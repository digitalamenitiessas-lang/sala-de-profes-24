// ---------------------------------------------------------------------------
// Análisis IA de ventas por ventana (días de semana + franja horaria).
// Junta estadísticas del mes desde Fudo, las cruza con las categorías de la
// carta, y le pide a la IA un análisis accionable (qué se vende, de qué tipo,
// en qué horario, comparación entre días y semanas, recomendaciones).
// ---------------------------------------------------------------------------

import { SupabaseClient } from '@supabase/supabase-js'
import { format, startOfWeek } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { fetchMonthSales, type MonthSale } from '@/lib/fudo/month-sales'

const DOW_LABELS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

// Mapeo de categorías Fudo → momento del día
// Las categorías no listadas aquí (bebidas sin alcohol, adicionales, etc.) quedan sin asignar.
const DESAYUNO_MERIENDA_CATS = new Set([
  'Desayunos & Meriendas',
  'Entre Panes Desayunos y Meriendas',
  'Cafetería',
  'Infusiones',
  'Pasteleria',
  'SIN TACC',
  'Tostones',
  'LECHES',
  'Cafe Frio',
])

const ALMUERZO_CENA_CATS = new Set([
  'Platos Principales',
  'Pizzas',
  'Entre Panes',
  'No Vives de Ensalada',
  'Entradas',
  'LVE Kids',
  'Picadas',
  'WRAPS',
  'Papas Fritas',
  'Guarniciones',
  'Menu diario',
  'Menu personal',
  'PEDIDOS YA',
  'TAKE WAY',
  'Postres',
  'Bebidas con alcohol',
  'Copa de vino',
  'Tragos',
  'Pomo del Dia',
])

function catToMomento(catName: string | null): 'desayuno_merienda' | 'almuerzo_cena' | null {
  if (!catName) return null
  if (DESAYUNO_MERIENDA_CATS.has(catName)) return 'desayuno_merienda'
  if (ALMUERZO_CENA_CATS.has(catName)) return 'almuerzo_cena'
  return null
}

export type SalesAnalysisRequest = {
  month?: string | null
  /** Días de semana a analizar (0=dom … 6=sáb). Vacío = todos. */
  dows: number[]
  hourFrom: number
  hourTo: number
}

export type SalesAnalysisStats = {
  windowLabel: string
  totalFacturado: number
  totalTickets: number
  avgTicket: number
  topProducts: { name: string; category: string | null; qty: number; revenue: number }[]
  categoryMix: { category: string; revenue: number; qty: number }[]
  byMomento: { momento: string; label: string; revenue: number; qty: number; topProducts: { name: string; qty: number; revenue: number }[] }[]
  byDow: { dow: string; total: number; tickets: number; dayCount: number; avgPerDay: number }[]
  byWeek: { week: string; total: number; tickets: number }[]
  byHour: { hour: number; total: number; tickets: number }[]
}

function inWindow(sale: MonthSale, req: SalesAnalysisRequest): boolean {
  if (req.dows.length > 0 && !req.dows.includes(sale.argDow)) return false
  return sale.argHour >= req.hourFrom && sale.argHour <= req.hourTo
}

