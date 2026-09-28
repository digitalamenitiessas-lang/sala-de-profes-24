import type { SupabaseClient } from '@supabase/supabase-js'
import { PRODUCTION_BATCHES, matchIngredientToStock } from '@/lib/recipes/production-batches'
import { canon, toStockUnit } from '@/lib/recipes/recipe-cost'
import { resumenLotes } from '@/lib/stock/lotes'
import { cargarRecetasProduccion } from '@/lib/produccion/recetas'

// ---------------------------------------------------------------------------
// "¿Qué producir hoy?" — UN solo cálculo para Hoy y Cocina
// ---------------------------------------------------------------------------
// Antes había dos planes que podían decir cosas distintas: Hoy miraba solo 7
// elaborados que se venden directo en Fudo; Cocina, solo 9 recetas escritas
// en el código. Ninguno veía lo más usado (masa de wrap, vacío deshebrado…).
//
// Para cada elaborado propio (stock_items.is_produced):
//   1. Demanda por día de semana (últimos 28 días, hora AR): lo vendido de
//      cada plato/opción que lo usa (fudo_consumo × receta, o descuento
//      directo 'insumo'), más su venta directa si es producto de Fudo.
//      Sin ninguna venta que lo use: movimientos de salida del stock.
//   2. Stock utilizable = stock − lotes vencidos. Producción ya abierta
//      (borrador / a revisar / en curso) se descuenta de lo que falta.
//   3. Sugerido = demanda de hoy + mañana − utilizable − en curso. Si la vida
//      útil es de 1 día, solo hoy. Redondeado a la tanda típica.
// Qué entra al plan: lo que se produjo alguna vez desde la app, lo que tiene
// receta de producción, o lo que tiene stock cargado. Los "Pre Producto" de
// café son un artificio contable de Fudo (nunca se producen): quedan afuera.
// Lo que se usa pero no lleva stock va aparte ("sin_control") para contarlo.
// ---------------------------------------------------------------------------

const WINDOW_DAYS = 28
const AR_OFFSET_MS = 3 * 60 * 60 * 1000
const DOW_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const PAGE_SIZE = 1000
const PRE_PRODUCTO = /\bpre\s*-?\s*producto\b/i

export type SugerenciaItem = {
  recipe_id: string            // slug de la receta de producción o "item:<id>"
  nombre: string
  stock_item_id: string
  stock_item_name: string
  unidad: string
  stock_actual: number
  stock_utilizable: number
  vencido_qty: number
  vence_proximo: string | null
  en_produccion: number
  demanda_hoy: number
  demanda_maniana: number
  demanda_diaria_prom: number
  sugerido: number
  tanda_tipica: number | null
  cobertura_dias: number
  vida_util_dias: number | null
  /** tiene receta de producción cargada: se puede registrar con "Lo hice" */
  tiene_receta: boolean
  fuente_demanda: 'ventas_fudo' | 'movimientos_stock'
  reason: string
}

export type PlanProduccion = {
  generated_at: string
  hoy: string
  maniana: string
  ventana_dias: number
  items: SugerenciaItem[]
  /** recetas de producción sin demanda medible */
  sin_datos: string[]
  /** se usan todos los días pero su stock no se lleva: contarlos o producir con orden */
  sin_control: { stock_item_id: string; name: string; unidad: string; demanda_diaria: number }[]
}

async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 0; page < 50; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await query(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return rows
}

function argDateDow(iso: string): { date: string; dow: number } {
  const t = new Date(new Date(iso).getTime() - AR_OFFSET_MS)
  return { date: t.toISOString().slice(0, 10), dow: t.getUTCDay() }
}

const round1 = (n: number) => Math.round(n * 10) / 10

type StockRow = { id: string; name: string; unit: string; current_qty: number; fudo_product_id: string | null; shelf_life_days: number | null }

