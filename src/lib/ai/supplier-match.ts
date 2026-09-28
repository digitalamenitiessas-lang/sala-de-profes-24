// ---------------------------------------------------------------------------
// AI Supplier Matching — suggests proveedor for items without one
// ---------------------------------------------------------------------------
// Logic-first approach: lexical/category matching runs in code.
// AI enriches with reasoning and confidence explanation.
// Never auto-assigns — always requires manual confirmation.
// ---------------------------------------------------------------------------

import { createAdminClient } from '@/lib/supabase/admin'

export type SupplierSuggestion = {
  item_id: string
  item_name: string
  item_category: string
  item_qty: number
  item_min: number
  suggested_supplier_id: string | null
  suggested_supplier_name: string | null
  confidence: 'alta' | 'media' | 'baja' | 'ninguna'
  confidence_score: number // 0-100
  reasons: string[]
  requires_manual_review: boolean
}

type StockItemRaw = {
  id: string
  name: string
  category: string
  current_qty: number
  min_qty: number
  supplier_id: string | null
}

type SupplierRaw = {
  id: string
  name: string
  category: string | null
  notes: string | null
}

type ExistingAssignment = {
  category: string
  supplier_id: string
  count: number
}

// ---------------------------------------------------------------------------
// Normalize for fuzzy matching
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(normalize(a).split(/\s+/).filter(w => w.length > 2))
  const wordsB = new Set(normalize(b).split(/\s+/).filter(w => w.length > 2))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let overlap = 0
  wordsA.forEach(w => { if (wordsB.has(w)) overlap++ })
  return overlap / Math.max(wordsA.size, wordsB.size)
}

// ---------------------------------------------------------------------------
// Category mapping — common supplier specialties
// ---------------------------------------------------------------------------

const CATEGORY_SUPPLIER_KEYWORDS: Record<string, string[]> = {
  bebidas: ['bebida', 'distribuidora', 'coca', 'cerveza', 'agua', 'gaseosa', 'vino'],
  lacteos: ['lacteo', 'leche', 'queso', 'crema', 'manteca', 'yogur'],
  carnes: ['carne', 'frigorifico', 'pollo', 'cerdo', 'vaca', 'res'],
  verduras: ['verdura', 'fruta', 'verduleria', 'hortaliza', 'organico'],
  frutas: ['fruta', 'verduleria', 'organico', 'citrico'],
  panaderia: ['panaderia', 'pan', 'harina', 'levadura', 'masa'],
  condimentos: ['condimento', 'especia', 'salsa', 'aceite', 'vinagre'],
  limpieza: ['limpieza', 'higiene', 'quimico', 'desinfectante', 'jabon'],
  desechables: ['descartable', 'desechable', 'envase', 'packaging', 'vaso'],
}

// ---------------------------------------------------------------------------
// Rule-based matching engine
// ---------------------------------------------------------------------------

