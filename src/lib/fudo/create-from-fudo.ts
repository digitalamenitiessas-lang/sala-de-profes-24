// ---------------------------------------------------------------------------
// Crear stock_items desde Fudo — lógica compartida
// ---------------------------------------------------------------------------
// Usada por:
//   - POST/GET /api/stock/create-from-fudo (botón manual, manager-only)
//   - GET /api/cron/fudo-sync (auto-creación nocturna de insumos nuevos)
// Fudo es la fuente de verdad: unidad real (include=unit), costo y stock
// inicial vienen de Fudo. Idempotente: si ya hay un stock_item vinculado a ese
// fudo_ingredient_id, se saltea.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'
import { fudoHttp } from '@/lib/fudoClient'
import { readFudoStock, type FudoIngredient } from '@/lib/fudo/stock-sync'
import { esErrorColumnaFaltante } from '@/lib/costos/confiable'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FudoIngredientWithUnit = {
  id: string
  name: string
  cost: number | null
  stock: number | null
  stockControl: boolean
  unit: 'kg' | 'l' | 'unidad'
}

export type CreateFromFudoResult = {
  created: number
  skipped: number
  createdNames: string[]
  errors: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mapea la unidad de Fudo ('kg' | 'litre' | 'unit') a la unidad LVE */
export function mapFudoUnit(raw: string | null | undefined): 'kg' | 'l' | 'unidad' {
  const value = (raw ?? '').toLowerCase()
  if (value.includes('kg') || value.includes('kilo')) return 'kg'
  if (value.includes('lit') || value === 'l') return 'l'
  return 'unidad'
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Lee todos los ingredientes de Fudo con su unidad (include=unit, paginado) */
export async function readFudoIngredientsWithUnit(): Promise<FudoIngredientWithUnit[]> {
  const all: FudoIngredientWithUnit[] = []
  let page = 1

  while (page <= 50) {
    // fudoHttp ya reintenta (con tope) si Fudo limita pedidos
    const res = await fudoHttp(
      `https://api.fu.do/v1alpha1/ingredients?include=unit&page[size]=200&page[number]=${page}`,
    )

    if (!res.ok) throw new Error(`Fudo API error: ${res.status}`)

    const data = await res.json()
    const items = data.data ?? []
    const included = data.included ?? []

    // Mapa de unidades incluidas: id → nombre/código ('kg' | 'litre' | 'unit')
    const unitMap = new Map<string, string>()
    for (const inc of included) {
      if ((inc.type ?? '').toLowerCase() === 'unit') {
        const label = inc.attributes?.name ?? inc.attributes?.code ?? inc.id
        unitMap.set(String(inc.id), String(label))
      }
    }

    for (const item of items) {
      const unitRef = item.relationships?.unit?.data as { id?: string } | null | undefined
      const rawUnit = unitRef?.id != null
        ? (unitMap.get(String(unitRef.id)) ?? String(unitRef.id))
        : null
      all.push({
        id: String(item.id),
        name: item.attributes?.name ?? `Ingrediente ${item.id}`,
        cost: asNullableNumber(item.attributes?.cost),
        stock: asNullableNumber(item.attributes?.stock),
        stockControl: item.attributes?.stockControl ?? false,
        unit: mapFudoUnit(rawUnit),
      })
    }

    if (items.length < 200) break
    page++
  }

  return all
}

/** Sets de ids Fudo ya vinculados a algún stock_item (activo o no) */
export async function readLinkedFudoIds(admin: SupabaseClient) {
  const { data, error } = await admin
    .from('stock_items')
    .select('fudo_ingredient_id, fudo_product_id')

  if (error) throw error

  const linkedIngredients = new Set<string>()
  const linkedProducts = new Set<string>()
  for (const row of data ?? []) {
    if (row.fudo_ingredient_id) linkedIngredients.add(String(row.fudo_ingredient_id))
    if (row.fudo_product_id) linkedProducts.add(String(row.fudo_product_id))
  }
  return { linkedIngredients, linkedProducts }
}

// ---------------------------------------------------------------------------
// Crear stock_items desde ingredientes Fudo
// ---------------------------------------------------------------------------

/**
 * Inserta un stock_item por cada ingrediente candidato que todavía no esté
 * vinculado. Muta `linkedIngredients` agregando los ids recién creados.
 */
export async function createStockItemsFromIngredients(
  admin: SupabaseClient,
  candidates: FudoIngredientWithUnit[],
  linkedIngredients: Set<string>,
): Promise<CreateFromFudoResult> {
  const result: CreateFromFudoResult = { created: 0, skipped: 0, createdNames: [], errors: [] }
  const now = new Date().toISOString()

  for (const ing of candidates) {
    if (linkedIngredients.has(ing.id)) {
      result.skipped++
      continue
    }
    const hasCost = ing.cost != null && ing.cost > 0
    const basePayload = {
      name: ing.name,
      unit: ing.unit,
      cost_per_unit: hasCost ? ing.cost : null,
      current_qty: typeof ing.stock === 'number' ? Math.round(ing.stock * 100) / 100 : 0,
      fudo_ingredient_id: ing.id,
      is_active: true,
      category: 'otros',
      semaphore: 'green',
      updated_at: now,
    }
    // Costo inicial tomado de Fudo al CREAR el item: se marca 'fudo' (fuente
    // NO confiable) — la UI no lo muestra como costo real.
    let { error } = await admin.from('stock_items').insert(
      hasCost ? { ...basePayload, cost_source: 'fudo', cost_updated_at: now } : basePayload,
    )
    if (error && hasCost && esErrorColumnaFaltante(error.message, ['cost_source', 'cost_updated_at'])) {
      ;({ error } = await admin.from('stock_items').insert(basePayload))
    }
    if (error) {
      result.errors.push(`${ing.name}: ${error.message}`)
    } else {
      result.created++
      result.createdNames.push(ing.name)
      linkedIngredients.add(ing.id)
    }
  }

  return result
}

/**
 * Auto-creación nocturna: detecta ingredientes de Fudo con stockControl=true
 * sin stock_item vinculado (por fudo_ingredient_id) y los crea con la unidad
 * real, el costo y el stock que reporta Fudo. Reusa exactamente la misma
 * lógica que el botón manual de /api/stock/create-from-fudo.
 */
export async function autoCreateMissingFudoIngredients(
  admin: SupabaseClient,
): Promise<CreateFromFudoResult> {
  const [ingredients, { linkedIngredients }] = await Promise.all([
    readFudoIngredientsWithUnit(),
    readLinkedFudoIds(admin),
  ])

  const candidates = ingredients.filter(
    i => i.stockControl && !linkedIngredients.has(i.id),
  )

  return createStockItemsFromIngredients(admin, candidates, linkedIngredients)
}

// ---------------------------------------------------------------------------
// Ingredientes Fudo cacheados (costo) — para lecturas frecuentes tipo
// /api/stock/intelligence, que no deben pegarle a Fudo en cada carga.
// Cache en memoria de módulo (30 min), mismo patrón que expenses.ts.
// ---------------------------------------------------------------------------

const INGREDIENTS_CACHE_TTL_MS = 30 * 60 * 1000
let ingredientsCache: { at: number; items: FudoIngredient[] } | null = null

export async function getFudoIngredientsCached(): Promise<FudoIngredient[]> {
  if (ingredientsCache && Date.now() - ingredientsCache.at < INGREDIENTS_CACHE_TTL_MS) {
    return ingredientsCache.items
  }
  const items = await readFudoStock()
  ingredientsCache = { at: Date.now(), items }
  return items
}
