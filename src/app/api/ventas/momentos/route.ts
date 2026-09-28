import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { costRecipes } from '@/lib/recipes/recipe-cost'

// ---------------------------------------------------------------------------
// GET /api/ventas/momentos?days=30
// ---------------------------------------------------------------------------
// Rentabilidad por momento del día — ¿qué conviene promocionar en cada franja?
//
// Cada venta se clasifica por la CATEGORÍA del producto (Fudo → menu_categories):
//   desayuno_merienda → Desayunos & Meriendas, Cafetería, Infusiones, etc.
//   almuerzo_cena     → Platos Principales, Menu diario, Pizzas, etc.
// Fallback para productos sin categoría o "neutrales" (bebidas sin alcohol,
// adicionales): hora ARGENTINA (06–12 y 16–20 → desayuno_merienda, resto → almuerzo_cena).
//
// Por momento: units_total y revenue_total de TODAS las ventas (con o sin
// receta), y por producto costeado (menu_item con receta + producto Fudo):
// units, revenue, avg_price, cost, margin_unit, margin_pct.
//
// `para_promocionar`: top 5 productos del momento con margen_pct ≥ mediana
// del momento y ventas en la franja, ordenados por MAYOR margen unitario $.
//
// Solo managers. Cache en memoria de módulo: 5 min por ventana de días.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000
const PAGE_SIZE = 1000

export type MomentoKey = 'desayuno_merienda' | 'almuerzo_cena'

export type MomentoProduct = {
  menu_item_id: string
  name: string
  units: number
  revenue: number
  avg_price: number
  cost: number
  margin_unit: number
  margin_pct: number
}

export type MomentoPromo = MomentoProduct & {
  reason: 'alto_margen_popular' | 'alto_margen_dormido'
}

export type Momento = {
  key: MomentoKey
  units_total: number
  revenue_total: number
  revenue_costeado: number
  coverage_pct: number | null
  productos_costeados: number
  median_margin_pct: number
  para_promocionar: MomentoPromo[]
  mas_vendidos: MomentoProduct[]
}

export type MomentosPayload = {
  days: number
  from: string
  to: string
  revenue_total: number
  units_total: number
  momentos: Momento[]
}

// Categorías Fudo → servicio del local.
// Las categorías no listadas (Bebidas sin alcohol, Adicionales, etc.)
// usan el fallback por hora.
const DESAYUNO_MERIENDA_CATS = new Set([
  'Desayunos & Meriendas',
  'Entre Panes Desayunos y Meriendas',
  'Cafetería',
  'Infusiones',
  'Pasteleria',
  'SIN TACC',
  'Tostones',
  'LECHES',
  'Cafe Frio',
])

const ALMUERZO_CENA_CATS = new Set([
  'Platos Principales',
  'Pizzas',
  'Entre Panes',
  'No Vives de Ensalada',
  'Entradas',
  'LVE Kids',
  'Picadas',
  'WRAPS',
  'Papas Fritas',
  'Guarniciones',
  'Menu diario',
  'Menu personal',
  'PEDIDOS YA',
  'TAKE WAY',
  'Postres',
  'Bebidas con alcohol',
  'Copa de vino',
  'Tragos',
  'Pomo del Dia',
])

/**
 * Determina el momento por categoría del producto.
 * Fallback: hora AR → desayuno_merienda si es 06–12 o 16–20, almuerzo_cena si no.
 */
function momentoOf(hourAR: number, catName: string | null): MomentoKey {
  if (catName) {
    if (DESAYUNO_MERIENDA_CATS.has(catName)) return 'desayuno_merienda'
    if (ALMUERZO_CENA_CATS.has(catName)) return 'almuerzo_cena'
  }
  if ((hourAR >= 6 && hourAR < 12) || (hourAR >= 16 && hourAR < 20)) return 'desayuno_merienda'
  return 'almuerzo_cena'
}

const MOMENTO_KEYS: MomentoKey[] = ['desayuno_merienda', 'almuerzo_cena']

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

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

