import type { SupabaseClient } from '@supabase/supabase-js'
import { esCostoConfiable, esErrorColumnaFaltante } from '@/lib/costos/confiable'

// ---------------------------------------------------------------------------
// recipe-cost.ts — costo por porción de recetas, con canonicalización de
// unidades y expansión nivel-2 de elaborados intermedios.
//
// LECCIÓN CRÍTICA: recipe_ingredients.ingredient_unit viene MEZCLADO entre
// filas del mismo insumo ('kg', 'gramos', 'g', 'ml', 'l', 'unidad'...).
// SIEMPRE canonicalizar cada fila (g/gr/gramos → ÷1000 kg, ml/cc → ÷1000 l)
// ANTES de sumar o multiplicar por stock_items.cost_per_unit.
//
// COSTO CONFIABLE (2026-09): solo suman las líneas cuyo stock_item tiene
// cost_source confiable ('compra' | 'manual' | 'produccion') y costo > 0.
// Todo lo demás (costo Fudo, estimado, 0, null, o unidad incompatible con la
// del item) cuenta como MISSING y la receta queda `confiable: false` — la UI
// debe mostrar "sin costo real", nunca un número fantasma.
//
// Nivel 2: si un ingrediente es un stock_item producido por otra receta
// (ej: "Milanesa cruda"), su costo se toma del costo por porción de esa
// receta. El vínculo se resuelve PRIMERO por recipes.output_stock_item_id
// (explícito, robusto a renombres) y recién si es null cae al match por
// nombre exacto (comportamiento histórico).
// ---------------------------------------------------------------------------

/** Canonicaliza una cantidad: g→kg, ml→l. Devuelve qty + unidad canónica. */
export function canon(qty: number, unit: string | null): { qty: number; unit: string | null } {
  const u = unit?.trim().toLowerCase() ?? null
  if (u === 'g' || u === 'gr' || u === 'gramos') return { qty: qty / 1000, unit: 'kg' }
  if (u === 'ml' || u === 'cc') return { qty: qty / 1000, unit: 'l' }
  if (u === 'lt' || u === 'litro' || u === 'litros') return { qty, unit: 'l' }
  if (u === 'kilo' || u === 'kilos') return { qty, unit: 'kg' }
  // Variantes de 'unidad': sin esto, una receta cargada en 'u'/'un' contra un
  // item en 'unidad' daba unidad-incompatible y la receta quedaba "sin costo"
  // por falso positivo.
  if (u === 'u' || u === 'un' || u === 'unid' || u === 'unidades') return { qty, unit: 'unidad' }
  return { qty, unit: u }
}

/**
 * Convierte qty de una unidad (ya canónica) a la unidad del stock_item.
 * OJO: si las unidades NO son convertibles (unidad↔kg, kg↔l) devuelve qty tal
 * cual — comportamiento histórico que varios callers usan para cantidades.
 * Para COSTOS usar toStockUnitStrict, que detecta el caso.
 */
export function toStockUnit(qty: number, fromUnit: string | null, toUnit: string): number {
  return toStockUnitStrict(qty, fromUnit, toUnit) ?? qty
}

/**
 * Igual que toStockUnit pero devuelve null cuando las unidades son
 * incompatibles (unidad↔kg, masa↔volumen, etc.): multiplicar ahí inventa
 * plata. La línea debe contarse como "sin costo real".
 */
export function toStockUnitStrict(qty: number, fromUnit: string | null, toUnit: string): number | null {
  // Sin unidad en la receta → se asume la unidad del item (histórico).
  if (!fromUnit) return qty
  if (fromUnit.trim().toLowerCase() === toUnit.trim().toLowerCase()) return qty
  const from = canon(qty, fromUnit)
  const to = canon(1, toUnit) // 1 unidad destino = to.qty unidades canónicas
  if (from.unit === to.unit && to.qty > 0) return from.qty / to.qty
  return null
}

type IngredientRow = {
  recipe_id: string
  stock_item_id: string
  qty_per_portion: number | null
  ingredient_unit: string | null
}

type StockItemRow = {
  id: string
  name: string
  unit: string
  cost_per_unit: number | null
  cost_source?: string | null
  is_produced?: boolean | null
}

export type RecipeCost = {
  /** Costo por porción en $ (redondeado a 2 decimales). 0 si no se pudo costear. */
  cost: number
  /** Cantidad de ingredientes de la receta. */
  ingredients: number
  /** Ingredientes sin costo confiable (fuente no confiable, costo 0/null o unidad incompatible). */
  missing: number
  /** Nombres de los insumos sin costo real (cap 6, sin duplicados). */
  missingNames: string[]
  /** true solo si TODAS las líneas se costearon con fuentes confiables. */
  confiable: boolean
}

