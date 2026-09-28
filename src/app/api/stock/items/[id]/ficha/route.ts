import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isKitchenRole } from '@/lib/roles'
import { lotTone, formatLotCountdown } from '@/lib/stock/helpers'
import { fudoFetch } from '@/lib/fudoClient'
import { fetchFudoExpenses } from '@/lib/fudo/expenses'
import { esErrorColumnaFaltante } from '@/lib/costos/confiable'

// ---------------------------------------------------------------------------
// GET /api/stock/items/[id]/ficha
// ---------------------------------------------------------------------------
// La FICHA DEL INSUMO: todo lo que se sabe de un stock_item en una sola
// respuesta, para que la pantalla no tenga que saltar entre 6 endpoints.
//
// Bloques (cada uno tolera su propio error; si falla uno, los otros llegan
// igual y el motivo queda en `errors`):
//   item        identidad + semáforo
//   fudo        vínculo, stock que reporta Fudo AHORA vs LVE, y la diferencia
//   incidents   incidentes de sync de ese item (fudo_sync_incidents)
//   movements   kardex unificado (stock_movements + stock_logs) etiquetado
//   recipes     recetas que lo consumen (+ recetas que lo producen)
//   prices      historial de stock_receipts + último/prom/mín/máx
//   supplier    proveedor vinculado
//   lots        lotes activos con vencimiento
//   counts      conteos físicos (stock_logs) con diferencia
//
// Query params:
//   ?expenses=1  suma los gastos de Fudo de ese ingrediente (por NOMBRE).
//                Opt-in porque fetchFudoExpenses pagina TODO el módulo de
//                gastos de Fudo (caro); la ficha no lo pide en el primer load.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const MOVEMENTS_LIMIT = 40
const RECEIPTS_LIMIT = 40
const COUNTS_LIMIT = 20

// ---------------------------------------------------------------------------
// Tipos de la respuesta
// ---------------------------------------------------------------------------

type Semaphore = 'red' | 'yellow' | 'green'

export type FichaItem = {
  id: string
  name: string
  unit: string
  category: string
  current_qty: number
  min_qty: number
  shelf_life_days: number | null
  purchase_lead_time_days: number | null
  cost_per_unit: number | null
  /** Fuente del costo: compra | manual | produccion | estimado | fudo | null. */
  cost_source: string | null
  cost_updated_at: string | null
  is_produced: boolean
  is_active: boolean
  notes: string | null
  last_counted_at: string | null
  next_purchase_date: string | null
  updated_at: string
  semaphore: Semaphore
}

export type FichaFudo = {
  linked: boolean
  kind: 'ingredient' | 'product' | 'local' | 'unmapped'
  label: string
  fudo_ingredient_id: string | null
  fudo_product_id: string | null
  fudo_skip: boolean
  /** Stock que reporta Fudo AHORA. null = no se pudo leer (ver `error`). */
  fudo_qty: number | null
  fudo_cost: number | null
  fudo_name: string | null
  fudo_stock_control: boolean | null
  /** fudo_qty - current_qty. null si no hay fudo_qty. */
  diff: number | null
  in_sync: boolean | null
  last_sync: {
    at: string
    status: string
    operation: string
    direction: string
    error: string | null
  } | null
  error: string | null
}

export type FichaMovement = {
  id: string
  source: 'movement' | 'log'
  at: string
  kind: 'compra' | 'venta' | 'produccion' | 'merma' | 'ajuste' | 'conteo' | 'otro'
  label: string
  qty: number | null
  previous_qty: number | null
  new_qty: number | null
  note: string | null
  who: string | null
}

export type FichaRecipe = {
  recipe_id: string
  name: string
  category: string | null
  is_active: boolean
  qty_per_portion: number
  unit: string | null
  yield_portions: number | null
  notes: string | null
}

export type FichaReceipt = {
  id: number
  date: string
  qty: number
  unit: string | null
  cost_per_unit: number | null
  cost_total: number | null
  supplier: string | null
  note: string | null
}

export type FichaLot = {
  id: number
  lot_code: string
  qty_remaining: number
  unit: string
  produced_at: string
  expires_at: string | null
  status: string
  expires_in_days: number | null
  countdown: string | null
  tone: { pill: string; panel: string } | null
}

