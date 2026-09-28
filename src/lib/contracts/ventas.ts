// ---------------------------------------------------------------------------
// Ventas — Contracts and derivations
// ---------------------------------------------------------------------------
// Source of truth: Fudo API (real-time) → /api/fudo/auto-sync
// Supabase fudo_sales is a log, not the live state
// ---------------------------------------------------------------------------

export type SaleState = 'CLOSED' | 'IN-COURSE' | 'PAYMENT-PROCESS'

export type SaleTicket = {
  id: string
  total: number
  state: SaleState
  type: string // EAT-IN, TAKEAWAY, DELIVERY
  tableNumber: number | null
  waiter: string | null
  createdAt: string
  closedAt: string | null
  items: SaleItem[]
}

export type SaleItem = {
  productId: string
  productName: string
  quantity: number
  price: number
  canceled: boolean
}

export type VentasResumen = {
  totalFacturado: number    // Only CLOSED tickets
  totalEnCurso: number      // Only IN-COURSE + PAYMENT-PROCESS
  totalGeneral: number      // facturado + en curso
  ticketsCerrados: number
  ticketsAbiertos: number
  ticketPromedio: number    // facturado / cerrados
  topProducts: { name: string; qty: number; revenue: number }[]
  ventasPorHora: { hour: number; total: number; count: number }[]
  ultimosTickets: SaleTicket[]
}

/**
 * Derive resumen from raw tickets.
 * This is the ONLY place that calculates ventas metrics.
 */
export function deriveVentasResumen(tickets: SaleTicket[]): VentasResumen {
  const closed = tickets.filter(t => t.state === 'CLOSED')
  const open = tickets.filter(t => t.state !== 'CLOSED')

  const totalFacturado = closed.reduce((s, t) => s + t.total, 0)
  const totalEnCurso = open.reduce((s, t) => s + t.total, 0)

  // Top products from ALL non-canceled items in closed tickets
  const productMap = new Map<string, { name: string; qty: number; revenue: number }>()
  for (const ticket of closed) {
    for (const item of ticket.items) {
      if (item.canceled) continue
      // price es UNITARIO: el revenue de la línea es quantity × price.
      // (El totalFacturado sigue saliendo de ticket.total, que respeta los
      // descuentos de ticket; este revenue por producto no los ve.)
      const key = item.productId
      const ex = productMap.get(key)
      if (ex) {
        ex.qty += item.quantity
        ex.revenue += item.quantity * item.price
      } else {
        productMap.set(key, { name: item.productName, qty: item.quantity, revenue: item.quantity * item.price })
      }
    }
  }
  const topProducts = [...productMap.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 20)

  // Ventas por hora (from closed tickets)
  const hourMap = new Map<number, { total: number; count: number }>()
  for (const ticket of closed) {
    const h = new Date(ticket.createdAt).getHours()
    const ex = hourMap.get(h)
    if (ex) { ex.total += ticket.total; ex.count++ }
    else hourMap.set(h, { total: ticket.total, count: 1 })
  }
  const ventasPorHora = [...hourMap.entries()]
    .map(([hour, { total, count }]) => ({ hour, total, count }))
    .sort((a, b) => a.hour - b.hour)

  return {
    totalFacturado,
    totalEnCurso,
    totalGeneral: totalFacturado + totalEnCurso,
    ticketsCerrados: closed.length,
    ticketsAbiertos: open.length,
    ticketPromedio: closed.length > 0 ? Math.round(totalFacturado / closed.length) : 0,
    topProducts,
    ventasPorHora,
    ultimosTickets: tickets.slice(0, 20),
  }
}

/** Format currency for display */
export function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}k`
  return `$${amount.toLocaleString('es-AR')}`
}
