import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isManagerOrAbove } from '@/lib/roles'
import { fetchFudoExpenses } from '@/lib/fudo/expenses'

// ---------------------------------------------------------------------------
// GET /api/compras/precios?days=90  (manager-only)
// ---------------------------------------------------------------------------
// Precio de COMPRA REAL por insumo, desde el módulo de gastos de Fudo.
// Toma SÓLO los gastos con EXACTAMENTE 1 ingrediente: en ese caso el monto
// del gasto = precio real de ese insumo. Agrupa por ingrediente y devuelve,
// por cada uno: último precio + proveedor + fecha, mín/prom/máx, y el detalle
// de cada compra (fecha, proveedor, monto) ordenado por fecha desc.
// Responde "qué proveedor te remarcó y qué insumo se encareció".
// ---------------------------------------------------------------------------

type PricePoint = { date: string; amount: number; provider: string | null }

type IngredientPrices = {
  name: string
  last_price: number | null
  last_provider: string | null
  last_date: string | null
  min: number | null
  max: number | null
  avg: number | null
  count: number
  points: PricePoint[]
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

    const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') ?? 90) || 90, 1), 365)
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceISO = since.toISOString()

    const expenses = await fetchFudoExpenses(sinceISO)

    // Sólo gastos con exactamente 1 ingrediente → el monto es el precio real.
    const byIngredient = new Map<string, IngredientPrices>()
    for (const exp of expenses) {
      if (exp.itemCount !== 1) continue
      if (!(exp.amount > 0)) continue
      const name = exp.ingredientNames[0]
      if (!name) continue

      const g = byIngredient.get(name) ?? {
        name,
        last_price: null,
        last_provider: null,
        last_date: null,
        min: null,
        max: null,
        avg: null,
        count: 0,
        points: [],
      }
      g.points.push({ date: exp.date, amount: exp.amount, provider: exp.provider })
      byIngredient.set(name, g)
    }

    const items: IngredientPrices[] = [...byIngredient.values()].map((g) => {
      // Ordenar puntos por fecha desc (los expenses ya vienen desc, pero aseguramos)
      g.points.sort((a, b) => b.date.localeCompare(a.date))
      const amounts = g.points.map((p) => p.amount)
      g.count = g.points.length
      g.last_price = g.points[0]?.amount ?? null
      g.last_provider = g.points[0]?.provider ?? null
      g.last_date = g.points[0]?.date ?? null
      g.min = amounts.length ? Math.round(Math.min(...amounts) * 100) / 100 : null
      g.max = amounts.length ? Math.round(Math.max(...amounts) * 100) / 100 : null
      g.avg = amounts.length ? Math.round((amounts.reduce((a, b) => a + b, 0) / amounts.length) * 100) / 100 : null
      return g
    })

    // Ordenar por más reciente (última compra desc)
    items.sort((a, b) => (b.last_date ?? '').localeCompare(a.last_date ?? ''))

    return NextResponse.json({
      days,
      items,
      total_ingredients: items.length,
      total_points: items.reduce((s, g) => s + g.count, 0),
    })
  } catch (err) {
    console.error('[GET /api/compras/precios]', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
