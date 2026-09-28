import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// GET /api/fudo/auto-sync — Real-time sales from Fudo
// Fetches directly from Fudo API with include=items.product,table
// Returns live data: mesas en curso, cerradas, productos vendidos
// Requires authentication — only socio/encargado can access
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const revalidate = 0

type IncludedResource = {
  type: string
  id: string
  attributes: Record<string, unknown>
  relationships?: Record<string, { data: unknown }>
}

export async function GET(request: NextRequest) {
  try {
    // Auth: usuario con sesión, o llamada interna con el secreto del servidor.
    // (Antes bastaba mandar "x-internal-call: true" para ver las ventas sin usuario.)
    const secreto = process.env.CRON_SECRET
    const isInternal = !!secreto && request.headers.get('x-internal-call') === secreto
    if (!isInternal) {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
      }
    }

    // Accept ?date=YYYY-MM-DD for historical data, default to today
    const dateParam = request.nextUrl.searchParams.get('date')
    const now = new Date()
    const argDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const today = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : argDate.toISOString().slice(0, 10)

    // Fetch sales with items, products, and tables — paginate to get all of today
    let salesData: IncludedResource[] = []
    let included: IncludedResource[] = []
    let page = 1

    while (page <= 5) { // safety limit: max 5 pages (500 sales)
      const response = await fudo.fetch<{
        data: IncludedResource[]
        included?: IncludedResource[]
      }>(`/sales?include=items.product,table&sort=-createdAt&page[size]=100&page[number]=${page}`)

      const pageData = Array.isArray(response.data) ? response.data : []
      salesData.push(...pageData)
      included.push(...(response.included ?? []))

      if (pageData.length < 100) break // last page

      // Check if oldest sale on this page is before today (Argentina time)
      const oldest = pageData[pageData.length - 1]
      const oldestUtc = new Date(String(oldest?.attributes?.createdAt ?? ''))
      const oldestArgDate = oldestUtc.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
      if (oldestArgDate < today) break

      page++
    }

    // Build lookup maps (deduplicate included across pages)
    const itemMap = new Map<string, IncludedResource>()
    const productMap = new Map<string, IncludedResource>()
    const tableMap = new Map<string, IncludedResource>()
    for (const r of included) {
      const key = `${r.type}_${r.id}`
      if (r.type === 'Item' && !itemMap.has(r.id)) itemMap.set(r.id, r)
      if (r.type === 'Product' && !productMap.has(r.id)) productMap.set(r.id, r)
      if (r.type === 'Table' && !tableMap.has(r.id)) tableMap.set(r.id, r)
    }

    // Filter today's sales using Argentina timezone (Fudo uses local AR time)
    const todaySales = salesData.filter((s) => {
      const utc = new Date(String(s.attributes.createdAt ?? ''))
      const argDate2 = utc.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
      return argDate2 === today
    })
    // Exclude $0 sales (empty/voided tickets)
    .filter((s) => Number(s.attributes.total ?? 0) > 0 || s.attributes.saleState !== 'CLOSED')

    // Build structured data per ticket/mesa
    type TicketItem = { name: string; qty: number; price: number }
    type Ticket = {
      id: string
      state: string // IN-COURSE, CLOSED, PAYMENT-PROCESS
      saleType: string // EAT-IN, TAKEAWAY, DELIVERY
      tableNumber: number | null
      tableId: string | null
      total: number // from Fudo sale.total (real amount)
      createdAt: string
      closedAt: string | null
      items: TicketItem[]
    }

    const tickets: Ticket[] = []
    const productSales = new Map<string, { name: string; qty: number; revenue: number }>()

    for (const sale of todaySales) {
      const saleTotal = Number(sale.attributes.total ?? 0)
      const state = String(sale.attributes.saleState ?? 'UNKNOWN')
      const saleType = String(sale.attributes.saleType ?? '')

      // Get table info
      const tableRef = (sale.relationships?.table?.data ?? null) as { id: string } | null
      const table = tableRef?.id ? tableMap.get(tableRef.id) : null
      const tableNumber = table ? Number(table.attributes.number ?? 0) : null

      // Get items
      const itemRefs = (sale.relationships?.items?.data ?? []) as { id: string }[]
      const ticketItems: TicketItem[] = []

      for (const ref of itemRefs) {
        const item = itemMap.get(ref.id)
        if (!item) continue

        // Skip cancelled/voided items
        if (item.attributes.canceled || item.attributes.status === 'CANCELLED') continue

        const productRef = (item.relationships?.product?.data ?? {}) as { id?: string }
        const product = productRef?.id ? productMap.get(productRef.id) : null
        const name = String(product?.attributes?.name ?? `Item #${item.id}`)
        const qty = Number(item.attributes.quantity ?? 1)
        const price = Number(item.attributes.price ?? 0)

        ticketItems.push({ name, qty, price })

        // Aggregate product sales — el price de Fudo es UNITARIO, así que el
        // revenue de la línea es qty × price (sumar solo price subestimaba
        // las líneas con cantidad > 1).
        // OJO: el totalFacturado del día sigue saliendo de sale.total, que
        // respeta descuentos de ticket; este revenue por producto no los ve.
        const prodKey = productRef?.id ?? item.id
        const existing = productSales.get(prodKey)
        if (existing) {
          existing.qty += qty
          existing.revenue += qty * price
        } else {
          productSales.set(prodKey, { name, qty, revenue: qty * price })
        }
      }

      tickets.push({
        id: sale.id,
        state,
        saleType,
        tableNumber,
        tableId: tableRef?.id ?? null,
        total: saleTotal,
        createdAt: String(sale.attributes.createdAt ?? ''),
        closedAt: sale.attributes.closedAt ? String(sale.attributes.closedAt) : null,
        items: ticketItems,
      })
    }

    // Separate by state
    const openTickets = tickets.filter((t) => t.state !== 'CLOSED')
    const closedTickets = tickets.filter((t) => t.state === 'CLOSED')

    // KPIs — use sale.total (Fudo's real total)
    const payingTickets = tickets.filter((t) => t.state === 'PAYMENT-PROCESS')
    const totalFacturado = closedTickets.reduce((s, t) => s + t.total, 0)
    const totalEnCurso = openTickets.reduce((s, t) => s + t.total, 0)
    const totalGeneral = totalFacturado + totalEnCurso
    const totalTickets = tickets.length
    const totalItems = tickets.reduce((s, t) => s + t.items.reduce((is, i) => is + i.qty, 0), 0)

    // Separate mesas (EAT-IN) from takeaway/delivery
    const openMesas = openTickets.filter((t) => t.saleType === 'EAT-IN')
    const openTakeaway = openTickets.filter((t) => t.saleType !== 'EAT-IN')

    // Top products
    const topProducts = [...productSales.values()]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 15)

    // By sale type
    const typeLabels: Record<string, string> = {
      'EAT-IN': 'En local',
      'TAKEAWAY': 'Para llevar',
      'DELIVERY': 'Delivery',
    }
    const typeAgg = new Map<string, { tickets: number; revenue: number }>()
    for (const t of tickets) {
      const label = typeLabels[t.saleType] ?? t.saleType
      const ex = typeAgg.get(label)
      if (ex) { ex.tickets++; ex.revenue += t.total }
      else typeAgg.set(label, { tickets: 1, revenue: t.total })
    }
    const bySaleType = [...typeAgg.entries()]
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)

    // By hour — UTC-3 (Argentina, sin DST)
    const hourAgg = new Map<number, { tickets: number; revenue: number; items: number }>()
    for (const t of tickets) {
      const hour = (new Date(t.createdAt).getUTCHours() - 3 + 24) % 24
      const ex = hourAgg.get(hour)
      const tItems = t.items.reduce((s, i) => s + i.qty, 0)
      if (ex) { ex.tickets++; ex.revenue += t.total; ex.items += tItems }
      else hourAgg.set(hour, { tickets: 1, revenue: t.total, items: tItems })
    }
    const byHour = Array.from({ length: 24 }, (_, h) => {
      const data = hourAgg.get(h)
      return {
        hour: `${String(h).padStart(2, '0')}:00`,
        tickets: data?.tickets ?? 0,
        revenue: data?.revenue ?? 0,
        items: data?.items ?? 0,
      }
    }).filter((h) => h.tickets > 0 || (h.hour >= '08:00' && h.hour <= '23:00'))

    // Format tickets for frontend (open first, then recent closed)
    const formatTicket = (t: Ticket) => ({
      ticketId: t.id,
      state: t.state,
      saleType: t.saleType,
      tableNumber: t.tableNumber,
      total: t.total,
      time: t.createdAt,
      closedAt: t.closedAt,
      items: t.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
    })

    return NextResponse.json({
      lastSync: new Date().toISOString(),
      today: {
        totalFacturado,
        totalEnCurso,
        totalGeneral,
        totalTickets,
        totalItems,
        avgTicket: closedTickets.length > 0 ? Math.round(totalFacturado / closedTickets.length) : 0,
        mesasAbiertas: openMesas.length,
        takeawayAbiertos: openTakeaway.length,
        mesasPagando: payingTickets.filter(t => t.saleType === 'EAT-IN').length,
        mesasCerradas: closedTickets.filter(t => t.saleType === 'EAT-IN').length,
        totalAbiertas: openTickets.length, // mesas + takeaway combined
        topProducts,
        bySaleType,
        byHour,
        openTables: openMesas
          .sort((a, b) => (a.tableNumber ?? 999) - (b.tableNumber ?? 999))
          .map(formatTicket),
        openTakeaway: openTakeaway
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(formatTicket),
        recentSales: closedTickets
          .sort((a, b) => (b.closedAt ?? b.createdAt).localeCompare(a.closedAt ?? a.createdAt))
          .slice(0, 10)
          .map(formatTicket),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error', today: null },
      { status: 500 },
    )
  }
}