export async function buildSalesAnalysis(
  admin: SupabaseClient,
  req: SalesAnalysisRequest,
): Promise<{ stats: SalesAnalysisStats; analysis: string; model: string | null }> {
  const { sales } = await fetchMonthSales(req.month)
  const closed = sales.filter(s => s.state === 'CLOSED')
  const windowSales = closed.filter(s => inWindow(s, req))

  // Mapa producto Fudo → categoría de carta
  const { data: menuRows } = await admin
    .from('menu_items')
    .select('fudo_product_id, menu_categories(name)')
    .not('fudo_product_id', 'is', null)

  const categoryByProduct = new Map<string, string>()
  for (const row of (menuRows ?? []) as unknown as { fudo_product_id: string; menu_categories: { name: string } | null }[]) {
    if (row.fudo_product_id && row.menu_categories?.name) {
      categoryByProduct.set(String(row.fudo_product_id), row.menu_categories.name)
    }
  }

  // --- Agregados de la ventana ---
  const productAgg = new Map<string, { name: string; category: string | null; qty: number; revenue: number }>()
  const categoryAgg = new Map<string, { revenue: number; qty: number }>()
  const momentoAgg = new Map<string, { revenue: number; qty: number; products: Map<string, { qty: number; revenue: number }> }>()
  const hourAgg = new Map<number, { total: number; tickets: number }>()
  const dowAgg = new Map<number, { total: number; tickets: number; days: Set<string> }>()
  const weekAgg = new Map<string, { total: number; tickets: number }>()

  for (const sale of windowSales) {
    const h = hourAgg.get(sale.argHour) ?? { total: 0, tickets: 0 }
    h.total += sale.total
    h.tickets++
    hourAgg.set(sale.argHour, h)

    const d = dowAgg.get(sale.argDow) ?? { total: 0, tickets: 0, days: new Set<string>() }
    d.total += sale.total
    d.tickets++
    d.days.add(sale.argDate)
    dowAgg.set(sale.argDow, d)

    const weekStart = startOfWeek(new Date(sale.argDate + 'T12:00:00'), { weekStartsOn: 1 })
    const weekKey = format(weekStart, 'yyyy-MM-dd')
    const w = weekAgg.get(weekKey) ?? { total: 0, tickets: 0 }
    w.total += sale.total
    w.tickets++
    weekAgg.set(weekKey, w)

    for (const item of sale.items) {
      const category = item.productId ? categoryByProduct.get(item.productId) ?? null : null
      const p = productAgg.get(item.name) ?? { name: item.name, category, qty: 0, revenue: 0 }
      p.qty += item.qty
      p.revenue += item.price
      productAgg.set(item.name, p)

      const catKey = category ?? 'Sin categoría'
      const c = categoryAgg.get(catKey) ?? { revenue: 0, qty: 0 }
      c.revenue += item.price
      c.qty += item.qty
      categoryAgg.set(catKey, c)

      const momento = catToMomento(category)
      if (momento) {
        const m = momentoAgg.get(momento) ?? { revenue: 0, qty: 0, products: new Map() }
        m.revenue += item.price
        m.qty += item.qty
        const mp = m.products.get(item.name) ?? { qty: 0, revenue: 0 }
        mp.qty += item.qty
        mp.revenue += item.price
        m.products.set(item.name, mp)
        momentoAgg.set(momento, m)
      }
    }
  }

  const totalFacturado = windowSales.reduce((s, t) => s + t.total, 0)
  const totalTickets = windowSales.length

  const dowLabelList = req.dows.length > 0 ? req.dows.map(d => DOW_LABELS[d]).join(', ') : 'todos los días'
  const MOMENTO_LABELS: Record<string, string> = {
    desayuno_merienda: 'Desayunos y Meriendas',
    almuerzo_cena: 'Almuerzos y Cenas',
  }

  const stats: SalesAnalysisStats = {
    windowLabel: `${dowLabelList}, de ${req.hourFrom}:00 a ${req.hourTo}:59`,
    totalFacturado,
    totalTickets,
    avgTicket: totalTickets > 0 ? Math.round(totalFacturado / totalTickets) : 0,
    topProducts: Array.from(productAgg.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 12),
    categoryMix: Array.from(categoryAgg.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.revenue - a.revenue),
    byMomento: ['desayuno_merienda', 'almuerzo_cena']
      .filter(k => momentoAgg.has(k))
      .map(k => {
        const m = momentoAgg.get(k)!
        const topProducts = Array.from(m.products.entries())
          .map(([name, v]) => ({ name, ...v }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5)
        return { momento: k, label: MOMENTO_LABELS[k] ?? k, revenue: m.revenue, qty: m.qty, topProducts }
      }),
    byDow: Array.from(dowAgg.entries())
      .map(([dow, v]) => ({
        dow: DOW_LABELS[dow],
        total: v.total,
        tickets: v.tickets,
        dayCount: v.days.size,
        avgPerDay: v.days.size > 0 ? Math.round(v.total / v.days.size) : 0,
      }))
      .sort((a, b) => b.avgPerDay - a.avgPerDay),
    byWeek: Array.from(weekAgg.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, v]) => ({
        week: `Semana del ${format(new Date(weekStart + 'T12:00:00'), "d 'de' MMMM", { locale: es })}`,
        ...v,
      })),
    byHour: Array.from(hourAgg.entries())
      .map(([hour, v]) => ({ hour, ...v }))
      .sort((a, b) => a.hour - b.hour),
  }

  const { analysis, model } = await generateAnalysisText(stats)
  return { stats, analysis, model }
}

// ---------------------------------------------------------------------------
// Texto del análisis — IA con fallback a reglas
// ---------------------------------------------------------------------------