/**
 * Costea un conjunto de recetas: costo por porción = Σ ingredientes
 * (canonicalizados) × cost_per_unit del stock_item, con expansión nivel-2
 * de intermedios. Solo suman líneas con costo CONFIABLE; el resto queda en
 * missing/missingNames y la receta sale con confiable=false.
 */
export async function costRecipes(
  admin: SupabaseClient,
  recipeIds: string[],
): Promise<Map<string, RecipeCost>> {
  const result = new Map<string, RecipeCost>()
  if (recipeIds.length === 0) return result

  // 1. Ingredientes directos de las recetas pedidas
  const { data: riRows, error: riError } = await admin
    .from('recipe_ingredients')
    .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit')
    .in('recipe_id', recipeIds)
  if (riError) throw new Error(riError.message)
  const ingredients = (riRows ?? []) as IngredientRow[]

  const directItemIds = [...new Set(ingredients.map(r => r.stock_item_id))]
  if (directItemIds.length === 0) return result

  // Select tolerante: si la migración de cost_source no está aplicada todavía,
  // cae al select legacy y el criterio de confiable pasa a ser costo > 0.
  let hasCostSource = true
  const selectItems = async (ids: string[]): Promise<StockItemRow[]> => {
    if (ids.length === 0) return []
    if (hasCostSource) {
      const res = await admin
        .from('stock_items')
        .select('id, name, unit, cost_per_unit, cost_source, is_produced')
        .in('id', ids)
      if (!res.error) return (res.data ?? []) as StockItemRow[]
      if (!esErrorColumnaFaltante(res.error.message, ['cost_source'])) throw new Error(res.error.message)
      hasCostSource = false
    }
    const legacy = await admin
      .from('stock_items')
      .select('id, name, unit, cost_per_unit, is_produced')
      .in('id', ids)
    if (legacy.error) throw new Error(legacy.error.message)
    return (legacy.data ?? []) as StockItemRow[]
  }

  // 2. Detectar intermedios: stock_items usados que son producidos por otra
  //    receta. Vínculo explícito (output_stock_item_id) primero; match por
  //    nombre solo como fallback para recetas sin vincular.
  const [directItems, recipesRes] = await Promise.all([
    selectItems(directItemIds),
    admin.from('recipes').select('id, name, output_stock_item_id'),
  ])

  type RecipeRow = { id: string; name: string; output_stock_item_id?: string | null }
  let allRecipes: RecipeRow[]
  if (recipesRes.error) {
    // Fallback: columna output_stock_item_id todavía no migrada
    const legacy = await admin.from('recipes').select('id, name')
    if (legacy.error) throw new Error(legacy.error.message)
    allRecipes = (legacy.data ?? []) as RecipeRow[]
  } else {
    allRecipes = (recipesRes.data ?? []) as RecipeRow[]
  }

  const recipeIdByName = new Map<string, string>()
  const recipeIdByOutputItemId = new Map<string, string>()
  for (const r of allRecipes) {
    recipeIdByName.set(r.name.trim().toLowerCase(), r.id)
    if (r.output_stock_item_id) recipeIdByOutputItemId.set(r.output_stock_item_id, r.id)
  }

  // stock_item intermedio → receta L1 que lo produce (explícito > nombre)
  const l1RecipeByItemId = new Map<string, string>()
  for (const item of directItems) {
    const rid = recipeIdByOutputItemId.get(item.id)
      ?? recipeIdByName.get(item.name.trim().toLowerCase())
    if (rid) l1RecipeByItemId.set(item.id, rid)
  }

  // 3. Ingredientes crudos de las recetas intermedias (nivel 2, sin recursión)
  const l1RecipeIds = [...new Set(l1RecipeByItemId.values())].filter(id => !result.has(id))
  let l1Ingredients: IngredientRow[] = []
  if (l1RecipeIds.length > 0) {
    const { data: l1Ris, error: l1Error } = await admin
      .from('recipe_ingredients')
      .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit')
      .in('recipe_id', l1RecipeIds)
    if (l1Error) throw new Error(l1Error.message)
    l1Ingredients = (l1Ris ?? []) as IngredientRow[]
  }

  // 4. Catálogo de stock_items involucrados (directos + crudos de intermedios)
  const allItemIds = [...new Set([...directItemIds, ...l1Ingredients.map(r => r.stock_item_id)])]
  const allItems = await selectItems(allItemIds)
  const itemById = new Map<string, StockItemRow>()
  for (const it of allItems) itemById.set(it.id, it)

  /** ¿El costo directo del item es usable? (fuente confiable + costo > 0) */
  const itemCostConfiable = (item: StockItemRow): boolean =>
    hasCostSource
      ? esCostoConfiable(item.cost_source ?? null, item.cost_per_unit)
      : Number(item.cost_per_unit ?? 0) > 0 // columna aún no migrada → criterio legacy

  /** Costo en $ de una fila contra el costo del stock_item, con gating. */
  const rowCost = (ri: IngredientRow): { cost: number; known: boolean; missingName: string } => {
    const item = itemById.get(ri.stock_item_id)
    if (!item) return { cost: 0, known: false, missingName: 'insumo desconocido' }
    if (!itemCostConfiable(item)) return { cost: 0, known: false, missingName: item.name }
    const c = canon(Number(ri.qty_per_portion ?? 0), ri.ingredient_unit)
    const qtyInStockUnit = toStockUnitStrict(c.qty, c.unit, item.unit)
    if (qtyInStockUnit === null) {
      return { cost: 0, known: false, missingName: `${item.name} (unidad incompatible)` }
    }
    return { cost: qtyInStockUnit * Number(item.cost_per_unit), known: true, missingName: '' }
  }

  // 5. Costo por porción de cada receta intermedia (solo crudos). Si alguna
  //    línea no es confiable, el costo teórico de la intermedia tampoco lo es.
  const l1CostByRecipeId = new Map<string, { cost: number; missing: number }>()
  for (const rid of l1RecipeIds) {
    let total = 0
    let missing = 0
    for (const ri of l1Ingredients.filter(r => r.recipe_id === rid)) {
      const r = rowCost(ri)
      if (!r.known) missing += 1
      total += r.cost
    }
    l1CostByRecipeId.set(rid, { cost: total, missing })
  }

  // 6. Costo por porción de cada receta pedida, expandiendo intermedios
  for (const rid of recipeIds) {
    const rows = ingredients.filter(r => r.recipe_id === rid)
    let total = 0
    let missing = 0
    const missingNames: string[] = []
    const addMissing = (name: string) => {
      missing += 1
      if (name && missingNames.length < 6 && !missingNames.includes(name)) missingNames.push(name)
    }
    for (const ri of rows) {
      const l1Recipe = l1RecipeByItemId.get(ri.stock_item_id)
      const producedItem = itemById.get(ri.stock_item_id)
      // Intermedio PRODUCIDO con costo real de producción CONFIABLE (lo escribe
      // complete_production_order v7 con cost_source='produccion'): ese costo
      // manda sobre el teórico de la receta.
      if (l1Recipe && l1Recipe !== rid && producedItem?.is_produced && itemCostConfiable(producedItem)) {
        const r = rowCost(ri)
        if (r.known) { total += r.cost; continue }
        addMissing(r.missingName)
        continue
      }
      // Intermedio (y no auto-referencia): costo teórico de esa receta × qty,
      // SOLO si esa receta se costeó completa con fuentes confiables. OJO: el
      // costo teórico es POR PORCIÓN, y cómo se denomina esa porción no es
      // conocible acá — multiplicar una línea en masa/volumen (ej. 0.2 kg) por
      // un costo por porción inventa plata. Conservador: el teórico solo
      // aplica cuando la línea está en unidades/porciones; en masa/volumen la
      // línea cae al costo directo del item (rowCost), que si no es confiable
      // o compatible la marca como missing.
      if (l1Recipe && l1Recipe !== rid) {
        const l1 = l1CostByRecipeId.get(l1Recipe)
        if (l1 && l1.missing === 0 && l1.cost > 0) {
          const c = canon(Number(ri.qty_per_portion ?? 0), ri.ingredient_unit)
          const effUnit = c.unit ?? producedItem?.unit?.trim().toLowerCase() ?? null
          const lineIsPortions = effUnit === null
            || effUnit === 'unidad'
            || effUnit === 'porcion' || effUnit === 'porción' || effUnit === 'porciones'
          if (lineIsPortions) {
            total += c.qty * l1.cost
            continue
          }
        }
        // Receta intermedia sin costo confiable (o línea en masa/volumen)
        // → caer al costo directo del item
      }
      const r = rowCost(ri)
      if (!r.known) addMissing(r.missingName)
      total += r.cost
    }
    result.set(rid, {
      cost: Math.round(total * 100) / 100,
      ingredients: rows.length,
      missing,
      missingNames,
      confiable: missing === 0,
    })
  }

  return result
}