export function matchItemToSupplier(
  item: StockItemRaw,
  suppliers: SupplierRaw[],
  categoryAssignments: ExistingAssignment[],
): SupplierSuggestion {
  const base: SupplierSuggestion = {
    item_id: item.id,
    item_name: item.name,
    item_category: item.category,
    item_qty: item.current_qty,
    item_min: item.min_qty,
    suggested_supplier_id: null,
    suggested_supplier_name: null,
    confidence: 'ninguna',
    confidence_score: 0,
    reasons: [],
    requires_manual_review: true,
  }

  if (suppliers.length === 0) {
    base.reasons = ['No hay proveedores cargados en el sistema']
    return base
  }

  type Candidate = { supplier: SupplierRaw; score: number; reasons: string[] }
  const candidates: Candidate[] = []

  for (const supplier of suppliers) {
    let score = 0
    const reasons: string[] = []

    // 1. Category match — supplier.category matches item.category
    if (supplier.category && normalize(supplier.category) === normalize(item.category)) {
      score += 40
      reasons.push(`Categoría coincide: ${item.category}`)
    }

    // 2. Name word overlap
    const nameOverlap = wordOverlap(item.name, supplier.name)
    if (nameOverlap > 0.3) {
      score += Math.round(nameOverlap * 30)
      reasons.push(`Coincidencia por nombre (${Math.round(nameOverlap * 100)}%)`)
    }

    // 3. Supplier notes contain item-related keywords
    if (supplier.notes) {
      const notesNorm = normalize(supplier.notes)
      const itemNorm = normalize(item.name)
      const itemWords = itemNorm.split(/\s+/).filter(w => w.length > 2)
      const notesMatch = itemWords.filter(w => notesNorm.includes(w)).length
      if (notesMatch > 0) {
        score += Math.min(notesMatch * 10, 20)
        reasons.push(`Notas del proveedor mencionan productos similares`)
      }
    }

    // 4. Category keyword matching
    const catKeywords = CATEGORY_SUPPLIER_KEYWORDS[item.category] ?? []
    const supplierNorm = normalize(supplier.name + ' ' + (supplier.notes ?? ''))
    const kwMatch = catKeywords.filter(kw => supplierNorm.includes(kw)).length
    if (kwMatch > 0) {
      score += Math.min(kwMatch * 10, 20)
      reasons.push(`Proveedor asociado a categoría ${item.category}`)
    }

    // 5. Same category assignments — other items in same category use this supplier
    const categoryMatch = categoryAssignments.find(
      a => a.category === item.category && a.supplier_id === supplier.id,
    )
    if (categoryMatch) {
      score += Math.min(categoryMatch.count * 8, 30)
      reasons.push(`${categoryMatch.count} item(s) de ${item.category} ya usan este proveedor`)
    }

    if (score > 0) {
      candidates.push({ supplier, score, reasons })
    }
  }

  if (candidates.length === 0) {
    base.reasons = ['No se encontró coincidencia razonable con ningún proveedor']
    return base
  }

  // Pick best candidate
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]

  // Map score to confidence
  let confidence: SupplierSuggestion['confidence'] = 'ninguna'
  if (best.score >= 60) confidence = 'alta'
  else if (best.score >= 35) confidence = 'media'
  else if (best.score >= 15) confidence = 'baja'

  return {
    ...base,
    suggested_supplier_id: best.supplier.id,
    suggested_supplier_name: best.supplier.name,
    confidence,
    confidence_score: Math.min(best.score, 100),
    reasons: best.reasons,
    requires_manual_review: confidence !== 'alta',
  }
}

// ---------------------------------------------------------------------------
// Batch matching — fetch data and match all unassigned items
// ---------------------------------------------------------------------------

export async function generateSupplierSuggestions(): Promise<SupplierSuggestion[]> {
  const admin = createAdminClient()

  const [itemsRes, suppliersRes] = await Promise.all([
    admin.from('stock_items')
      .select('id, name, category, current_qty, min_qty, supplier_id')
      .eq('is_active', true)
      .is('supplier_id', null),
    admin.from('suppliers')
      .select('id, name, category, notes'),
  ])

  const items = (itemsRes.data ?? []) as StockItemRaw[]
  const suppliers = (suppliersRes.data ?? []) as SupplierRaw[]

  // Build category assignment map from items WITH suppliers
  const { data: assignedItems } = await admin
    .from('stock_items')
    .select('category, supplier_id')
    .eq('is_active', true)
    .not('supplier_id', 'is', null)

  const assignmentMap = new Map<string, Map<string, number>>()
  for (const ai of assignedItems ?? []) {
    if (!assignmentMap.has(ai.category)) assignmentMap.set(ai.category, new Map())
    const catMap = assignmentMap.get(ai.category)!
    catMap.set(ai.supplier_id!, (catMap.get(ai.supplier_id!) ?? 0) + 1)
  }

  const categoryAssignments: ExistingAssignment[] = []
  assignmentMap.forEach((catMap, category) => {
    catMap.forEach((count, supplier_id) => {
      categoryAssignments.push({ category, supplier_id, count })
    })
  })

  // Generate suggestions for items without supplier
  // Prioritize critical items first
  const sorted = items.sort((a, b) => {
    const aCrit = a.current_qty <= a.min_qty ? 1 : 0
    const bCrit = b.current_qty <= b.min_qty ? 1 : 0
    return bCrit - aCrit
  })

  return sorted.map(item => matchItemToSupplier(item, suppliers, categoryAssignments))
}
