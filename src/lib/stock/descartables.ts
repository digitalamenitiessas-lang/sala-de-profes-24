import type { SupabaseClient } from '@supabase/supabase-js'
import { writeFudoStockDelta } from '@/lib/fudo/stock-sync'
import { encolarDeltaStock } from '@/lib/fudo/reintentos'
import { notifyEvent } from '@/lib/push/notify-event'

// ---------------------------------------------------------------------------
// Descartables que se descuentan solos con las ventas PARA LLEVAR
// ---------------------------------------------------------------------------
// fudo_sales ya trae cada ítem vendido con raw_payload.sale_type
// ('TAKEAWAY' | 'EAT-IN'). Por cada ítem para llevar de un producto
// configurado (descartables_producto), se descuentan sus descartables
// (vaso, tapa…) del stock. Cada ítem se descuenta UNA vez
// (descartables_consumidos se reserva antes de descontar) y solo ventas
// posteriores a cuando se configuró ese producto: no hay retroactivo.
// Si un descartable queda en su mínimo o menos, avisa al encargado (una vez
// cada 12 h por descartable). Lo corre el pulso de Fudo cada 10 minutos.
// ---------------------------------------------------------------------------

const VENTANA_DIAS = 3
const AVISO_CADA_H = 12

type Config = { fudo_product_id: string; stock_item_id: string; cantidad: number; created_at: string }
type Venta = { fudo_sale_item_id: string; fudo_product_id: string; quantity: number; sold_at: string }

export async function procesarDescartablesParaLlevar(admin: SupabaseClient): Promise<{ items: number; descartables: Record<string, number>; avisos: number }> {
  const out = { items: 0, descartables: {} as Record<string, number>, avisos: 0 }
  const { data: cfgData } = await admin.from('descartables_producto').select('fudo_product_id, stock_item_id, cantidad, created_at')
  const config = (cfgData ?? []) as Config[]
  if (config.length === 0) return out

  const porProducto = new Map<string, Config[]>()
  for (const c of config) porProducto.set(c.fudo_product_id, [...(porProducto.get(c.fudo_product_id) ?? []), c])
  const desde = new Date(Math.max(
    Date.now() - VENTANA_DIAS * 86_400_000,
    Math.min(...config.map((c) => Date.parse(c.created_at))),
  )).toISOString()

  const { data: ventasData } = await admin.from('fudo_sales')
    .select('fudo_sale_item_id, fudo_product_id, quantity, sold_at')
    .eq('raw_payload->>sale_type', 'TAKEAWAY')
    .in('fudo_product_id', [...porProducto.keys()])
    .gte('sold_at', desde)
    .limit(2000)
  const ventas = ((ventasData ?? []) as Venta[]).filter((v) => v.fudo_sale_item_id)
  if (ventas.length === 0) return out

  // Ya descontados
  const { data: hechos } = await admin.from('descartables_consumidos').select('fudo_sale_item_id').in('fudo_sale_item_id', ventas.map((v) => v.fudo_sale_item_id))
  const yaHechos = new Set((hechos ?? []).map((h: { fudo_sale_item_id: string }) => h.fudo_sale_item_id))

  // Qué descuenta cada ítem nuevo (solo configuraciones anteriores a la venta)
  const filas = ventas.filter((v) => !yaHechos.has(v.fudo_sale_item_id)).map((v) => {
    const detalle = (porProducto.get(v.fudo_product_id) ?? [])
      .filter((c) => Date.parse(c.created_at) <= Date.parse(v.sold_at))
      .map((c) => ({ stock_item_id: c.stock_item_id, cantidad: Number(c.cantidad) * (Number(v.quantity) || 1) }))
    return { fudo_sale_item_id: v.fudo_sale_item_id, fudo_product_id: v.fudo_product_id, vendido_at: v.sold_at, detalle }
  }).filter((f) => f.detalle.length > 0)
  if (filas.length === 0) return out

  // Reservar antes de descontar: si dos procesos corren a la vez, solo uno gana cada ítem
  const { data: reservados } = await admin.from('descartables_consumidos')
    .upsert(filas, { onConflict: 'fudo_sale_item_id', ignoreDuplicates: true })
    .select('fudo_sale_item_id')
  const mios = new Set((reservados ?? []).map((r: { fudo_sale_item_id: string }) => r.fudo_sale_item_id))
  const consumo = new Map<string, number>()
  for (const f of filas) {
    if (!mios.has(f.fudo_sale_item_id)) continue
    out.items++
    for (const d of f.detalle) consumo.set(d.stock_item_id, (consumo.get(d.stock_item_id) ?? 0) + d.cantidad)
  }

  for (const [stockItemId, n] of consumo) {
    const { data: item } = await admin.from('stock_items')
      .select('id, name, unit, current_qty, min_qty, fudo_ingredient_id, fudo_product_id, fudo_skip, aviso_minimo_at')
      .eq('id', stockItemId).maybeSingle()
    if (!item) continue
    const antes = Number(item.current_qty ?? 0)
    let despues = Math.round((antes - n) * 1000) / 1000

    // Si el descartable está vinculado a Fudo, el movimiento va también a Fudo
    if ((item.fudo_ingredient_id || item.fudo_product_id) && !item.fudo_skip) {
      const res = await writeFudoStockDelta(
        { fudoIngredientId: item.fudo_ingredient_id, fudoProductId: item.fudo_product_id },
        -n,
        { admin, operation: 'descartables_para_llevar', stockItemId: item.id, entityType: 'descartables', reason: 'waste', note: `${n} usados en ventas para llevar` },
      )
      if (res.success && typeof res.fudoAfter === 'number') despues = res.fudoAfter
      else await encolarDeltaStock(admin, { stockItemId: item.id, delta: -n, origen: 'merma', error: res.error ?? 'Fudo no aceptó el movimiento', nota: 'Descartables de ventas para llevar' })
    }

    await admin.from('stock_items').update({ current_qty: despues, updated_at: new Date().toISOString() }).eq('id', item.id)
    await admin.from('stock_logs').insert({ stock_item_id: item.id, user_id: null, action: 'consumo_para_llevar', old_qty: antes, new_qty: despues, note: `${n} ${item.unit} usados en ventas para llevar` })
    out.descartables[item.name] = n

    // Aviso de mínimo (uno cada 12 h por descartable)
    const minimo = Number(item.min_qty ?? 0)
    const ultimoAviso = item.aviso_minimo_at ? Date.parse(item.aviso_minimo_at) : 0
    if (minimo > 0 && despues <= minimo && Date.now() - ultimoAviso > AVISO_CADA_H * 3_600_000) {
      const { data: reservado } = await admin.from('stock_items').update({ aviso_minimo_at: new Date().toISOString() })
        .eq('id', item.id).or(`aviso_minimo_at.is.null,aviso_minimo_at.lt.${new Date(Date.now() - AVISO_CADA_H * 3_600_000).toISOString()}`)
        .select('id')
      if ((reservado ?? []).length > 0) {
        await notifyEvent(admin, 'faltante_reportado', {
          title: `📦 Quedan ${Math.max(0, Math.floor(despues))} ${item.name}`,
          body: `Bajó del mínimo (${minimo}) con las ventas para llevar. Revisá y pedí reposición antes de que falte.`,
          url: '/stock?area=descartables',
        }).catch(() => {})
        out.avisos++
      }
    }
  }
  return out
}
