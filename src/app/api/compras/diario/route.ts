import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isManagerOrAbove } from '@/lib/roles'
import { fetchFudoExpenses } from '@/lib/fudo/expenses'

// ---------------------------------------------------------------------------
// GET /api/compras/diario?days=30  (manager-only)
// ---------------------------------------------------------------------------
// Compras REALES de Fudo por día, desde el módulo de gastos. Suma el monto de
// TODOS los gastos (con pago válido) por día AR (UTC-3) y devuelve:
//   - series [{ date, total }]  (días sin compra = 0)
//   - total del período
//   - top 10 proveedores por gasto
// Alimenta el "comprado" real del Balance.
// ---------------------------------------------------------------------------

const AR_OFFSET_MS = 3 * 60 * 60 * 1000

function arDateOf(utcISO: string): string {
  return new Date(new Date(utcISO).getTime() - AR_OFFSET_MS).toISOString().slice(0, 10)
}

function arToday(): string {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
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

    // Rango de fechas AR del período (hoy y days-1 hacia atrás)
    const todayAR = arToday()
    const dates: string[] = []
    const todayUTCNoon = new Date(`${todayAR}T12:00:00Z`)
    for (let i = days - 1; i >= 0; i--) {
      dates.push(new Date(todayUTCNoon.getTime() - i * 86_400_000).toISOString().slice(0, 10))
    }
    const sinceDate = dates[0]
    const sinceUTC = new Date(`${sinceDate}T00:00:00-03:00`).toISOString()

    const expenses = await fetchFudoExpenses(sinceUTC)

    const byDay = new Map<string, number>()
    for (const d of dates) byDay.set(d, 0)

    const byProvider = new Map<string, number>()
    let total = 0

    for (const exp of expenses) {
      if (!(exp.amount > 0)) continue
      const day = arDateOf(exp.date)
      if (!byDay.has(day)) continue // fuera del rango exacto
      byDay.set(day, (byDay.get(day) ?? 0) + exp.amount)
      total += exp.amount

      const prov = exp.provider ?? 'Sin proveedor'
      byProvider.set(prov, (byProvider.get(prov) ?? 0) + exp.amount)
    }

    const series = dates.map((date) => ({ date, total: Math.round(byDay.get(date) ?? 0) }))

    const topProviders = [...byProvider.entries()]
      .map(([name, amount]) => ({ name, total: Math.round(amount) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    return NextResponse.json({
      days,
      from: sinceDate,
      to: todayAR,
      series,
      total: Math.round(total),
      top_providers: topProviders,
    })
  } catch (err) {
    console.error('[GET /api/compras/diario]', err)
    const msg = err instanceof Error ? err.message : 'Error interno'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