export type FichaCount = {
  id: number
  at: string
  old_qty: number | null
  new_qty: number | null
  diff: number | null
  note: string | null
  who: string | null
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

function semaphoreOf(currentQty: number, minQty: number): Semaphore {
  if (currentQty <= 0) return 'red'
  if (currentQty <= minQty) return 'red'
  if (currentQty <= minQty * 1.5) return 'yellow'
  return 'green'
}

/** Etiqueta legible del movimiento a partir de movement_type + reason. */
function labelMovement(
  movementType: string | null,
  reason: string | null,
): { kind: FichaMovement['kind']; label: string } {
  const t = (movementType ?? '').toLowerCase()
  const r = (reason ?? '').toLowerCase()

  if (r === 'sale' || r === 'venta') return { kind: 'venta', label: 'Venta' }
  if (r === 'compra' || r === 'reception' || r === 'recepcion') return { kind: 'compra', label: 'Compra / recepción' }
  if (r === 'physical_count' || r === 'conteo' || r === 'count') return { kind: 'conteo', label: 'Conteo físico' }
  if (r === 'waste' || r === 'merma' || r === 'desperdicio') return { kind: 'merma', label: 'Merma' }
  if (r.startsWith('produccion') || r === 'production') {
    return { kind: 'produccion', label: r.includes('input') ? 'Producción (consumo)' : 'Producción' }
  }
  if (r === 'manual_adjustment' || r === 'ajuste') return { kind: 'ajuste', label: 'Ajuste manual' }

  if (t === 'entrada' || t === 'in') return { kind: 'compra', label: 'Entrada' }
  if (t === 'uso' || t === 'out') return { kind: 'venta', label: 'Salida' }
  if (t === 'desperdicio') return { kind: 'merma', label: 'Merma' }
  if (t === 'ajuste') return { kind: 'ajuste', label: 'Ajuste' }

  return { kind: 'otro', label: reason || movementType || 'Movimiento' }
}

function personName(p: unknown): string | null {
  if (!p || typeof p !== 'object') return null
  const rec = p as { first_name?: string | null; last_name?: string | null }
  const name = [rec.first_name, rec.last_name].filter(Boolean).join(' ').trim()
  return name || null
}

function daysUntil(iso: string): number {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(iso)
  const t = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  return Math.round((t.getTime() - today.getTime()) / 86_400_000)
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------------
// Bloque Fudo — lee el stock EN VIVO del ingrediente/producto
// ---------------------------------------------------------------------------

type FudoResource = {
  data?: {
    id?: string
    attributes?: {
      name?: string
      stock?: number | null
      cost?: number | null
      stockControl?: boolean
    }
  }
}

async function readFudoOne(kind: 'ingredient' | 'product', fudoId: string) {
  const path = kind === 'ingredient' ? `/ingredients/${fudoId}` : `/products/${fudoId}`
  const res = await fudoFetch<FudoResource>(path, { signal: AbortSignal.timeout(8000) })
  const attrs = res?.data?.attributes ?? {}
  return {
    name: typeof attrs.name === 'string' ? attrs.name : null,
    stock: typeof attrs.stock === 'number' && Number.isFinite(attrs.stock) ? attrs.stock : null,
    cost: typeof attrs.cost === 'number' && Number.isFinite(attrs.cost) ? attrs.cost : null,
    stockControl: typeof attrs.stockControl === 'boolean' ? attrs.stockControl : null,
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!isKitchenRole(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const { id } = await context.params
    if (!id) return NextResponse.json({ error: 'Falta el id del insumo' }, { status: 400 })

    const admin = createAdminClient()
    const wantsExpenses = request.nextUrl.searchParams.get('expenses') === '1'

    // --- Identidad (si esto falla, no hay ficha) ---------------------------
    // cost_source/cost_updated_at con tolerancia a migración pendiente
    let itemRes = await admin
      .from('stock_items')
      .select(`
        id, name, unit, category, current_qty, min_qty, shelf_life_days,
        purchase_lead_time_days, cost_per_unit, cost_source, cost_updated_at,
        is_produced, is_active, notes,
        last_counted_at, next_purchase_date, updated_at,
        fudo_ingredient_id, fudo_product_id, fudo_skip, supplier_id
      `)
      .eq('id', id)
      .maybeSingle()

    if (itemRes.error && esErrorColumnaFaltante(itemRes.error.message, ['cost_source', 'cost_updated_at'])) {
      itemRes = await admin
        .from('stock_items')
        .select(`
          id, name, unit, category, current_qty, min_qty, shelf_life_days,
          purchase_lead_time_days, cost_per_unit, is_produced, is_active, notes,
          last_counted_at, next_purchase_date, updated_at,
          fudo_ingredient_id, fudo_product_id, fudo_skip, supplier_id
        `)
        .eq('id', id)
        .maybeSingle() as typeof itemRes
    }

    const { data: raw, error: itemError } = itemRes
    if (itemError) throw itemError
    if (!raw) return NextResponse.json({ error: 'Insumo no encontrado' }, { status: 404 })

    const item: FichaItem = {
      id: raw.id,
      name: raw.name,
      unit: raw.unit,
      category: raw.category,
      current_qty: Number(raw.current_qty ?? 0),
      min_qty: Number(raw.min_qty ?? 0),
      shelf_life_days: raw.shelf_life_days,
      purchase_lead_time_days: raw.purchase_lead_time_days,
      cost_per_unit: raw.cost_per_unit,
      cost_source: (raw as { cost_source?: string | null }).cost_source ?? null,
      cost_updated_at: (raw as { cost_updated_at?: string | null }).cost_updated_at ?? null,
      is_produced: Boolean(raw.is_produced),
      is_active: Boolean(raw.is_active),
      notes: raw.notes,
      last_counted_at: raw.last_counted_at,
      next_purchase_date: raw.next_purchase_date,
      updated_at: raw.updated_at,
      semaphore: semaphoreOf(Number(raw.current_qty ?? 0), Number(raw.min_qty ?? 0)),
    }

    const errors: Record<string, string> = {}

    /**
     * Corre un bloque aislado: si falla, se anota el motivo en `errors` y la
     * ficha sigue devolviendo todo lo demás (tolerancia por bloque).
     */
    async function guard<T>(block: string, run: () => Promise<T>): Promise<T | null> {
      try {
        return await run()
      } catch (err) {
        errors[block] = err instanceof Error ? err.message : 'Error desconocido'
        return null
      }
    }

    // --- Bloques en paralelo, cada uno con su propio catch -----------------

    const fudoKind: FichaFudo['kind'] = raw.fudo_ingredient_id
      ? 'ingredient'
      : raw.fudo_product_id
        ? 'product'
        : raw.fudo_skip
          ? 'local'
          : 'unmapped'

    const fudoLabel = {
      ingredient: 'Fudo insumo',
      product: 'Fudo producto',
      local: 'Local LVE',
      unmapped: 'Sin mapeo Fudo',
    }[fudoKind]

    const fudoLivePromise = guard('fudo', async () => {
      if (fudoKind === 'ingredient') return readFudoOne('ingredient', String(raw.fudo_ingredient_id))
      if (fudoKind === 'product') return readFudoOne('product', String(raw.fudo_product_id))
      return null
    })

    const lastSyncPromise = guard('fudo_last_sync', async () => {
      const { data, error } = await admin
        .from('fudo_sync_events')
        .select('created_at, completed_at, status, operation, direction, error_message')
        .eq('stock_item_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return data?.[0] ?? null
    })

    const incidentsPromise = guard('incidents', async () => {
      const { data, error } = await admin
        .from('fudo_sync_incidents')
        .select('id, code, title, detail, severity, status, first_seen_at, last_seen_at')
        .eq('stock_item_id', id)
        .order('last_seen_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data ?? []
    })

    const movementsPromise = guard('movements', async () => {
      const { data, error } = await admin
        .from('stock_movements')
        .select('id, movement_type, qty, previous_qty, new_qty, reason, note, created_at, profiles:created_by(first_name, last_name)')
        .eq('stock_item_id', id)
        .order('created_at', { ascending: false })
        .limit(MOVEMENTS_LIMIT)
      if (error) throw error
      return data ?? []
    })

    // stock_logs es el histórico viejo (y hoy el más poblado): entra al mismo
    // kardex etiquetado como conteo/ajuste según la acción.
    const logsPromise = guard('logs', async () => {
      const { data, error } = await admin
        .from('stock_logs')
        .select('id, action, old_qty, new_qty, note, created_at, profiles:user_id(first_name, last_name)')
        .eq('stock_item_id', id)
        .order('created_at', { ascending: false })
        .limit(MOVEMENTS_LIMIT)
      if (error) throw error
      return data ?? []
    })

    const recipesPromise = guard('recipes', async () => {
      const { data, error } = await admin
        .from('recipe_ingredients')
        .select('id, qty_per_portion, ingredient_unit, notes, recipes(id, name, category, is_active, yield_portions)')
        .eq('stock_item_id', id)
      if (error) throw error
      return data ?? []
    })

    const producedByPromise = guard('produced_by', async () => {
      const { data, error } = await admin
        .from('recipes')
        .select('id, name, category, is_active, yield_portions')
        .eq('output_stock_item_id', id)
      if (error) throw error
      return data ?? []
    })

    const receiptsPromise = guard('prices', async () => {
      const { data, error } = await admin
        .from('stock_receipts')
        .select('id, qty, unit, cost_per_unit, cost_total, received_date, note, suppliers(id, name)')
        .eq('stock_item_id', id)
        .order('received_date', { ascending: false })
        .limit(RECEIPTS_LIMIT)
      if (error) throw error
      return data ?? []
    })

    const supplierPromise = raw.supplier_id
      ? guard('supplier', async () => {
        const { data, error } = await admin
          .from('suppliers')
          .select('id, name, contact_name, phone, email, category, lead_time_days, order_days, is_active')
          .eq('id', raw.supplier_id as string)
          .maybeSingle()
        if (error) throw error
        return data
      })
      : Promise.resolve(null)

    const lotsPromise = guard('lots', async () => {
      const { data, error } = await admin
        .from('stock_lots')
        .select('id, lot_code, qty_remaining, unit, produced_at, expires_at, status, notes')
        .eq('stock_item_id', id)
        .in('status', ['active', 'expired'])
        .gt('qty_remaining', 0)
        .order('expires_at', { ascending: true, nullsFirst: false })
        .limit(20)
      if (error) throw error
      return data ?? []
    })

    const expensesPromise = wantsExpenses
      ? guard('expenses', async () => {
        const all = await fetchFudoExpenses()
        const needle = raw.name.toLowerCase().trim()
        return all
          .filter((e) => e.ingredientNames.some((n) => n.toLowerCase().trim() === needle))
          .slice(0, 20)
          .map((e) => ({ id: e.id, provider: e.provider, date: e.date, amount: e.amount }))
      })
      : Promise.resolve(null)

    const [
      fudoLive, lastSync, incidents, movementRows, logRows,
      recipeRows, producedByRows, receiptRows, supplier, lotRows, expenses,
    ] = await Promise.all([
      fudoLivePromise, lastSyncPromise, incidentsPromise, movementsPromise, logsPromise,
      recipesPromise, producedByPromise, receiptsPromise, supplierPromise, lotsPromise, expensesPromise,
    ])

    // --- Fudo: el reflejo, con la diferencia explícita --------------------
    const fudoQty = fudoLive?.stock ?? null
    const diff = fudoQty === null ? null : round2(fudoQty - item.current_qty)

    const fudo: FichaFudo = {
      linked: fudoKind === 'ingredient' || fudoKind === 'product',
      kind: fudoKind,
      label: fudoLabel,
      fudo_ingredient_id: raw.fudo_ingredient_id ?? null,
      fudo_product_id: raw.fudo_product_id ?? null,
      fudo_skip: Boolean(raw.fudo_skip),
      fudo_qty: fudoQty,
      fudo_cost: fudoLive?.cost ?? null,
      fudo_name: fudoLive?.name ?? null,
      fudo_stock_control: fudoLive?.stockControl ?? null,
      diff,
      in_sync: diff === null ? null : Math.abs(diff) < 0.01,
      last_sync: lastSync
        ? {
          at: lastSync.completed_at ?? lastSync.created_at,
          status: lastSync.status,
          operation: lastSync.operation,
          direction: lastSync.direction,
          error: lastSync.error_message ?? null,
        }
        : null,
      error: errors.fudo ?? null,
    }

    // --- Kardex unificado -------------------------------------------------
    const movements: FichaMovement[] = []

    for (const m of movementRows ?? []) {
      const { kind, label } = labelMovement(m.movement_type, m.reason)
      movements.push({
        id: `mv:${m.id}`,
        source: 'movement',
        at: m.created_at ?? new Date(0).toISOString(),
        kind,
        label,
        qty: m.qty == null ? null : Number(m.qty),
        previous_qty: m.previous_qty == null ? null : Number(m.previous_qty),
        new_qty: m.new_qty == null ? null : Number(m.new_qty),
        note: m.note ?? null,
        who: personName(m.profiles),
      })
    }

    for (const l of logRows ?? []) {
      const old = l.old_qty == null ? null : Number(l.old_qty)
      const next = l.new_qty == null ? null : Number(l.new_qty)
      const delta = old != null && next != null ? round2(next - old) : null
      const action = (l.action ?? '').toLowerCase()
      const isCount = action.includes('count')
      // 'fudo_mirror' = el sync espejó un número que cambió en Fudo (ventas del
      // día o un ajuste hecho en el POS). No es una acción de nadie de LVE.
      const isMirror = action === 'fudo_mirror' || (action === 'update' && !l.profiles)
      movements.push({
        id: `log:${l.id}`,
        source: 'log',
        at: l.created_at,
        kind: isMirror ? 'otro' : isCount ? 'conteo' : 'ajuste',
        label: isMirror ? 'Movimiento en Fudo' : isCount ? 'Conteo físico' : 'Ajuste de stock',
        qty: delta,
        previous_qty: old,
        new_qty: next,
        note: l.note ?? null,
        who: personName(l.profiles),
      })
    }

    movements.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    const kardex = movements.slice(0, MOVEMENTS_LIMIT)

    // --- Recetas ----------------------------------------------------------
    type RecipeRel = { id: string; name: string; category: string | null; is_active: boolean | null; yield_portions: number | null }
    const recipes: FichaRecipe[] = (recipeRows ?? [])
      .map((r): FichaRecipe | null => {
        const rel = r.recipes as unknown as RecipeRel | RecipeRel[] | null
        const rec = Array.isArray(rel) ? rel[0] : rel
        if (!rec) return null
        return {
          recipe_id: rec.id,
          name: rec.name,
          category: rec.category ?? null,
          is_active: rec.is_active !== false,
          qty_per_portion: Number(r.qty_per_portion ?? 0),
          unit: r.ingredient_unit ?? item.unit,
          yield_portions: rec.yield_portions ?? null,
          notes: r.notes ?? null,
        }
      })
      .filter((r): r is FichaRecipe => r !== null)
      .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name))

    const producedBy = (producedByRows ?? []).map((r) => ({
      recipe_id: r.id,
      name: r.name,
      category: r.category ?? null,
      is_active: r.is_active !== false,
      yield_portions: r.yield_portions ?? null,
    }))

    // --- Precios ----------------------------------------------------------
    type SupplierRel = { id: string; name: string }
    const receipts: FichaReceipt[] = (receiptRows ?? []).map((r) => {
      const rel = r.suppliers as unknown as SupplierRel | SupplierRel[] | null
      const sup = Array.isArray(rel) ? rel[0] : rel
      return {
        id: r.id,
        date: r.received_date,
        qty: Number(r.qty ?? 0),
        unit: r.unit ?? item.unit,
        cost_per_unit: r.cost_per_unit == null ? null : Number(r.cost_per_unit),
        cost_total: r.cost_total == null ? null : Number(r.cost_total),
        supplier: sup?.name ?? null,
        note: r.note ?? null,
      }
    })

    const pricePoints = receipts
      .filter((r) => r.cost_per_unit != null && r.cost_per_unit > 0)
      .map((r) => r.cost_per_unit as number)

    const prices = {
      receipts,
      latest: pricePoints[0] ?? null,
      avg: pricePoints.length ? round2(pricePoints.reduce((s, n) => s + n, 0) / pricePoints.length) : null,
      min: pricePoints.length ? Math.min(...pricePoints) : null,
      max: pricePoints.length ? Math.max(...pricePoints) : null,
      count: pricePoints.length,
      /** Costo de referencia guardado en el item (y el que reporta Fudo). */
      item_cost_per_unit: item.cost_per_unit,
      /** Fuente del costo del item: la UI solo muestra número si es confiable */
      item_cost_source: item.cost_source,
      fudo_cost: fudo.fudo_cost,
    }

    // --- Lotes ------------------------------------------------------------
    const lots: FichaLot[] = (lotRows ?? []).map((l) => {
      const inDays = l.expires_at ? daysUntil(l.expires_at) : null
      return {
        id: l.id,
        lot_code: l.lot_code,
        qty_remaining: Number(l.qty_remaining ?? 0),
        unit: l.unit ?? item.unit,
        produced_at: l.produced_at,
        expires_at: l.expires_at,
        status: l.status,
        expires_in_days: inDays,
        countdown: inDays === null ? null : formatLotCountdown(inDays),
        tone: inDays === null ? null : lotTone(inDays),
      }
    })

    // --- Conteos ----------------------------------------------------------
    const counts: FichaCount[] = (logRows ?? [])
      .slice(0, COUNTS_LIMIT)
      .map((l) => {
        const old = l.old_qty == null ? null : Number(l.old_qty)
        const next = l.new_qty == null ? null : Number(l.new_qty)
        return {
          id: l.id,
          at: l.created_at,
          old_qty: old,
          new_qty: next,
          diff: old != null && next != null ? round2(next - old) : null,
          note: l.note ?? null,
          who: personName(l.profiles),
        }
      })

    return NextResponse.json({
      ok: true,
      item,
      fudo,
      incidents: incidents ?? [],
      movements: kardex,
      recipes,
      produced_by: producedBy,
      prices,
      supplier: supplier ?? null,
      lots,
      counts,
      expenses,
      errors,
      generated_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[GET /api/stock/items/[id]/ficha]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