export async function calcularPlanProduccion(admin: SupabaseClient): Promise<PlanProduccion> {
  const cutoffISO = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
  const { dow: todayDow } = argDateDow(new Date().toISOString())
  const tomorrowDow = (todayDow + 1) % 7

  // --- 1) Elaborados propios y cómo se identifican ---
  const [{ data: stockRows, error: siError }, { data: producedBefore }, { data: templates }] = await Promise.all([
    admin.from('stock_items').select('id, name, unit, current_qty, fudo_product_id, shelf_life_days').eq('is_active', true).eq('is_produced', true),
    admin.from('production_outputs').select('stock_item_id'),
    admin.from('production_templates').select('name, recipes(output_stock_item_id)').eq('is_active', true),
  ])
  if (siError) throw new Error(siError.message)
  const produced = ((stockRows ?? []) as StockRow[]).filter((s) => !PRE_PRODUCTO.test(s.name))
  const yaProducido = new Set((producedBefore ?? []).map((o: { stock_item_id: string | null }) => o.stock_item_id).filter(Boolean))

  const batchByItem = new Map<string, { slug: string; displayName: string; yieldPerBase: number }>()
  for (const batch of PRODUCTION_BATCHES) {
    if (!batch.output) continue
    const match = matchIngredientToStock(batch.output.name, produced)
    if (match) batchByItem.set(match.id, { slug: batch.slug, displayName: batch.displayName, yieldPerBase: batch.output.yieldPerBase })
  }
  const templateByItem = new Map<string, string>()
  for (const t of (templates ?? []) as unknown as { name: string; recipes: { output_stock_item_id: string | null } | null }[]) {
    const out = t.recipes?.output_stock_item_id
    if (out) templateByItem.set(out, t.name)
  }

  const itemIds = produced.map((p) => p.id)
  const itemById = new Map(produced.map((p) => [p.id, p]))
  const recetas = itemIds.length > 0 ? await cargarRecetasProduccion(admin, itemIds) : new Map()
  if (itemIds.length === 0) {
    return { generated_at: new Date().toISOString(), hoy: DOW_LABELS[todayDow], maniana: DOW_LABELS[tomorrowDow], ventana_dias: WINDOW_DAYS, items: [], sin_datos: [], sin_control: [] }
  }

  // --- 2) Qué productos de Fudo consumen cada elaborado ---
  const [{ data: menuItems }, { data: riRows }, { data: directos }] = await Promise.all([
    admin.from('menu_items').select('recipe_id, fudo_product_id').eq('is_active', true).not('recipe_id', 'is', null).not('fudo_product_id', 'is', null),
    admin.from('recipe_ingredients').select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit').in('stock_item_id', itemIds),
    admin.from('menu_items').select('fudo_product_id, consumo_stock_item_id, consumo_qty').eq('consumo_modo', 'insumo').in('consumo_stock_item_id', itemIds),
  ])
  const fudoIdsByRecipe = new Map<string, string[]>()
  for (const mi of (menuItems ?? []) as { recipe_id: string; fudo_product_id: string }[]) {
    fudoIdsByRecipe.set(mi.recipe_id, [...(fudoIdsByRecipe.get(mi.recipe_id) ?? []), mi.fudo_product_id])
  }
  const consumersByFudoId = new Map<string, { itemId: string; factor: number }[]>()
  const addConsumer = (fudoId: string, itemId: string, factor: number) => {
    consumersByFudoId.set(fudoId, [...(consumersByFudoId.get(fudoId) ?? []), { itemId, factor }])
  }
  for (const ri of (riRows ?? []) as { recipe_id: string; stock_item_id: string; qty_per_portion: number | null; ingredient_unit: string | null }[]) {
    const item = itemById.get(ri.stock_item_id)
    if (!item) continue
    const c = canon(Number(ri.qty_per_portion ?? 0), ri.ingredient_unit)
    const factor = toStockUnit(c.qty, c.unit, item.unit)
    if (!(factor > 0)) continue
    for (const fudoId of fudoIdsByRecipe.get(ri.recipe_id) ?? []) addConsumer(fudoId, item.id, factor)
  }
  for (const d of (directos ?? []) as { fudo_product_id: string | null; consumo_stock_item_id: string; consumo_qty: number }[]) {
    if (d.fudo_product_id && Number(d.consumo_qty) > 0) addConsumer(d.fudo_product_id, d.consumo_stock_item_id, Number(d.consumo_qty))
  }
  for (const p of produced) if (p.fudo_product_id) addConsumer(p.fudo_product_id, p.id, 1)

  // --- 3) Ventas (ítems + opciones elegidas) de esos productos, por día de semana ---
  const demandByItem = new Map<string, number[]>(itemIds.map((id) => [id, Array(7).fill(0)]))
  const datesByDow: Array<Set<string>> = Array.from({ length: 7 }, () => new Set<string>())
  const allFudoIds = [...consumersByFudoId.keys()]
  for (let i = 0; i < allFudoIds.length; i += 200) {
    const chunk = allFudoIds.slice(i, i + 200)
    const sales = await fetchAll<{ fudo_product_id: string; quantity: number; sold_at: string }>((from, to) =>
      admin.from('fudo_consumo').select('fudo_product_id, quantity, sold_at').in('fudo_product_id', chunk)
        .gte('sold_at', cutoffISO).order('id', { ascending: true }).range(from, to) as never)
    for (const s of sales) {
      const { date, dow } = argDateDow(s.sold_at)
      datesByDow[dow].add(date)
      for (const c of consumersByFudoId.get(s.fudo_product_id) ?? []) demandByItem.get(c.itemId)![dow] += Number(s.quantity ?? 0) * c.factor
    }
  }

  // Sin cadena de venta → salidas registradas del propio stock
  const withSales = new Set([...consumersByFudoId.values()].flat().map((c) => c.itemId))
  const fallbackIds = itemIds.filter((id) => !withSales.has(id))
  const fallbackItems = new Set<string>()
  if (fallbackIds.length > 0) {
    const movements = await fetchAll<{ stock_item_id: string; qty: number; created_at: string | null }>((from, to) =>
      admin.from('stock_movements').select('stock_item_id, qty, created_at').in('stock_item_id', fallbackIds)
        .eq('movement_type', 'out').eq('reason', 'sale').gte('created_at', cutoffISO).order('id', { ascending: true }).range(from, to) as never)
    for (const m of movements) {
      if (!m.created_at) continue
      const { date, dow } = argDateDow(m.created_at)
      datesByDow[dow].add(date)
      demandByItem.get(m.stock_item_id)![dow] += Number(m.qty ?? 0)
      fallbackItems.add(m.stock_item_id)
    }
  }

  // --- 4) Lotes, producción abierta y tanda típica ---
  const nowISO = new Date().toISOString()
  const [{ data: lots }, { data: outputs }, { data: abiertas }] = await Promise.all([
    admin.from('stock_lots').select('stock_item_id, qty_remaining, expires_at, produced_at, created_at').in('stock_item_id', itemIds).gt('qty_remaining', 0),
    admin.from('production_outputs').select('stock_item_id, production_order_id, qty_produced, is_waste, production_orders!inner(status)')
      .in('stock_item_id', itemIds).eq('production_orders.status', 'completed'),
    admin.from('production_outputs').select('stock_item_id, qty_produced, is_waste, production_orders!inner(status)')
      .in('stock_item_id', itemIds).in('production_orders.status', ['draft', 'pending_review', 'in_progress']),
  ])
  // Lotes: qty_remaining nunca se descuenta al usar; el stock actual se
  // reparte entre los lotes más nuevos (ver lib/stock/lotes.ts)
  const lotes = resumenLotes(
    ((lots ?? []) as { stock_item_id: string; qty_remaining: number; expires_at: string | null; produced_at: string | null; created_at: string | null }[]),
    new Map(produced.map((p) => [p.id, Number(p.current_qty)])),
    nowISO,
  )
  const enCurso = new Map<string, number>()
  for (const o of (abiertas ?? []) as unknown as { stock_item_id: string | null; qty_produced: number; is_waste: boolean | null }[]) {
    if (!o.stock_item_id || o.is_waste) continue
    enCurso.set(o.stock_item_id, (enCurso.get(o.stock_item_id) ?? 0) + Number(o.qty_produced))
  }
  const byItemOrder = new Map<string, Map<number, number>>()
  for (const o of (outputs ?? []) as unknown as { stock_item_id: string; production_order_id: number; qty_produced: number; is_waste: boolean | null }[]) {
    if (!o.stock_item_id || o.is_waste) continue
    const orders = byItemOrder.get(o.stock_item_id) ?? new Map<number, number>()
    orders.set(o.production_order_id, (orders.get(o.production_order_id) ?? 0) + Number(o.qty_produced))
    byItemOrder.set(o.stock_item_id, orders)
  }
  const tandaByItem = new Map<string, number>()
  for (const [itemId, orders] of byItemOrder) {
    const totals = [...orders.values()].filter((t) => t > 0)
    if (totals.length > 0) tandaByItem.set(itemId, totals.reduce((a, b) => a + b, 0) / totals.length)
  }

  // --- 5) Sugerencias ---
  const items: SugerenciaItem[] = []
  const sinDatos: string[] = []
  const sinControl: PlanProduccion['sin_control'] = []
  const totalActiveDays = Math.max(new Set(datesByDow.flatMap((s) => [...s])).size, 1)

  for (const item of produced) {
    const batch = batchByItem.get(item.id)
    const receta = recetas.get(item.id)
    const nombre = batch?.displayName ?? receta?.name ?? templateByItem.get(item.id) ?? item.name
    const dowQty = demandByItem.get(item.id)!
    const total = dowQty.reduce((a, b) => a + b, 0)
    const stockActual = Number(item.current_qty)
    const seControla = yaProducido.has(item.id) || !!batch || !!receta || templateByItem.has(item.id) || stockActual > 0

    if (total <= 0) {
      if (batch || yaProducido.has(item.id)) sinDatos.push(nombre)
      continue
    }
    const avgDaily = total / totalActiveDays
    if (!seControla) {
      if (avgDaily >= 0.5) sinControl.push({ stock_item_id: item.id, name: item.name, unidad: item.unit, demanda_diaria: round1(avgDaily) })
      continue
    }

    const perDow = (dow: number) => dowQty[dow] / Math.max(datesByDow[dow].size, 1)
    const demandaHoy = dowQty[todayDow] > 0 ? perDow(todayDow) : avgDaily
    const demandaManiana = dowQty[tomorrowDow] > 0 ? perDow(tomorrowDow) : avgDaily
    const vencido = lotes.get(item.id)?.vencido ?? 0
    const utilizable = Math.max(0, stockActual - vencido)
    const curso = enCurso.get(item.id) ?? 0
    const cobertura = avgDaily > 0 ? (utilizable + curso) / avgDaily : Infinity
    if (cobertura > 3) continue

    // Vida útil de 1 día: producir solo para hoy
    const soloHoy = item.shelf_life_days === 1
    const objetivo = demandaHoy + (soloHoy ? 0 : demandaManiana)
    const raw = Math.max(0, objetivo - utilizable - curso)
    const tanda = tandaByItem.get(item.id) ?? receta?.rinde ?? batch?.yieldPerBase ?? 0
    let sugerido = Math.ceil(raw)
    if (raw > 0 && tanda > 0) sugerido = round1(Math.max(1, Math.round(raw / tanda)) * tanda)
    if (raw <= 0 && utilizable + curso >= objetivo) continue // cubre hoy y mañana

    const partes = [`los ${DOW_LABELS[todayDow]} se usan ~${round1(demandaHoy)}`, `hay ${round1(utilizable)}`]
    if (vencido > 0) partes.push(`${round1(vencido)} vencidos`)
    if (curso > 0) partes.push(`${round1(curso)} ya en producción`)
    if (soloHoy) partes.push('dura 1 día: solo para hoy')

    items.push({
      recipe_id: batch?.slug ?? `item:${item.id}`,
      nombre,
      stock_item_id: item.id,
      stock_item_name: item.name,
      unidad: item.unit,
      stock_actual: round1(stockActual),
      stock_utilizable: round1(utilizable),
      vencido_qty: round1(vencido),
      vence_proximo: lotes.get(item.id)?.proximo?.slice(0, 10) ?? null,
      en_produccion: round1(curso),
      demanda_hoy: round1(demandaHoy),
      demanda_maniana: round1(demandaManiana),
      demanda_diaria_prom: round1(avgDaily),
      sugerido,
      tanda_tipica: tanda > 0 ? round1(tanda) : null,
      cobertura_dias: round1(cobertura),
      vida_util_dias: item.shelf_life_days,
      tiene_receta: !!receta && receta.ingredientes.length > 0,
      fuente_demanda: fallbackItems.has(item.id) ? 'movimientos_stock' : 'ventas_fudo',
      reason: partes.join(' · '),
    })
  }

  items.sort((a, b) => a.cobertura_dias - b.cobertura_dias || b.demanda_diaria_prom - a.demanda_diaria_prom)
  sinControl.sort((a, b) => b.demanda_diaria - a.demanda_diaria)

  return {
    generated_at: new Date().toISOString(),
    hoy: DOW_LABELS[todayDow],
    maniana: DOW_LABELS[tomorrowDow],
    ventana_dias: WINDOW_DAYS,
    items,
    sin_datos: sinDatos,
    sin_control: sinControl,
  }
}
