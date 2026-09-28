import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { esCostoConfiable, esErrorColumnaFaltante } from '@/lib/costos/confiable'
import { toStockUnitStrict } from '@/lib/recipes/recipe-cost'

// ---------------------------------------------------------------------------
// GET /api/ventas/insumos?days=7
// ---------------------------------------------------------------------------
// "¿Qué insumos se están vendiendo más?" — la conexión venta → insumo.
//
// Recorre la cadena oficial (mismas tablas que /api/stock/demand, pero en
// sentido inverso y agregado sobre TODOS los insumos):
//
//   fudo_sales (período) → menu_items (fudo_product_id, recipe_id)
//   → recipes → recipe_ingredients → stock_items
//
// Nivel 2 (elaborados intermedios): si un insumo consumido es a su vez una
// receta con el mismo nombre (ej: "Milanesa cruda"), su consumo se propaga
// a los ingredientes crudos de esa receta (nalga, pan rallado, etc.).
//
// Devuelve top 15: [{ stock_item_id, name, unit, qty_consumed, sales_count,
// cost_estimate }] ordenado por platos vendidos que usan el insumo.
// Excluye outputs de producción marcados is_waste. Solo managers.
// Cache en memoria de módulo: 5 minutos por ventana de días.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000
const PAGE_SIZE = 1000

type InsumoRow = {
  stock_item_id: string
  name: string
  unit: string
  qty_consumed: number
  sales_count: number
  cost_estimate: number | null
}

type Payload = {
  days: number
  from: string
  to: string
  total_dishes_sold: number
  items: InsumoRow[]
}

const cache = new Map<number, { at: number; payload: Payload }>()

/** Pagina de a 1000 (PostgREST corta en 1000 por default). */
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

