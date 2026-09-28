import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { esCostoConfiable, esErrorColumnaFaltante } from '@/lib/costos/confiable'

// ---------------------------------------------------------------------------
// Tipos exportados para consumo desde la página
// ---------------------------------------------------------------------------

export type MermaDayRow = {
  date: string        // YYYY-MM-DD snapshot inicial
  date_to: string     // YYYY-MM-DD snapshot siguiente
  qty_before: number
  qty_after: number
  delta: number
  sold: number
  received: number
  faltante: number    // 0 si no hay
  entrada: number     // 0 si no hay
}

export type MermaProductRow = {
  stock_item_id: string
  name: string
  unit: string
  cost_per_unit: number | null
  /** false = sin costo real (fuente no confiable): faltante_value queda en 0. */
  costo_confiable: boolean
  faltante_units: number   // total del período
  faltante_value: number   // faltante_units × cost_per_unit (solo confiables)
  entrada_units: number
  entrada_value: number
  worst_faltante_date: string | null
  worst_faltante_qty: number
  days: MermaDayRow[]      // solo los días con faltante > 0 o entrada > 0
}

export type MermasPayload = {
  period_days: number
  from: string   // YYYY-MM-DD
  to: string
  generated_at: string
  products: MermaProductRow[]  // ordenado por faltante_value desc
  total_faltante_value: number
  total_entrada_value: number
  /** Cobertura de la valorización: cuántos productos tienen precio real. */
  products_con_precio: number
  days_with_data: number
}

// ---------------------------------------------------------------------------
// Cache de 5 minutos
// ---------------------------------------------------------------------------

type CacheEntry = { at: number; payload: MermasPayload }
const cache = new Map<number, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000

// ---------------------------------------------------------------------------
// Snapshot item type (JSON in stock_snapshots.items)
// ---------------------------------------------------------------------------

type SnapshotItem = {
  id: string
  name: string
  unit: string | null
  category: string | null
  current_qty: number
  cost_per_unit: number | null
  fudo_product_id: string | null
  fudo_ingredient_id: string | null
}

