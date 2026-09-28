// ---------------------------------------------------------------------------
// Motor ÚNICO de "qué pedir" — sin IA, todo trazable.
// ---------------------------------------------------------------------------
// Antes convivían tres listas con criterios distintos en /pedidos (mínimos
// client-side, copiloto IA por ventas directas, pendientes por proveedor).
// Acá hay UNA sola regla, que combina:
//
//   1. Consumo real del insumo = ventas Fudo (fudo_sales) × recetas
//      (menu_items → recipe_ingredients), últimos 14 días, en la unidad del
//      stock. Para productos de reventa (fudo_product_id) se usa la venta
//      directa del producto.
//   2. Stock actual espejado de Fudo (stock_items.current_qty).
//   3. Mínimo operativo (stock_items.min_qty — sincronizado desde el minStock
//      de Fudo cuando LVE no lo tenía).
//   4. Calendario del proveedor (order_days + lead_time_days): la compra tiene
//      que cubrir hasta la PRÓXIMA entrega.
//
// Un insumo entra en "a pedir" si:
//   - stock ≤ 0, o
//   - min_qty > 0 y stock ≤ min_qty × 1.2, o
//   - con consumo conocido, los días de cobertura ≤ días hasta la próxima
//     entrega (+1 de margen).
//
// Cantidad sugerida = max(0, consumo_diario × cobertura × 1.2 − stock),
// redondeada hacia arriba; si no hay consumo conocido, mínimo × 1.3 − stock.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'
import { cargarRecetasProduccion, expandirAElaborados } from '@/lib/produccion/recetas'
import { canon, toStockUnit } from '@/lib/recipes/recipe-cost'
import { esCostoConfiable } from '@/lib/costos/confiable'
import { fetchFudoExpenses, type FudoExpense } from '@/lib/fudo/expenses'

export type SugerenciaCompra = {
  stock_item_id: string
  name: string
  unit: string
  area: string | null
  category: string | null
  current_qty: number
  min_qty: number
  /** SOLO si la fuente del costo es confiable (compra/manual/produccion); si no, null */
  cost_per_unit: number | null
  daily_consumption: number | null
  days_left: number | null
  coverage_days: number | null
  suggested_qty: number
  estimated_cost: number | null
  reason: 'sin_stock' | 'negativo' | 'bajo_minimo' | 'se_acaba' | 'reponer'
  reason_label: string
  supplier_id: string | null
  supplier_name: string | null
  supplier_phone: string | null
  is_order_day: boolean
  already_ordered: boolean
  last_ordered_at: string | null
  /** Última compra REAL (gasto Fudo mono-insumo): monto total del gasto, no precio unitario. */
  last_purchase: { amount: number; date: string } | null
}

export type SugerenciasPorProveedor = {
  supplier_id: string | null
  supplier_name: string
  supplier_phone: string | null
  supplier_contact: string | null
  is_order_day: boolean
  order_days: number[]
  lead_time_days: number | null
  coverage_days: number | null
  items: SugerenciaCompra[]
  estimated_cost: number
}

export type SugerenciasPayload = {
  generated_at: string
  window_days: number
  today_dow: number
  groups: SugerenciasPorProveedor[]
  total_items: number
  total_estimated_cost: number
}

const WINDOW_DAYS = 14
const PAGE = 1000

function arNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
}

function daysUntilNextDelivery(orderDays: number[] | null, todayDow: number, leadTime: number | null): number | null {
  if (!orderDays || orderDays.length === 0) return null
  let delta = 7
  for (let d = 1; d <= 7; d++) {
    if (orderDays.includes((todayDow + d) % 7)) { delta = d; break }
  }
  return delta + (leadTime ?? 0)
}

function round2(n: number) { return Math.round(n * 100) / 100 }

