import type { SupabaseClient } from '@supabase/supabase-js'
import { canon, toStockUnitStrict } from '@/lib/recipes/recipe-cost'
import { esCostoConfiable } from '@/lib/costos/confiable'

// ---------------------------------------------------------------------------
// Recetas de producción: qué crudo lleva cada elaborado y cuánto rinde
// ---------------------------------------------------------------------------
// Fuente única (la usan "Lo hice", compras, costos y el plan de producción):
//   recipes.output_stock_item_id = el elaborado que sale
//   recipe_ingredients.qty_per_portion = cantidad POR UNIDAD producida
//   recipes.rinde_tanda (o yield_portions) = cuánto sale de una tanda típica
// No cuentan como receta de producción las recetas de platos (las usa un
// menu_item): esas dicen qué lleva un plato vendido, no cómo se elabora algo.
// Se cargan desde la app con guardar_receta_produccion().
// ---------------------------------------------------------------------------

export type IngredienteProduccion = {
  stock_item_id: string
  name: string
  /** unidad del insumo en stock */
  unit: string
  /** cantidad por UNIDAD producida, en unidad_receta */
  qty_por_unidad: number
  unidad_receta: string | null
  /** costo por unidad de stock, si es confiable */
  costo_unitario: number | null
}

export type RecetaProduccion = {
  recipe_id: string
  name: string
  output_stock_item_id: string
  /** cuánto rinde una tanda típica (unidad del elaborado) */
  rinde: number
  ingredientes: IngredienteProduccion[]
  /** costo teórico por unidad producida (null si falta algún costo confiable) */
  costo_por_unidad: number | null
  ingredientes_sin_costo: string[]
}

type RecipeRow = { id: string; name: string; slug: string | null; output_stock_item_id: string; rinde_tanda: number | null; yield_portions: number | null; updated_at: string | null }
type IngRow = { recipe_id: string; stock_item_id: string; qty_per_portion: number | null; ingredient_unit: string | null }
type ItemRow = { id: string; name: string; unit: string; cost_per_unit: number | null; cost_source?: string | null }