// ---------------------------------------------------------------------------
// GET /api/admin/mermas?days=7|14|30
// Solo socios. Calcula faltantes y entradas sin registrar cruzando snapshots
// diarios con ventas de Fudo y recepciones de stock.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    // Auth: solo socios
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || profile.role !== 'socio') {
      return NextResponse.json({ error: 'Sin acceso: solo socios' }, { status: 403 })
    }

    // Params
    const { searchParams } = new URL(request.url)
    const rawDays = parseInt(searchParams.get('days') ?? '7', 10)
    const days = [7, 14, 30].includes(rawDays) ? rawDays : 7

    // Cache hit
    const cached = cache.get(days)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload)
    }

    const admin = createAdminClient()

    // Calcular sinceDate en AR time
    const nowAR = new Date(new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const sinceAR = new Date(nowAR)
    sinceAR.setDate(sinceAR.getDate() - days - 1) // -1 para capturar el snapshot anterior
    const sinceStr = sinceAR.toISOString().slice(0, 10)
    const todayStr = nowAR.toISOString().slice(0, 10).slice(0, 10)

    // --- 1) Snapshots diarios ---
    const { data: snapshots } = await admin
      .from('stock_snapshots')
      .select('snapshot_date, items')
      .eq('snapshot_type', 'daily')
      .gte('snapshot_date', sinceStr)
      .order('snapshot_date', { ascending: true })

    const snaps = (snapshots ?? []) as unknown as { snapshot_date: string; items: SnapshotItem[] }[]

    // --- 2) Ventas Fudo paginadas ---
    const salesRows: { fudo_product_id: string; quantity: number; sold_at: string }[] = []
    for (let offset = 0; offset < 50000; offset += 1000) {
      const { data: batch } = await admin
        .from('fudo_sales')
        .select('fudo_product_id, quantity, sold_at')
        .gte('sold_at', sinceStr)
        .order('sold_at', { ascending: true })
        .range(offset, offset + 999)
      if (!batch || batch.length === 0) break
      salesRows.push(...(batch as typeof salesRows))
      if (batch.length < 1000) break
    }

    // Indexar ventas por `${fudo_product_id}|${argDate}`
    const soldByProductDate = new Map<string, number>()
    for (const row of salesRows) {
      const argDate = new Date(row.sold_at)
        .toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
        .slice(0, 10)
      const key = `${row.fudo_product_id}|${argDate}`
      soldByProductDate.set(key, (soldByProductDate.get(key) ?? 0) + Number(row.quantity))
    }

    // --- 3) Recepciones de stock ---
    const { data: receiptRows } = await admin
      .from('stock_receipts')
      .select('stock_item_id, qty, received_date')
      .gte('received_date', sinceStr)

    const receivedByItemDate = new Map<string, number>()
    for (const row of (receiptRows ?? []) as { stock_item_id: string | null; qty: number; received_date: string }[]) {
      if (!row.stock_item_id) continue
      const key = `${row.stock_item_id}|${row.received_date}`
      receivedByItemDate.set(key, (receivedByItemDate.get(key) ?? 0) + Number(row.qty))
    }

    // --- 4) Algoritmo día a día ---
    // Map: stock_item_id → acumulado
    type ItemAcc = {
      name: string
      unit: string
      cost_per_unit: number | null
      faltante_units: number
      faltante_value: number
      entrada_units: number
      entrada_value: number
      worst_faltante_date: string | null
      worst_faltante_qty: number
      days: MermaDayRow[]
    }
    const itemAccMap = new Map<string, ItemAcc>()

    for (let i = 0; i + 1 < snaps.length; i++) {
      const snapDate = snaps[i].snapshot_date   // fecha del snapshot "antes"
      const snapDateTo = snaps[i + 1].snapshot_date // fecha del snapshot "después"

      const before = new Map(snaps[i].items.map(it => [it.id, it]))
      const after = new Map(snaps[i + 1].items.map(it => [it.id, it]))

      for (const [id, b] of before) {
        const a = after.get(id)
        if (!a || !b.fudo_product_id) continue // solo items con fudo_product_id

        const qtyBefore = Number(b.current_qty)
        const qtyAfter = Number(a.current_qty)
        const delta = qtyAfter - qtyBefore
        const sold = soldByProductDate.get(`${b.fudo_product_id}|${snapDate}`) ?? 0
        const received = receivedByItemDate.get(`${id}|${snapDate}`) ?? 0

        // unexplained = delta + sold - received
        // Si unexplained < 0 → faltante (stock bajó más de lo explicado por ventas)
        // Si unexplained > 0 → entrada sin registrar (stock subió más de lo esperado)
        const unexplained = delta + sold - received

        const faltante = unexplained < -2 ? -unexplained : 0
        const entrada = unexplained > 2 ? unexplained : 0

        if (faltante === 0 && entrada === 0) continue

        const cost = a.cost_per_unit ?? b.cost_per_unit
        const unit = a.unit ?? b.unit ?? ''

        // Obtener o crear acumulador
        if (!itemAccMap.has(id)) {
          itemAccMap.set(id, {
            name: b.name,
            unit,
            cost_per_unit: cost,
            faltante_units: 0,
            faltante_value: 0,
            entrada_units: 0,
            entrada_value: 0,
            worst_faltante_date: null,
            worst_faltante_qty: 0,
            days: [],
          })
        }

        const acc = itemAccMap.get(id)!
        acc.faltante_units += faltante
        acc.entrada_units += entrada
        // La valorización $ se hace DESPUÉS, con el costo real vigente del
        // item (gating de cost_source) — el costo del snapshot podía venir
        // del espejo de Fudo, que no es un precio real.

        if (faltante > acc.worst_faltante_qty) {
          acc.worst_faltante_qty = faltante
          acc.worst_faltante_date = snapDate
        }

        acc.days.push({
          date: snapDate,
          date_to: snapDateTo,
          qty_before: qtyBefore,
          qty_after: qtyAfter,
          delta,
          sold,
          received,
          faltante,
          entrada,
        })
      }
    }

    // --- 5) Valorizar con costo REAL vigente (solo fuentes confiables) ---
    // Los snapshots guardan el cost_per_unit histórico, que podía ser el
    // espejo de Fudo. Para poner $ se usa el costo actual del item y SOLO si
    // su fuente es confiable (compra/manual/producción); si no, va sin $.
    const accIds = [...itemAccMap.keys()]
    const costRealById = new Map<string, number>()
    if (accIds.length > 0) {
      let rows: { id: string; cost_per_unit: number | null; cost_source?: string | null }[] = []
      const res = await admin
        .from('stock_items')
        .select('id, cost_per_unit, cost_source')
        .in('id', accIds)
      if (res.error && esErrorColumnaFaltante(res.error.message, ['cost_source'])) {
        // Migración pendiente → criterio legacy (costo > 0)
        const legacy = await admin.from('stock_items').select('id, cost_per_unit').in('id', accIds)
        rows = ((legacy.data ?? []) as typeof rows).map(r => ({
          ...r,
          cost_source: Number(r.cost_per_unit ?? 0) > 0 ? 'compra' : null,
        }))
      } else if (!res.error) {
        rows = (res.data ?? []) as typeof rows
      }
      for (const r of rows) {
        if (esCostoConfiable(r.cost_source ?? null, r.cost_per_unit)) {
          costRealById.set(r.id, Number(r.cost_per_unit))
        }
      }
    }

    // --- 6) Filtrar ruido y construir products ---
    const products: MermaProductRow[] = []
    for (const [id, acc] of itemAccMap) {
      if (acc.faltante_units <= 2 && acc.entrada_units <= 30) continue
      const costReal = costRealById.get(id) ?? null
      products.push({
        stock_item_id: id,
        name: acc.name,
        unit: acc.unit,
        cost_per_unit: costReal,
        costo_confiable: costReal != null,
        faltante_units: acc.faltante_units,
        faltante_value: costReal != null ? acc.faltante_units * costReal : 0,
        entrada_units: acc.entrada_units,
        entrada_value: costReal != null ? acc.entrada_units * costReal : 0,
        worst_faltante_date: acc.worst_faltante_date,
        worst_faltante_qty: acc.worst_faltante_qty,
        days: acc.days.filter(d => d.faltante > 0 || d.entrada > 0),
      })
    }

    // Ordenar por faltante_value desc, y a igual valor por unidades faltantes
    products.sort((a, b) => b.faltante_value - a.faltante_value || b.faltante_units - a.faltante_units)

    const payload: MermasPayload = {
      period_days: days,
      from: sinceStr,
      to: todayStr,
      generated_at: new Date().toISOString(),
      products,
      total_faltante_value: products.reduce((s, p) => s + p.faltante_value, 0),
      total_entrada_value: products.reduce((s, p) => s + p.entrada_value, 0),
      products_con_precio: products.filter(p => p.costo_confiable).length,
      days_with_data: Math.max(snaps.length - 1, 0),
    }

    cache.set(days, { at: Date.now(), payload })

    return NextResponse.json(payload)
  } catch (error) {
    console.error('[/api/admin/mermas GET]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
