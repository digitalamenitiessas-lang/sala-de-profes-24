import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// ---------------------------------------------------------------------------
// sales-engine.ts — FASE 1 del reemplazo de Fudo: motor de descuento de stock
// PROPIO corriendo EN PARALELO (sombra) contra Fudo.
//
// NO toca stock_items.current_qty (que sigue espejando a Fudo). Lleva su
// propia contabilidad teórica en sales_engine_state y deja un snapshot
// comparativo por día AR en sales_engine_daily (lve_qty vs fudo_qty → diff).
//
// SEMÁNTICA FUDO REPLICADA EXACTA:
//  · Venta → descuenta los ingredientes DIRECTOS de la receta del producto
//    (incluidos intermedios como "Milanesa Cruda unidad"). SIN expandir
//    nivel 2: los insumos base ya se descontaron cuando se PRODUJO el
//    intermedio.
//  · Producto vendido sin receta → no descuenta nada (igual que Fudo).
//  · Producción validada (production_orders completed) → outputs no-waste
//    suman, inputs restan (cantidades crudas, igual que el RPC
//    complete_production_order).
//  · Recepciones (stock_receipts) → suman (qty ya viene en la unidad del item).
//
// Unidades: cada fila de receta se canonicaliza (g→kg ÷1000, ml→l ÷1000) y se
// convierte a la unidad del stock_item. Si no es convertible (ej. receta en
// "ml" para un item en "unidad") se registra un warning y NO se descuenta.
//
// Idempotente por día: si el día ya fue corrido, el delta viejo guardado en
// sales_engine_daily se revierte del state antes de aplicar el nuevo.
// ---------------------------------------------------------------------------

type AdminClient = SupabaseClient<Database>

// Las tablas del motor todavía no están en los types generados → acceso raw.
const rawClient = (admin: AdminClient) => admin as unknown as SupabaseClient

const AR_OFFSET = '-03:00'
const PAGE = 1000

export type SalesEngineDiff = {
  stock_item_id: string
  name: string
  unit: string
  lve_qty: number
  fudo_qty: number
  diff: number
}

export type SalesEngineSummary = {
  day: string
  /** true = primera corrida (o items nuevos): solo baseline, diff 0. */
  seeded: boolean
  /** Insumos trackeados por el motor. */
  items: number
  /** Insumos con consumo teórico > 0 en el día. */
  consumidos: number
  /** Productos vendidos en el día sin receta espejada (no descuentan, igual que Fudo). */
  ventas_sin_receta: number
  /** Top 10 por |diff| absoluto. */
  top_diffs: SalesEngineDiff[]
  /** Items con |diff| relativo > 15% (sobre max(1,|fudo_qty|)), orden |diff| desc. */
  drift: SalesEngineDiff[]
  /** Unidades de receta no convertibles a la unidad del item (no se descontó). */
  warnings: string[]
}

/** Canonicaliza qty+unidad: g→kg, ml→l (mismo criterio que recipe-cost). */
function canonQty(qty: number, unit: string | null): { qty: number; unit: string | null } {
  const u = unit?.trim().toLowerCase() ?? null
  if (u === 'g' || u === 'gr' || u === 'gramos') return { qty: qty / 1000, unit: 'kg' }
  if (u === 'ml' || u === 'cc') return { qty: qty / 1000, unit: 'l' }
  if (u === 'lt' || u === 'litro' || u === 'litros') return { qty, unit: 'l' }
  if (u === 'kilo' || u === 'kilos') return { qty, unit: 'kg' }
  if (u === 'u' || u === 'un' || u === 'unidades' || u === 'unid') return { qty, unit: 'unidad' }
  return { qty, unit: u }
}

/**
 * Convierte qty de la unidad de la receta a la unidad del stock_item.
 * Devuelve null si NO es convertible (masa↔volumen, unidad↔kg, etc.) — a
 * diferencia de recipe-cost.toStockUnit, acá necesitamos DETECTAR el caso
 * para avisar y no descontar.
 */
