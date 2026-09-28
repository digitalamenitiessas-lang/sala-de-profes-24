import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'

// ---------------------------------------------------------------------------
// GET /api/ventas/recetas-faltantes?days=30
// ---------------------------------------------------------------------------
// "¿Qué plato tengo que cargar receta para no errar el Food Cost?"
//
// La cobertura del Food Cost sube cuando se cargan recetas de los platos que
// MÁS facturan. Este endpoint lista los platos activos con producto Fudo pero
// SIN recipe_id, ordenados por lo que facturaron en el período, para que
// cocina cargue primero las que más mueven la aguja.
//
// Por plato sin receta:
//   units   = Σ quantity
//   revenue = Σ (quantity × raw_payload.price)  — filas con price nulo/0 se
//             ignoran para el revenue (modificadores), pero no aportan monto.
//
// Resumen:
//   revenue_total       = TODAS las ventas del período (con y sin receta)
//   revenue_sin_receta  = facturación de platos sin receta
//   coverage_pct        = revenue con receta / total (cobertura actual)
//   coverage_top10_pct  = cuánto SUBIRÍA la cobertura si se cargaran los
//                         top-10 sin receta (revenue con receta + top10 / total)
//
// Solo managers. Cache en memoria de módulo: 5 min por ventana de días.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000
const PAGE_SIZE = 1000
const TOP_N = 25

export type RecetaFaltante = {
  fudo_product_id: string
  name: string
  units: number
  revenue: number
}

export type RecetasFaltantesPayload = {
  days: number
  from: string
  to: string
  items: RecetaFaltante[]
  summary: {
    revenue_total: number
    revenue_sin_receta: number
    revenue_con_receta: number
    coverage_pct: number | null
    coverage_top10_pct: number | null
    top10_revenue: number
    platos_sin_receta: number
  }
}

const cache = new Map<number, { at: number; payload: RecetasFaltantesPayload }>()

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

    // 1. Platos activos con producto Fudo, con y sin receta (para poder
    //    separar el revenue con/sin receta a nivel producto Fudo).
    const { data: menuItems, error: miError } = await admin
      .from('menu_items')
      .select('name, recipe_id, fudo_product_id')
      .eq('is_active', true)
      .not('fudo_product_id', 'is', null)
    if (miError) throw new Error(miError.message)

    // Mapa fudo_product_id → { name, hasRecipe }. Si dos menu_items comparten
    // fudo_product_id (raro), tener receta en cualquiera cuenta como cubierto.
    const productInfo = new Map<string, { name: string; hasRecipe: boolean }>()
    for (const mi of menuItems ?? []) {
      const pid = mi.fudo_product_id as string
      const prev = productInfo.get(pid)
      const hasRecipe = mi.recipe_id != null
      if (!prev) productInfo.set(pid, { name: mi.name, hasRecipe })
      else if (hasRecipe && !prev.hasRecipe) prev.hasRecipe = true
    }

    // 2. TODAS las ventas del período (paginado 1000).
    type SaleRow = { fudo_product_id: string | null; quantity: number; price: number | null }
    const sales = await fetchAll<SaleRow>((from, to) =>
      admin
        .from('fudo_sales')
        .select('fudo_product_id, quantity, price:raw_payload->price')
        .gte('sold_at', sinceUTC)
        .order('id', { ascending: true })
        .range(from, to) as never,
    )

    // 3. Agregado por producto Fudo + revenue total.
    type Agg = { units: number; revenue: number }
    const byProduct = new Map<string, Agg>()
    let revenueTotal = 0
    for (const s of sales) {
      const qty = Number(s.quantity ?? 0)
      const price = s.price != null ? Number(s.price) : null
      const rowRevenue = price != null && price > 0 ? qty * price : 0
      revenueTotal += rowRevenue
      if (!s.fudo_product_id) continue
      const agg = byProduct.get(s.fudo_product_id) ?? { units: 0, revenue: 0 }
      agg.units += qty
      agg.revenue += rowRevenue
      byProduct.set(s.fudo_product_id, agg)
    }

    // 4. Separar revenue con/sin receta y armar lista de faltantes.
    let revenueConReceta = 0
    let revenueSinReceta = 0
    const faltantes: RecetaFaltante[] = []
    for (const [pid, agg] of byProduct) {
      const info = productInfo.get(pid)
      if (!info) continue // venta de un producto Fudo sin menu_item activo mapeado
      if (info.hasRecipe) {
        revenueConReceta += agg.revenue
      } else {
        revenueSinReceta += agg.revenue
        faltantes.push({
          fudo_product_id: pid,
          name: info.name,
          units: Math.round(agg.units),
          revenue: Math.round(agg.revenue),
        })
      }
    }

    faltantes.sort((a, b) => b.revenue - a.revenue)
    const items = faltantes.slice(0, TOP_N)

    // 5. Proyección: cargar los top-10 sin receta.
    const top10Revenue = faltantes.slice(0, 10).reduce((sum, f) => sum + f.revenue, 0)

    const payload: RecetasFaltantesPayload = {
      days,
      from: sinceDate,
      to: todayAR,
      items,
      summary: {
        revenue_total: Math.round(revenueTotal),
        revenue_sin_receta: Math.round(revenueSinReceta),
        revenue_con_receta: Math.round(revenueConReceta),
        coverage_pct: revenueTotal > 0 ? Math.round((revenueConReceta / revenueTotal) * 1000) / 10 : null,
        coverage_top10_pct:
          revenueTotal > 0 ? Math.round(((revenueConReceta + top10Revenue) / revenueTotal) * 1000) / 10 : null,
        top10_revenue: Math.round(top10Revenue),
        platos_sin_receta: faltantes.length,
      },
    }
    cache.set(days, { at: Date.now(), payload })
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[GET /api/ventas/recetas-faltantes]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
