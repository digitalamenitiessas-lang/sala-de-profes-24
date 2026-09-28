import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { suggestSupplier, type SupplierOption } from '@/lib/proveedores/supplier-match'

// ---------------------------------------------------------------------------
// GET /api/proveedores/sin-vincular
// ---------------------------------------------------------------------------
// Stock items vinculados a Fudo (ingrediente o producto) sin proveedor en LVE,
// con una sugerencia de proveedor por coincidencia de texto cuando aplica.
//
// Fudo no expone (ni permite escribir) un vínculo insumo→proveedor en su API,
// así que el vínculo vive acá — apuntando siempre a un proveedor real de Fudo.
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    const [itemsRes, suppliersRes] = await Promise.all([
      admin
        .from('stock_items')
        .select('id, name, category, unit, fudo_ingredient_id, fudo_product_id')
        .eq('is_active', true)
        .is('supplier_id', null)
        .or('fudo_ingredient_id.not.is.null,fudo_product_id.not.is.null')
        .order('category')
        .order('name'),
      admin
        .from('suppliers')
        .select('id, name')
        .eq('is_active', true)
        .order('name'),
    ])

    if (itemsRes.error) throw itemsRes.error
    if (suppliersRes.error) throw suppliersRes.error

    const suppliers: SupplierOption[] = suppliersRes.data ?? []

    const items = (itemsRes.data ?? []).map((item) => ({
      ...item,
      suggestion: suggestSupplier(item, suppliers),
    }))

    return NextResponse.json({
      items,
      suppliers,
      total: items.length,
      withSuggestion: items.filter((i) => i.suggestion).length,
    })
  } catch (error) {
    console.error('[GET /api/proveedores/sin-vincular]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
