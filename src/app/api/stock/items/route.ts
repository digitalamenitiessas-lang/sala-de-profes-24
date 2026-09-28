import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStockItems } from '@/lib/queries/stock'

// ---------------------------------------------------------------------------
// GET /api/stock/items
// Returns all active stock items. Used by production wizard, search inputs,
// the guided count and other client components.
//
// Query params:
//   preset — 'minimal' | 'summary' | 'full' | 'withSupplier' | 'conteo' (default: summary)
//   'conteo' = campos del conteo guiado (área, último conteo, vínculo Fudo,
//   costo); tolera que la migración de áreas no esté aplicada.
// ---------------------------------------------------------------------------

const CONTEO_BASE = 'id, name, unit, current_qty, min_qty, category, is_produced, fudo_ingredient_id, fudo_product_id, fudo_skip, last_counted_at, cost_per_unit, updated_at'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['socio', 'encargado', 'chef', 'cocina', 'barista'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const preset = (request.nextUrl.searchParams.get('preset') ?? 'summary') as
      'minimal' | 'summary' | 'full' | 'withSupplier' | 'conteo'

    if (preset === 'conteo') {
      const admin = createAdminClient()
      let res: { data: unknown[] | null; error: { message: string } | null } = await admin
        .from('stock_items')
        .select(`${CONTEO_BASE}, area, fudo_category`)
        .eq('is_active', true)
        .order('name')
      if (res.error && /area|fudo_category/i.test(res.error.message)) {
        res = await admin.from('stock_items').select(CONTEO_BASE).eq('is_active', true).order('name')
      }
      if (res.error) throw res.error
      return NextResponse.json({ items: res.data ?? [] })
    }

    const { data: items, error } = await getStockItems(preset)
    if (error) throw error

    return NextResponse.json({ items: items ?? [] })
  } catch (err) {
    console.error('[GET /api/stock/items]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
