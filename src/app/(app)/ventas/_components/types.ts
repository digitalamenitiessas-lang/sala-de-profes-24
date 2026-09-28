import type { VentasAgregadas } from '@/lib/ventas/aggregate'

export type TicketItem = { name: string; qty: number; price: number }

export type Ticket = {
  ticketId: string
  state: string
  saleType: string
  tableNumber: number | null
  total: number
  time: string
  closedAt: string | null
  items: TicketItem[]
}

export type DashboardData = {
  totalFacturado: number
  totalEnCurso: number
  totalGeneral: number
  totalTickets: number
  totalItems: number
  avgTicket: number
  mesasAbiertas: number
  takeawayAbiertos: number
  totalAbiertas: number
  mesasCerradas: number
  topProducts: { name: string; qty: number; revenue: number }[]
  bySaleType: { name: string; tickets: number; revenue: number }[]
  byHour: { hour: string; tickets: number; revenue: number; items: number }[]
  openTables: Ticket[]
  openTakeaway: Ticket[]
  recentSales: Ticket[]
}

/**
 * Respuesta de /api/fudo/range-summary: DashboardData compatible + los cortes
 * nuevos del agregador único (src/lib/ventas/aggregate.ts).
 */
export type RangeData = DashboardData &
  Pick<VentasAgregadas, 'byDay' | 'byDow' | 'byCanal' | 'byCategoria' | 'byProduct' | 'dataHasta' | 'truncado'> & {
    /** Solo manager con costos=1: Σ gastos de Fudo del período. */
    comprasFudo?: number
    /** Solo manager con costos=1: comprasFudo ÷ facturado (0-1). */
    foodCostReal?: number
    /** Por qué no se pudo calcular el food cost, si aplica. */
    costosNota?: string
  }

export const PIE_COLORS = ['#006d5a', '#8b5e34', '#d4943a', '#4a90d9', '#c67b4b', '#2d7d6a']

export const STATE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  'IN-COURSE':      { label: 'En curso',   color: '#006d5a', bg: '#e8f5f1' },
  'PAYMENT-PROCESS':{ label: 'Por cobrar', color: '#d4943a', bg: '#fdf6ec' },
  'CLOSED':         { label: 'Cerrada',    color: '#a39e97', bg: '#f3efe9' },
}

export function formatPrice(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}