const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`

async function generateAnalysisText(stats: SalesAnalysisStats): Promise<{ analysis: string; model: string | null }> {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY
  if (!OPENROUTER_KEY || stats.totalTickets === 0) {
    return { analysis: buildFallbackAnalysis(stats), model: null }
  }

  const lines: string[] = [
    `VENTANA ANALIZADA: ${stats.windowLabel}`,
    `Facturado: ${fmt(stats.totalFacturado)} en ${stats.totalTickets} tickets (ticket promedio ${fmt(stats.avgTicket)})`,
    '',
    'TOP PRODUCTOS (por facturación):',
    ...stats.topProducts.slice(0, 10).map(p => `- ${p.name}${p.category ? ` [${p.category}]` : ''}: ${p.qty} u., ${fmt(p.revenue)}`),
    '',
    'POR MOMENTO DEL DÍA:',
    ...stats.byMomento.map(m =>
      `- ${m.label}: ${fmt(m.revenue)} (${m.qty} u.) | Top: ${m.topProducts.slice(0, 3).map(p => p.name).join(', ')}`,
    ),
    '',
    'MIX POR CATEGORÍA DE CARTA:',
    ...stats.categoryMix.slice(0, 8).map(c => `- ${c.category}: ${fmt(c.revenue)} (${c.qty} u.)`),
    '',
    'POR DÍA DE SEMANA (promedio por día en la ventana):',
    ...stats.byDow.map(d => `- ${d.dow}: ${fmt(d.avgPerDay)}/día (${d.dayCount} días, total ${fmt(d.total)}, ${d.tickets} tickets)`),
    '',
    'POR SEMANA DEL MES:',
    ...stats.byWeek.map(w => `- ${w.week}: ${fmt(w.total)} (${w.tickets} tickets)`),
    '',
    'POR HORA:',
    ...stats.byHour.map(h => `- ${h.hour}:00 → ${fmt(h.total)} (${h.tickets} tickets)`),
  ]

  const systemPrompt = `Sos el analista de negocio de La Vieja Escuela, un bar/café en Tucumán, Argentina.
Te van a pasar estadísticas de ventas de una ventana elegida por el dueño (días de semana + franja horaria).
Escribí un análisis corto y accionable para tomar decisiones de personal, promociones y producción:
1) Qué se vende más en esta ventana (productos concretos y tipo/categoría).
2) Qué horas son fuertes y cuáles flojas dentro de la franja.
3) Diferencias entre los días analizados y tendencia entre semanas (¿mejora, empeora, estable?).
4) 3 a 5 recomendaciones concretas y realistas (refuerzo o reducción de personal en horas puntuales, promos para horas valle con los productos que ya se venden, producción/stock).
Formato: texto plano con guiones para las listas. Sin markdown, sin emojis. Máximo ~250 palabras.
Usá español argentino, directo. Mencioná números concretos (montos y horas).`

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
        max_tokens: 700,
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
    return { analysis: buildFallbackAnalysis(stats), model: null }
  }
}

function buildFallbackAnalysis(stats: SalesAnalysisStats): string {
  if (stats.totalTickets === 0) {
    return 'No hay ventas registradas en la ventana elegida. Probá con otra franja u otros días.'
  }
  const top = stats.topProducts[0]
  const topCat = stats.categoryMix[0]
  const hours = [...stats.byHour]
  const pico = hours.reduce((m, h) => (h.total > m.total ? h : m), hours[0])
  const valle = hours.reduce((m, h) => (h.total < m.total ? h : m), hours[0])
  const lines = [
    `En la ventana (${stats.windowLabel}) se facturaron ${fmt(stats.totalFacturado)} en ${stats.totalTickets} tickets.`,
    top ? `Lo más vendido: ${top.name}${top.category ? ` (${top.category})` : ''} con ${fmt(top.revenue)}.` : '',
    topCat ? `La categoría más fuerte: ${topCat.category} (${fmt(topCat.revenue)}).` : '',
    pico ? `Hora más fuerte: ${pico.hour}:00 (${fmt(pico.total)}). Hora más floja: ${valle.hour}:00 (${fmt(valle.total)}).` : '',
    stats.byWeek.length > 1 ? `Semanas: ${stats.byWeek.map(w => `${w.week} ${fmt(w.total)}`).join(' · ')}.` : '',
    '(Análisis generado sin IA — configurar OPENROUTER_API_KEY para el análisis completo.)',
  ]
  return lines.filter(Boolean).join('\n')
}
