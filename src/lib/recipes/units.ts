// ---------------------------------------------------------------------------
// Unit normalization for recipe ingredients
// ---------------------------------------------------------------------------
// Converts all quantities to a canonical base unit per category:
//   Weight: grams (gr)
//   Volume: milliliters (ml)
//   Count:  unidad
// ---------------------------------------------------------------------------

type UnitCategory = 'weight' | 'volume' | 'count' | 'unknown'

type UnitInfo = {
  category: UnitCategory
  toBase: number // multiply by this to get base unit (gr or ml)
  baseUnit: string
}

const UNIT_MAP: Record<string, UnitInfo> = {
  // Weight → grams
  'gr': { category: 'weight', toBase: 1, baseUnit: 'gr' },
  'g': { category: 'weight', toBase: 1, baseUnit: 'gr' },
  'gramos': { category: 'weight', toBase: 1, baseUnit: 'gr' },
  'kg': { category: 'weight', toBase: 1000, baseUnit: 'gr' },
  'kilo': { category: 'weight', toBase: 1000, baseUnit: 'gr' },
  'kilos': { category: 'weight', toBase: 1000, baseUnit: 'gr' },

  // Volume → milliliters
  'ml': { category: 'volume', toBase: 1, baseUnit: 'ml' },
  'cc': { category: 'volume', toBase: 1, baseUnit: 'ml' },
  'lt': { category: 'volume', toBase: 1000, baseUnit: 'ml' },
  'litro': { category: 'volume', toBase: 1000, baseUnit: 'ml' },
  'litros': { category: 'volume', toBase: 1000, baseUnit: 'ml' },

  // Count → unidad
  'unidad': { category: 'count', toBase: 1, baseUnit: 'u' },
  'unidades': { category: 'count', toBase: 1, baseUnit: 'u' },
  'u': { category: 'count', toBase: 1, baseUnit: 'u' },
  'feta': { category: 'count', toBase: 1, baseUnit: 'u' },
  'fetas': { category: 'count', toBase: 1, baseUnit: 'u' },
  'rodaja': { category: 'count', toBase: 1, baseUnit: 'u' },
  'rodajas': { category: 'count', toBase: 1, baseUnit: 'u' },
  'porcion': { category: 'count', toBase: 1, baseUnit: 'u' },
  'porciones': { category: 'count', toBase: 1, baseUnit: 'u' },
  'cucharada': { category: 'volume', toBase: 15, baseUnit: 'ml' },
  'cucharadas': { category: 'volume', toBase: 15, baseUnit: 'ml' },
  'cucharadita': { category: 'volume', toBase: 5, baseUnit: 'ml' },
  'pizca': { category: 'count', toBase: 1, baseUnit: 'u' },
  'ramita': { category: 'count', toBase: 1, baseUnit: 'u' },
  'tajadita': { category: 'count', toBase: 1, baseUnit: 'u' },
  'caja': { category: 'count', toBase: 1, baseUnit: 'u' },
}

export type NormalizedQty = {
  qty: number
  unit: string
  category: UnitCategory
  original_qty: number | null
  original_unit: string | null
}

/**
 * Normalize a quantity + unit to its base unit (gr, ml, or u).
 * Returns null if quantity or unit is missing/unknown.
 */
export function normalizeQty(
  cantidad: number | null,
  unidad: string | null,
): NormalizedQty | null {
  if (cantidad === null || cantidad === 0) return null
  if (!unidad) return null

  const key = unidad.toLowerCase().trim()
  const info = UNIT_MAP[key]

  if (!info) {
    // Unknown unit — keep as-is with 'unknown' category
    return {
      qty: cantidad,
      unit: key,
      category: 'unknown',
      original_qty: cantidad,
      original_unit: unidad,
    }
  }

  return {
    qty: cantidad * info.toBase,
    unit: info.baseUnit,
    category: info.category,
    original_qty: cantidad,
    original_unit: unidad,
  }
}

/**
 * Format a normalized quantity for display.
 * Converts back to human-friendly units when appropriate.
 */
export function formatQty(qty: number, unit: string): string {
  if (unit === 'gr' && qty >= 1000) {
    return `${(qty / 1000).toFixed(1).replace(/\.0$/, '')} kg`
  }
  if (unit === 'ml' && qty >= 1000) {
    return `${(qty / 1000).toFixed(1).replace(/\.0$/, '')} lt`
  }
  return `${qty % 1 === 0 ? qty : qty.toFixed(1)} ${unit}`
}