function toItemUnit(qty: number, fromUnit: string | null, itemUnit: string): number | null {
  // Sin unidad en la receta → se asume la unidad del item (comportamiento
  // histórico de recipe-cost: pasa la cantidad tal cual).
  if (!fromUnit) return qty
  const from = canonQty(qty, fromUnit)
  const to = canonQty(1, itemUnit)
  if (from.unit === to.unit) return from.qty
  return null
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

function arDayWindowUTC(day: string): { startISO: string; endISO: string } {
  const start = new Date(`${day}T00:00:00${AR_OFFSET}`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { startISO: start.toISOString(), endISO: end.toISOString() }
}

/**
 * Corre el motor paralelo para un día AR (YYYY-MM-DD).
 *
 * (a) state vacío → seed lve_qty = current_qty de cada item activo (arranque
 *     justo: ese día NO se aplican movimientos, diff = 0 — current_qty ya los
 *     refleja). Items activos nuevos se seedean igual en corridas posteriores.
 * (b) consumo: fudo_sales del día × receta del menu_item (ingredientes
 *     DIRECTOS, sin nivel 2), canonicalizado a la unidad del item.
 * (c) producción validada del día: outputs no-waste suman, inputs restan.
 * (d) recepciones del día suman.
 * (e) state.lve_qty += produced + received − consumed (con reversa del delta
 *     viejo si el día se re-corre → idempotente).
 * (f) snapshot en sales_engine_daily con fudo_qty = current_qty actual y
 *     diff = lve_qty − fudo_qty. Ojo: en backfills viejos fudo_qty es el
 *     espejo de HOY (limitación inherente; el cron corre para ayer).
 */
export async function runSalesEngine(
  admin: AdminClient,
  day: string,
): Promise<SalesEngineSummary> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Día inválido: ${day}`)
  const raw = rawClient(admin)
  const { startISO, endISO } = arDayWindowUTC(day)
  const warnings = new Set<string>()

  // ========================================================================
  // Catálogo de items activos + state actual del motor
  // ========================================================================
  const { data: itemRows, error: itemsErr } = await admin
    .from('stock_items')
    .select('id, name, unit, current_qty, is_active')
    .eq('is_active', true)
  if (itemsErr) throw new Error(itemsErr.message)
  const items = itemRows ?? []
  const itemById = new Map(items.map(i => [i.id, i]))

  const { data: stateRows, error: stateErr } = await raw
    .from('sales_engine_state')
    .select('stock_item_id, lve_qty')
  if (stateErr) throw new Error(stateErr.message)
  const stateByItem = new Map<string, number>(
    ((stateRows ?? []) as { stock_item_id: string; lve_qty: number }[]).map(r => [
      r.stock_item_id,
      Number(r.lve_qty),
    ]),
  )

  // Seed de arranque justo: todo item activo sin state arranca en current_qty
  // y ese día no se le aplican movimientos (current_qty ya los refleja).
  const seededNow = new Set<string>()
  const nowISO = new Date().toISOString()
  const toSeed = items.filter(i => !stateByItem.has(i.id))
  if (toSeed.length > 0) {
    const { error: seedErr } = await raw.from('sales_engine_state').upsert(
      toSeed.map(i => ({
        stock_item_id: i.id,
        lve_qty: Number(i.current_qty ?? 0),
        seeded_at: nowISO,
        updated_at: nowISO,
      })),
      { onConflict: 'stock_item_id' },
    )
    if (seedErr) throw new Error(seedErr.message)
    for (const i of toSeed) {
      stateByItem.set(i.id, Number(i.current_qty ?? 0))
      seededNow.add(i.id)
    }
  }

  // ========================================================================
  // (b) Consumo del día: fudo_sales × recetas (ingredientes DIRECTOS)
  // ========================================================================
  const { data: menuRows, error: miErr } = await admin
    .from('menu_items')
    .select('fudo_product_id, recipe_id')
    .not('fudo_product_id', 'is', null)
    .not('recipe_id', 'is', null)
  if (miErr) throw new Error(miErr.message)
  const recipeByFudoId = new Map<string, string>()
  for (const mi of menuRows ?? []) {
    if (mi.fudo_product_id && mi.recipe_id) recipeByFudoId.set(mi.fudo_product_id, mi.recipe_id)
  }

  // Ventas del día AR, paginadas
  const soldByFudoId = new Map<string, number>()
  for (let page = 0; page < 50; page++) {
    const from = page * PAGE
    const { data, error } = await admin
      .from('fudo_consumo') // ítems vendidos + opciones elegidas
      .select('fudo_product_id, quantity')
      .gte('sold_at', startISO)
      .lt('sold_at', endISO)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const row of data) {
      soldByFudoId.set(
        row.fudo_product_id,
        (soldByFudoId.get(row.fudo_product_id) ?? 0) + Number(row.quantity ?? 0),
      )
    }
    if (data.length < PAGE) break
  }

  // Productos vendidos sin receta → NO consumen (misma semántica que Fudo)
  let ventasSinReceta = 0
  const portionsByRecipe = new Map<string, number>()
  for (const [fudoId, qty] of soldByFudoId) {
    const recipeId = recipeByFudoId.get(fudoId)
    if (!recipeId) {
      ventasSinReceta += 1
      continue
    }
    portionsByRecipe.set(recipeId, (portionsByRecipe.get(recipeId) ?? 0) + qty)
  }

  // Ingredientes DIRECTOS de las recetas vendidas (SIN expansión nivel 2:
  // los intermedios se descuentan como stock_item — sus insumos base ya se
  // restaron cuando se produjo el intermedio).
  const consumedByItem = new Map<string, number>()
  const recipeIds = [...portionsByRecipe.keys()]
  if (recipeIds.length > 0) {
    const { data: riRows, error: riErr } = await admin
      .from('recipe_ingredients')
      .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit')
      .in('recipe_id', recipeIds)
    if (riErr) throw new Error(riErr.message)
    for (const ri of riRows ?? []) {
      const portions = portionsByRecipe.get(ri.recipe_id) ?? 0
      if (portions <= 0) continue
      const item = itemById.get(ri.stock_item_id)
      if (!item) continue // item inactivo o inexistente: fuera del ledger
      const perPortion = toItemUnit(
        Number(ri.qty_per_portion ?? 0),
        ri.ingredient_unit,
        item.unit,
      )
      if (perPortion == null) {
        warnings.add(
          `${item.name}: unidad de receta "${ri.ingredient_unit}" no convertible a "${item.unit}" — no se descontó`,
        )
        continue
      }
      consumedByItem.set(
        ri.stock_item_id,
        (consumedByItem.get(ri.stock_item_id) ?? 0) + perPortion * portions,
      )
    }
  }

  // ========================================================================
  // (c) Producción validada del día: outputs no-waste suman, inputs restan
  // ========================================================================
  const producedByItem = new Map<string, number>()
  const { data: orders, error: poErr } = await admin
    .from('production_orders')
    .select('id')
    .eq('status', 'completed')
    .gte('completed_at', startISO)
    .lt('completed_at', endISO)
  if (poErr) throw new Error(poErr.message)
  const orderIds = (orders ?? []).map(o => o.id)
  if (orderIds.length > 0) {
    const [outputsRes, inputsRes] = await Promise.all([
      admin
        .from('production_outputs')
        .select('stock_item_id, qty_produced, is_waste')
        .in('production_order_id', orderIds),
      admin
        .from('production_inputs')
        .select('stock_item_id, qty_used')
        .in('production_order_id', orderIds),
    ])
    if (outputsRes.error) throw new Error(outputsRes.error.message)
    if (inputsRes.error) throw new Error(inputsRes.error.message)
    // Cantidades crudas, igual que el RPC complete_production_order
    for (const o of outputsRes.data ?? []) {
      if (o.is_waste || !o.stock_item_id) continue
      producedByItem.set(
        o.stock_item_id,
        (producedByItem.get(o.stock_item_id) ?? 0) + Number(o.qty_produced ?? 0),
      )
    }
    for (const i of inputsRes.data ?? []) {
      if (!i.stock_item_id) continue
      producedByItem.set(
        i.stock_item_id,
        (producedByItem.get(i.stock_item_id) ?? 0) - Number(i.qty_used ?? 0),
      )
    }
  }

  // ========================================================================
  // (d) Recepciones del día (received_date ya es fecha AR)
  // ========================================================================
  const receivedByItem = new Map<string, number>()
  const { data: receipts, error: rcErr } = await admin
    .from('stock_receipts')
    .select('stock_item_id, qty')
    .eq('received_date', day)
  if (rcErr) throw new Error(rcErr.message)
  for (const r of receipts ?? []) {
    if (!r.stock_item_id) continue
    receivedByItem.set(
      r.stock_item_id,
      (receivedByItem.get(r.stock_item_id) ?? 0) + Number(r.qty ?? 0),
    )
  }

  // ========================================================================
  // (e)+(f) Actualizar state y snapshot diario (idempotente por día)
  // ========================================================================
  // Delta viejo del día (si se re-corre): se revierte antes de aplicar el nuevo.
  const { data: oldDailyRows, error: odErr } = await raw
    .from('sales_engine_daily')
    .select('stock_item_id, qty_consumed, qty_produced, qty_received')
    .eq('day', day)
  if (odErr) throw new Error(odErr.message)
  const oldDeltaByItem = new Map<string, number>()
  for (const r of (oldDailyRows ?? []) as {
    stock_item_id: string
    qty_consumed: number
    qty_produced: number
    qty_received: number
  }[]) {
    oldDeltaByItem.set(
      r.stock_item_id,
      Number(r.qty_produced ?? 0) + Number(r.qty_received ?? 0) - Number(r.qty_consumed ?? 0),
    )
  }

  type DailyUpsert = {
    day: string
    stock_item_id: string
    qty_consumed: number
    qty_produced: number
    qty_received: number
    lve_qty: number
    fudo_qty: number
    diff: number
  }
  type StateUpsert = {
    stock_item_id: string
    lve_qty: number
    updated_at: string
  }

  const dailyUpserts: DailyUpsert[] = []
  const stateUpserts: StateUpsert[] = []
  const diffs: SalesEngineDiff[] = []
  let consumidos = 0

  for (const item of items) {
    const fudoQty = round3(Number(item.current_qty ?? 0))
    const prevLve = stateByItem.get(item.id) ?? fudoQty

    let consumed = 0
    let produced = 0
    let received = 0
    let lve = prevLve

    if (!seededNow.has(item.id)) {
      consumed = round3(consumedByItem.get(item.id) ?? 0)
      produced = round3(producedByItem.get(item.id) ?? 0)
      received = round3(receivedByItem.get(item.id) ?? 0)
      const newDelta = produced + received - consumed
      const oldDelta = oldDeltaByItem.get(item.id) ?? 0
      lve = round3(prevLve - oldDelta + newDelta)
    }
    // Item recién seedeado: baseline puro — el día ya está reflejado en el
    // seed (current_qty), movimientos en 0 para que una re-corrida no lo toque.

    if (consumed > 0) consumidos += 1
    const diff = round3(lve - fudoQty)

    dailyUpserts.push({
      day,
      stock_item_id: item.id,
      qty_consumed: consumed,
      qty_produced: produced,
      qty_received: received,
      lve_qty: lve,
      fudo_qty: fudoQty,
      diff,
    })
    if (lve !== prevLve) {
      stateUpserts.push({ stock_item_id: item.id, lve_qty: lve, updated_at: nowISO })
    }
    stateByItem.set(item.id, lve)
    diffs.push({
      stock_item_id: item.id,
      name: item.name,
      unit: item.unit,
      lve_qty: lve,
      fudo_qty: fudoQty,
      diff,
    })
  }

  for (let i = 0; i < dailyUpserts.length; i += 500) {
    const { error } = await raw
      .from('sales_engine_daily')
      .upsert(dailyUpserts.slice(i, i + 500), { onConflict: 'day,stock_item_id' })
    if (error) throw new Error(error.message)
  }
  for (let i = 0; i < stateUpserts.length; i += 500) {
    const { error } = await raw
      .from('sales_engine_state')
      .upsert(stateUpserts.slice(i, i + 500), { onConflict: 'stock_item_id' })
    if (error) throw new Error(error.message)
  }

  // ========================================================================
  // Resumen
  // ========================================================================
  const byAbsDiff = [...diffs].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
  const drift = byAbsDiff.filter(
    d => Math.abs(d.diff) / Math.max(1, Math.abs(d.fudo_qty)) > 0.15,
  )

  return {
    day,
    seeded: seededNow.size === items.length && items.length > 0,
    items: items.length,
    consumidos,
    ventas_sin_receta: ventasSinReceta,
    top_diffs: byAbsDiff.slice(0, 10),
    drift,
    warnings: [...warnings],
  }
}
