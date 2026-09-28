// ---------------------------------------------------------------------------
// Recipe ↔ Stock Item Matching
// ---------------------------------------------------------------------------
// Attempts to link normalized ingredients to real stock_items.
// Uses fuzzy name matching with confidence scoring.
// Never auto-assigns — produces suggestions for manual review.
// ---------------------------------------------------------------------------

export type StockMatchResult = {
  ingredient_name: string
  normalized_name: string
  recipe_slug: string
  suggested_stock_item_id: string | number | null
  suggested_stock_item_name: string | null
  confidence: 'exacto' | 'probable' | 'ambiguo' | 'sin_match'
  confidence_score: number // 0-100
  reasons: string[]
  requires_review: boolean
}

type StockItemForMatch = {
  id: string | number
  name: string
  category: string
}

// Normalize for matching
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function words(s: string): string[] {
  return norm(s).split(/\s+/).filter(w => w.length > 2)
}

export function matchIngredientToStock(
  ingredientName: string,
  normalizedName: string,
  recipeSlug: string,
  stockItems: StockItemForMatch[],
): StockMatchResult {
  const base: StockMatchResult = {
    ingredient_name: ingredientName,
    normalized_name: normalizedName,
    recipe_slug: recipeSlug,
    suggested_stock_item_id: null,
    suggested_stock_item_name: null,
    confidence: 'sin_match',
    confidence_score: 0,
    reasons: [],
    requires_review: true,
  }

  if (stockItems.length === 0) {
    base.reasons = ['No hay items de stock cargados']
    return base
  }

  const ingNorm = norm(normalizedName)
  const ingWords = words(normalizedName)

  type Candidate = { item: StockItemForMatch; score: number; reasons: string[] }
  const candidates: Candidate[] = []

  for (const item of stockItems) {
    const itemNorm = norm(item.name)
    const itemWords = words(item.name)
    let score = 0
    const reasons: string[] = []

    // Exact match
    if (ingNorm === itemNorm) {
      score = 100
      reasons.push('Nombre exacto')
    }
    // One contains the other
    else if (ingNorm.includes(itemNorm) || itemNorm.includes(ingNorm)) {
      score = 70
      reasons.push('Nombre contenido')
    }
    // Word overlap
    else {
      const overlap = ingWords.filter(w => itemWords.includes(w)).length
      if (overlap > 0) {
        const pct = overlap / Math.max(ingWords.length, itemWords.length)
        score = Math.round(pct * 60)
        reasons.push(`${overlap} palabra(s) en común (${Math.round(pct * 100)}%)`)
      }
    }

    // Bonus: key ingredient word match (first significant word)
    if (ingWords.length > 0 && itemWords.includes(ingWords[0]) && score < 70) {
      score += 15
      reasons.push('Palabra clave coincide')
    }

    if (score > 0) {
      candidates.push({ item, score, reasons })
    }
  }

  if (candidates.length === 0) {
    base.reasons = ['Sin coincidencia con items de stock existentes']
    return base
  }

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]

  let confidence: StockMatchResult['confidence'] = 'sin_match'
  if (best.score >= 80) confidence = 'exacto'
  else if (best.score >= 50) confidence = 'probable'
  else if (best.score >= 20) confidence = 'ambiguo'

  return {
    ...base,
    suggested_stock_item_id: best.item.id,
    suggested_stock_item_name: best.item.name,
    confidence,
    confidence_score: best.score,
    reasons: best.reasons,
    requires_review: confidence !== 'exacto',
  }
}
