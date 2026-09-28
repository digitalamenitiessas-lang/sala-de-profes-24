import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchMonthSales } from '@/lib/fudo/month-sales'
import { format } from 'date-fns'

// ---------------------------------------------------------------------------
// GET /api/fudo/monthly-summary?month=2026-03
// Fetches all sales for a month and aggregates top products + daily totals
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const monthParam = request.nextUrl.searchParams.get('month')
    const { sales: allSales, start, days, truncado } = await fetchMonthSales(monthParam)

    // Only count closed sales for totals
    const closedSales = allSales.filter(s => s.state === 'CLOSED')

    // Daily totals
    const dailyMap = new Map<string, { total: number; tickets: number }>()
    for (const day of days) {
      dailyMap.set(format(day, 'yyyy-MM-dd'), { total: 0, tickets: 0 })
    }
    for (const sale of closedSales) {
      const d = dailyMap.get(sale.argDate)
      if (d) {
        d.total += sale.total
        d.tickets++
      }
    }

    const dailyData = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Ventas por hora × día de semana (para "¿a qué hora vendemos más?")
    const hourlyMap = new Map<string, { dow: number; hour: number; total: number; tickets: number }>()
    for (const sale of closedSales) {
      const key = `${sale.argDow}-${sale.argHour}`
      const entry = hourlyMap.get(key) ?? { dow: sale.argDow, hour: sale.argHour, total: 0, tickets: 0 }
      entry.total += sale.total
      entry.tickets++
      hourlyMap.set(key, entry)
    }
    const hourlyByDow = Array.from(hourlyMap.values()).sort((a, b) => a.dow - b.dow || a.hour - b.hour)

    // Top products across the whole month
    const productAgg = new Map<string, { qty: number; revenue: number }>()
    for (const sale of closedSales) {
      for (const item of sale.items) {
        // price es UNITARIO: el revenue de la línea es qty × price
        const ex = productAgg.get(item.name)
        if (ex) {
          ex.qty += item.qty
          ex.revenue += item.qty * item.price
        } else {
          productAgg.set(item.name, { qty: item.qty, revenue: item.qty * item.price })
        }
      }
    }

    const topProducts = Array.from(productAgg.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.qty - a.qty)

    // Summary
    const totalFacturado = closedSales.reduce((s, t) => s + t.total, 0)
    const totalTickets = closedSales.length
    const activeDays = dailyData.filter(d => d.total > 0).length

    return NextResponse.json({
      month: format(start, 'yyyy-MM'),
      truncado,
      totalFacturado,
      totalTickets,
      activeDays,
      avgPerDay: activeDays > 0 ? Math.round(totalFacturado / activeDays) : 0,
      avgTicket: totalTickets > 0 ? Math.round(totalFacturado / totalTickets) : 0,
      dailyData,
      hourlyByDow,
      topProducts: topProducts.slice(0, 30),
      topByRevenue: [...topProducts].sort((a, b) => b.revenue - a.revenue).slice(0, 30),
    })
  } catch (error) {
    console.error('[monthly-summary] Error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