/** Recetas de producción por elaborado (id del stock_item que sale). */
export async function cargarRecetasProduccion(admin: SupabaseClient, outputIds?: string[]): Promise<Map<string, RecetaProduccion>> {
  let q = admin.from('recipes')
    .select('id, name, slug, output_stock_item_id, rinde_tanda, yield_portions, updated_at')
    .eq('is_active', true).not('output_stock_item_id', 'is', null)
  if (outputIds && outputIds.length > 0) q = q.in('output_stock_item_id', outputIds)
  const [{ data: recipes, error }, { data: platos }] = await Promise.all([
    q,
    admin.from('menu_items').select('recipe_id').not('recipe_id', 'is', null),
  ])
  if (error) throw new Error(error.message)
  const dePlato = new Set((platos ?? []).map((p: { recipe_id: string }) => p.recipe_id))

  // Una por elaborado: la propia (prod-*) primero, después la más reciente
  const elegida = new Map<string, RecipeRow>()
  for (const r of ((recipes ?? []) as RecipeRow[]).filter((r) => !dePlato.has(r.id))) {
    const prev = elegida.get(r.output_stock_item_id)
    const propia = (x: RecipeRow) => (x.slug ?? '').startsWith('prod-')
    if (!prev || (propia(r) && !propia(prev)) || (propia(r) === propia(prev) && (r.updated_at ?? '') > (prev.updated_at ?? ''))) {
      elegida.set(r.output_stock_item_id, r)
    }
  }
  const recipeIds = [...elegida.values()].map((r) => r.id)
  if (recipeIds.length === 0) return new Map()

  const { data: ings, error: ingErr } = await admin.from('recipe_ingredients')
    .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit').in('recipe_id', recipeIds)
  if (ingErr) throw new Error(ingErr.message)
  const ingRows = (ings ?? []) as IngRow[]
  const itemIds = [...new Set(ingRows.map((i) => i.stock_item_id))]
  let items: ItemRow[] = []
  if (itemIds.length > 0) {
    const res = await admin.from('stock_items').select('id, name, unit, cost_per_unit, cost_source').in('id', itemIds)
    items = (res.error
      ? (await admin.from('stock_items').select('id, name, unit, cost_per_unit').in('id', itemIds)).data ?? []
      : res.data ?? []) as ItemRow[]
  }
  const itemById = new Map(items.map((i) => [i.id, i]))

  const out = new Map<string, RecetaProduccion>()
  for (const r of elegida.values()) {
    let costo = 0
    const sinCosto: string[] = []
    const ingredientes: IngredienteProduccion[] = []
    for (const ri of ingRows.filter((x) => x.recipe_id === r.id)) {
      const item = itemById.get(ri.stock_item_id)
      if (!item) continue
      const qty = Number(ri.qty_per_portion ?? 0)
      const confiable = item.cost_source === undefined
        ? Number(item.cost_per_unit ?? 0) > 0
        : esCostoConfiable(item.cost_source, Number(item.cost_per_unit))
      const c = canon(qty, ri.ingredient_unit)
      const enStock = toStockUnitStrict(c.qty, c.unit, item.unit)
      if (confiable && enStock !== null) costo += enStock * Number(item.cost_per_unit)
      else sinCosto.push(item.name)
      ingredientes.push({
        stock_item_id: item.id,
        name: item.name,
        unit: item.unit,
        qty_por_unidad: qty,
        unidad_receta: ri.ingredient_unit,
        costo_unitario: confiable ? Number(item.cost_per_unit) : null,
      })
    }
    ingredientes.sort((a, b) => a.name.localeCompare(b.name, 'es'))
    out.set(r.output_stock_item_id, {
      recipe_id: r.id,
      name: r.name,
      output_stock_item_id: r.output_stock_item_id,
      rinde: Number(r.rinde_tanda ?? 0) > 0 ? Number(r.rinde_tanda) : Math.max(1, Number(r.yield_portions ?? 1)),
      ingredientes,
      costo_por_unidad: ingredientes.length > 0 && sinCosto.length === 0 ? Math.round(costo * 100) / 100 : null,
      ingredientes_sin_costo: sinCosto,
    })
  }
  return out
}

/** Insumos para producir `cantidad` unidades del elaborado (en la unidad de la receta). */
export function escalarReceta(receta: RecetaProduccion, cantidad: number): { stock_item_id: string; name: string; qty: number; unit: string }[] {
  return receta.ingredientes.map((i) => ({
    stock_item_id: i.stock_item_id,
    name: i.name,
    qty: Math.round(i.qty_por_unidad * cantidad * 10000) / 10000,
    unit: i.unidad_receta ?? i.unit,
  }))
}

/**
 * Consumo de elaborados → consumo de sus crudos (recursivo, hasta 3 niveles).
 * Devuelve SOLO lo que se suma a los crudos: los elaborados quedan como estaban.
 */
export function expandirAElaborados(
  consumoElaborados: Map<string, number>,
  recetas: Map<string, RecetaProduccion>,
): Map<string, number> {
  const extra = new Map<string, number>()
  const expandir = (itemId: string, qty: number, nivel: number, visto: Set<string>) => {
    const receta = recetas.get(itemId)
    if (!receta || nivel > 3 || visto.has(itemId)) return
    const sigVisto = new Set(visto).add(itemId)
    for (const ing of receta.ingredientes) {
      const c = canon(ing.qty_por_unidad * qty, ing.unidad_receta)
      const enStock = toStockUnitStrict(c.qty, c.unit, ing.unit)
      if (enStock === null || !(enStock > 0)) continue
      extra.set(ing.stock_item_id, (extra.get(ing.stock_item_id) ?? 0) + enStock)
      expandir(ing.stock_item_id, enStock, nivel + 1, sigVisto)
    }
  }
  for (const [itemId, qty] of consumoElaborados) if (qty > 0) expandir(itemId, qty, 1, new Set())
  return extra
}
