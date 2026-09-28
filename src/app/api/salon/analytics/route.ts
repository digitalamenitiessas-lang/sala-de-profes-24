import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { format, subDays, parseISO, differenceInMinutes } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { fudoHttp } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// GET /api/salon/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
// Generates dispatch time analytics from salon_item_status + Fudo
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const url = new URL(request.url)
    const from = url.searchParams.get('from') ?? format(subDays(new Date(), 7), 'yyyy-MM-dd')
    const to = url.searchParams.get('to') ?? format(new Date(), 'yyyy-MM-dd')

    // 1. Get all served items in the period
    const { data: servedItems } = await admin
      .from('salon_item_status')
      .select('fudo_sale_id, fudo_item_id, served_at, served_by, profiles:served_by(first_name, last_name)')
      .gte('served_at', `${from}T00:00:00-03:00`)
      .lte('served_at', `${to}T23:59:59-03:00`)

    if (!servedItems?.length) {
      return NextResponse.json({
        message: 'Sin datos de servicio en el período',
        period: { from, to },
        summary: null,
        byProduct: [],
        byHour: [],
        byDayOfWeek: [],
        byRunner: [],
        byDay: [],
      })
    }

    // 2. Get Fudo sales with items for the period
    const saleIds = [...new Set(servedItems.map(s => s.fudo_sale_id))]

    // Fetch sales in batches
    const itemCreatedMap = new Map<string, { createdAt: string; productName: string; saleCreatedAt: string }>()

    for (let i = 0; i < saleIds.length; i += 10) {
      const batch = saleIds.slice(i, i + 10)
      for (const saleId of batch) {
        try {
          const res = await fudoHttp(
            `https://api.fu.do/v1alpha1/sales/${saleId}?include=items.product`,
          )
          if (!res.ok) continue
          const data = await res.json()

          const saleCreatedAt = data.data?.attributes?.createdAt ?? ''
          const included = data.included ?? []
          const productMap = new Map<string, string>()
          for (const inc of included) {
            if (inc.type === 'Product') productMap.set(inc.id, inc.attributes?.name ?? '?')
          }
          for (const inc of included) {
            if (inc.type === 'Item') {
              const prodId = inc.relationships?.product?.data?.id
              itemCreatedMap.set(`${saleId}|${inc.id}`, {
                createdAt: inc.attributes?.createdAt ?? saleCreatedAt,
                productName: prodId ? productMap.get(prodId) ?? '?' : '?',
                saleCreatedAt,
              })
            }
          }
        } catch { /* skip */ }
      }
      // Rate limit protection
      if (i + 10 < saleIds.length) await new Promise(r => setTimeout(r, 500))
    }

    // 3. Calculate dispatch times
    type DispatchRecord = {
      productName: string
      dispatchMinutes: number
      servedAt: Date
      runnerName: string
      dayOfWeek: number
      hour: number
      date: string
    }

    const records: DispatchRecord[] = []

    for (const served of servedItems) {
      const key = `${served.fudo_sale_id}|${served.fudo_item_id}`
      const itemInfo = itemCreatedMap.get(key)
      if (!itemInfo) continue

      const orderedAt = parseISO(itemInfo.createdAt)
      const servedAt = parseISO(served.served_at)
      const dispatchMinutes = differenceInMinutes(servedAt, orderedAt)

      if (dispatchMinutes < 0 || dispatchMinutes > 180) continue // Skip outliers

      const prof = served.profiles as { first_name: string; last_name: string } | null

      records.push({
        productName: itemInfo.productName,
        dispatchMinutes,
        servedAt,
        runnerName: prof ? `${prof.first_name} ${prof.last_name}` : '?',
        dayOfWeek: servedAt.getDay(),
        hour: servedAt.getHours(),
        date: format(servedAt, 'yyyy-MM-dd'),
      })
    }

    if (records.length === 0) {
      return NextResponse.json({
        message: 'Sin registros de despacho válidos',
        period: { from, to },
        summary: null,
        byProduct: [],
        byHour: [],
        byDayOfWeek: [],
        byRunner: [],
        byDay: [],
      })
    }

    // 4. Build analytics

    // Summary
    const allMinutes = records.map(r => r.dispatchMinutes)
    const avg = Math.round(allMinutes.reduce((a, b) => a + b, 0) / allMinutes.length)
    const median = allMinutes.sort((a, b) => a - b)[Math.floor(allMinutes.length / 2)]
    const p90 = allMinutes[Math.floor(allMinutes.length * 0.9)]
    const underTarget = records.filter(r => r.dispatchMinutes <= 20).length
    const overTarget = records.filter(r => r.dispatchMinutes > 25).length

    const summary = {
      totalDispatches: records.length,
      avgMinutes: avg,
      medianMinutes: median,
      p90Minutes: p90,
      minMinutes: Math.min(...allMinutes),
      maxMinutes: Math.max(...allMinutes),
      underTarget20min: underTarget,
      underTargetPct: Math.round((underTarget / records.length) * 100),
      overTarget25min: overTarget,
      overTargetPct: Math.round((overTarget / records.length) * 100),
    }

    // By product
    const productMap = new Map<string, { total: number; count: number; max: number }>()
    for (const r of records) {
      const existing = productMap.get(r.productName) ?? { total: 0, count: 0, max: 0 }
      existing.total += r.dispatchMinutes
      existing.count++
      existing.max = Math.max(existing.max, r.dispatchMinutes)
      productMap.set(r.productName, existing)
    }
    const byProduct = [...productMap.entries()]
      .map(([name, { total, count, max }]) => ({ name, avg: Math.round(total / count), count, max }))
      .sort((a, b) => b.avg - a.avg)

    // By hour
    const hourMap = new Map<number, { total: number; count: number }>()
    for (const r of records) {
      const ex = hourMap.get(r.hour) ?? { total: 0, count: 0 }
      ex.total += r.dispatchMinutes
      ex.count++
      hourMap.set(r.hour, ex)
    }
    const byHour = [...hourMap.entries()]
      .map(([hour, { total, count }]) => ({ hour: `${hour}:00`, avg: Math.round(total / count), count }))
      .sort((a, b) => parseInt(a.hour) - parseInt(b.hour))

    // By day of week
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
    const dowMap = new Map<number, { total: number; count: number }>()
    for (const r of records) {
      const ex = dowMap.get(r.dayOfWeek) ?? { total: 0, count: 0 }
      ex.total += r.dispatchMinutes
      ex.count++
      dowMap.set(r.dayOfWeek, ex)
    }
    const byDayOfWeek = [...dowMap.entries()]
      .map(([dow, { total, count }]) => ({ day: dayNames[dow], avg: Math.round(total / count), count }))
      .sort((a, b) => dayNames.indexOf(a.day) - dayNames.indexOf(b.day))

    // By runner
    const runnerMap = new Map<string, { total: number; count: number }>()
    for (const r of records) {
      const ex = runnerMap.get(r.runnerName) ?? { total: 0, count: 0 }
      ex.total += r.dispatchMinutes
      ex.count++
      runnerMap.set(r.runnerName, ex)
    }
    const byRunner = [...runnerMap.entries()]
      .map(([name, { total, count }]) => ({ name, avg: Math.round(total / count), count }))
      .sort((a, b) => a.avg - b.avg) // Fastest first

    // By day (trend)
    const dayMap = new Map<string, { total: number; count: number }>()
    for (const r of records) {
      const ex = dayMap.get(r.date) ?? { total: 0, count: 0 }
      ex.total += r.dispatchMinutes
      ex.count++
      dayMap.set(r.date, ex)
    }
    const byDay = [...dayMap.entries()]
      .map(([date, { total, count }]) => ({
        date,
        label: format(parseISO(date), 'EEE d', { locale: es }),
        avg: Math.round(total / count),
        count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json({
      period: { from, to },
      summary,
      byProduct,
      byHour,
      byDayOfWeek,
      byRunner,
      byDay,
    })
  } catch (error) {
    console.error('[salon/analytics]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