/** Consumo por stock_item en la ventana: unidades de stock consumidas por ventas × recetas + venta directa. */
export async function computeConsumption(
  admin: SupabaseClient,
  windowDays = WINDOW_DAYS,
): Promise<{ byItem: Map<string, number>; activeDays: number }> {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString()

  const soldByProduct = new Map<string, number>()
  const activeDates = new Set<string>()
  for (let from = 0; from < 40_000; from += PAGE) {
    const { data, error } = await admin
      .from('fudo_consumo') // ítems vendidos + opciones elegidas (combos, extras)
      .select('fudo_product_id, quantity, sold_at')
      .gte('sold_at', since)
      .order('id', { ascending: true }) // sin orden, el paginado repetía/salteaba filas
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { fudo_product_id: string | null; quantity: number; sold_at: string }[]
    for (const r of rows) {
      if (!r.fudo_product_id) continue
      soldByProduct.set(r.fudo_product_id, (soldByProduct.get(r.fudo_product_id) ?? 0) + Number(r.quantity))
      activeDates.add(r.sold_at.slice(0, 10))
    }
    if (rows.length < PAGE) break
  }
  const activeDays = Math.max(activeDates.size, 1)
  const byItem = new Map<string, number>()
  if (soldByProduct.size === 0) return { byItem, activeDays }

  // Recetas de los productos vendidos
  const { data: menuItems } = await admin
    .from('menu_items')
    .select('recipe_id, fudo_product_id')
    .eq('is_active', true)
    .not('recipe_id', 'is', null)
    .not('fudo_product_id', 'is', null)
  const recipeByProduct = new Map<string, string>()
  for (const mi of (menuItems ?? []) as { recipe_id: string; fudo_product_id: string }[]) {
    recipeByProduct.set(mi.fudo_product_id, mi.recipe_id)
  }
  const recipeIds = [...new Set([...soldByProduct.keys()].map((p) => recipeByProduct.get(p)).filter((x): x is string => Boolean(x)))]

  type RI = { recipe_id: string; stock_item_id: string; qty_per_portion: number | null; ingredient_unit: string | null }
  const riByRecipe = new Map<string, RI[]>()
  if (recipeIds.length > 0) {
    const { data: ri } = await admin
      .from('recipe_ingredients')
      .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit')
      .in('recipe_id', recipeIds)
    for (const r of (ri ?? []) as RI[]) {
      riByRecipe.set(r.recipe_id, [...(riByRecipe.get(r.recipe_id) ?? []), r])
    }
  }

  // Unidad de cada stock_item (para canonicalizar) + reventa por fudo_product_id
  const { data: items } = await admin
    .from('stock_items')
    .select('id, unit, fudo_product_id, is_produced')
    .eq('is_active', true)
  const unitById = new Map<string, string>()
  const itemByProduct = new Map<string, string>()
  const producidos = new Set<string>()
  for (const it of (items ?? []) as { id: string; unit: string; fudo_product_id: string | null; is_produced: boolean | null }[]) {
    unitById.set(it.id, it.unit)
    if (it.is_produced) producidos.add(it.id)
    if (it.fudo_product_id) itemByProduct.set(it.fudo_product_id, it.id)
  }

  // Platos u opciones que descuentan directo un insumo con cantidad
  // (ej. opción "Leche Entera 190 ML" → 0,19 l de leche entera)
  const { data: directos } = await admin
    .from('menu_items')
    .select('fudo_product_id, consumo_stock_item_id, consumo_qty')
    .eq('consumo_modo', 'insumo')
    .not('fudo_product_id', 'is', null)
  const insumoByProduct = new Map<string, { item: string; qty: number }>()
  for (const d of (directos ?? []) as { fudo_product_id: string; consumo_stock_item_id: string | null; consumo_qty: number | null }[]) {
    if (d.consumo_stock_item_id && Number(d.consumo_qty) > 0) insumoByProduct.set(d.fudo_product_id, { item: d.consumo_stock_item_id, qty: Number(d.consumo_qty) })
  }

  for (const [productId, units] of soldByProduct) {
    // Venta directa del producto de reventa (gaseosa, budín comprado, etc.)
    const directItem = itemByProduct.get(productId)
    if (directItem) byItem.set(directItem, (byItem.get(directItem) ?? 0) + units)

    const insumo = insumoByProduct.get(productId)
    if (insumo && !directItem) byItem.set(insumo.item, (byItem.get(insumo.item) ?? 0) + insumo.qty * units)

    const recipeId = recipeByProduct.get(productId)
    if (!recipeId) continue
    for (const ri of riByRecipe.get(recipeId) ?? []) {
      const c = canon(Number(ri.qty_per_portion ?? 0), ri.ingredient_unit)
      const qty = toStockUnit(c.qty, c.unit, unitById.get(ri.stock_item_id) ?? 'unidad') * units
      if (!Number.isFinite(qty) || qty <= 0) continue
      byItem.set(ri.stock_item_id, (byItem.get(ri.stock_item_id) ?? 0) + qty)
    }
  }

  // Elaborados → sus crudos: lo que se vende como "masa de wrap" o "vacío
  // deshebrado" también gasta harina o carne. Sin esto, compras no veía los
  // crudos que solo se usan para elaborar (recetas de producción).
  const consumoElaborados = new Map([...byItem].filter(([id]) => producidos.has(id)))
  if (consumoElaborados.size > 0) {
    const recetas = await cargarRecetasProduccion(admin, [...consumoElaborados.keys()])
    // recursivo: un elaborado puede llevar otro elaborado
    const faltantes = new Set<string>()
    for (const r of recetas.values()) for (const i of r.ingredientes) if (producidos.has(i.stock_item_id) && !recetas.has(i.stock_item_id)) faltantes.add(i.stock_item_id)
    if (faltantes.size > 0) for (const [k, v] of await cargarRecetasProduccion(admin, [...faltantes])) recetas.set(k, v)
    for (const [id, qty] of expandirAElaborados(consumoElaborados, recetas)) {
      byItem.set(id, (byItem.get(id) ?? 0) + qty)
    }
  }

  return { byItem, activeDays }
}

