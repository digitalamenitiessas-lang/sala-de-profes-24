import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { costRecipes } from '@/lib/recipes/recipe-cost'
import { fetchFudoExpenses } from '@/lib/fudo/expenses'

// ---------------------------------------------------------------------------
// GET /api/ventas/carta?days=30
// ---------------------------------------------------------------------------
// Food Cost % + Ingeniería de menú — los dos números clave de gestión.
//
// Por plato (menu_items con receta y producto Fudo):
//   units, revenue, avg_price (ignora filas con price nulo/0 para el precio,
//   pero cuenta sus unidades), cost_per_portion (receta canonicalizada con
//   expansión nivel-2 de intermedios — ver src/lib/recipes/recipe-cost.ts),
//   margin_unit, margin_pct, food_cost_pct.
//
// Clasificación vs MEDIANAS del set costeado:
//   estrella (popular + rentable) · caballito (popular) · incognita (rentable)
//   · perro (ninguna).
//
// Resumen global:
//   revenue_total  = TODAS las ventas del período (con o sin receta)
//   cmv_teorico    = Σ (cost × units) de los platos costeados
//   food_cost_teorico_pct = cmv_teorico / revenue de los costeados
//   compras_total  = Σ stock_receipts.cost_total del período
//   food_cost_real_pct    = compras_total / revenue_total
//   coverage_pct   = revenue costeado / revenue_total
//
// Nada estimado: platos sin precio o sin costo CONFIABLE (compra/manual/
// producción — ver src/lib/costos/confiable.ts) van a `sin_datos` con motivo.
// food_cost_teorico_pct se calcula SOLO sobre platos confiables;
// food_cost_real_pct (compras Fudo / ventas Fudo) es el único 100% real.
// Solo managers. Cache en memoria de módulo: 5 min por ventana de días.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000
const PAGE_SIZE = 1000

export type CartaDish = {
  menu_item_id: string
  name: string
  units: number
  revenue: number
  avg_price: number
  cost_per_portion: number
  margin_unit: number
  margin_pct: number
  food_cost_pct: number
  group: 'estrella' | 'caballito' | 'incognita' | 'perro'
}

export type CartaPayload = {
  days: number
  from: string
  to: string
  dishes: CartaDish[]
  sin_datos: { menu_item_id: string; name: string; motivo: string }[]
  medians: { units: number; margin_unit: number }
  summary: {
    revenue_total: number
    revenue_costeado: number
    cmv_teorico: number
    food_cost_teorico_pct: number | null
    compras_total: number
    food_cost_real_pct: number | null
    coverage_pct: number | null
  }
}

const cache = new Map<number, { at: number; payload: CartaPayload }>()

