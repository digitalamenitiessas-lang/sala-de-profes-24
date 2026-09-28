import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'

// ---------------------------------------------------------------------------
// GET /api/ventas/balance?days=30
// ---------------------------------------------------------------------------
// "Lo que se compra se compensa con lo que se vende".
// Devuelve, para el período (default 30 días, máx 90):
//   - serie diaria [{ date, sold, purchased }]
//       sold      = Σ (quantity × raw_payload.price) de fudo_sales por día AR
//       purchased = Σ (cost_total) de stock_receipts por received_date
//   - totales del período + balance (sold − purchased)
//   - top 10 insumos por gasto (stock_receipts agrupado por stock_item)
//   - desglose pagado vs a_pagar
// Argentina no tiene horario de verano (siempre UTC-3): sold_at (UTC) se
// convierte a fecha AR restando 3 horas.
// ---------------------------------------------------------------------------

const AR_OFFSET_MS = 3 * 60 * 60 * 1000
const PAGE_SIZE = 1000

function arDateOf(utcISO: string): string {
  return new Date(new Date(utcISO).getTime() - AR_OFFSET_MS).toISOString().slice(0, 10)
}

function arToday(): string {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

/** Trae todas las filas paginando de a 1000 (PostgREST corta en 1000 por default). */
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

    const admin = createAdminClient()
    const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') ?? 30) || 30, 1), 90)

    // Fechas AR del período: hoy y (days − 1) días hacia atrás
    const todayAR = arToday()
    const dates: string[] = []
    const todayUTCNoon = new Date(`${todayAR}T12:00:00Z`)
    for (let i = days - 1; i >= 0; i--) {
      dates.push(new Date(todayUTCNoon.getTime() - i * 86_400_000).toISOString().slice(0, 10))
    }
    const sinceDate = dates[0]
    // Comienzo del primer día AR, expresado en UTC
    const sinceUTC = new Date(`${sinceDate}T00:00:00-03:00`).toISOString()

    type SaleRow = { sold_at: string; quantity: number; price: number | null }
    type ReceiptRow = {
      stock_item_id: string | null
      cost_total: number | null
      payment_status: string
      received_date: string
      stock_items: { name: string | null } | null
    }

    const [sales, receipts] = await Promise.all([
      fetchAll<SaleRow>((from, to) =>
        admin
          .from('fudo_sales')
          .select('sold_at, quantity, price:raw_payload->price')
          .gte('sold_at', sinceUTC)
          .order('id', { ascending: true })
          .range(from, to) as never,
      ),
      fetchAll<ReceiptRow>((from, to) =>
        admin
          .from('stock_receipts')
          .select('stock_item_id, cost_total, payment_status, received_date, stock_items(name)')
          .gte('received_date', sinceDate)
          .lte('received_date', todayAR)
          .order('id', { ascending: true })
          .range(from, to) as never,
      ),
    ])

    // Serie diaria
    const byDay = new Map<string, { sold: number; purchased: number }>()
    for (const d of dates) byDay.set(d, { sold: 0, purchased: 0 })

    for (const s of sales) {
      const day = byDay.get(arDateOf(s.sold_at))
      if (!day) continue
      day.sold += Number(s.quantity ?? 0) * Number(s.price ?? 0)
    }

    // Compras: serie + top insumos + desglose de pago
    const bySupply = new Map<string, { stock_item_id: string | null; name: string; total: number; receipts: number }>()
    let paid = 0
    let pending = 0
    for (const r of receipts) {
      const cost = Number(r.cost_total ?? 0)
      if (cost <= 0) continue
      const day = byDay.get(r.received_date)
      if (day) day.purchased += cost

      if (r.payment_status === 'pagado') paid += cost
      else pending += cost

      const key = r.stock_item_id ?? 'otros'
      const entry = bySupply.get(key) ?? {
        stock_item_id: r.stock_item_id,
        name: r.stock_items?.name ?? 'Otros',
        total: 0,
        receipts: 0,
      }
      entry.total += cost
      entry.receipts += 1
      bySupply.set(key, entry)
    }

    const series = dates.map((date) => {
      const d = byDay.get(date)!
      return { date, sold: Math.round(d.sold), purchased: Math.round(d.purchased) }
    })

    const totalSold = series.reduce((s, d) => s + d.sold, 0)
    const totalPurchased = series.reduce((s, d) => s + d.purchased, 0)

    const topSupplies = [...bySupply.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((s) => ({ ...s, total: Math.round(s.total) }))

    return NextResponse.json({
      days,
      from: sinceDate,
      to: todayAR,
      series,
      totals: {
        sold: totalSold,
        purchased: totalPurchased,
        balance: totalSold - totalPurchased,
      },
      top_supplies: topSupplies,
      payments: {
        pagado: Math.round(paid),
        a_pagar: Math.round(pending),
      },
    })
  } catch (err) {
    console.error('[GET /api/ventas/balance]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
