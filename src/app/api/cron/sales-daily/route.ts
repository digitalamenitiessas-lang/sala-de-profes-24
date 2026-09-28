import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { asegurarVentasDeHoy } from '@/lib/fudo/ventas-intradia'
import { notifyEvent } from '@/lib/push/notify-event'

// ---------------------------------------------------------------------------
// GET /api/cron/sales-daily
// ---------------------------------------------------------------------------
// Corre una vez al día a las 23:30 hora Argentina (02:30 UTC).
// Calcula el top 5 de platos más vendidos del día completo (desde las 00:00 AR)
// y manda la notificación a todos los usuarios activos.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const AR_OFFSET = '-03:00'
const TOP_N = 5

function arTodayDate(): string {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const admin = createAdminClient()
    // Traer las ventas de hoy antes de resumir: el cron diario las importa
    // recién a la madrugada y el resumen salía casi vacío.
    await asegurarVentasDeHoy(admin, { maxAgeMin: 5 })
    const todayAR = arTodayDate()

    // Desde las 00:00 AR del día actual hasta ahora
    const startUTC = new Date(`${todayAR}T00:00:00${AR_OFFSET}`)
    const nowUTC = new Date()

    // Paginado (el tope silencioso de 1000 filas cortaba días fuertes) y
    // agrupado por fudo_product_id: item_name viene null en el 98,7% de las
    // filas, así que agrupar por nombre dejaba el top casi vacío.
    type SaleRow = { fudo_product_id: string | null; quantity: number }
    const sales: SaleRow[] = []
    for (let page = 0; page < 50; page++) {
      const { data, error } = await admin
        .from('fudo_sales')
        .select('fudo_product_id, quantity')
        .gte('sold_at', startUTC.toISOString())
        .lte('sold_at', nowUTC.toISOString())
        .order('id', { ascending: true })
        .range(page * 1000, page * 1000 + 999)
      if (error) throw error
      if (!data || data.length === 0) break
      sales.push(...(data as SaleRow[]))
      if (data.length < 1000) break
    }

    const totals = new Map<string, number>()
    for (const row of sales) {
      if (!row.fudo_product_id) continue
      const key = String(row.fudo_product_id)
      totals.set(key, (totals.get(key) ?? 0) + Number(row.quantity ?? 0))
    }

    // Nombres reales desde menu_items (fudo_product_id → name)
    const { data: menu } = await admin
      .from('menu_items')
      .select('fudo_product_id, name')
      .not('fudo_product_id', 'is', null)
    const nameByFudo = new Map((menu ?? []).map((m) => [String(m.fudo_product_id), String(m.name)]))

    const top: [string, number][] = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([id, qty]) => [nameByFudo.get(id) ?? `Producto ${id}`, qty])

    if (top.length === 0) {
      return NextResponse.json({ success: true, message: 'Sin ventas en el día', sent: false })
    }

    const list = top.map(([name, qty], i) => `${i + 1}. ${name} — ${qty}`).join('\n')
    const fecha = new Date().toLocaleDateString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })

    await notifyEvent(admin, 'sales_summary_daily', {
      title: `🏆 Top 5 del ${fecha}`,
      body: list,
      url: '/ventas',
    })

    return NextResponse.json({
      success: true,
      date: todayAR,
      window: { from: startUTC.toISOString(), to: nowUTC.toISOString() },
      top,
      sent: true,
    })
  } catch (error) {
    console.error('[GET /api/cron/sales-daily]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
