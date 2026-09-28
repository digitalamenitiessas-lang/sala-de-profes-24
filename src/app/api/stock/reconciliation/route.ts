import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/stock/reconciliation
// ---------------------------------------------------------------------------
// Reconciliación de stock: compara expected vs actual.
//
// Query params:
//   view   'stock' (default) | 'menu'
//   from   ISO date/datetime (default: hoy 00:00)
//   to     ISO date/datetime (default: ahora)
//
// Ejemplos:
//   /api/stock/reconciliation                          → stock view, hoy
//   /api/stock/reconciliation?view=menu                → carta view, hoy
//   /api/stock/reconciliation?from=2026-04-05&to=2026-04-05T23:59:59
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const view = request.nextUrl.searchParams.get('view') ?? 'stock'
    const fromParam = request.nextUrl.searchParams.get('from')
    const toParam = request.nextUrl.searchParams.get('to')

    // Default: hoy 00:00 → ahora
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const from = fromParam ?? today.toISOString()
    const to = toParam ?? new Date().toISOString()

    const admin = createAdminClient()

    if (view === 'menu') {
      const { data, error } = await (admin.rpc as any)('menu_item_reconciliation', {
        p_from: from,
        p_to: to,
      })
      if (error) throw error

      type MenuRow = {
        menu_item_id: number
        menu_item_name: string
        recipe_id: string
        recipe_name: string | null
        qty_produced: number
        qty_sold: number
        expected_remaining: number
      }

      const items = (data ?? []) as MenuRow[]
      const totalProduced = items.reduce((s, i) => s + i.qty_produced, 0)
      const totalSold = items.reduce((s, i) => s + i.qty_sold, 0)
      const negativeItems = items.filter(i => i.expected_remaining < 0)

      return NextResponse.json({
        view: 'menu',
        from,
        to,
        total: items.length,
        total_produced: totalProduced,
        total_sold: totalSold,
        sell_through_pct: totalProduced > 0 ? Math.round((totalSold / totalProduced) * 100) : 0,
        negative_count: negativeItems.length,
        items,
        generatedAt: new Date().toISOString(),
      })
    }

    // Default: stock view
    const { data, error } = await (admin.rpc as any)('stock_reconciliation', {
      p_from: from,
      p_to: to,
    })
    if (error) throw error

    type StockRow = {
      stock_item_id: number
      name: string
      unit: string
      opening_qty: number
      received: number
      prod_in: number
      prod_out: number
      sales: number
      waste: number
      manual_adj: number
      expected_closing: number
      actual_closing: number
      variance: number
    }

    const items = (data ?? []) as StockRow[]
    const withVariance = items.filter(i => Math.abs(i.variance) > 0.01)
    const withMovement = items.filter(i =>
      i.received !== 0 || i.prod_in !== 0 || i.prod_out !== 0 ||
      i.sales !== 0 || i.waste !== 0 || i.manual_adj !== 0
    )

    return NextResponse.json({
      view: 'stock',
      from,
      to,
      total: items.length,
      with_movement: withMovement.length,
      with_variance: withVariance.length,
      items: withMovement,  // Solo items con movimiento en el periodo
      all_items: items,     // Todos (incluido sin movimiento)
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/stock/reconciliation]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
