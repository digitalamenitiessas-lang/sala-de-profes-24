import type { SupabaseClient } from '@supabase/supabase-js'
import { esFacturaEnFudo } from '@/lib/compras/datos-gasto'
import { fraccionADecimal } from '@/lib/compras/lista-pegada'
import { syncToFudo } from '@/lib/fudo/stock-sync'
import { normalizeToStockUnit, parseTypedUnit } from '@/lib/produccion/units'

// ---------------------------------------------------------------------------
// Facturas A: se cargan en Fudo, no desde la app (decisión de administración,
// 29/10/2026, para las dos sucursales)
// ---------------------------------------------------------------------------
// Administración concilia por número de factura, fecha y total, y necesita el
// IVA y el IIBB como impuestos en Fudo: la API de Fudo no deja cargarlos, así
// que desde la app quedaban solo en la descripción. Ahora una compra con
// Factura A NO crea gasto en Fudo desde la app:
//   · "Ya está cargado en Fudo": se vincula a ese gasto (link_fudo_expense).
//   · Si todavía no está: el pedido queda recibido con la factura pendiente
//     (received_mode 'factura_pendiente'), sin stock ni gasto. Cuando la
//     factura aparece en Fudo, el importador la vincula sola (importarGastos
//     Manuales) y el stock entra por Fudo (con los productos de la factura).
// ---------------------------------------------------------------------------

export const MODO_FACTURA_PENDIENTE = 'factura_pendiente'

export { esFacturaEnFudo }

type Tabla = 'kitchen_orders' | 'bar_orders'
const tablaDe = (source: 'cocina' | 'barra'): Tabla => (source === 'barra' ? 'bar_orders' : 'kitchen_orders')

