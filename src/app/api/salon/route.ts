import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fudoHttp } from '@/lib/fudoClient'

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

    // Get open sales with items + table + product
    const res = await fudoHttp(
      'https://api.fu.do/v1alpha1/sales?include=items.product,table&sort=-createdAt&page[size]=50',
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
    const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

    // Get all served items from our DB
    const { data: servedItems } = await admin
      .from('salon_item_status')
      .select('fudo_sale_id, fudo_item_id, served_at')

    const servedSet = new Set((servedItems ?? []).map(s => `${s.fudo_sale_id}|${s.fudo_item_id}`))
    const servedTimeMap = new Map((servedItems ?? []).map(s => [`${s.fudo_sale_id}|${s.fudo_item_id}`, s.served_at]))

    // Build tables
    type SaleItem = { itemId: string; name: string; qty: number; price: number; createdAt: string; served: boolean; servedAt?: string; minutesPending: number }

    const tables = ((data.data ?? []) as Array<{
      id: string
      attributes: { saleState: string; saleType: string; total: number; createdAt: string; people: number | null }
      relationships: { table?: { data?: { id: string } }; items?: { data?: { id: string }[] } }
    }>)
      .filter(sale => {
        if (sale.attributes.saleState === 'CLOSED') return false
        const argDate = new Date(sale.attributes.createdAt).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
        return argDate === today
      })
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

        return {
          saleId: sale.id,
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
    const { saleId, itemIds, allServed } = body

    if (!saleId) return NextResponse.json({ error: 'saleId requerido' }, { status: 400 })

    let idsToMark: string[] = []

    if (allServed) {
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
    } else if (Array.isArray(itemIds)) {
      idsToMark = itemIds
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