function arToday(): string {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

/** Pagina de a 1000 (PostgREST corta en 1000 por default). */
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

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
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

    const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') ?? 30) || 30, 1), 90)

    const cached = cache.get(days)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload)
    }

    const admin = createAdminClient()
    const todayAR = arToday()
    const sinceDate = new Date(new Date(`${todayAR}T12:00:00Z`).getTime() - (days - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10)
    // Comienzo del primer día AR, expresado en UTC (AR es siempre UTC-3)
    const sinceUTC = new Date(`${sinceDate}T00:00:00-03:00`).toISOString()

    // 1. Platos del menú con receta y producto Fudo
    const { data: menuItems, error: miError } = await admin
      .from('menu_items')
      .select('id, name, recipe_id, fudo_product_id')
      .eq('is_active', true)
      .not('recipe_id', 'is', null)
      .not('fudo_product_id', 'is', null)
    if (miError) throw new Error(miError.message)

    type SaleRow = { fudo_product_id: string | null; quantity: number; price: number | null }

    // 2. En paralelo: costos de recetas + TODAS las ventas del período + compras
    //    reales del módulo de gastos de Fudo (stock_receipts está vacía; los
    //    gastos de Fudo tienen el histórico real de compras). Best-effort: si
    //    Fudo falla, compras=0 y el food cost real queda null — no rompe la carta.
    const recipeIds = [...new Set((menuItems ?? []).map(mi => mi.recipe_id as string))]
    const [recipeCosts, sales, expenses] = await Promise.all([
      costRecipes(admin, recipeIds),
      fetchAll<SaleRow>((from, to) =>
        admin
          .from('fudo_sales')
          .select('fudo_product_id, quantity, price:raw_payload->price')
          .gte('sold_at', sinceUTC)
          .order('id', { ascending: true })
          .range(from, to) as never,
      ),
      fetchFudoExpenses(sinceUTC).catch(() => [] as { date: string; amount: number }[]),
    ])

    // 3. Ventas por producto Fudo + revenue total del período (todo lo vendido)
    type ProductAgg = { units: number; revenue: number; pricedUnits: number; pricedRevenue: number }
    const byProduct = new Map<string, ProductAgg>()
    let revenueTotal = 0
    for (const s of sales) {
      const qty = Number(s.quantity ?? 0)
      const price = s.price != null ? Number(s.price) : null
      const rowRevenue = price != null && price > 0 ? qty * price : 0
      revenueTotal += rowRevenue
      if (!s.fudo_product_id) continue
      const agg = byProduct.get(s.fudo_product_id) ?? { units: 0, revenue: 0, pricedUnits: 0, pricedRevenue: 0 }
      // OJO: price puede venir 0/null en modificadores — se ignoran para el
      // precio promedio, pero sus unidades cuentan.
      agg.units += qty
      if (price != null && price > 0) {
        agg.pricedUnits += qty
        agg.pricedRevenue += qty * price
      }
      agg.revenue += rowRevenue
      byProduct.set(s.fudo_product_id, agg)
    }

    // 4. Por plato: métricas + filtro de transparencia (nada estimado)
    const costeados: Omit<CartaDish, 'group'>[] = []
    const sinDatos: CartaPayload['sin_datos'] = []
    for (const mi of menuItems ?? []) {
      const agg = mi.fudo_product_id ? byProduct.get(mi.fudo_product_id) : undefined
      const rc = mi.recipe_id ? recipeCosts.get(mi.recipe_id) : undefined
      const cost = rc?.cost ?? 0
      if (!agg || agg.units <= 0) {
        sinDatos.push({ menu_item_id: mi.id, name: mi.name, motivo: 'Sin ventas en el período' })
        continue
      }
      const avgPrice = agg.pricedUnits > 0 ? agg.pricedRevenue / agg.pricedUnits : 0
      if (avgPrice <= 0) {
        sinDatos.push({ menu_item_id: mi.id, name: mi.name, motivo: 'Sin precio en las ventas (modificador o precio en 0)' })
        continue
      }
      // Gating de costo confiable: si alguna línea de la receta no tiene costo
      // REAL (compra/manual/producción), el plato no se costea — nada estimado.
      if (rc && rc.missing > 0) {
        const nombres = rc.missingNames.length > 0 ? `: ${rc.missingNames.join(', ')}` : ''
        sinDatos.push({ menu_item_id: mi.id, name: mi.name, motivo: `Faltan costos reales${nombres}` })
        continue
      }
      if (cost <= 0) {
        sinDatos.push({ menu_item_id: mi.id, name: mi.name, motivo: 'Receta sin costo (ingredientes sin precio cargado)' })
        continue
      }
      const marginUnit = avgPrice - cost
      costeados.push({
        menu_item_id: mi.id,
        name: mi.name,
        units: Math.round(agg.units),
        revenue: Math.round(agg.revenue),
        avg_price: Math.round(avgPrice),
        cost_per_portion: Math.round(cost),
        margin_unit: Math.round(marginUnit),
        margin_pct: Math.round((marginUnit / avgPrice) * 1000) / 10,
        food_cost_pct: Math.round((cost / avgPrice) * 1000) / 10,
      })
    }

    // 5. Ingeniería de menú vs medianas del set costeado
    const medianUnits = median(costeados.map(d => d.units))
    const medianMargin = median(costeados.map(d => d.margin_unit))
    const dishes: CartaDish[] = costeados
      .map(d => {
        const popular = d.units >= medianUnits
        const profitable = d.margin_unit >= medianMargin
        const group: CartaDish['group'] = popular
          ? (profitable ? 'estrella' : 'caballito')
          : (profitable ? 'incognita' : 'perro')
        return { ...d, group }
      })
      .sort((a, b) => b.revenue - a.revenue)

    // 6. Resumen global
    const revenueCosteado = dishes.reduce((sum, d) => sum + d.revenue, 0)
    const cmvTeorico = dishes.reduce((sum, d) => sum + d.cost_per_portion * d.units, 0)
    const comprasTotal = expenses.reduce((sum, e) => sum + Number(e.amount ?? 0), 0)

    const payload: CartaPayload = {
      days,
      from: sinceDate,
      to: todayAR,
      dishes,
      sin_datos: sinDatos,
      medians: { units: medianUnits, margin_unit: medianMargin },
      summary: {
        revenue_total: Math.round(revenueTotal),
        revenue_costeado: Math.round(revenueCosteado),
        cmv_teorico: Math.round(cmvTeorico),
        food_cost_teorico_pct: revenueCosteado > 0 ? Math.round((cmvTeorico / revenueCosteado) * 1000) / 10 : null,
        compras_total: Math.round(comprasTotal),
        food_cost_real_pct: revenueTotal > 0 ? Math.round((comprasTotal / revenueTotal) * 1000) / 10 : null,
        coverage_pct: revenueTotal > 0 ? Math.round((revenueCosteado / revenueTotal) * 1000) / 10 : null,
      },
    }
    cache.set(days, { at: Date.now(), payload })
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[GET /api/ventas/carta]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
