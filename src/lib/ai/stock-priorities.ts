// ---------------------------------------------------------------------------
// AI Stock Priorities — conservative prioritization without recipe consumption
// ---------------------------------------------------------------------------
// Score built from real, verifiable signals only:
// - criticality (qty vs min)
// - supplier status
// - category sensitivity
// - how far below minimum
// AI explains and suggests actions, but logic lives in code.
// ---------------------------------------------------------------------------

import { createAdminClient } from '@/lib/supabase/admin'

export type StockPriority = {
  item_id: string
  item_name: string
  category: string
  current_qty: number
  min_qty: number
  status: 'critico' | 'atencion' | 'normal'
  supplier_status: 'asignado' | 'sin_proveedor'
  supplier_name: string | null
  priority_score: number // 0-100
  reasons: string[]
  suggested_action: string
  confidence_label: 'dato_real' | 'estimacion'
}

// Sensitive categories — outage has immediate operational impact
const SENSITIVE_CATEGORIES = new Set(['bebidas', 'lacteos', 'carnes', 'verduras', 'frutas'])

// ---------------------------------------------------------------------------
// Calculate priority score — pure logic, no AI
// ---------------------------------------------------------------------------

function calculatePriorityScore(item: {
  current_qty: number
  min_qty: number
  supplier_id: string | null
  category: string
}): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // 1. Zero stock — max urgency
  if (item.current_qty === 0) {
    score += 50
    reasons.push('Sin stock — agotado')
  }
  // Critical (below minimum)
  else if (item.current_qty <= item.min_qty) {
    const deficit = item.min_qty - item.current_qty
    const deficitPct = item.min_qty > 0 ? deficit / item.min_qty : 1
    score += 20 + Math.round(deficitPct * 25)
    reasons.push(`${Math.round(deficitPct * 100)}% por debajo del mínimo`)
  }
  // Attention (at minimum)
  else if (item.current_qty <= item.min_qty * 1.2) {
    score += 10
    reasons.push('Cerca del mínimo')
  }

  // 2. No supplier — compounds urgency
  if (!item.supplier_id) {
    score += 20
    reasons.push('Sin proveedor asignado — no se puede pedir')
  }

  // 3. Sensitive category
  if (SENSITIVE_CATEGORIES.has(item.category)) {
    score += 10
    reasons.push('Categoría sensible — impacto operativo directo')
  }

  return { score: Math.min(score, 100), reasons }
}

// ---------------------------------------------------------------------------
// Derive suggested action from state
// ---------------------------------------------------------------------------

function suggestAction(item: {
  current_qty: number
  min_qty: number
  supplier_id: string | null
}): string {
  if (!item.supplier_id && item.current_qty <= item.min_qty) {
    return 'Asignar proveedor y reponer urgente'
  }
  if (!item.supplier_id) {
    return 'Asignar proveedor'
  }
  if (item.current_qty === 0) {
    return 'Reponer hoy — stock agotado'
  }
  if (item.current_qty <= item.min_qty) {
    return 'Priorizar compra esta semana'
  }
  if (item.current_qty <= item.min_qty * 1.2) {
    return 'Monitorear — cerca del mínimo'
  }
  return 'Sin acción requerida'
}

// ---------------------------------------------------------------------------
// Generate priorities for all stock items
// ---------------------------------------------------------------------------

export async function generateStockPriorities(): Promise<StockPriority[]> {
  const admin = createAdminClient()

  const { data: items } = await admin
    .from('stock_items')
    .select('id, name, category, current_qty, min_qty, supplier_id, suppliers!stock_items_supplier_id_fkey(name)')
    .eq('is_active', true)

  if (!items || items.length === 0) return []

  const priorities: StockPriority[] = items
    .map((item) => {
      const { score, reasons } = calculatePriorityScore(item)

      let status: StockPriority['status'] = 'normal'
      if (item.current_qty <= item.min_qty) status = 'critico'
      else if (item.current_qty <= item.min_qty * 1.2) status = 'atencion'

      return {
        item_id: item.id,
        item_name: item.name,
        category: item.category,
        current_qty: item.current_qty,
        min_qty: item.min_qty,
        status,
        supplier_status: item.supplier_id ? 'asignado' as const : 'sin_proveedor' as const,
        supplier_name: (item.suppliers as { name: string } | null)?.name ?? null,
        priority_score: score,
        reasons,
        suggested_action: suggestAction(item),
        confidence_label: 'dato_real' as const,
      }
    })
    .filter((p) => p.priority_score > 0)
    .sort((a, b) => b.priority_score - a.priority_score)

  return priorities
}

// ---------------------------------------------------------------------------
// AI explanation layer — optional enrichment
// ---------------------------------------------------------------------------

export async function explainPrioritiesWithAI(priorities: StockPriority[]): Promise<string | null> {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY
  if (!OPENROUTER_KEY || priorities.length === 0) return null

  const top = priorities.slice(0, 8)
  const context = top.map((p, i) =>
    `${i + 1}. ${p.item_name} (${p.category}) — ${p.status}, qty: ${p.current_qty}/${p.min_qty}${p.supplier_status === 'sin_proveedor' ? ' ⚠️ SIN PROVEEDOR' : ` (${p.supplier_name})`} — Acción: ${p.suggested_action}`
  ).join('\n')

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        temperature: 0.2,
        max_tokens: 250,
        messages: [
          {
            role: 'system',
            content: 'Sos el asistente operativo de un bar/café. Resumí en 2-3 oraciones las prioridades de stock más urgentes. Español argentino, directo, sin markdown ni emojis. Mencioná acciones concretas.',
          },
          { role: 'user', content: `Prioridades de stock:\n${context}` },
        ],
      }),
    })

    if (!res.ok) return null
    const json = await res.json()
    return json.choices?.[0]?.message?.content?.trim() ?? null
  } catch {
    return null
  }
}