/** Convierte qty de la unidad de receta a la unidad del stock_item (g→kg, ml→l). */
function toStockUnit(qty: number, fromUnit: string | null, toUnit: string): number {
  if (!fromUnit) return qty
  const f = fromUnit.trim().toLowerCase()
  const t = toUnit.trim().toLowerCase()
  if (f === t) return qty
  if ((f === 'g' || f === 'gr' || f === 'gramos') && (t === 'kg' || t === 'kilo' || t === 'kilos')) return qty / 1000
  if ((t === 'g' || t === 'gr' || t === 'gramos') && (f === 'kg' || f === 'kilo' || f === 'kilos')) return qty * 1000
  if ((f === 'ml' || f === 'cc') && (t === 'l' || t === 'lt' || t === 'litro' || t === 'litros')) return qty / 1000
  if ((t === 'ml' || t === 'cc') && (f === 'l' || f === 'lt' || f === 'litro' || f === 'litros')) return qty * 1000
  return qty
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!isManagerOrAbove(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') ?? 7) || 7, 1), 30)

    const cached = cache.get(days)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload)
    }

    const admin = createAdminClient()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffISO = cutoff.toISOString()

    // 1. Platos del menú vinculados a receta y a producto Fudo
    const { data: menuItems, error: miError } = await admin
      .from('menu_items')
      .select('id, name, recipe_id, fudo_product_id')
      .eq('is_active', true)
      .not('recipe_id', 'is', null)
      .not('fudo_product_id', 'is', null)
    if (miError) throw new Error(miError.message)

    const recipeByFudoId = new Map<string, string>()
    for (const mi of menuItems ?? []) {
      if (mi.fudo_product_id && mi.recipe_id) recipeByFudoId.set(mi.fudo_product_id, mi.recipe_id)
    }

    if (recipeByFudoId.size === 0) {
      return NextResponse.json({ days, from: cutoffISO.slice(0, 10), to: new Date().toISOString().slice(0, 10), total_dishes_sold: 0, items: [] })
    }

    // 2. Ventas del período (solo productos con receta), paginado
    const fudoIds = [...recipeByFudoId.keys()]
    type SaleRow = { fudo_product_id: string; quantity: number }
    const sales = await fetchAll<SaleRow>((from, to) =>
      admin
        .from('fudo_consumo') // ítems vendidos + opciones elegidas
        .select('fudo_product_id, quantity')
        .in('fudo_product_id', fudoIds)
        .gte('sold_at', cutoffISO)
        .order('id', { ascending: true })
        .range(from, to) as never,
    )

    // 3. Unidades vendidas por receta
    const unitsByRecipe = new Map<string, number>()
    let totalDishes = 0
    for (const s of sales) {
      const recipeId = recipeByFudoId.get(s.fudo_product_id)
      if (!recipeId) continue
      const qty = Number(s.quantity ?? 0)
      unitsByRecipe.set(recipeId, (unitsByRecipe.get(recipeId) ?? 0) + qty)
      totalDishes += qty
    }

    const soldRecipeIds = [...unitsByRecipe.keys()]
    const consumed = new Map<string, { qty: number; sales: number; unit: string | null }>()

    // Canonicaliza ANTES de acumular: distintas recetas expresan el mismo
    // insumo en unidades distintas (ej. Papas: 30 recetas en kg y una en
    // gramos). Sumar crudo mezclaba 714 g con 0.357 kg como si fueran la
    // misma unidad e inflaba el consumo ~1000x en ese insumo. g→kg y ml→l
    // acá; así el acumulador siempre suma en una única unidad por familia.
    const canon = (qty: number, unit: string | null): { qty: number; unit: string | null } => {
      const u = unit?.trim().toLowerCase() ?? null
      if (u === 'g' || u === 'gr' || u === 'gramos') return { qty: qty / 1000, unit: 'kg' }
      if (u === 'ml' || u === 'cc') return { qty: qty / 1000, unit: 'l' }
      if (u === 'lt' || u === 'litro' || u === 'litros') return { qty, unit: 'l' }
      if (u === 'kilo' || u === 'kilos') return { qty, unit: 'kg' }
      return { qty, unit: u }
    }

    const addConsumption = (stockItemId: string, rawQty: number, salesCount: number, rawUnit: string | null) => {
      const { qty, unit } = canon(rawQty, rawUnit)
      const entry = consumed.get(stockItemId) ?? { qty: 0, sales: 0, unit }
      entry.qty += qty
      entry.sales += salesCount
      if (!entry.unit && unit) entry.unit = unit
      consumed.set(stockItemId, entry)
    }

    // 4. Nivel 1 — ingredientes directos de las recetas vendidas
    if (soldRecipeIds.length > 0) {
      const { data: riRows, error: riError } = await admin
        .from('recipe_ingredients')
        .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit')
        .in('recipe_id', soldRecipeIds)
      if (riError) throw new Error(riError.message)

      for (const ri of riRows ?? []) {
        const units = unitsByRecipe.get(ri.recipe_id) ?? 0
        if (units <= 0) continue
        addConsumption(ri.stock_item_id, Number(ri.qty_per_portion ?? 0) * units, units, ri.ingredient_unit)
      }
    }

    // 5. Nivel 2 — elaborados intermedios: insumo consumido cuyo nombre coincide
    //    con una receta (ej: "Milanesa cruda") propaga su consumo a los crudos.
    if (consumed.size > 0) {
      const consumedIds = [...consumed.keys()]
      const { data: consumedItems } = await admin
        .from('stock_items')
        .select('id, name')
        .in('id', consumedIds)

      const { data: allRecipes } = await admin
        .from('recipes')
        .select('id, name')

      const recipeIdByName = new Map<string, string>()
      for (const r of allRecipes ?? []) recipeIdByName.set(r.name.trim().toLowerCase(), r.id)

      // stock_item intermedio consumido → receta L1 que lo produce
      const l1RecipeByItemId = new Map<string, string>()
      for (const item of consumedItems ?? []) {
        const recipeId = recipeIdByName.get(item.name.trim().toLowerCase())
        if (recipeId) l1RecipeByItemId.set(item.id, recipeId)
      }

      const l1RecipeIds = [...new Set(l1RecipeByItemId.values())]
      if (l1RecipeIds.length > 0) {
        const { data: l1Ris } = await admin
          .from('recipe_ingredients')
          .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit')
          .in('recipe_id', l1RecipeIds)

        for (const [itemId, recipeId] of l1RecipeByItemId) {
          const parent = consumed.get(itemId)
          if (!parent || parent.qty <= 0) continue
          for (const ri of (l1Ris ?? []).filter(r => r.recipe_id === recipeId)) {
            // No re-propagar sobre sí mismo (receta que se referencia a sí misma)
            if (ri.stock_item_id === itemId) continue
            addConsumption(ri.stock_item_id, Number(ri.qty_per_portion ?? 0) * parent.qty, parent.sales, ri.ingredient_unit)
          }
        }
      }
    }

    if (consumed.size === 0) {
      const payload: Payload = { days, from: cutoffISO.slice(0, 10), to: new Date().toISOString().slice(0, 10), total_dishes_sold: totalDishes, items: [] }
      cache.set(days, { at: Date.now(), payload })
      return NextResponse.json(payload)
    }

    // 6. Excluir descartes de producción (outputs marcados is_waste)
    const { data: wasteOutputs } = await admin
      .from('production_template_outputs')
      .select('stock_item_id')
      .eq('is_waste', true)
      .not('stock_item_id', 'is', null)
    const wasteIds = new Set((wasteOutputs ?? []).map(w => w.stock_item_id as string))

    // 7. Detalle de los insumos consumidos + costo (SOLO fuentes confiables:
    //    compra/manual/producción — el costo Fudo no se valoriza).
    const finalIds = [...consumed.keys()].filter(id => !wasteIds.has(id))
    type SiRow = { id: string; name: string; unit: string; cost_per_unit: number | null; cost_source?: string | null; is_active: boolean }
    let hasCostSource = true
    let stockItems: SiRow[]
    {
      const res = await admin
        .from('stock_items')
        .select('id, name, unit, cost_per_unit, cost_source, is_active')
        .in('id', finalIds)
      if (res.error && esErrorColumnaFaltante(res.error.message, ['cost_source'])) {
        hasCostSource = false
        const legacy = await admin
          .from('stock_items')
          .select('id, name, unit, cost_per_unit, is_active')
          .in('id', finalIds)
        if (legacy.error) throw new Error(legacy.error.message)
        stockItems = (legacy.data ?? []) as SiRow[]
      } else if (res.error) {
        throw new Error(res.error.message)
      } else {
        stockItems = (res.data ?? []) as SiRow[]
      }
    }

    const items: InsumoRow[] = (stockItems ?? [])
      .filter(si => si.is_active)
      .map(si => {
        const c = consumed.get(si.id)!
        const qtyInStockUnit = toStockUnit(c.qty, c.unit, si.unit)
        const confiable = hasCostSource
          ? esCostoConfiable(si.cost_source ?? null, si.cost_per_unit)
          : Number(si.cost_per_unit ?? 0) > 0
        // Para el $ la conversión debe ser estricta: unidad incompatible = sin costo
        const qtyForCost = toStockUnitStrict(c.qty, c.unit, si.unit)
        const cost = confiable && qtyForCost !== null
          ? Math.round(qtyForCost * Number(si.cost_per_unit))
          : null
        return {
          stock_item_id: si.id,
          name: si.name,
          unit: si.unit,
          qty_consumed: Math.round(qtyInStockUnit * 100) / 100,
          sales_count: Math.round(c.sales),
          cost_estimate: cost,
        }
      })
      .sort((a, b) => b.sales_count - a.sales_count || (b.cost_estimate ?? 0) - (a.cost_estimate ?? 0))
      .slice(0, 15)

    const payload: Payload = {
      days,
      from: cutoffISO.slice(0, 10),
      to: new Date().toISOString().slice(0, 10),
      total_dishes_sold: totalDishes,
      items,
    }
    cache.set(days, { at: Date.now(), payload })
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[GET /api/ventas/insumos]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