export async function generarSugerenciasCompra(admin: SupabaseClient): Promise<SugerenciasPayload> {
  const now = arNow()
  const todayDow = now.getDay()

  const baseSelect = 'id, name, unit, category, current_qty, min_qty, cost_per_unit, supplier_id, is_produced, fudo_skip, fudo_ingredient_id, fudo_product_id, last_ordered_at'
  let itemsRes: { data: unknown[] | null; error: { message: string } | null } = await admin.from('stock_items').select(`${baseSelect}, area, cost_source`).eq('is_active', true)
  if (itemsRes.error) itemsRes = await admin.from('stock_items').select(`${baseSelect}, area`).eq('is_active', true)
  if (itemsRes.error) itemsRes = await admin.from('stock_items').select(baseSelect).eq('is_active', true)
  if (itemsRes.error) throw new Error(itemsRes.error.message)

  type ItemRow = {
    id: string; name: string; unit: string; category: string | null; current_qty: number; min_qty: number
    cost_per_unit: number | null; supplier_id: string | null; is_produced: boolean | null; fudo_skip: boolean | null
    fudo_ingredient_id: string | null; fudo_product_id: string | null; last_ordered_at: string | null; area?: string | null
    /** Sin la migración de cost_source, undefined → ningún costo cuenta como real */
    cost_source?: string | null
  }
  const items = (itemsRes.data ?? []) as unknown as ItemRow[]

  const [{ data: suppliers }, consumption, { data: openOrders }, barOrdersRes, gastosFudo] = await Promise.all([
    admin.from('suppliers').select('id, name, phone, contact_name, order_days, lead_time_days').eq('is_active', true),
    computeConsumption(admin),
    admin.from('kitchen_orders').select('stock_item_id, product_name, status').in('status', ['pending', 'ordered']),
    // Barra también pide: sin esto un insumo pedido desde barra volvía a sugerirse
    admin.from('bar_orders').select('stock_item_id, product_name, status').in('status', ['pending', 'ordered']),
    // Última compra real por insumo (gasto Fudo mono-insumo) — best-effort
    // CON timeout: si Fudo está lento (~4s), las sugerencias salen sin el
    // chip en vez de colgar /pedidos entero.
    (async (): Promise<FudoExpense[]> => {
      try {
        return await Promise.race([
          fetchFudoExpenses(new Date(Date.now() - 90 * 86_400_000).toISOString()),
          new Promise<FudoExpense[]>((resolve) => setTimeout(() => resolve([]), 4000)),
        ])
      } catch { return [] }
    })(),
  ])

  type Sup = { id: string; name: string; phone: string | null; contact_name: string | null; order_days: number[] | null; lead_time_days: number | null }
  const supById = new Map((suppliers ?? []).map((s) => [s.id, s as Sup]))

  const orderedIds = new Set<string>()
  const orderedNames = new Set<string>()
  for (const o of (openOrders ?? []) as { stock_item_id: string | null; product_name: string }[]) {
    if (o.stock_item_id) orderedIds.add(o.stock_item_id)
    orderedNames.add(o.product_name.trim().toLowerCase())
  }
  // bar_orders: tolerante a migración pendiente de stock_item_id
  let barOrders = barOrdersRes.data as { stock_item_id?: string | null; product_name: string }[] | null
  if (barOrdersRes.error && /stock_item_id/.test(barOrdersRes.error.message)) {
    const retry = await admin.from('bar_orders').select('product_name, status').in('status', ['pending', 'ordered'])
    barOrders = retry.data as { stock_item_id?: string | null; product_name: string }[] | null
  }
  for (const o of barOrders ?? []) {
    if (o.stock_item_id) orderedIds.add(o.stock_item_id)
    if (o.product_name) orderedNames.add(o.product_name.trim().toLowerCase())
  }

  // Gastos mono-insumo → última compra por stock_item (por fudo_ingredient_id,
  // con fallback por nombre). Vienen ordenados por fecha desc: el primero gana.
  const lastPurchaseByItem = new Map<string, { amount: number; date: string }>()
  {
    const itemByFudoIng = new Map<string, string>()
    const itemByName = new Map<string, string>()
    for (const it of items) {
      if (it.fudo_ingredient_id) itemByFudoIng.set(String(it.fudo_ingredient_id), it.id)
      itemByName.set(it.name.trim().toLowerCase(), it.id)
    }
    for (const e of gastosFudo) {
      if (e.ingredientIds.length !== 1 || !(e.amount > 0)) continue
      const itemId = itemByFudoIng.get(e.ingredientIds[0])
        ?? (e.ingredientNames[0] ? itemByName.get(e.ingredientNames[0].trim().toLowerCase()) : undefined)
      if (!itemId || lastPurchaseByItem.has(itemId)) continue
      lastPurchaseByItem.set(itemId, { amount: e.amount, date: e.date })
    }
  }

  const suggestions: SugerenciaCompra[] = []

  for (const it of items) {
    // Lo que se produce en cocina no se compra; los intermedios salen por producción.
    if (it.is_produced) continue
    const qty = Number(it.current_qty ?? 0)
    const min = Number(it.min_qty ?? 0)
    const consumed = consumption.byItem.get(it.id) ?? 0
    const daily = consumed > 0 ? consumed / consumption.activeDays : null
    const daysLeft = daily && daily > 0 ? Math.max(qty, 0) / daily : null
    const sup = it.supplier_id ? supById.get(it.supplier_id) ?? null : null
    const coverage = sup ? daysUntilNextDelivery(sup.order_days, todayDow, sup.lead_time_days) : null
    const horizon = coverage ?? 7

    let reason: SugerenciaCompra['reason'] | null = null
    if (qty < 0) reason = 'negativo'
    else if (qty === 0 && (min > 0 || daily)) reason = 'sin_stock'
    else if (min > 0 && qty <= min * 1.2) reason = 'bajo_minimo'
    else if (daysLeft !== null && daysLeft <= horizon + 1) reason = 'se_acaba'
    if (!reason) continue

    let suggested: number
    if (daily && daily > 0) {
      suggested = Math.ceil(daily * horizon * 1.2 - Math.max(qty, 0))
    } else if (min > 0) {
      suggested = Math.ceil(min * 1.3 - Math.max(qty, 0))
    } else {
      suggested = 0
    }
    if (suggested <= 0) {
      if (reason === 'negativo' || reason === 'sin_stock') suggested = Math.max(1, Math.ceil(min || 1))
      else continue
    }

    const reasonLabel = reason === 'negativo'
      ? `Figura ${qty} ${it.unit}: se vendió más de lo cargado`
      : reason === 'sin_stock'
        ? 'Sin stock'
        : reason === 'bajo_minimo'
          ? `${qty} ${it.unit} · mínimo ${min}`
          : daysLeft !== null
            ? `Te quedan ~${Math.round(daysLeft * 10) / 10} días al ritmo actual`
            : 'Reponer'

    // Decisión de producto (Marco): el costo espejado de Fudo NO es real.
    // Solo se estima plata con fuentes confiables (compra/manual/produccion).
    const costoReal = esCostoConfiable(it.cost_source, it.cost_per_unit) ? Number(it.cost_per_unit) : null

    suggestions.push({
      stock_item_id: it.id,
      name: it.name,
      unit: it.unit,
      area: it.area ?? null,
      category: it.category,
      current_qty: qty,
      min_qty: min,
      cost_per_unit: costoReal,
      daily_consumption: daily ? round2(daily) : null,
      days_left: daysLeft !== null ? Math.round(daysLeft * 10) / 10 : null,
      coverage_days: coverage,
      suggested_qty: suggested,
      estimated_cost: costoReal ? round2(costoReal * suggested) : null,
      reason,
      reason_label: reasonLabel,
      supplier_id: sup?.id ?? null,
      supplier_name: sup?.name ?? null,
      supplier_phone: sup?.phone ?? null,
      is_order_day: Boolean(sup?.order_days?.includes(todayDow)),
      already_ordered: orderedIds.has(it.id) || orderedNames.has(it.name.trim().toLowerCase()),
      last_ordered_at: it.last_ordered_at,
      last_purchase: lastPurchaseByItem.get(it.id) ?? null,
    })
  }

  // Agrupar por proveedor: primero los que HOY toca pedir, después por urgencia
  const groupsMap = new Map<string, SugerenciasPorProveedor>()
  const urgency: Record<SugerenciaCompra['reason'], number> = { negativo: 0, sin_stock: 1, bajo_minimo: 2, se_acaba: 3, reponer: 4 }
  for (const s of suggestions) {
    const key = s.supplier_id ?? 'sin-proveedor'
    if (!groupsMap.has(key)) {
      const sup = s.supplier_id ? supById.get(s.supplier_id) ?? null : null
      groupsMap.set(key, {
        supplier_id: s.supplier_id,
        supplier_name: sup?.name ?? 'Sin proveedor asignado',
        supplier_phone: sup?.phone ?? null,
        supplier_contact: sup?.contact_name ?? null,
        is_order_day: s.is_order_day,
        order_days: sup?.order_days ?? [],
        lead_time_days: sup?.lead_time_days ?? null,
        coverage_days: s.coverage_days,
        items: [],
        estimated_cost: 0,
      })
    }
    const g = groupsMap.get(key)!
    g.items.push(s)
    g.estimated_cost = round2(g.estimated_cost + (s.estimated_cost ?? 0))
  }
  for (const g of groupsMap.values()) {
    g.items.sort((a, b) => urgency[a.reason] - urgency[b.reason] || a.name.localeCompare(b.name))
  }
  const groups = [...groupsMap.values()].sort((a, b) => {
    if (a.supplier_id === null) return 1
    if (b.supplier_id === null) return -1
    if (a.is_order_day !== b.is_order_day) return a.is_order_day ? -1 : 1
    const ua = Math.min(...a.items.map((i) => urgency[i.reason]))
    const ub = Math.min(...b.items.map((i) => urgency[i.reason]))
    return ua - ub || b.items.length - a.items.length
  })

  return {
    generated_at: new Date().toISOString(),
    window_days: WINDOW_DAYS,
    today_dow: todayDow,
    groups,
    total_items: suggestions.length,
    total_estimated_cost: round2(groups.reduce((s, g) => s + g.estimated_cost, 0)),
  }
}
