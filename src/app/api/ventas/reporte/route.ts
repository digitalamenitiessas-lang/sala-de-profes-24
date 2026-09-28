import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { costRecipes } from '@/lib/recipes/recipe-cost'

// ---------------------------------------------------------------------------
// GET /api/ventas/reporte?days=30|60|90
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000
const PAGE_SIZE = 1000
const VALID_DAYS = new Set([30, 60, 90])

export type ReporteDish = {
  menu_item_id: string
  name: string
  category: string
  units: number
  avg_price: number
  cost_per_portion: number
  food_cost_pct: number
}

export type BrokenDish = {
  menu_item_id: string
  name: string
  category: string
  units: number
  missing_items: string[]
}

export type ReportePayload = {
  days: number
  from: string
  to: string
  dishes: ReporteDish[]
  broken: BrokenDish[]
  generated_at: string
}

const cache = new Map<number, { at: number; payload: ReportePayload }>()

function arToday(): string {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 0; page < 50; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await query(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return rows
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!isManagerOrAbove(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const rawDays = Number(request.nextUrl.searchParams.get('days') ?? 30) || 30
    const days = VALID_DAYS.has(rawDays) ? rawDays : 30

    const cached = cache.get(days)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload)
    }

    const admin = createAdminClient()
    const todayAR = arToday()
    const sinceDate = new Date(new Date(`${todayAR}T12:00:00Z`).getTime() - (days - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const sinceUTC = new Date(`${sinceDate}T00:00:00-03:00`).toISOString()

    const { data: menuItems, error: miError } = await admin
      .from('menu_items')
      .select('id, name, category, recipe_id, fudo_product_id')
      .eq('is_active', true)
      .not('recipe_id', 'is', null)
      .not('fudo_product_id', 'is', null)
    if (miError) throw new Error(miError.message)

    type SaleRow = { fudo_product_id: string | null; quantity: number; price: number | null }

    const recipeIds = [...new Set((menuItems ?? []).map(mi => mi.recipe_id as string))]
    const [recipeCosts, sales] = await Promise.all([
      costRecipes(admin, recipeIds),
      fetchAll<SaleRow>((from, to) =>
        admin
          .from('fudo_sales')
          .select('fudo_product_id, quantity, price:raw_payload->price')
          .gte('sold_at', sinceUTC)
          .order('id', { ascending: true })
          .range(from, to) as never,
      ),
    ])

    type ProductAgg = { units: number; pricedUnits: number; pricedRevenue: number }
    const byProduct = new Map<string, ProductAgg>()
    for (const s of sales) {
      if (!s.fudo_product_id) continue
      const qty = Number(s.quantity ?? 0)
      const price = s.price != null ? Number(s.price) : null
      const agg = byProduct.get(s.fudo_product_id) ?? { units: 0, pricedUnits: 0, pricedRevenue: 0 }
      agg.units += qty
      if (price != null && price > 0) {
        agg.pricedUnits += qty
        agg.pricedRevenue += qty * price
      }
      byProduct.set(s.fudo_product_id, agg)
    }

    const dishes: ReporteDish[] = []
    const brokenCandidates: Array<{ mi: typeof menuItems[0]; units: number }> = []

    for (const mi of menuItems ?? []) {
      const agg = mi.fudo_product_id ? byProduct.get(mi.fudo_product_id) : undefined
      if (!agg || agg.units <= 0) continue

      const rc = mi.recipe_id ? recipeCosts.get(mi.recipe_id) : undefined
      const avgPrice = agg.pricedUnits > 0 ? agg.pricedRevenue / agg.pricedUnits : 0

      if (!rc || rc.missing > 0 || rc.cost <= 0 || avgPrice <= 0) {
        brokenCandidates.push({ mi, units: Math.round(agg.units) })
        continue
      }

      dishes.push({
        menu_item_id: mi.id,
        name: mi.name,
        category: mi.category ?? '',
        units: Math.round(agg.units),
        avg_price: Math.round(avgPrice),
        cost_per_portion: Math.round(rc.cost),
        food_cost_pct: Math.round((rc.cost / avgPrice) * 1000) / 10,
      })
    }

    dishes.sort((a, b) => b.units - a.units)

    // ── Identificar qué ingredientes faltan en las recetas rotas ──────────────
    const broken: BrokenDish[] = []
    if (brokenCandidates.length > 0) {
      const brokenRecipeIds = [...new Set(brokenCandidates.map(x => x.mi.recipe_id as string))]

      const { data: riRows } = await admin
        .from('recipe_ingredients')
        .select('recipe_id, stock_item_id')
        .in('recipe_id', brokenRecipeIds)

      const ingredientIds = [...new Set((riRows ?? []).map(r => r.stock_item_id as string))]
      const { data: ingredientItems } = await admin
        .from('stock_items')
        .select('id, name, cost_per_unit, is_produced')
        .in('id', ingredientIds)

      const itemById = new Map((ingredientItems ?? []).map(it => [it.id, it]))

      const riByRecipe = new Map<string, string[]>()
      for (const ri of riRows ?? []) {
        const list = riByRecipe.get(ri.recipe_id) ?? []
        const item = itemById.get(ri.stock_item_id)
        if (item && (item.cost_per_unit == null || item.cost_per_unit === 0)) {
          list.push(item.is_produced ? `${item.name} (sin receta)` : item.name)
        }
        riByRecipe.set(ri.recipe_id, list)
      }

      for (const { mi, units } of brokenCandidates) {
        // Preferir los nombres que ya identificó costRecipes (incluye insumos
        // con costo Fudo/estimado, que para el modelo confiable son "sin costo
        // real" aunque tengan un número cargado).
        const rc = mi.recipe_id ? recipeCosts.get(mi.recipe_id) : undefined
        const missing = rc && rc.missingNames.length > 0
          ? rc.missingNames
          : (riByRecipe.get(mi.recipe_id ?? '') ?? ['receta vacía'])
        broken.push({
          menu_item_id: mi.id,
          name: mi.name,
          category: mi.category ?? '',
          units,
          missing_items: [...new Set(missing)],
        })
      }
      broken.sort((a, b) => b.units - a.units)
    }

    const payload: ReportePayload = {
      days,
      from: sinceDate,
      to: todayAR,
      dishes,
      broken,
      generated_at: new Date().toISOString(),
    }
    cache.set(days, { at: Date.now(), payload })
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[GET /api/ventas/reporte]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
