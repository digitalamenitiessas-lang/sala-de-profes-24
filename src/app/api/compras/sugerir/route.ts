import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { ROLES } from '@/lib/constants'

// ---------------------------------------------------------------------------
// GET /api/compras/sugerir — datos de "Sugerir compra" (cualquier empleado)
//   insumos: lo que se compra (sin elaborados), para reconocer la lista
//   mios:    mis sugerencias de los últimos 10 días, con su estado
// La sugerencia se manda con POST /api/kitchen/orders (create_order): queda
// "sin enviar" en Compras y les llega a los encargados, que son los únicos
// que hacen el pedido.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireRole(Object.keys(ROLES))
  if (auth.response) return auth.response
  const admin = createAdminClient()
  const desde = new Date(Date.now() - 10 * 86_400_000).toISOString()

  const [{ data: insumos }, { data: mios }, { data: proveedores }] = await Promise.all([
    admin.from('stock_items').select('id, name, unit, fudo_product_id, fudo_ingredient_id, supplier_id')
      .eq('is_active', true).eq('is_produced', false).order('name'),
    admin.from('kitchen_orders').select('id, product_name, quantity, status, note, supplier_id, created_at, ordered_at, received_at, urgency')
      .eq('created_by', auth.user.id).gte('created_at', desde).order('created_at', { ascending: false }).limit(80),
    admin.from('suppliers').select('id, name'),
  ])
  const nombreProv = new Map(((proveedores ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]))

  type Fila = { id: string; name: string; unit: string; fudo_product_id: string | null; fudo_ingredient_id: string | null; supplier_id: string | null }
  return NextResponse.json({
    // Productos de Fudo sin ingrediente son platos ("Adicional huevo"), salvo reventa con proveedor
    insumos: ((insumos ?? []) as Fila[])
      .filter((i) => !(i.fudo_product_id && !i.fudo_ingredient_id && !i.supplier_id))
      .map((i) => ({ id: i.id, name: i.name, unit: i.unit })),
    mios: ((mios ?? []) as { supplier_id: string | null }[]).map((o) => ({ ...o, proveedor: o.supplier_id ? nombreProv.get(o.supplier_id) ?? null : null })),
  })
}