const cache = new Map<number, { at: number; payload: MomentosPayload }>()

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
    const sinceUTC = new Date(`${sinceDate}T00:00:00-03:00`).toISOString()

    // 1. Todos los menu_items activos con fudo_product_id: para mapear categoría y receta
    const { data: allMenuItems } = await admin
      .from('menu_items')
      .select('id, name, recipe_id, fudo_product_id, menu_categories(name)')
      .eq('is_active', true)
      .not('fudo_product_id', 'is', null)

    type MenuItemRow = {
      id: string
      name: string
      recipe_id: string | null
      fudo_product_id: string | null
      menu_categories: { name: string } | null
    }
    const allItems = (allMenuItems ?? []) as unknown as MenuItemRow[]

    // fudo_product_id → category name (para clasificar ventas)
    const fudoToCat = new Map<string, string | null>()
    for (const mi of allItems) {
      if (mi.fudo_product_id) fudoToCat.set(mi.fudo_product_id, mi.menu_categories?.name ?? null)
    }

    // menu_items con receta (para costing)
    const menuItems = allItems.filter(mi => mi.recipe_id != null)

    type SaleRow = { fudo_product_id: string | null; quantity: number; price: number | null; sold_at: string }

    const recipeIds = [...new Set(menuItems.map(mi => mi.recipe_id as string))]
    const [recipeCosts, sales] = await Promise.all([
      costRecipes(admin, recipeIds),
      fetchAll<SaleRow>((from, to) =>
        admin
          .from('fudo_sales')
          .select('fudo_product_id, quantity, price:raw_payload->price, sold_at')
          .gte('sold_at', sinceUTC)
          .order('id', { ascending: true })
          .range(from, to) as never,
      ),
    ])

    // 3. Agregación por momento × producto Fudo
    type ProductAgg = { units: number; revenue: number; pricedUnits: number; pricedRevenue: number }
    type MomentoAgg = { units: number; revenue: number; byProduct: Map<string, ProductAgg> }
    const aggs = new Map<MomentoKey, MomentoAgg>(
      MOMENTO_KEYS.map(k => [k, { units: 0, revenue: 0, byProduct: new Map() }]),
    )
    let revenueTotal = 0
    let unitsTotal = 0

    for (const s of sales) {
      const soldAt = new Date(s.sold_at)
      if (Number.isNaN(soldAt.getTime())) continue
      const hourAR = (soldAt.getUTCHours() - 3 + 24) % 24
      const catName = s.fudo_product_id ? (fudoToCat.get(s.fudo_product_id) ?? null) : null
      const momentoKey = momentoOf(hourAR, catName)
      const momento = aggs.get(momentoKey)!

      const qty = Number(s.quantity ?? 0)
      const price = s.price != null ? Number(s.price) : null
      const rowRevenue = price != null && price > 0 ? qty * price : 0
      revenueTotal += rowRevenue
      unitsTotal += qty
      momento.revenue += rowRevenue
      momento.units += qty

      if (!s.fudo_product_id) continue
      const agg = momento.byProduct.get(s.fudo_product_id) ?? { units: 0, revenue: 0, pricedUnits: 0, pricedRevenue: 0 }
      agg.units += qty
      agg.revenue += rowRevenue
      if (price != null && price > 0) {
        agg.pricedUnits += qty
        agg.pricedRevenue += qty * price
      }
      momento.byProduct.set(s.fudo_product_id, agg)
    }

    // 4. Por momento: productos costeados, medianas y ranking de promoción
    const momentos: Momento[] = MOMENTO_KEYS.map((key) => {
      const m = aggs.get(key)!

      const costeados: MomentoProduct[] = []
      for (const mi of menuItems) {
        const agg = mi.fudo_product_id ? m.byProduct.get(mi.fudo_product_id) : undefined
        if (!agg || agg.units <= 0) continue
        const avgPrice = agg.pricedUnits > 0 ? agg.pricedRevenue / agg.pricedUnits : 0
        if (avgPrice <= 0) continue
        const rc = mi.recipe_id ? recipeCosts.get(mi.recipe_id) : undefined
        const cost = rc?.cost ?? 0
        // Solo platos con costo CONFIABLE completo — nada de márgenes fantasma
        if (!rc || rc.missing > 0 || cost <= 0) continue
        const marginUnit = avgPrice - cost
        costeados.push({
          menu_item_id: mi.id,
          name: mi.name,
          units: Math.round(agg.units * 10) / 10,
          revenue: Math.round(agg.revenue),
          avg_price: Math.round(avgPrice),
          cost: Math.round(cost),
          margin_unit: Math.round(marginUnit),
          margin_pct: Math.round((marginUnit / avgPrice) * 1000) / 10,
        })
      }

      const medianMarginPct = median(costeados.map(p => p.margin_pct))
      const medianUnits = median(costeados.map(p => p.units))

      const paraPromocionar: MomentoPromo[] = costeados
        .filter(p => p.margin_pct >= medianMarginPct && p.units > 0)
        .sort((a, b) => b.margin_unit - a.margin_unit)
        .slice(0, 5)
        .map(p => ({
          ...p,
          reason: p.units >= medianUnits ? 'alto_margen_popular' as const : 'alto_margen_dormido' as const,
        }))

      const masVendidos = [...costeados].sort((a, b) => b.units - a.units).slice(0, 5)

      const revenueCosteado = costeados.reduce((sum, p) => sum + p.revenue, 0)
      return {
        key,
        units_total: Math.round(m.units),
        revenue_total: Math.round(m.revenue),
        revenue_costeado: Math.round(revenueCosteado),
        coverage_pct: m.revenue > 0 ? Math.round((revenueCosteado / m.revenue) * 1000) / 10 : null,
        productos_costeados: costeados.length,
        median_margin_pct: medianMarginPct,
        para_promocionar: paraPromocionar,
        mas_vendidos: masVendidos,
      }
    })

    const payload: MomentosPayload = {
      days,
      from: sinceDate,
      to: todayAR,
      revenue_total: Math.round(revenueTotal),
      units_total: Math.round(unitsTotal),
      momentos,
    }
    cache.set(days, { at: Date.now(), payload })
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[GET /api/ventas/momentos]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
