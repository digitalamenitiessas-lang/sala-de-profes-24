import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isKitchenRole } from '@/lib/roles'

// ---------------------------------------------------------------------------
// GET /api/stock/precios?days=180
// ---------------------------------------------------------------------------
// Precio histórico de COMPRA por insumo: stock_receipts con cost_per_unit
// no nulo, agrupado por stock_item. Para cada grupo: último precio,
// mín/prom/máx y detalle por recibo (fecha, cantidad, precio, proveedor).
// Mismo espíritu que /api/produccion/costos pero mirando compras.
// ---------------------------------------------------------------------------

type PriceReceipt = {
  id: number
  date: string
  qty: number
  unit: string
  cost_per_unit: number
  cost_total: number | null
  supplier: string | null
}

type ItemPriceHistory = {
  stock_item_id: string | null
  name: string
  unit: string
  receipts: PriceReceipt[]
  latest_price: number | null
  avg_price: number | null
  min_price: number | null
  max_price: number | null
  receipt_count: number
}

const PAGE_SIZE = 1000

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!isKitchenRole(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const admin = createAdminClient()
    const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') ?? 180) || 180, 1), 365)
    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceDate = since.toISOString().slice(0, 10)

    type Row = {
      id: number
      stock_item_id: string | null
      qty: number
      unit: string | null
      cost_per_unit: number
      cost_total: number | null
      received_date: string
      stock_items: { name: string | null; unit: string | null } | null
      suppliers: { name: string | null } | null
    }

    // Paginado de a 1000 (PostgREST corta en 1000 por default)
    const rows: Row[] = []
    for (let page = 0; page < 20; page++) {
      const from = page * PAGE_SIZE
      const { data, error } = await admin
        .from('stock_receipts')
        .select('id, stock_item_id, qty, unit, cost_per_unit, cost_total, received_date, stock_items(name, unit), suppliers(name)')
        .not('cost_per_unit', 'is', null)
        .gte('received_date', sinceDate)
        .order('received_date', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      const batch = (data ?? []) as unknown as Row[]
      rows.push(...batch)
      if (batch.length < PAGE_SIZE) break
    }

    // Agrupar por insumo (los recibos ya vienen ordenados por fecha desc)
    const groups = new Map<string, ItemPriceHistory>()
    for (const r of rows) {
      const price = Number(r.cost_per_unit)
      if (!(price > 0)) continue
      const key = r.stock_item_id ?? 'sin-insumo'
      const group = groups.get(key) ?? {
        stock_item_id: r.stock_item_id,
        name: r.stock_items?.name ?? 'Sin insumo vinculado',
        unit: r.stock_items?.unit ?? r.unit ?? 'u',
        receipts: [],
        latest_price: null,
        avg_price: null,
        min_price: null,
        max_price: null,
        receipt_count: 0,
      }
      group.receipts.push({
        id: r.id,
        date: r.received_date,
        qty: Math.round(Number(r.qty) * 1000) / 1000,
        unit: r.unit ?? group.unit,
        cost_per_unit: Math.round(price * 100) / 100,
        cost_total: r.cost_total != null ? Math.round(Number(r.cost_total)) : null,
        supplier: r.suppliers?.name ?? null,
      })
      groups.set(key, group)
    }

    const items = [...groups.values()].map((g) => {
      const prices = g.receipts.map((r) => r.cost_per_unit)
      g.receipt_count = g.receipts.length
      g.latest_price = g.receipts[0]?.cost_per_unit ?? null
      g.avg_price = prices.length ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : null
      g.min_price = prices.length ? Math.min(...prices) : null
      g.max_price = prices.length ? Math.max(...prices) : null
      return g
    }).sort((a, b) => b.receipt_count - a.receipt_count)

    return NextResponse.json({
      items,
      total_receipts: items.reduce((sum, g) => sum + g.receipt_count, 0),
    })
  } catch (err) {
    console.error('[GET /api/stock/precios]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