/** Llegó, la factura la carga administración en Fudo: el pedido queda recibido sin stock ni gasto */
export async function marcarFacturaPendiente(admin: SupabaseClient, userId: string, p: {
  orderId: number; source: 'cocina' | 'barra'; receivedQty?: string | null; stockItemId?: string | null
  numero?: string | null; nota?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const tabla = tablaDe(p.source)
  const { data } = await admin.from(tabla).select('id, status, quantity, stock_item_id').eq('id', p.orderId).maybeSingle()
  const order = data as { id: number; status: string; quantity: string | null; stock_item_id: string | null } | null
  if (!order) return { ok: false, error: 'Pedido no encontrado' }
  if (order.status === 'received') return { ok: false, error: 'Ya estaba recibido' }
  if (order.status === 'cancelled') return { ok: false, error: 'El pedido está cancelado' }
  const ahoraIso = new Date().toISOString()
  const cantidad = (p.receivedQty ?? '').trim() ? fraccionADecimal(String(p.receivedQty).trim()) : order.quantity
  const numero = p.numero?.trim() || null
  const nota = p.nota?.trim() || null
  const { error } = await admin.from(tabla).update({
    status: 'received',
    received_mode: MODO_FACTURA_PENDIENTE,
    received_qty: cantidad,
    received_at: ahoraIso,
    received_by: userId,
    // Con el insumo el importador reconoce el renglón de la factura en Fudo
    ...(!order.stock_item_id && p.stockItemId ? { stock_item_id: p.stockItemId } : {}),
    received_note: `Factura A${numero ? ` N° ${numero}` : ''}: falta cargarla en Fudo (el stock entra con la factura)${nota ? ` — ${nota}` : ''}`,
    updated_at: ahoraIso,
  }).eq('id', order.id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export type PedidoPendiente = {
  id: number; source: 'cocina' | 'barra'; supplier_id: string | null; stock_item_id: string | null
  product_name: string; received_qty: string | null; received_at: string | null
}

/** Pedidos recibidos con la factura pendiente de cargar en Fudo */
export async function pedidosConFacturaPendiente(admin: SupabaseClient, supplierIds?: string[]): Promise<PedidoPendiente[]> {
  const leer = async (tabla: Tabla, source: 'cocina' | 'barra') => {
    let q = admin.from(tabla).select('id, supplier_id, stock_item_id, product_name, received_qty, received_at')
      .eq('status', 'received').eq('received_mode', MODO_FACTURA_PENDIENTE)
    if (supplierIds) q = q.in('supplier_id', supplierIds)
    const { data } = await q
    return ((data ?? []) as Omit<PedidoPendiente, 'source'>[]).map((o) => ({ ...o, source }))
  }
  const [cocina, barra] = await Promise.all([leer('kitchen_orders', 'cocina'), leer('bar_orders', 'barra')])
  return [...cocina, ...barra]
}

/**
 * Pedidos pendientes que explica una factura de Fudo: los del mismo proveedor
 * cuyo insumo está en la factura (recibidos hasta 10 días antes de cargarla),
 * más los que llegaron el mismo día que esos (misma entrega). Si la factura
 * no reconoce ningún insumo, no se adivina: queda para vincular a mano.
 */
export function pedidosDeLaFactura(
  pendientes: PedidoPendiente[],
  factura: { supplierId: string; fecha: string; stockItemIds: Set<string> },
): PedidoPendiente[] {
  const t = Date.parse(factura.fecha)
  const delProveedor = pendientes.filter((o) => {
    if (o.supplier_id !== factura.supplierId || !o.received_at) return false
    const r = Date.parse(o.received_at)
    return r <= t + 3_600_000 && r >= t - 10 * 86_400_000
  })
  const diaAR = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Tucuman' })
  const dias = new Set(delProveedor.filter((o) => o.stock_item_id && factura.stockItemIds.has(o.stock_item_id)).map((o) => diaAR(o.received_at!)))
  return delProveedor.filter((o) => dias.has(diaAR(o.received_at!)))
}

/** Cierra un pedido pendiente con su factura de Fudo */
export async function cerrarConFactura(admin: SupabaseClient, o: { id: number; source: 'cocina' | 'barra' }, expenseId: string, monto: number | null) {
  const { error } = await admin.from(tablaDe(o.source)).update({
    received_mode: 'fudo_expense', fudo_expense_id: expenseId, fudo_amount: monto,
    received_note: `Factura cargada en Fudo (gasto #${expenseId})`, updated_at: new Date().toISOString(),
  }).eq('id', o.id).eq('received_mode', MODO_FACTURA_PENDIENTE)
  if (error) console.warn('[factura-en-fudo] pedido sin cerrar:', o.id, error.message)
  return !error
}

/**
 * Pedido de la entrega que la factura de Fudo no trae como renglón (producto
 * sin vínculo con Fudo, o que no cargaron): Fudo no le sumó stock, lo suma la
 * app con la cantidad que llegó.
 */
export async function sumarStockSinRenglon(admin: SupabaseClient, o: PedidoPendiente, expenseId: string): Promise<void> {
  if (!o.stock_item_id) return
  const escrito = fraccionADecimal(String(o.received_qty ?? ''))
  const numero = parseFloat(escrito.replace(',', '.'))
  if (!(Number.isFinite(numero) && numero > 0)) return
  const { data } = await admin.from('stock_items').select('name, current_qty, unit').eq('id', o.stock_item_id).maybeSingle()
  const si = data as { name: string; current_qty: number | null; unit: string } | null
  if (!si) return
  // "500 g" en un insumo en kg → 0,5 (misma regla que "Llegó")
  const norm = normalizeToStockUnit(numero, parseTypedUnit(escrito) ?? si.unit, si)
  if (!norm.ok) { console.warn('[factura-en-fudo] cantidad sin convertir:', o.product_name, norm.error); return }
  const r = await syncToFudo(admin, o.stock_item_id, Math.round((Number(si.current_qty ?? 0) + norm.qty) * 100) / 100, undefined, {
    reason: 'reception',
    deltaOverride: norm.qty,
    note: `Recepción: ${o.product_name} (+${norm.qty} ${si.unit}) — la factura de Fudo (gasto #${expenseId}) no lo trae como renglón`,
  })
  if (!r.success) console.warn('[factura-en-fudo] stock sin sumar:', o.product_name, r.error)
}

/**
 * La factura ya estaba en Fudo cuando se marcó la llegada (el importador la
 * trajo antes, como compra suelta): se cierra el pedido con ella al toque.
 * Devuelve el gasto vinculado, o null si todavía no está.
 */
export async function vincularSiYaEstaEnFudo(admin: SupabaseClient, o: { id: number; source: 'cocina' | 'barra' }): Promise<string | null> {
  const { data } = await admin.from(tablaDe(o.source)).select('supplier_id, stock_item_id, received_mode').eq('id', o.id).maybeSingle()
  const order = data as { supplier_id: string | null; stock_item_id: string | null; received_mode: string | null } | null
  if (!order?.supplier_id || !order.stock_item_id || order.received_mode !== MODO_FACTURA_PENDIENTE) return null
  const desde = new Date(Date.now() - 10 * 86_400_000).toISOString()
  const { data: recibos } = await admin.from('stock_receipts')
    .select('id, fudo_expense_id, cost_total')
    .eq('supplier_id', order.supplier_id).eq('stock_item_id', order.stock_item_id)
    .is('order_id', null).not('fudo_expense_id', 'is', null)
    .like('note', 'Importado desde Fudo%').gte('received_at', desde)
    .order('received_at', { ascending: false }).limit(1)
  const r = ((recibos ?? []) as { id: number; fudo_expense_id: string; cost_total: number | null }[])[0]
  if (!r) return null
  await admin.from('stock_receipts').update({ order_id: o.id, order_source: o.source }).eq('id', r.id)
  return (await cerrarConFactura(admin, o, r.fudo_expense_id, r.cost_total)) ? r.fudo_expense_id : null
}
