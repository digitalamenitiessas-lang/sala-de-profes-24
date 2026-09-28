import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fudo } from '@/lib/fudoClient'
import { esCostoConfiable } from '@/lib/costos/confiable'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ProductoControlRow = {
  stock_item_id: string
  name: string
  unit: string
  category: string | null
  /** SOLO con fuente de costo confiable (compra/manual/produccion); si no, null y la UI no muestra plata */
  cost_per_unit: number | null
  fudo_product_id: string
  /** Stock actual en Fudo (null si no tiene stockControl activo) */
  fudo_stock: number | null
  /** Stock en el snapshot más reciente (la base de comparación) */
  baseline: number | null
  baseline_date: string | null
  /** Ventas desde el snapshot (3 AM) hasta ahora */
  sold_since_baseline: number
  /** Esperado = baseline − sold_since_baseline */
  expected: number | null
  /**
   * Merma implícita = expected − fudo_stock.
   * Positivo = bajó más de lo que las ventas explican (merma, ajuste en Fudo, etc.)
   * Negativo = tiene más stock del esperado (producción o conteo sin registrar)
   */
  merma_implicita: number | null
  merma_implicita_value: number | null
  /** Mermas registradas manualmente en LVE (últimos 30 días) */
  merma_lve_units: number
  merma_lve_notes: string[]
  current_qty: number
}

export type ProductosControlPayload = {
  generated_at: string
  today_ar: string
  baseline_snapshot_date: string | null
  rows: ProductoControlRow[]
  total_merma_implicita: number
  total_merma_implicita_value: number
  total_merma_lve: number
  total_products: number
  with_stock_control: number
}

// ---------------------------------------------------------------------------
// Cache de 3 minutos (la llamada a Fudo getProducts es cara)
// ---------------------------------------------------------------------------

type CacheEntry = { at: number; payload: ProductosControlPayload }
let cacheEntry: CacheEntry | null = null
const CACHE_TTL_MS = 3 * 60 * 1000

type SnapshotItem = {
  id: string
  current_qty: number
  fudo_product_id: string | null
}

