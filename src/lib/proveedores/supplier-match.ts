// ---------------------------------------------------------------------------
// Sugerencia de proveedor por nombre — para la pantalla de vinculación guiada.
// ---------------------------------------------------------------------------
// Fudo no expone (ni permite escribir) un vínculo insumo→proveedor en su API,
// así que esto solo alimenta stock_items.supplier_id en LVE, apuntando siempre
// a un proveedor real de Fudo (mismo fudo_provider_id).
//
// Reglas explícitas primero (hints entre paréntesis o palabras clave del
// nombre del proveedor, ej. "Harituc (Harina)"), y si ninguna matchea, no se
// sugiere nada — mejor sin sugerencia que una equivocada.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'y', 'con', 'sin', 'un', 'una', 'para', 'x',
])

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
}

function tokens(s: string): string[] {
  return normalize(s)
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
}

// Extrae las pistas explícitas del nombre del proveedor: contenido entre
// paréntesis (separado por comas) — es la parte que quien cargó el proveedor
// usó para aclarar qué vende. Ej: "Proveedor (Brownie, Chipa, Cookie, Alfa)"
// -> ['brownie', 'chipa', 'cookie', 'alfa']
function supplierHints(supplierName: string): string[] {
  const match = supplierName.match(/\(([^)]+)\)/)
  if (!match) return []
  return match[1]
    .split(',')
    .flatMap((part) => tokens(part))
}

export type SupplierOption = { id: string; name: string }

export type SupplierSuggestion = {
  supplierId: string
  supplierName: string
  reason: string
} | null

/**
 * Sugiere un proveedor para un stock_item en base a coincidencias de texto.
 * No usa IA — es determinístico y fácil de ajustar (solo tocar STOPWORDS o
 * la extracción de hints de arriba).
 */
export function suggestSupplier(
  item: { name: string; category?: string | null },
  suppliers: SupplierOption[],
): SupplierSuggestion {
  const itemTokens = new Set([...tokens(item.name), ...tokens(item.category ?? '')])
  if (itemTokens.size === 0) return null

  let best: { supplier: SupplierOption; score: number; matched: string[] } | null = null

  for (const supplier of suppliers) {
    const hints = supplierHints(supplier.name)
    const nameTokens = tokens(supplier.name.replace(/\([^)]*\)/g, ''))

    const hintMatches = hints.filter((h) => itemTokens.has(h))
    const nameMatches = nameTokens.filter((t) => itemTokens.has(t))

    // Un match dentro del paréntesis vale mucho más: es una pista explícita.
    const score = hintMatches.length * 3 + nameMatches.length
    if (score === 0) continue

    if (!best || score > best.score) {
      best = { supplier, score, matched: [...hintMatches, ...nameMatches] }
    }
  }

  if (!best || best.score < 3) return null // exigir al menos un hint explícito o 3+ matches de nombre

  return {
    supplierId: best.supplier.id,
    supplierName: best.supplier.name,
    reason: `coincide con "${best.matched[0]}"`,
  }
}
