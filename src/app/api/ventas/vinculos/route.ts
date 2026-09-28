import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { logAudit } from '@/lib/audit'
import {
  autoVincularPlatos,
  buildVentasVinculos,
  ultimaAutoVinculacion,
  type VentasVinculosPayload,
} from '@/lib/ventas/vinculos-recetas'

// ---------------------------------------------------------------------------
// /api/ventas/vinculos — platos vendidos ↔ recetas (encargados y socios)
//   GET  → lo que falta vincular, ordenado por facturación. Antes corre la
//          vinculación automática si pasaron 30 min. ?resumen=1 → solo totales.
//   POST → { menu_item_id, accion: 'receta' | 'insumo' | 'combo' | 'sin_consumo',
//            recipe_id?, stock_item_id?, qty? }
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const AUTO_CADA_MS = 30 * 60 * 1000
const CACHE_MS = 5 * 60 * 1000
let cache: { at: number; payload: VentasVinculosPayload } | null = null
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function payload(fresh: boolean): Promise<VentasVinculosPayload> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.payload
  const admin = createAdminClient()
  const ultima = ultimaAutoVinculacion()
  if (!ultima || Date.now() - ultima.at > AUTO_CADA_MS) {
    await autoVincularPlatos(admin).catch((err) => console.error('[ventas/vinculos] auto', err))
  }
  const p = await buildVentasVinculos(admin, 30)
  cache = { at: Date.now(), payload: p }
  return p
}

export async function GET(request: Request) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response
    const url = new URL(request.url)
    const p = await payload(url.searchParams.get('fresh') === '1')
    if (url.searchParams.get('resumen') === '1') {
      return NextResponse.json({
        pendientes: p.pendientes.length + p.opciones.length,
        revenue_pendiente: p.resumen.revenue_pendiente,
        cobertura_pct: p.resumen.cobertura_pct,
      })
    }
    return NextResponse.json(p)
  } catch (err) {
    console.error('[GET /api/ventas/vinculos]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response

    const body = await request.json().catch(() => null) as { menu_item_id?: string; accion?: string; recipe_id?: string; stock_item_id?: string; qty?: number } | null
    const accion = body?.accion
    if (!body || !UUID.test(String(body.menu_item_id)) || !['receta', 'insumo', 'combo', 'sin_consumo'].includes(String(accion))) {
      return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
    }
    if (accion === 'receta' && !UUID.test(String(body.recipe_id))) {
      return NextResponse.json({ error: 'Falta la receta' }, { status: 400 })
    }
    const qty = Number(body.qty)
    if (accion === 'insumo' && (!UUID.test(String(body.stock_item_id)) || !(qty > 0) || qty > 1000)) {
      return NextResponse.json({ error: 'Falta el insumo o la cantidad' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: plato } = await admin.from('menu_items').select('id, name').eq('id', body.menu_item_id!).maybeSingle()
    if (!plato) return NextResponse.json({ error: 'Plato no encontrado' }, { status: 404 })

    let recetaNombre: string | null = null
    if (accion === 'receta') {
      const { data: receta } = await admin.from('recipes').select('id, name').eq('id', body.recipe_id!).eq('is_active', true).maybeSingle()
      if (!receta) return NextResponse.json({ error: 'Receta no encontrada o inactiva' }, { status: 404 })
      recetaNombre = receta.name
    }

    let insumoNombre: string | null = null
    if (accion === 'insumo') {
      const { data: insumo } = await admin.from('stock_items').select('id, name, unit').eq('id', body.stock_item_id!).eq('is_active', true).maybeSingle()
      if (!insumo) return NextResponse.json({ error: 'Insumo no encontrado o inactivo' }, { status: 404 })
      insumoNombre = `${qty} ${insumo.unit} de ${insumo.name}`
    }

    const { error } = await admin.from('menu_items').update({
      consumo_modo: accion,
      recipe_id: accion === 'receta' ? body.recipe_id! : null,
      consumo_stock_item_id: accion === 'insumo' ? body.stock_item_id! : null,
      consumo_qty: accion === 'insumo' ? qty : null,
      recipe_link_source: 'manual',
      updated_at: new Date().toISOString(),
    }).eq('id', plato.id)
    if (error) throw error

    const { data: perfil } = await admin.from('profiles').select('first_name, last_name').eq('id', auth.user.id).maybeSingle()
    const quien = [perfil?.first_name, perfil?.last_name].filter(Boolean).join(' ') || null
    const que = accion === 'receta' ? `usa la receta "${recetaNombre}"` : accion === 'insumo' ? `descuenta ${insumoNombre}` : accion === 'combo' ? 'se cuenta por lo elegido (combo)' : 'no descuenta insumos'
    void logAudit(admin, {
      userId: auth.user.id, userName: quien, action: 'link_menu_item_recipe', module: 'recetas',
      entityType: 'menu_item', entityId: plato.id,
      description: `${quien ?? 'Alguien'}: "${plato.name}" ${que}`,
      metadata: { accion, recipe_id: body.recipe_id ?? null, stock_item_id: body.stock_item_id ?? null, qty: accion === 'insumo' ? qty : null },
    })

    cache = null
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[POST /api/ventas/vinculos]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
