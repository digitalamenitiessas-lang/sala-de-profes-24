// ---------------------------------------------------------------------------
// AI Briefing — generates daily operational summary for Home dashboard
// ---------------------------------------------------------------------------
// Runs server-side only via /api/ai/briefing
// Uses OpenRouter (Claude) with structured context from real data
// Falls back gracefully if AI unavailable
// ---------------------------------------------------------------------------

import { createAdminClient } from '@/lib/supabase/admin'
import { isStockCritical } from '@/lib/contracts/stock'

export type BriefingData = {
  stockCritical: { name: string; qty: number; min: number; supplier: string | null }[]
  stockNoSupplier: number
  pendingOrders: { kitchen: number; bar: number }
  expedientesOverdue: { code: string; title: string; daysOverdue: number }[]
  expedientesActive: number
  teamToday: number
  ventas: { total: number; tickets: number; topProduct: string } | null
  announcements: number
}

export type BriefingResult = {
  text: string
  data: BriefingData
  sources: string[]
  generatedAt: string
  model: string | null
}

// ---------------------------------------------------------------------------
// Gather context from Supabase (not FUDO — that's fetched separately)
// ---------------------------------------------------------------------------

export async function gatherBriefingContext(): Promise<BriefingData> {
  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const [stockRes, ordersKitchenRes, ordersBarRes, expedientesRes, teamRes, announcementsRes] = await Promise.all([
    admin.from('stock_items').select('name, current_qty, min_qty, supplier_id, suppliers!stock_items_supplier_id_fkey(name)').eq('is_active', true),
    admin.from('kitchen_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('bar_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    admin.from('expedientes').select('id, code, title, status, target_date, updated_at').not('status', 'in', '("cumplido","cerrado_sin_implementacion","archivado")'),
    admin.from('attendance_logs').select('id', { count: 'exact', head: true }).eq('operative_date', today).is('clock_out_at', null),
    admin.from('announcements').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ])

  // Stock critical
  const stockItems = stockRes.data ?? []
  const critical = stockItems
    .filter((item) => isStockCritical(item.current_qty ?? 0, item.min_qty ?? 0))
    .map((item) => ({
      name: item.name,
      qty: item.current_qty,
      min: item.min_qty,
      supplier: (item.suppliers as { name: string } | null)?.name ?? null,
    }))

  const noSupplier = stockItems.filter((item) => !item.supplier_id && isStockCritical(item.current_qty ?? 0, item.min_qty ?? 0)).length

  // Expedientes overdue
  const now = new Date()
  const overdue = (expedientesRes.data ?? [])
    .filter((exp) => exp.target_date && new Date(exp.target_date) < now)
    .map((exp) => ({
      code: exp.code,
      title: exp.title,
      daysOverdue: Math.ceil((now.getTime() - new Date(exp.target_date!).getTime()) / 86400000),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)

  return {
    stockCritical: critical.slice(0, 10),
    stockNoSupplier: noSupplier,
    pendingOrders: {
      kitchen: ordersKitchenRes.count ?? 0,
      bar: ordersBarRes.count ?? 0,
    },
    expedientesOverdue: overdue.slice(0, 5),
    expedientesActive: expedientesRes.data?.length ?? 0,
    teamToday: teamRes.count ?? 0,
    ventas: null, // filled by caller with FUDO data
    announcements: announcementsRes.count ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Generate briefing text via OpenRouter
// ---------------------------------------------------------------------------

export async function generateBriefingText(data: BriefingData): Promise<{ text: string; model: string | null }> {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY
  if (!OPENROUTER_KEY) {
    return { text: buildFallbackBriefing(data), model: null }
  }

  const contextLines: string[] = []

  // Stock
  if (data.stockCritical.length > 0) {
    contextLines.push(`STOCK CRÍTICO (${data.stockCritical.length} items):`)
    data.stockCritical.slice(0, 5).forEach((s) => {
      contextLines.push(`- ${s.name}: tiene ${s.qty}, mínimo ${s.min}${s.supplier ? ` (proveedor: ${s.supplier})` : ' ⚠️ SIN PROVEEDOR'}`)
    })
  } else {
    contextLines.push('STOCK: Todo en orden, sin items críticos.')
  }

  if (data.stockNoSupplier > 0) {
    contextLines.push(`⚠️ ${data.stockNoSupplier} items críticos sin proveedor asignado.`)
  }

  // Pedidos
  const totalOrders = data.pendingOrders.kitchen + data.pendingOrders.bar
  if (totalOrders > 0) {
    contextLines.push(`PEDIDOS PENDIENTES: ${data.pendingOrders.kitchen} de cocina, ${data.pendingOrders.bar} de barra.`)
  }

  // Ventas
  if (data.ventas) {
    contextLines.push(`VENTAS HOY: $${(data.ventas.total / 1000).toFixed(0)}k facturado, ${data.ventas.tickets} tickets.`)
    if (data.ventas.topProduct) {
      contextLines.push(`Más vendido: ${data.ventas.topProduct}`)
    }
  }

  // Expedientes
  if (data.expedientesOverdue.length > 0) {
    contextLines.push(`EXPEDIENTES VENCIDOS (${data.expedientesOverdue.length}):`)
    data.expedientesOverdue.slice(0, 3).forEach((e) => {
      contextLines.push(`- ${e.code}: "${e.title}" — ${e.daysOverdue} días de atraso`)
    })
  }
  if (data.expedientesActive > 0) {
    contextLines.push(`Expedientes activos total: ${data.expedientesActive}`)
  }

  // Equipo
  contextLines.push(`EQUIPO: ${data.teamToday} persona${data.teamToday !== 1 ? 's' : ''} fichada${data.teamToday !== 1 ? 's' : ''} hoy.`)

  // Avisos
  if (data.announcements > 0) {
    contextLines.push(`AVISOS: ${data.announcements} activos.`)
  }

  const systemPrompt = `Sos el asistente operativo de La Vieja Escuela, un bar/café en Tucumán, Argentina.
Generá un resumen operativo breve (3-5 oraciones) para el inicio del día del encargado o socio.
Priorizá: problemas urgentes primero, después situación general.
Tono: profesional pero cercano, directo, sin rodeos.
Usá español argentino. No uses markdown. No uses emojis. Solo texto plano.
Si hay items críticos sin proveedor, mencionalo como urgente.
Si no hay problemas, decilo brevemente y mencioná lo positivo.`

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
        max_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Datos operativos de hoy:\n\n${contextLines.join('\n')}` },
        ],
      }),
    })

    if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
    const json = await res.json()
    const text = json.choices?.[0]?.message?.content?.trim()
    if (!text) throw new Error('Empty response')
    return { text, model: json.model ?? 'anthropic/claude-sonnet-4' }
  } catch {
    return { text: buildFallbackBriefing(data), model: null }
  }
}

// ---------------------------------------------------------------------------
// Fallback — rule-based briefing when AI is unavailable
// ---------------------------------------------------------------------------

function buildFallbackBriefing(data: BriefingData): string {
  const parts: string[] = []

  if (data.stockCritical.length > 0) {
    parts.push(`${data.stockCritical.length} items de stock en estado crítico.`)
    if (data.stockNoSupplier > 0) {
      parts.push(`${data.stockNoSupplier} de ellos sin proveedor asignado — requiere atención inmediata.`)
    }
  }

  const totalOrders = data.pendingOrders.kitchen + data.pendingOrders.bar
  if (totalOrders > 0) {
    parts.push(`Hay ${totalOrders} pedido${totalOrders > 1 ? 's' : ''} pendiente${totalOrders > 1 ? 's' : ''} por gestionar.`)
  }

  if (data.expedientesOverdue.length > 0) {
    parts.push(`${data.expedientesOverdue.length} expediente${data.expedientesOverdue.length > 1 ? 's' : ''} vencido${data.expedientesOverdue.length > 1 ? 's' : ''}.`)
  }

  if (data.ventas) {
    parts.push(`Ventas: $${(data.ventas.total / 1000).toFixed(0)}k facturado en ${data.ventas.tickets} tickets.`)
  }

  if (parts.length === 0) {
    parts.push(`Operación estable. ${data.teamToday} persona${data.teamToday !== 1 ? 's' : ''} en turno. Sin alertas pendientes.`)
  }

  return parts.join(' ')
}
