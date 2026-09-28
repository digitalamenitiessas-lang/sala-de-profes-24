// ---------------------------------------------------------------------------
// Lectura de ventas de un mes desde Fudo, normalizada a zona Argentina.
// Fuente única para monthly-summary y el análisis IA de ventas.
// ---------------------------------------------------------------------------

import { fudo } from '@/lib/fudoClient'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, min } from 'date-fns'

export type MonthSaleItem = { name: string; qty: number; price: number; productId: string | null }

export type MonthSale = {
  id: string
  total: number
  state: string
  /** Fecha argentina yyyy-MM-dd */
  argDate: string
  /** Hora argentina 0-23 */
  argHour: number
  /** Día de semana argentino: 0=domingo … 6=sábado */
  argDow: number
  items: MonthSaleItem[]
}

type JsonApiRow = { type: string; id: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data: unknown }> }

export async function fetchMonthSales(monthParam?: string | null): Promise<{
  sales: MonthSale[]
  start: Date
  end: Date
  days: Date[]
  /** true si el mes quedó incompleto: se llegó al tope de páginas o falló una página. */
  truncado: boolean
}> {
  const refDate = monthParam ? new Date(monthParam + '-15') : new Date()
  const start = startOfMonth(refDate)
  const end = min([endOfMonth(refDate), new Date()])
  const days = eachDayOfInterval({ start, end })

  const startStr = format(start, 'yyyy-MM-dd')
  const endStr = format(end, 'yyyy-MM-dd')

  const sales: MonthSale[] = []
  let truncado = false

  let page = 1
  // 40×200 = 8.000 ventas: alcanza para el mes más fuerte medido (5.588
  // líneas) con margen. Si igual se corta, se avisa con truncado=true.
  const maxPages = 40
  while (page <= maxPages) {
    try {
      const res = await fudo.fetch<{ data?: JsonApiRow[]; included?: JsonApiRow[] }>(
        `/sales?include=items.product&sort=-createdAt&page[size]=200&page[number]=${page}`
      )

      const salesData = res.data ?? []
      const included = res.included ?? []

      const itemMap = new Map<string, JsonApiRow>()
      const productMap = new Map<string, JsonApiRow>()
      for (const r of included) {
        if (r.type === 'Item') itemMap.set(r.id, r)
        if (r.type === 'Product') productMap.set(r.id, r)
      }

      let foundBefore = false
      for (const sale of salesData) {
        const createdAt = String(sale.attributes?.createdAt ?? '')
        const saleDate = new Date(createdAt)
        const argDate = saleDate.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
        const argHour = Number(saleDate.toLocaleString('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false })) % 24
        const argDow = new Date(argDate + 'T12:00:00').getDay()

        if (argDate < startStr) { foundBefore = true; continue }
        if (argDate > endStr) continue

        const saleItems: MonthSaleItem[] = []
        const itemRefs = (sale.relationships?.items?.data ?? []) as Array<{ id: string }>
        for (const ref of itemRefs) {
          const item = itemMap.get(ref.id)
          if (!item) continue
          const attrs = item.attributes as Record<string, unknown> | undefined
          if (attrs?.canceled) continue

          const prodRef = (item.relationships as Record<string, { data: unknown }> | undefined)?.product?.data as { id?: string } | undefined
          const product = prodRef?.id ? productMap.get(String(prodRef.id)) : undefined
          const prodAttrs = product?.attributes as Record<string, unknown> | undefined

          saleItems.push({
            name: String(prodAttrs?.name ?? 'Desconocido'),
            qty: Number(attrs?.quantity ?? 1),
            price: Number(attrs?.price ?? 0),
            productId: prodRef?.id ? String(prodRef.id) : null,
          })
        }

        sales.push({
          id: String(sale.id),
          total: Number(sale.attributes?.total ?? 0),
          state: String(sale.attributes?.saleState ?? 'UNKNOWN'),
          argDate,
          argHour,
          argDow,
          items: saleItems,
        })
      }

      if (foundBefore || salesData.length < 200) break
      // Si el tope llega igual (mes con más de 8.000 ventas), el mes queda incompleto
      if (page === maxPages) truncado = true
      page++
    } catch (err) {
      // Una página falló: lo que sigue del mes no se leyó → mes incompleto
      console.error('[month-sales] page fetch error:', err)
      truncado = true
      break
    }
  }

  return { sales, start, end, days, truncado }
}
