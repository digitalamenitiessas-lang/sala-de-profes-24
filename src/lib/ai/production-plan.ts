// ---------------------------------------------------------------------------
// Plan de producción de Hoy: cantidades del cálculo único de producción
// (lib/produccion/plan.ts, el mismo de Cocina) + un consejo escrito por IA.
// ---------------------------------------------------------------------------

import { SupabaseClient } from '@supabase/supabase-js'
import { calcularPlanProduccion } from '@/lib/produccion/plan'

const DOW_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// Solo entra al plan lo que la casa PRODUCE (stock_items.is_produced).
// Lo comprado hecho (budines de tercero, etc.) va al copiloto de compras.

export type ProductionPlanItem = {
  stock_item_id: string
  name: string
  unit: string
  category: string
  current_qty: number
  shelf_life_days: number | null
  /** unidades vendidas por día activo (promedio del período) */
  avg_daily_sales: number
  /** venta esperada hoy según el día de semana */
  expected_today: number
  /** ya en órdenes de producción abiertas (draft/pending_review/in_progress) */
  pending_production: number
  suggested_qty: number
  reason: string
}

export type ProductionPlan = {
  generatedAt: string
  today: string
  items: ProductionPlanItem[]
  sellingWithoutStock: { name: string; avg_daily_sales: number; current_qty: number }[]
  analysis: string
  model: string | null
}

export async function buildProductionPlan(admin: SupabaseClient): Promise<ProductionPlan> {
  // Las cantidades salen del MISMO cálculo que Cocina (lib/produccion/plan):
  // antes Hoy tenía su propio plan y podía decir otra cosa.
  const plan = await calcularPlanProduccion(admin)
  const todayDow = DOW_LABELS.indexOf(plan.hoy)

  const items: ProductionPlanItem[] = plan.items
    .filter((i) => i.sugerido > 0)
    .map((i) => ({
      stock_item_id: i.stock_item_id,
      name: i.nombre,
      unit: i.unidad,
      category: '',
      current_qty: i.stock_actual,
      shelf_life_days: i.vida_util_dias,
      avg_daily_sales: i.demanda_diaria_prom,
      expected_today: i.demanda_hoy,
      pending_production: i.en_produccion,
      suggested_qty: i.sugerido,
      reason: i.reason,
    }))

  // Se usan pero el stock digital está en cero (o no se lleva): contar primero
  const sellingWithoutStock: ProductionPlan['sellingWithoutStock'] = [
    ...plan.items
      .filter((i) => i.stock_actual <= 0 && i.demanda_diaria_prom >= 0.5)
      .map((i) => ({ name: i.stock_item_name, avg_daily_sales: i.demanda_diaria_prom, current_qty: i.stock_actual })),
    ...plan.sin_control.map((s) => ({ name: s.name, avg_daily_sales: s.demanda_diaria, current_qty: 0 })),
  ]

  const { analysis, model } = await generatePlanText(items, sellingWithoutStock, todayDow)

  return {
    generatedAt: new Date().toISOString(),
    today: DOW_LABELS[todayDow],
    items: items.slice(0, 15),
    sellingWithoutStock: sellingWithoutStock.slice(0, 10),
    analysis,
    model,
  }
}

// ---------------------------------------------------------------------------
// Narrativa IA con fallback
// ---------------------------------------------------------------------------

async function generatePlanText(
  items: ProductionPlanItem[],
  sellingWithoutStock: ProductionPlan['sellingWithoutStock'],
  todayDow: number,
): Promise<{ analysis: string; model: string | null }> {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY
  const fallback = () => {
    if (items.length === 0) {
      return 'No hay producción sugerida para hoy: el stock cubre la venta esperada. Revisá igualmente los items sin stock digital si cocina reporta faltantes.'
    }
    const top = items.slice(0, 5).map(i => `- ${i.name}: producir ${i.suggested_qty} ${i.unit} (${i.reason})`)
    const alerts = sellingWithoutStock.length > 0
      ? `\nAtención: ${sellingWithoutStock.map(s => s.name).join(', ')} registran ventas pero no tienen stock digital — contá lo físico y corregí.`
      : ''
    return `Prioridades de producción para hoy ${DOW_LABELS[todayDow]}:\n${top.join('\n')}${alerts}`
  }

  if (!OPENROUTER_KEY || items.length === 0) {
    return { analysis: fallback(), model: null }
  }

  const lines = [
    `HOY ES: ${DOW_LABELS[todayDow]}`,
    '',
    'SUGERENCIAS CALCULADAS (venta esperada según histórico del día de semana, stock actual, producción en curso, vida útil):',
    ...items.map(i => `- ${i.name} [${i.category}]: sugerido ${i.suggested_qty} ${i.unit} | stock ${i.current_qty} | venta esperada hoy ${i.expected_today} | en producción ${i.pending_production} | vida útil ${i.shelf_life_days ?? 's/d'} días`),
    '',
    sellingWithoutStock.length > 0
      ? `VENDIENDO SIN STOCK DIGITAL (posible faltante físico o conteo pendiente): ${sellingWithoutStock.map(s => `${s.name} (~${s.avg_daily_sales}/día, stock ${s.current_qty})`).join('; ')}`
      : 'Sin items vendiendo en negativo.',
  ]

  const systemPrompt = `Sos el jefe de producción de La Vieja Escuela, bar/café con pastelería propia en Tucumán, Argentina.
Te paso el plan de producción calculado para hoy. Escribí un mensaje corto para el chef y el encargado:
1) Las 3-5 prioridades de producción de hoy con cantidades concretas y el porqué en una línea.
2) Si hay items vendiendo sin stock digital, marcalo como URGENTE: hay que contar lo físico primero.
3) Cerrá con una observación útil si la ves (ej. algo con vida útil corta que conviene producir en dos tandas).
Formato: texto plano con guiones. Sin markdown ni emojis. Máximo 150 palabras. Español argentino, directo.`

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        temperature: 0.3,
        max_tokens: 400,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: lines.join('\n') },
        ],
      }),
    })

    if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
    const json = await res.json()
    const text = json.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('Empty response')
    return { analysis: text, model: json.model ?? 'anthropic/claude-sonnet-4' }
  } catch {
    return { analysis: fallback(), model: null }
  }
}
