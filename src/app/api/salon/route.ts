import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fudoHttp } from '@/lib/fudoClient'
import { fechaOperativa } from '@/lib/attendance/jornada'

// ---------------------------------------------------------------------------
// GET /api/salon — Open tables with items and delay semaphore
// POST /api/salon — Mark item(s) as served
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const admin = createAdminClient()

    // Solo las ventas abiertas (antes: las últimas 50 ventas, y en un día con
    // mucho para llevar una mesa abierta temprano quedaba afuera)
    const res = await fudoHttp(
      'https://api.fu.do/v1alpha1/sales?filter[saleState]=in.(IN-COURSE,PENDING,PAYMENT-PROCESS)&include=items.product,table&sort=-createdAt&page[size]=100',
    )
    if (!res.ok) throw new Error(`Fudo API: ${res.status}`)
    const data = await res.json()

    // Build maps
    const tableMap = new Map<string, { number: number }>()
    const itemMap = new Map<string, { qty: number; price: number; createdAt: string; productId?: string; canceled?: boolean }>()
    const productMap = new Map<string, string>()

    for (const inc of (data.included ?? [])) {
      if (inc.type === 'Table') tableMap.set(inc.id, { number: inc.attributes.number })
      if (inc.type === 'Item') {
        itemMap.set(inc.id, {
          qty: inc.attributes.quantity ?? 1,
          price: inc.attributes.price ?? 0,
          createdAt: inc.attributes.createdAt ?? '',
          productId: inc.relationships?.product?.data?.id,
          canceled: inc.attributes.canceled ?? false,
        })
      }
      if (inc.type === 'Product') productMap.set(inc.id, inc.attributes.name ?? '?')
    }

    const now = new Date()
    // Día operativo (corta a las 6): una mesa de las 23:30 sigue a las 00:30
    const hoy = fechaOperativa(now)
    type Venta = {
      id: string
      attributes: { saleState: string; saleType: string; total: number; createdAt: string; people: number | null }
      relationships: { table?: { data?: { id: string } }; items?: { data?: { id: string }[] } }
    }
    const abiertas = ((data.data ?? []) as Venta[])
      .filter((sale) => sale.attributes.saleState !== 'CLOSED' && fechaOperativa(new Date(sale.attributes.createdAt)) === hoy)

    // Lo marcado como servido, SOLO de estas ventas. Antes se leía la tabla
    // entera y, pasadas las 1.000 filas, lo nuevo no llegaba: "Todo listo"
    // se guardaba pero la mesa seguía pendiente.
    const saleIds = abiertas.map((s) => String(s.id))
    const { data: servedItems } = saleIds.length === 0 ? { data: [] } : await admin
      .from('salon_item_status')
      .select('fudo_sale_id, fudo_item_id, served_at')
      .in('fudo_sale_id', saleIds)

    const servedSet = new Set((servedItems ?? []).map(s => `${s.fudo_sale_id}|${s.fudo_item_id}`))
    const servedTimeMap = new Map((servedItems ?? []).map(s => [`${s.fudo_sale_id}|${s.fudo_item_id}`, s.served_at]))

    // Build tables
    type SaleItem = { itemId: string; name: string; qty: number; price: number; createdAt: string; served: boolean; servedAt?: string; minutesPending: number }

    const tables = abiertas
      .map(sale => {
        const tableRef = sale.relationships?.table?.data
        const table = tableRef ? tableMap.get(tableRef.id) : null
        const itemRefs = sale.relationships?.items?.data ?? []

        // Build items list
        const items: SaleItem[] = itemRefs
          .map(ref => {
            const item = itemMap.get(ref.id)
            if (!item || item.canceled) return null
            const name = item.productId ? productMap.get(item.productId) ?? '?' : '?'
            const key = `${sale.id}|${ref.id}`
            const served = servedSet.has(key)
            const servedAt = servedTimeMap.get(key)
            const itemCreated = new Date(item.createdAt)
            const minutesPending = served ? 0 : Math.round((now.getTime() - itemCreated.getTime()) / 60000)

            return {
              itemId: ref.id,
              name,
              qty: item.qty,
              price: item.price,
              createdAt: item.createdAt,
              served,
              servedAt: servedAt ?? undefined,
              minutesPending,
            }
          })
          .filter(Boolean) as SaleItem[]

        // Semaphore based on OLDEST UNSERVED ITEM (not table open time)
        const pendingItems = items.filter(i => !i.served)
        const oldestPending = pendingItems.length > 0
          ? Math.max(...pendingItems.map(i => i.minutesPending))
          : 0

        let semaphore: 'green' | 'yellow' | 'red' | 'critical'
        if (pendingItems.length === 0) semaphore = 'green' // All served
        else if (oldestPending > 35) semaphore = 'critical'
        else if (oldestPending > 25) semaphore = 'red'
        else if (oldestPending > 15) semaphore = 'yellow'
        else semaphore = 'green'

        // Hora del pedido que se está esperando (el más viejo sin servir); si
        // está todo servido, la del último pedido. La de la venta es cuando se
        // abrió la mesa, que no es lo mismo cuando piden una segunda vuelta.
        const porHora = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        const pedidoAt = (pendingItems.length > 0
          ? [...pendingItems].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
          : porHora.at(-1))?.createdAt ?? sale.attributes.createdAt

        return {
          saleId: sale.id,
          pedidoAt,
          tableNumber: table?.number ?? null,
          saleType: sale.attributes.saleType,
          state: sale.attributes.saleState,
          total: sale.attributes.total,
          people: sale.attributes.people,
          createdAt: sale.attributes.createdAt,
          minutesOpen: Math.round((now.getTime() - new Date(sale.attributes.createdAt).getTime()) / 60000),
          minutesPending: oldestPending,
          semaphore,
          items,
          itemsTotal: items.length,
          itemsServed: items.filter(i => i.served).length,
          itemsPending: pendingItems.length,
        }
      })
      .sort((a, b) => b.minutesPending - a.minutesPending)

    const counts = {
      total: tables.length,
      green: tables.filter(t => t.semaphore === 'green').length,
      yellow: tables.filter(t => t.semaphore === 'yellow').length,
      red: tables.filter(t => t.semaphore === 'red').length,
      critical: tables.filter(t => t.semaphore === 'critical').length,
    }

    return NextResponse.json({ tables, counts, timestamp: now.toISOString() })
  } catch (error) {
    console.error('[/api/salon GET]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/salon — Mark items as served
// Body: { saleId, itemIds: string[] } or { saleId, allServed: true }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const body = await request.json()
    const { saleId, itemIds, allServed } = body as { saleId?: string; itemIds?: unknown; allServed?: boolean }

    if (!saleId) return NextResponse.json({ error: 'saleId requerido' }, { status: 400 })

    let idsToMark: string[] = []

    // La pantalla manda los ids pendientes que ya tiene (no depende de Fudo)
    if (Array.isArray(itemIds) && itemIds.length > 0) {
      idsToMark = itemIds.map(String).slice(0, 100)
    } else if (allServed) {
      // Get all items for this sale from Fudo
      const res = await fudoHttp(
        `https://api.fu.do/v1alpha1/sales/${saleId}?include=items`,
      )
      if (res.ok) {
        const data = await res.json()
        idsToMark = (data.included ?? [])
          .filter((i: { type: string; attributes?: { canceled?: boolean } }) => i.type === 'Item' && !i.attributes?.canceled)
          .map((i: { id: string }) => i.id)
      }
    }

    if (idsToMark.length === 0) {
      return NextResponse.json({ error: 'No hay items para marcar' }, { status: 400 })
    }

    // Upsert served status
    const records = idsToMark.map(itemId => ({
      fudo_sale_id: String(saleId),
      fudo_item_id: String(itemId),
      served_by: user.id,
    }))

    const { error } = await admin
      .from('salon_item_status')
      .upsert(records, { onConflict: 'fudo_sale_id,fudo_item_id' })

    if (error) throw error

    return NextResponse.json({ success: true, marked: idsToMark.length })
  } catch (error) {
    console.error('[/api/salon POST]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
