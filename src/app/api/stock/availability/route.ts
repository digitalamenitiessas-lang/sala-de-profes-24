import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// POST /api/stock/availability
// ---------------------------------------------------------------------------
// Lista disponibilidad de TODAS las recetas activas con ingredientes vinculados.
// Usa la RPC stock_yield() que devuelve todas las recetas de una sola vez.
//
// Body (opcional):
//   threshold (number, default 0) — porciones mínimas para considerar "ok"
//
// Response:
//   { total_recipes, at_risk_count, ok_count, recipes: [...] }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const threshold: number = body?.threshold ?? 0

    const admin = createAdminClient()

    // stock_yield() returns all recipes with their max_portions and ingredients
    const { data, error } = await (admin.rpc as any)('stock_yield')
    if (error) throw error

    type YieldRow = {
      recipe_id: string
      recipe_name: string
      yield_portions: number
      max_portions: number
      limiting_item: string | null
      limiting_qty: number | null
      limiting_need: number | null
      ingredients: Array<{
        stock_item_id: string
        name: string
        current_qty: number
        qty_per_portion: number
        yield: number
      }>
    }

    const rows = (data ?? []) as YieldRow[]

    // Transform to the format the rendimiento page expects
    const recipes = rows.map(r => ({
      recipe_id: r.recipe_id,
      recipe_name: r.recipe_name,
      available_portions: r.max_portions,
      limiting_ingredient: r.limiting_item,
      warning: false,
      ingredients: (r.ingredients ?? []).map(ing => ({
        stock_item_id: ing.stock_item_id,
        name: ing.name,
        current_qty: ing.current_qty,
        qty_per_portion: ing.qty_per_portion,
        available_portions: ing.yield,
        unit: '',
        is_limiting: ing.name === r.limiting_item,
      })),
    }))

    const atRisk = recipes.filter(r => r.available_portions <= threshold)
    const ok = recipes.filter(r => r.available_portions > threshold)

    return NextResponse.json({
      success: true,
      threshold,
      total_recipes: recipes.length,
      at_risk_count: atRisk.length,
      ok_count: ok.length,
      recipes,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/stock/availability POST]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// GET /api/stock/availability?recipe_id=UUID
//   — Single recipe availability (filters stock_yield by recipe_id)
//
// GET /api/stock/availability?threshold=10[&status=sin_stock|bajo|ok]
//   — All recipes at-risk view (calls recipes_at_risk RPC).
//     This replaces the deprecated /api/stock/at-risk endpoint.
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

    const recipeId = request.nextUrl.searchParams.get('recipe_id')

    // --- Single recipe mode ---
    if (recipeId) {
      const admin = createAdminClient()
      const { data, error } = await (admin.rpc as any)('stock_yield')
      if (error) throw error

      const match = (data ?? []).find((r: any) => r.recipe_id === recipeId)
      if (!match) {
        return NextResponse.json({ error: 'Receta no encontrada o sin ingredientes vinculados' }, { status: 404 })
      }

      return NextResponse.json({
        recipe_id: match.recipe_id,
        recipe_name: match.recipe_name,
        available_portions: match.max_portions,
        limiting_ingredient: match.limiting_item,
        ingredients: match.ingredients,
      })
    }

    // --- All recipes at-risk mode (replaces /api/stock/at-risk) ---
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

    if (statusFilter) {
      results = results.filter(r => r.status === statusFilter)
    }

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
    console.error('[/api/stock/availability GET]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
