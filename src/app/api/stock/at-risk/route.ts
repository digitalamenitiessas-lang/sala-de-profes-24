import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// DEPRECATED: Use /api/stock/availability?threshold=N instead.
// This endpoint is kept for backwards compatibility only.
// ---------------------------------------------------------------------------
// GET /api/stock/at-risk
// ---------------------------------------------------------------------------
// Lista todas las recetas con stock insuficiente para producción.
// Llama a la RPC recipes_at_risk(p_min_portions_threshold).
//
// Query params:
//   threshold (optional, default 10) — mínimo de porciones para no ser "en riesgo"
//
// Respuesta:
//   [{
//     recipe_id, recipe_name,
//     available_portions,
//     limiting_ingredient,
//     status: 'sin_stock' | 'bajo' | 'ok'
//   }]
//
// Ejemplo de uso en cocina:
//   /api/stock/at-risk?threshold=5
//   → "Milanesa: solo 2.7 porciones posibles — falta nalga"
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const threshold = Number(request.nextUrl.searchParams.get('threshold') ?? '10')
    const statusFilter = request.nextUrl.searchParams.get('status') // 'sin_stock' | 'bajo' | 'ok' | null (all)

    const admin = createAdminClient()

    const { data, error } = await (admin.rpc as any)('recipes_at_risk', {
      p_min_portions: threshold,
    })

    if (error) throw error

    type RecipeAtRisk = {
      recipe_id: number
      recipe_name: string
      available_portions: number
      limiting_ingredient: string | null
      limiting_item_id: number | null
      status: string
    }

    let results: RecipeAtRisk[] = (data ?? []) as unknown as RecipeAtRisk[]

    // Filter by status if requested
    if (statusFilter) {
      results = results.filter(r => r.status === statusFilter)
    }

    // Separate counts
    const sinStock = results.filter(r => r.status === 'sin_stock')
    const bajo = results.filter(r => r.status === 'bajo')
    const ok = results.filter(r => r.status === 'ok')

    // Enrich with stock_item details for limiting ingredient
    const limitingIds = [...new Set(results.map(r => r.limiting_item_id).filter(Boolean))]
    let limitingDetails: Record<number, { unit: string; current_qty: number }> = {}

    if (limitingIds.length > 0) {
      const { data: stockDetails } = await admin
        .from('stock_items')
        .select('id, unit, current_qty')
        .in('id', limitingIds as number[])

      limitingDetails = Object.fromEntries(
        (stockDetails ?? []).map(s => [s.id, { unit: s.unit, current_qty: s.current_qty }])
      )
    }

    const enriched = results.map(r => ({
      ...r,
      limiting_ingredient_unit: r.limiting_item_id ? limitingDetails[r.limiting_item_id]?.unit ?? null : null,
      limiting_ingredient_current_qty: r.limiting_item_id ? limitingDetails[r.limiting_item_id]?.current_qty ?? null : null,
    }))

    return NextResponse.json({
      success: true,
      threshold,
      total: results.length,
      sin_stock_count: sinStock.length,
      bajo_count: bajo.length,
      ok_count: ok.length,
      recipes: enriched,
      alert: sinStock.length > 0
        ? `⚠️ ${sinStock.length} receta(s) sin stock suficiente para producir`
        : bajo.length > 0
          ? `ℹ️ ${bajo.length} receta(s) con stock bajo (< ${threshold} porciones)`
          : null,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/stock/at-risk]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