// ---------------------------------------------------------------------------
// GET /api/admin/productos-control
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || profile.role !== 'socio') {
      return NextResponse.json({ error: 'Sin acceso: solo socios' }, { status: 403 })
    }

    if (cacheEntry && Date.now() - cacheEntry.at < CACHE_TTL_MS) {
      return NextResponse.json(cacheEntry.payload)
    }

    const admin = createAdminClient()

    // Fecha Argentina
    const nowAR = new Date(new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const todayStr = nowAR.toISOString().slice(0, 10)

    // 1. Stock items con fudo_product_id — cost_source con select tolerante
    // (migración pendiente → sin la columna, ningún costo cuenta como real)
    const baseSelect = 'id, name, unit, category, current_qty, cost_per_unit, fudo_product_id'
    let stockItemsRes: { data: unknown[] | null; error: { message: string } | null } = await admin
      .from('stock_items')
      .select(`${baseSelect}, cost_source`)
      .eq('is_active', true)
      .not('fudo_product_id', 'is', null)
    if (stockItemsRes.error) {
      stockItemsRes = await admin
        .from('stock_items')
        .select(baseSelect)
        .eq('is_active', true)
        .not('fudo_product_id', 'is', null)
    }
    const stockItems = stockItemsRes.data

    if (!stockItems?.length) {
      const empty: ProductosControlPayload = {
        generated_at: new Date().toISOString(), today_ar: todayStr,
        baseline_snapshot_date: null, rows: [],
        total_merma_implicita: 0, total_merma_implicita_value: 0,
        total_merma_lve: 0, total_products: 0, with_stock_control: 0,
      }
      return NextResponse.json(empty)
    }

    // 2. Productos Fudo con stock actual
    const fudoProducts = await fudo.getProducts()
    const fudoStockMap = new Map<string, number | null>()
    for (const p of fudoProducts) {
      // Solo incluir stock si el producto tiene stockControl activo y un valor real
      fudoStockMap.set(p.id, (p.stockControl && p.stock != null) ? p.stock : null)
    }

    // 3. Snapshot más reciente como baseline
    const { data: latestSnap } = await admin
      .from('stock_snapshots')
      .select('snapshot_date, items')
      .eq('snapshot_type', 'daily')
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .single()

    const snapItems = (latestSnap?.items ?? []) as unknown as SnapshotItem[]
    const snapByItemId = new Map(snapItems.map(si => [si.id, si.current_qty]))
    const baselineDate = latestSnap?.snapshot_date ?? null

    // Las ventas post-snapshot son desde las 3 AM AR del día del snapshot
    // (el snapshot se toma a las 3 AM, así que ventas desde ese punto)
    const baselineStr = baselineDate ?? todayStr
    const since3amAR = `${baselineStr}T03:00:00`
    const since3amUTC = new Date(since3amAR + '-03:00').toISOString()

    // 4. Ventas de Fudo desde el snapshot
    const salesRows: { fudo_product_id: string; quantity: number }[] = []
    for (let offset = 0; offset < 20000; offset += 1000) {
      const { data: batch } = await admin
        .from('fudo_sales')
        .select('fudo_product_id, quantity')
        .gte('sold_at', since3amUTC)
        .range(offset, offset + 999)
      if (!batch?.length) break
      salesRows.push(...(batch as typeof salesRows))
      if (batch.length < 1000) break
    }

    const soldMap = new Map<string, number>()
    for (const row of salesRows) {
      soldMap.set(row.fudo_product_id, (soldMap.get(row.fudo_product_id) ?? 0) + Number(row.quantity))
    }

    // 5. Mermas registradas en LVE (últimos 30 días)
    const since30d = new Date(nowAR)
    since30d.setDate(since30d.getDate() - 30)
    const { data: wasteLogs } = await admin
      .from('stock_logs')
      .select('stock_item_id, old_qty, new_qty, note')
      .eq('action', 'waste')
      .gte('created_at', since30d.toISOString().slice(0, 10))

    type WasteAcc = { units: number; notes: string[] }
    const wasteMap = new Map<string, WasteAcc>()
    for (const w of (wasteLogs ?? []) as { stock_item_id: string | null; old_qty: number; new_qty: number; note: string | null }[]) {
      if (!w.stock_item_id) continue
      const prev = wasteMap.get(w.stock_item_id) ?? { units: 0, notes: [] }
      prev.units += Math.max(0, w.old_qty - w.new_qty)
      if (w.note) prev.notes.push(w.note)
      wasteMap.set(w.stock_item_id, prev)
    }

    // 6. Construir filas
    const rows: ProductoControlRow[] = []
    let withStockControl = 0

    for (const si of stockItems as { id: string; name: string; unit: string; category: string | null; current_qty: number; cost_per_unit: number | null; cost_source?: string | null; fudo_product_id: string }[]) {
      const fudoStock = fudoStockMap.get(si.fudo_product_id) ?? null
      if (fudoStock !== null) withStockControl++

      const baseline = snapByItemId.get(si.id) ?? null
      const sold = soldMap.get(si.fudo_product_id) ?? 0
      const expected = baseline !== null ? baseline - sold : null
      const mermaImplicita = (expected !== null && fudoStock !== null) ? expected - fudoStock : null
      // Plata SOLO con costo confiable (compra/manual/produccion): la merma en
      // unidades se muestra igual, pero sin valorizar con costos de Fudo.
      const costoReal = esCostoConfiable(si.cost_source, si.cost_per_unit) ? Number(si.cost_per_unit) : null
      const mermaValue = (mermaImplicita !== null && costoReal != null) ? mermaImplicita * costoReal : null
      const waste = wasteMap.get(si.id)

      rows.push({
        stock_item_id: si.id,
        name: si.name,
        unit: si.unit ?? 'unidad',
        category: si.category,
        cost_per_unit: costoReal,
        fudo_product_id: si.fudo_product_id,
        fudo_stock: fudoStock,
        baseline,
        baseline_date: baselineDate,
        sold_since_baseline: sold,
        expected,
        merma_implicita: mermaImplicita,
        merma_implicita_value: mermaValue,
        merma_lve_units: waste?.units ?? 0,
        merma_lve_notes: waste?.notes ?? [],
        current_qty: si.current_qty,
      })
    }

    // Ordenar: mayor merma implícita primero, luego sin stock control al final
    rows.sort((a, b) => {
      if (a.merma_implicita === null && b.merma_implicita === null) return a.name.localeCompare(b.name)
      if (a.merma_implicita === null) return 1
      if (b.merma_implicita === null) return -1
      return b.merma_implicita - a.merma_implicita
    })

    const payload: ProductosControlPayload = {
      generated_at: new Date().toISOString(),
      today_ar: todayStr,
      baseline_snapshot_date: baselineDate,
      rows,
      total_merma_implicita: rows.reduce((s, r) => s + Math.max(0, r.merma_implicita ?? 0), 0),
      total_merma_implicita_value: rows.reduce((s, r) => s + Math.max(0, r.merma_implicita_value ?? 0), 0),
      total_merma_lve: rows.reduce((s, r) => s + r.merma_lve_units, 0),
      total_products: rows.length,
      with_stock_control: withStockControl,
    }

    cacheEntry = { at: Date.now(), payload }
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[admin/productos-control]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
