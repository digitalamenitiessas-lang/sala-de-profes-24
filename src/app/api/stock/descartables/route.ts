import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// /api/stock/descartables — qué descartables usa cada producto PARA LLEVAR
//   GET  → descartables (stock del área descartables), productos de la carta
//          con cuántas veces se vendieron para llevar en 30 días, y la config.
//   POST { fudo_product_id, items: [{ stock_item_id, cantidad }] } → reemplaza
//          la config de ese producto (vale para ventas desde ahora).
// Encargados y socios.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const auth = await requireRole(['socio', 'encargado'])
  if (auth.response) return auth.response
  const admin = createAdminClient()

  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const llevar = new Map<string, number>()
  for (let from = 0; from < 20_000; from += 1000) {
    const { data } = await admin.from('fudo_sales').select('fudo_product_id, quantity')
      .eq('raw_payload->>sale_type', 'TAKEAWAY').gte('sold_at', desde).range(from, from + 999)
    for (const r of (data ?? []) as { fudo_product_id: string; quantity: number }[]) {
      llevar.set(r.fudo_product_id, (llevar.get(r.fudo_product_id) ?? 0) + (Number(r.quantity) || 1))
    }
    if ((data ?? []).length < 1000) break
  }

  const [{ data: descartables }, { data: productos }, { data: cats }, { data: config }] = await Promise.all([
    admin.from('stock_items').select('id, name, unit, current_qty, min_qty').eq('is_active', true).eq('area', 'descartables').order('name'),
    admin.from('menu_items').select('fudo_product_id, name, category, menu_category_id').eq('is_active', true).not('fudo_product_id', 'is', null),
    admin.from('menu_categories').select('id, name'),
    admin.from('descartables_producto').select('fudo_product_id, stock_item_id, cantidad'),
  ])
  const catNombre = new Map(((cats ?? []) as { id: number | string; name: string }[]).map((c) => [String(c.id), c.name]))
  const lista = ((productos ?? []) as unknown as { fudo_product_id: string; name: string; category: string | null; menu_category_id: number | string | null }[])
    .map((p) => ({
      fudo_product_id: p.fudo_product_id,
      nombre: p.name,
      categoria: (p.menu_category_id != null && catNombre.get(String(p.menu_category_id))) || p.category || 'Sin categoría',
      para_llevar_30d: llevar.get(p.fudo_product_id) ?? 0,
    }))
    .sort((a, b) => b.para_llevar_30d - a.para_llevar_30d || a.nombre.localeCompare(b.nombre, 'es'))

  return NextResponse.json({ descartables: descartables ?? [], productos: lista, config: config ?? [] })
}

export async function POST(request: Request) {
  const auth = await requireRole(['socio', 'encargado'])
  if (auth.response) return auth.response
  const body = await request.json().catch(() => null) as { fudo_product_id?: string; items?: { stock_item_id?: string; cantidad?: number }[] } | null
  const productId = String(body?.fudo_product_id ?? '').trim()
  if (!productId || !Array.isArray(body?.items)) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
  const items = body!.items!
    .filter((i) => UUID.test(String(i.stock_item_id)) && Number(i.cantidad) > 0)
    .map((i) => ({ fudo_product_id: productId, stock_item_id: i.stock_item_id!, cantidad: Math.min(20, Number(i.cantidad)), created_by: auth.user.id }))

  const admin = createAdminClient()
  const { data: actual } = await admin.from('descartables_producto').select('stock_item_id, cantidad').eq('fudo_product_id', productId)
  // Lo que no cambió se deja como está (mantiene su fecha de inicio)
  const igual = (a: { stock_item_id: string; cantidad: number }) => items.some((i) => i.stock_item_id === a.stock_item_id && Number(i.cantidad) === Number(a.cantidad))
  const borrar = ((actual ?? []) as { stock_item_id: string; cantidad: number }[]).filter((a) => !igual(a)).map((a) => a.stock_item_id)
  if (borrar.length) await admin.from('descartables_producto').delete().eq('fudo_product_id', productId).in('stock_item_id', borrar)
  const nuevos = items.filter((i) => !((actual ?? []) as { stock_item_id: string; cantidad: number }[]).some((a) => igual(a) && a.stock_item_id === i.stock_item_id))
  if (nuevos.length) {
    const { error } = await admin.from('descartables_producto').insert(nuevos)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { data: prod } = await admin.from('menu_items').select('name').eq('fudo_product_id', productId).maybeSingle()
  void logAudit(admin, {
    userId: auth.user.id, userName: null, action: 'descartables_config', module: 'stock', entityType: 'menu_item', entityId: productId,
    description: `Descartables para llevar de "${prod?.name ?? productId}": ${items.length ? `${items.length} configurado${items.length !== 1 ? 's' : ''}` : 'ninguno'}`,
  })
  return NextResponse.json({ success: true })
}
