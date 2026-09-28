// ---------------------------------------------------------------------------
// Chatbot Actions Engine
// ---------------------------------------------------------------------------
// Handles action detection, validation, and execution from chatbot messages.
// The chatbot API calls this when it detects an actionable intent.
//
// PRINCIPLES:
// - Always confirm with the user before executing
// - Always check for duplicates
// - Always match product names to real stock items
// - Always log to audit_trail
// - Never modify stock directly
// - Never send emails (only in-app notifications)
// ---------------------------------------------------------------------------

import { SupabaseClient } from '@supabase/supabase-js'
import { costRecipes } from '@/lib/recipes/recipe-cost'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionIntent =
  | 'PEDIDO_MERCADERIA'
  | 'ACTUALIZAR_STOCK'
  | 'REPORTE_PROBLEMA'
  | 'AVISO_ENCARGADO'
  | 'PRODUCCION_COMPLETA'
  | 'MISE_EN_PLACE'
  | 'CONSULTA'
  | 'NONE'

export type QueryType =
  | 'STOCK_DISPONIBILIDAD'
  | 'STOCK_DURACION'
  | 'RECETAS_RIESGO'
  | 'PRODUCCION_HOY'
  | 'PENDIENTES_LINKS'
  | 'VENTAS_HOY'
  | 'COSTO_PLATO'
  | 'BRIEFING_DIARIO'
  | 'FICHAJES_ANOMALIAS'

export type QueryData = {
  type: QueryType
  item?: string // nombre de insumo para STOCK_DISPONIBILIDAD y STOCK_DURACION
}

export type ExtractedItem = {
  rawName: string
  quantity: string
  matchedStockId?: string | number
  matchedStockName?: string
  matchConfidence: 'exact' | 'probable' | 'none'
}

type ExtractedItemWithHints = ExtractedItem & {
  _ambiguous?: boolean
  _suggestions?: string[]
}

export type ActionProposal = {
  intent: ActionIntent
  items: ExtractedItem[]
  message?: string // For reports/announcements
  urgency?: 'normal' | 'alta' | 'urgente'
  duplicateWarnings: string[]
  confirmationText: string
  readyToExecute: boolean
}

export type ActionResult = {
  success: boolean
  created: number
  details: string[]
  errors: string[]
}

export function parseStockQuantity(quantity: string): number {
  const cleaned = quantity.trim().replace(/[^\d,.-]/g, '')
  if (!cleaned) return NaN

  const hasComma = cleaned.includes(',')
  const hasDot = cleaned.includes('.')
  let normalized = cleaned

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(',')
    const lastDot = cleaned.lastIndexOf('.')
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '')
  } else if (hasComma) {
    normalized = cleaned.replace(',', '.')
  }

  return Number(normalized)
}

function describeStockSource(item: {
  fudo_ingredient_id?: string | null
  fudo_product_id?: string | null
  fudo_skip?: boolean | null
}) {
  if (item.fudo_product_id) return { label: 'Fudo producto', actionable: true }
  if (item.fudo_ingredient_id) return { label: 'Fudo insumo', actionable: true }
  if (item.fudo_skip === true) return { label: 'Local LVE', actionable: true }
  return { label: 'Sin mapeo Fudo', actionable: false }
}

export function isConfirmableProposal(proposal: ActionProposal): boolean {
  if (proposal.confirmationText.startsWith('❌')) return false

  switch (proposal.intent) {
    case 'PEDIDO_MERCADERIA':
    case 'ACTUALIZAR_STOCK':
    case 'MISE_EN_PLACE':
      return proposal.items.length > 0
    case 'PRODUCCION_COMPLETA':
      return Boolean(proposal.message) && proposal.confirmationText.startsWith('🔪')
    case 'REPORTE_PROBLEMA':
    case 'AVISO_ENCARGADO':
      return Boolean(proposal.message?.trim())
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// 0. Execute Query — runs read-only queries for QUERY_JSON blocks
// ---------------------------------------------------------------------------

// Which roles can access each query type
const QUERY_PERMISSIONS: Record<string, string[]> = {
  STOCK_DISPONIBILIDAD: ['socio', 'encargado', 'chef', 'cocina', 'barista'],
  STOCK_DURACION: ['socio', 'encargado', 'chef', 'cocina'],
  RECETAS_RIESGO: ['socio', 'encargado', 'chef', 'cocina'],
  PRODUCCION_HOY: ['socio', 'encargado', 'chef', 'cocina'],
  PENDIENTES_LINKS: ['socio', 'encargado'],
  VENTAS_HOY: ['socio', 'encargado'],
  COSTO_PLATO: ['socio', 'encargado', 'chef'],
  BRIEFING_DIARIO: ['socio', 'encargado'],
  FICHAJES_ANOMALIAS: ['socio', 'encargado'],
}

export async function executeQuery(
  admin: SupabaseClient,
  queryData: QueryData,
  userRole?: string,
): Promise<string> {
  // Role-based access control for queries
  if (userRole && queryData.type) {
    const allowed = QUERY_PERMISSIONS[queryData.type]
    if (allowed && !allowed.includes(userRole)) {
      return 'No tenés acceso a esta información. Consultá con tu encargado.'
    }
  }
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

  try {
    if (queryData.type === 'STOCK_DISPONIBILIDAD') {
      const itemName = queryData.item ?? ''
      const { data: items } = await admin
        .from('stock_items')
        .select('name, current_qty, min_qty, unit')
        .eq('is_active', true)

      if (!items?.length) return 'No hay items de stock registrados.'

      const n = norm(itemName)

      // Strict matching: exact → unique contains → ambiguous → not found
      let match = items.find((i) => norm(i.name) === n)
      if (!match) {
        const candidates = items.filter((i) => norm(i.name).includes(n) || n.includes(norm(i.name)))
        if (candidates.length === 1) {
          match = candidates[0]
        } else if (candidates.length > 1) {
          const options = candidates.slice(0, 6).map(c => `• **${c.name}**: ${c.current_qty} ${c.unit}`).join('\n')
          return `"${itemName}" coincide con varios items:\n${options}\n\n¿Cuál necesitás? Decime el nombre exacto.`
        }
      }

      if (!match) {
        const mainWord = n.split(/\s+/).filter(w => w.length > 2)[0]
        const suggestions = mainWord
          ? items.filter(i => norm(i.name).includes(mainWord)).slice(0, 5).map(i => i.name)
          : []
        const suggestStr = suggestions.length > 0 ? ` ¿Quisiste decir: ${suggestions.join(', ')}?` : ' Verificá el nombre en la app.'
        return `No encontré "${itemName}" en el stock.${suggestStr}`
      }

      const semaphore =
        match.current_qty <= 0 || match.current_qty <= match.min_qty
          ? '🔴'
          : match.current_qty <= match.min_qty * 1.5
          ? '🟡'
          : '🟢'
      return `${semaphore} **${match.name}**: ${match.current_qty} ${match.unit} (mínimo: ${match.min_qty} ${match.unit})`
    }

    if (queryData.type === 'STOCK_DURACION') {
      const itemName = queryData.item ?? ''
      const { data: items } = await admin
        .from('stock_items')
        .select('id, name, current_qty, min_qty, unit')
        .eq('is_active', true)

      if (!items?.length) return 'No hay items de stock registrados.'

      const n = norm(itemName)

      // Strict matching: exact → unique contains → ambiguous → not found
      let match = items.find((i) => norm(i.name) === n)
      if (!match) {
        const candidates = items.filter((i) => norm(i.name).includes(n) || n.includes(norm(i.name)))
        if (candidates.length === 1) {
          match = candidates[0]
        } else if (candidates.length > 1) {
          const options = candidates.slice(0, 6).map(c => `• **${c.name}**`).join('\n')
          return `"${itemName}" coincide con varios items:\n${options}\n\n¿De cuál querés saber la duración? Decime el nombre exacto.`
        }
      }
      if (!match) {
        const mainWord = n.split(/\s+/).filter(w => w.length > 2)[0]
        const suggestions = mainWord
          ? items.filter(i => norm(i.name).includes(mainWord)).slice(0, 5).map(i => i.name)
          : []
        const suggestStr = suggestions.length > 0 ? ` ¿Quisiste decir: ${suggestions.join(', ')}?` : ''
        return `No encontré "${itemName}" en el stock.${suggestStr}`
      }

      // Estimate daily usage from production outputs over last 30 days
      const since = new Date()
      since.setDate(since.getDate() - 30)

      const { data: inputs } = await admin
        .from('production_inputs')
        .select('qty_used, production_orders!inner(created_at, status)')
        .eq('stock_item_id', match.id)
        .eq('production_orders.status', 'completed')
        .gte('production_orders.created_at', since.toISOString())

      const totalUsed = (inputs ?? []).reduce((acc, i) => acc + (i.qty_used ?? 0), 0)
      const dailyAvg = totalUsed / 30

      if (dailyAvg < 0.01) {
        return `📦 **${match.name}**: ${match.current_qty} ${match.unit} en stock. Sin producción reciente registrada — no puedo estimar duración.`
      }

      const daysLeft = Math.floor(match.current_qty / dailyAvg)
      const semaphore = daysLeft <= 2 ? '🔴' : daysLeft <= 5 ? '🟡' : '🟢'
      return `${semaphore} **${match.name}**: ${match.current_qty} ${match.unit} en stock. Uso diario promedio: ${dailyAvg.toFixed(2)} ${match.unit}/día. Estimado: **${daysLeft} días**.`
    }

    if (queryData.type === 'RECETAS_RIESGO') {
      // Find stock items in red
      const { data: stockItems } = await admin
        .from('stock_items')
        .select('id, name, current_qty, min_qty')
        .eq('is_active', true)

      const redIds = new Set(
        (stockItems ?? [])
          .filter((i) => i.current_qty <= i.min_qty)
          .map((i) => String(i.id))
      )
      if (redIds.size === 0) return '🟢 No hay recetas en riesgo — todos los insumos están en nivel normal o superior.'

      // Check recipe_ingredients table for affected recipes
      const { data: affected } = await admin
        .from('recipe_ingredients')
        .select('recipes(name), stock_item_id')
        .in('stock_item_id', [...redIds])

      if (!affected?.length) return '🟢 No hay recetas vinculadas a insumos en riesgo.'

      const recipeNames = [...new Set((affected as Array<{ recipes?: { name?: string } | null }>).map((r) => r.recipes?.name).filter(Boolean))]
      if (!recipeNames.length) return '🟢 No hay recetas en riesgo.'

      return `⚠️ **Recetas en riesgo** (${recipeNames.length}):\n${recipeNames.map((n) => `- ${n}`).join('\n')}`
    }

    if (queryData.type === 'PRODUCCION_HOY') {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const { data: orders } = await admin
        .from('production_orders')
        .select('name, status, chef_id, profiles!production_orders_chef_id_fkey(first_name)')
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false })

      if (!orders?.length) return 'No hay producciones registradas hoy.'

      const completed = orders.filter((o) => o.status === 'completed')
      const pending = orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled')

      const lines = orders.map((o) => {
        const chef = (o.profiles as { first_name?: string } | null)?.first_name ?? '?'
        const icon = o.status === 'completed' ? '✅' : o.status === 'in_progress' ? '🔄' : '📋'
        return `${icon} ${o.name} — ${chef} (${o.status})`
      })
      return `📦 **Producción hoy** (${orders.length} total, ${completed.length} completadas, ${pending.length} pendientes):\n${lines.join('\n')}`
    }

    if (queryData.type === 'PENDIENTES_LINKS') {
      const { count } = await admin
        .from('recipe_ingredient_pending_links')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')

      if (!count) return '✅ No hay ingredientes pendientes de vincular al stock.'
      return `🔗 Hay **${count} ingrediente${count !== 1 ? 's' : ''}** pendiente${count !== 1 ? 's' : ''} de vincular al stock. Entrá en **Admin → Recetas → Pending** para revisarlos.`
    }

    // ── VENTAS_HOY — resumen de ventas del día desde Fudo ──
    if (queryData.type === 'VENTAS_HOY') {
      try {
        const { fudo } = await import('@/lib/fudoClient')
        const today = new Date().toISOString().split('T')[0]
        const sales = await fudo.getSales({ from: today })

        if (!sales.length) return '📊 Sin ventas registradas hoy en Fudo.'

        const closed = sales.filter(s => s.saleState === 'CLOSED')
        const inCourse = sales.filter(s => s.saleState === 'IN-COURSE')
        const totalClosed = closed.reduce((s, v) => s + (v.total ?? 0), 0)
        const totalInCourse = inCourse.reduce((s, v) => s + (v.total ?? 0), 0)

        // Get items to find top products
        const productCounts: Record<string, number> = {}
        for (const sale of closed.slice(0, 50)) {
          try {
            const items = await fudo.getSaleItems(sale.id)
            for (const item of items) {
              const name = item.name ?? 'Desconocido'
              productCounts[name] = (productCounts[name] ?? 0) + (item.quantity ?? 1)
            }
          } catch { /* skip */ }
        }

        const topProducts = Object.entries(productCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, qty], i) => `${i + 1}. ${name} (${qty})`)

        let result = `📊 **Ventas hoy**\n`
        result += `- 💰 Cerradas: **$${totalClosed.toLocaleString('es-AR')}** (${closed.length} tickets)\n`
        if (inCourse.length > 0) {
          result += `- 🔄 En curso: **$${totalInCourse.toLocaleString('es-AR')}** (${inCourse.length} mesas)\n`
        }
        result += `- 📝 Total: **$${(totalClosed + totalInCourse).toLocaleString('es-AR')}**`

        if (topProducts.length > 0) {
          result += `\n\n🏆 **Más vendidos:**\n${topProducts.join('\n')}`
        }

        return result
      } catch (err) {
        return `No pude obtener las ventas de Fudo: ${err instanceof Error ? err.message : 'Error'}`
      }
    }

    // ── COSTO_PLATO — costo de producción por receta ──
    if (queryData.type === 'COSTO_PLATO') {
      const recipeName = queryData.item ?? ''

      const { data: recipes } = await admin
        .from('recipes')
        .select('id, name')
        .eq('is_active', true)

      if (!recipes?.length) return 'No hay recetas cargadas en el sistema.'

      // Strict matching: exact → unique contains → ambiguous → not found
      const n = norm(recipeName)
      let match = recipes.find(r => norm(r.name) === n)
      if (!match) {
        const candidates = recipes.filter(r => norm(r.name).includes(n) || n.includes(norm(r.name)))
        if (candidates.length === 1) {
          match = candidates[0]
        } else if (candidates.length > 1) {
          const options = candidates.slice(0, 6).map(c => `• **${c.name}**`).join('\n')
          return `"${recipeName}" coincide con varias recetas:\n${options}\n\n¿De cuál querés saber el costo? Decime el nombre exacto.`
        }
      }

      if (!match) {
        const list = recipes.map(r => `- ${r.name}`).join('\n')
        return `No encontré "${recipeName}". Recetas disponibles:\n${list}`
      }

      // Costo vía costRecipes: canonicaliza unidades (g→kg, ml→l), expande
      // intermedios nivel-2 y aplica el gating de costo confiable. El cálculo
      // manual anterior multiplicaba 200 g × $/kg sin convertir: disparate.
      const rc = (await costRecipes(admin, [match.id])).get(match.id)

      if (!rc || rc.ingredients === 0) {
        return `📋 **${match.name}** no tiene ingredientes vinculados al stock todavía.`
      }

      if (!rc.confiable || rc.cost <= 0) {
        const faltan = rc.missingNames.length > 0
          ? rc.missingNames.join(', ')
          : 'sus ingredientes'
        return `📋 **${match.name}**: sin costo real todavía — faltan precios reales de ${faltan}. El costo aparece cuando esos insumos tengan precio de compra, carga manual o costo de producción.`
      }

      const totalCost = rc.cost

      // Get sale price from menu_items
      const { data: menuItem } = await admin
        .from('menu_items')
        .select('sale_price')
        .eq('recipe_id', match.id)
        .limit(1)
        .maybeSingle()

      const salePrice = menuItem?.sale_price ?? 0
      const margin = salePrice > 0 ? ((salePrice - totalCost) / salePrice * 100).toFixed(0) : null

      let result = `💰 **Costo: ${match.name}**\n`
      result += `📦 **Costo por porción: $${totalCost.toFixed(0)}** (${rc.ingredients} ingredientes, precios reales)`
      if (salePrice > 0) {
        result += `\n🏷️ Precio de venta: $${salePrice.toFixed(0)}`
        result += `\n📈 Margen: **${margin}%** ($${(salePrice - totalCost).toFixed(0)} de ganancia)`
      }

      return result
    }

    // ── BRIEFING_DIARIO — resumen ejecutivo del día ──
    if (queryData.type === 'BRIEFING_DIARIO') {
      const todayDate = new Date().toISOString().split('T')[0]
      const lines: string[] = ['📋 **Briefing del día**\n']

      // Stock alerts
      const { data: stockItems } = await admin
        .from('stock_items')
        .select('name, current_qty, min_qty')
        .eq('is_active', true)

      const critical = (stockItems ?? []).filter(i => i.current_qty <= 0)
      const low = (stockItems ?? []).filter(i => i.current_qty > 0 && i.current_qty <= i.min_qty)

      if (critical.length > 0) {
        lines.push(`🔴 **${critical.length} insumos agotados:** ${critical.slice(0, 5).map(i => i.name).join(', ')}${critical.length > 5 ? ` (+${critical.length - 5} más)` : ''}`)
      }
      if (low.length > 0) {
        lines.push(`🟡 **${low.length} insumos bajos:** ${low.slice(0, 5).map(i => i.name).join(', ')}${low.length > 5 ? ` (+${low.length - 5} más)` : ''}`)
      }
      if (critical.length === 0 && low.length === 0) {
        lines.push('🟢 Stock: todo en niveles normales')
      }

      // Pending orders
      const { data: pendingOrders } = await admin
        .from('kitchen_orders')
        .select('id')
        .eq('status', 'pending')

      if ((pendingOrders ?? []).length > 0) {
        lines.push(`📦 **${pendingOrders!.length} pedidos pendientes** de mercadería`)
      }

      // Attendance
      const { data: clockedIn } = await admin
        .from('clock_events')
        .select('employee_id, profiles!clock_events_employee_id_fkey(first_name)')
        .eq('event_type', 'clock_in')
        .gte('timestamp', todayDate)

      const presentCount = new Set((clockedIn ?? []).map(c => c.employee_id)).size
      lines.push(`👥 **${presentCount} personas** ficharon hoy`)

      // Open anomalies
      const { count: anomalyCount } = await admin
        .from('attendance_anomalies')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')

      if (anomalyCount && anomalyCount > 0) {
        lines.push(`⚠️ **${anomalyCount} anomalías** de fichaje pendientes`)
      }

      // Active announcements
      const { data: urgentAnnouncements } = await admin
        .from('announcements')
        .select('title')
        .in('priority', ['alta', 'critica'])
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .limit(3)

      if ((urgentAnnouncements ?? []).length > 0) {
        lines.push(`🚨 **Avisos urgentes:** ${urgentAnnouncements!.map(a => a.title).join(', ')}`)
      }

      // Pending recipe links
      const { count: pendingLinks } = await admin
        .from('recipe_ingredient_pending_links')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')

      if (pendingLinks && pendingLinks > 0) {
        lines.push(`🔗 **${pendingLinks} ingredientes** pendientes de vincular al stock`)
      }

      return lines.join('\n')
    }

    // ── FICHAJES_ANOMALIAS — anomalías de fichaje recientes ──
    if (queryData.type === 'FICHAJES_ANOMALIAS') {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      // Open anomalies
      const { data: anomalies } = await admin
        .from('attendance_anomalies')
        .select('anomaly_type, severity, status, created_at, employee_id, profiles!attendance_anomalies_employee_id_fkey(first_name, last_name)')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(15)

      // Suspicious logs
      const { data: suspicious } = await admin
        .from('attendance_logs')
        .select('operative_date, suspicious_reasons, profiles!attendance_logs_user_id_fkey(first_name)')
        .eq('is_suspicious', true)
        .gte('operative_date', sevenDaysAgo.toISOString().split('T')[0])
        .order('operative_date', { ascending: false })
        .limit(10)

      const anomRows = anomalies ?? []
      const suspRows = suspicious ?? []

      if (anomRows.length === 0 && suspRows.length === 0) {
        return '✅ Sin anomalías ni fichajes sospechosos en los últimos 7 días.'
      }

      const lines: string[] = ['🔍 **Anomalías de fichaje (últimos 7 días)**\n']

      if (anomRows.length > 0) {
        const openCount = anomRows.filter(a => a.status === 'open').length
        lines.push(`📊 ${anomRows.length} anomalías (${openCount} abiertas)\n`)

        for (const a of anomRows.slice(0, 8)) {
          const anomaly = a as typeof a & { profiles?: { first_name?: string } | null }
          const name = anomaly.profiles?.first_name ?? '?'
          const tipo =
            a.anomaly_type === 'gps_out_of_range' ? '📍 GPS fuera de rango' :
            a.anomaly_type === 'wifi_mismatch' ? '📶 WiFi no reconocida' :
            a.anomaly_type === 'unknown_device' ? '📱 Dispositivo no registrado' :
            a.anomaly_type === 'rapid_succession' ? '⚡ Fichaje muy rápido' :
            a.anomaly_type === 'unusual_hour' ? '🕐 Horario inusual' :
            `❓ ${a.anomaly_type}`
          const severity = a.severity === 'high' ? '🔴' : a.severity === 'medium' ? '🟡' : '⚪'
          const date = new Date(a.created_at).toLocaleDateString('es-AR')
          lines.push(`${severity} ${name}: ${tipo} (${date}) — ${a.status}`)
        }
      }

      if (suspRows.length > 0) {
        lines.push(`\n⚠️ **Fichajes sospechosos:** ${suspRows.length}`)
        for (const s of suspRows.slice(0, 5)) {
          const suspicious = s as typeof s & { profiles?: { first_name?: string } | null }
          const name = suspicious.profiles?.first_name ?? '?'
          const reasons = ((s.suspicious_reasons as string[]) ?? []).map(r => r.split(':')[0]).join(', ')
          lines.push(`- ${name} (${s.operative_date}): ${reasons}`)
        }
      }

      lines.push('\nVer detalle completo en **Admin → Reportes → Sospechosos**')
      return lines.join('\n')
    }

  } catch (err) {
    console.error('[executeQuery]', err)
    return 'No pude obtener esa información en este momento.'
  }

  return 'Tipo de consulta no reconocido.'
}

// ---------------------------------------------------------------------------
// 1. Detect Intent — called by the chatbot with the AI's structured response
// ---------------------------------------------------------------------------

export function detectIntent(aiAnalysis: {
  intent: string
  items?: { name: string; quantity: string }[]
  message?: string
  urgency?: string
}): ActionIntent {
  const intent = (aiAnalysis.intent || '').toUpperCase().replace(/\s+/g, '_')

  if (
    intent.includes('ACTUALIZAR')
    || intent.includes('CARGAR')
    || intent.includes('SOBREESCRIBIR')
    || intent.includes('PONER')
    || intent.includes('CONTAR')
    || intent.includes('UPDATE_STOCK')
    || intent.includes('STOCK_UPDATE')
  ) {
    return 'ACTUALIZAR_STOCK'
  }
  if (intent.includes('PEDIDO') || intent.includes('ORDER') || intent.includes('NECESITO') || intent.includes('FALTA')) {
    return 'PEDIDO_MERCADERIA'
  }
  if (intent.includes('PRODUCCION') || intent.includes('DESPIECE') || intent.includes('PRODUCCION_COMPLETA')) {
    return 'PRODUCCION_COMPLETA'
  }
  if (intent.includes('MISE') || intent.includes('MISE_EN_PLACE') || intent.includes('PREPARACION_LISTA')) {
    return 'MISE_EN_PLACE'
  }
  if (intent.includes('REPORT') || intent.includes('PROBLEMA') || intent.includes('ROTO') || intent.includes('ROMPIÓ')) {
    return 'REPORTE_PROBLEMA'
  }
  if (intent.includes('AVISO') || intent.includes('AVISALE') || intent.includes('DECILE') || intent.includes('COMUNIC')) {
    return 'AVISO_ENCARGADO'
  }
  if (intent.includes('CONSULT') || intent.includes('CUANTO') || intent.includes('QUE_HAY')) {
    return 'CONSULTA'
  }
  return 'NONE'
}

// ---------------------------------------------------------------------------
// 2. Match Items — find stock items that match the user's names
// ---------------------------------------------------------------------------

export async function matchItems(
  admin: SupabaseClient,
  rawItems: { name: string; quantity: string }[],
  source: 'cocina' | 'barra',
): Promise<ExtractedItem[]> {
  // Fetch the appropriate stock table
  let stockItems: { id: string | number; name: string }[]

  if (source === 'barra') {
    const { data } = await admin
      .from('bar_stock_items')
      .select('id, name')
      .eq('is_active', true)
    stockItems = (data ?? []) as { id: number; name: string }[]
  } else {
    const { data } = await admin
      .from('stock_items')
      .select('id, name')
      .eq('is_active', true)
    stockItems = (data ?? []) as { id: string; name: string }[]
  }

  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

  const stockByNorm = new Map(stockItems.map(si => [norm(si.name), si]))

  return rawItems.map(raw => {
    const n = norm(raw.name)

    // 1. Exact match — safest
    if (stockByNorm.has(n)) {
      const match = stockByNorm.get(n)!
      return {
        rawName: raw.name,
        quantity: raw.quantity,
        matchedStockId: match.id,
        matchedStockName: match.name,
        matchConfidence: 'exact' as const,
      }
    }

    // 2. Contains match — check for ambiguity (multiple matches = reject)
    const containsMatches: { key: string; si: typeof stockItems[0] }[] = []
    for (const [key, si] of stockByNorm) {
      if (key.includes(n) || n.includes(key)) {
        containsMatches.push({ key, si })
      }
    }

    if (containsMatches.length === 1) {
      const { si } = containsMatches[0]
      return {
        rawName: raw.name,
        quantity: raw.quantity,
        matchedStockId: si.id,
        matchedStockName: si.name,
        matchConfidence: 'probable' as const,
      }
    }

    if (containsMatches.length > 1) {
      // Ambiguous — multiple items match, return as 'none' with suggestions
      const suggestions = containsMatches.slice(0, 5).map(m => m.si.name)
      return {
        rawName: raw.name,
        quantity: raw.quantity,
        matchConfidence: 'none' as const,
        _ambiguous: true,
        _suggestions: suggestions,
      } as ExtractedItem & { _ambiguous?: boolean; _suggestions?: string[] }
    }

    // 3. First significant word match — also check ambiguity
    const mainWord = n.split(/\s+/).filter(w => w.length > 3)[0]
    if (mainWord) {
      const wordMatches: typeof stockItems[0][] = []
      for (const [key, si] of stockByNorm) {
        if (key.startsWith(mainWord) || mainWord.startsWith(key.split(/\s+/)[0])) {
          wordMatches.push(si)
        }
      }
      if (wordMatches.length === 1) {
        return {
          rawName: raw.name,
          quantity: raw.quantity,
          matchedStockId: wordMatches[0].id,
          matchedStockName: wordMatches[0].name,
          matchConfidence: 'probable' as const,
        }
      }
      if (wordMatches.length > 1) {
        return {
          rawName: raw.name,
          quantity: raw.quantity,
          matchConfidence: 'none' as const,
          _ambiguous: true,
          _suggestions: wordMatches.slice(0, 5).map(m => m.name),
        } as ExtractedItem & { _ambiguous?: boolean; _suggestions?: string[] }
      }
    }

    // No match
    return {
      rawName: raw.name,
      quantity: raw.quantity,
      matchConfidence: 'none' as const,
    }
  })
}

// ---------------------------------------------------------------------------
// 3. Check Duplicates — verify no pending orders exist for these items
// ---------------------------------------------------------------------------

export async function checkDuplicates(
  admin: SupabaseClient,
  items: ExtractedItem[],
  source: 'cocina' | 'barra',
): Promise<string[]> {
  const warnings: string[] = []
  const table = source === 'barra' ? 'bar_orders' : 'kitchen_orders'

  const { data: pendingOrders } = await admin
    .from(table)
    .select('product_name, quantity, status')
    .in('status', ['pending', 'ordered'])

  if (!pendingOrders?.length) return warnings

  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

  for (const item of items) {
    const itemNorm = norm(item.matchedStockName ?? item.rawName)
    const existingOrder = pendingOrders.find(o => {
      const orderNorm = norm(o.product_name)
      return orderNorm === itemNorm || orderNorm.includes(itemNorm) || itemNorm.includes(orderNorm)
    })
    if (existingOrder) {
      warnings.push(
        `Ya hay un pedido pendiente de "${existingOrder.product_name}" (${existingOrder.quantity}, estado: ${existingOrder.status})`
      )
    }
  }

  return warnings
}

// ---------------------------------------------------------------------------
// 3b. Permission Check — validate role can perform action
// ---------------------------------------------------------------------------

const ACTION_PERMISSIONS: Record<ActionIntent, string[]> = {
  PEDIDO_MERCADERIA: ['socio', 'encargado', 'chef', 'cocina', 'barista'], // All operational roles
  ACTUALIZAR_STOCK: ['socio', 'encargado', 'chef', 'cocina', 'barista'], // Who can count/update stock
  REPORTE_PROBLEMA: ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha'], // Everyone can report
  AVISO_ENCARGADO: ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha'], // Everyone can notify
  PRODUCCION_COMPLETA: ['socio', 'encargado', 'chef', 'cocina'], // Only kitchen roles can register production
  MISE_EN_PLACE: ['socio', 'encargado', 'chef', 'cocina'], // Kitchen roles can update mise en place
  CONSULTA: ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha'], // Everyone can ask
  NONE: [],
}

// What stock source each role accesses
const ROLE_STOCK_SOURCE: Record<string, 'cocina' | 'barra'> = {
  barista: 'barra',
  chef: 'cocina',
  cocina: 'cocina',
  encargado: 'cocina', // Encargado sees general stock (cocina table)
  socio: 'cocina',
}

export function checkPermission(intent: ActionIntent, role: string): { allowed: boolean; reason?: string } {
  const allowed = ACTION_PERMISSIONS[intent]
  if (!allowed || allowed.length === 0) return { allowed: false, reason: 'Acción no reconocida' }
  if (!allowed.includes(role)) {
    return {
      allowed: false,
      reason: `Los ${role}s no pueden realizar esta acción. Consultá con tu encargado.`,
    }
  }
  return { allowed: true }
}

export function getStockSource(role: string): 'cocina' | 'barra' {
  return ROLE_STOCK_SOURCE[role] ?? 'cocina'
}

// ---------------------------------------------------------------------------
// 4. Build Proposal — create the confirmation message
// ---------------------------------------------------------------------------

export async function buildProposal(
  admin: SupabaseClient,
  intent: ActionIntent,
  rawItems: { name: string; quantity: string }[],
  message: string | undefined,
  urgency: string | undefined,
  userRole: string,
): Promise<ActionProposal> {
  // Check permissions
  const perm = checkPermission(intent, userRole)
  if (!perm.allowed) {
    return {
      intent,
      items: [],
      duplicateWarnings: [],
      confirmationText: `❌ ${perm.reason}`,
      readyToExecute: false,
    }
  }

  const source = getStockSource(userRole)

  if (intent === 'PEDIDO_MERCADERIA') {
    const matched = await matchItems(admin, rawItems, source)

    // Check for ambiguous matches — ask user to clarify instead of guessing
    const ambiguous = matched.filter((i): i is ExtractedItemWithHints => Boolean((i as ExtractedItemWithHints)._ambiguous))
    if (ambiguous.length > 0) {
      const ambigLines = ambiguous.map(i => {
        const suggestions = i._suggestions ?? []
        return `• "${i.rawName}" podría ser: ${suggestions.map(s => `**${s}**`).join(', ')}`
      })
      return {
        intent,
        items: [],
        duplicateWarnings: [],
        confirmationText: `⚠️ **Nombres ambiguos — necesito que aclares:**\n${ambigLines.join('\n')}\n\nDecime el nombre exacto de cada producto para continuar.`,
        readyToExecute: false,
      }
    }

    const duplicates = await checkDuplicates(admin, matched, source)

    const itemLines = matched.map(i => {
      const name = i.matchedStockName ?? i.rawName
      const confidence = i.matchConfidence === 'exact' ? '' :
        i.matchConfidence === 'probable' ? ' (coincidencia probable)' : ' ⚠️ no encontrado en stock'
      return `• **${name}** — ${i.quantity}${confidence}`
    })

    let confirmText = `📋 **Pedido para el encargado:**\n${itemLines.join('\n')}`
    if (duplicates.length > 0) {
      confirmText += `\n\n⚠️ **Atención:**\n${duplicates.map(d => `• ${d}`).join('\n')}`
      confirmText += `\n\n¿Querés enviarlo igual o modificar algo?`
    } else {
      confirmText += `\n\n¿Lo envío al encargado?`
    }

    return {
      intent,
      items: matched,
      urgency: (urgency as 'normal' | 'alta' | 'urgente') ?? 'normal',
      duplicateWarnings: duplicates,
      confirmationText: confirmText,
      readyToExecute: false, // Needs user confirmation
    }
  }

  if (intent === 'ACTUALIZAR_STOCK') {
    const source: 'cocina' | 'barra' = userRole === 'barista' ? 'barra' : 'cocina'
    const matched = await matchItems(admin, rawItems, source)

    // ── AMBIGUITY CHECK — ask user to clarify before proceeding ──
    const ambiguous = matched.filter((i): i is ExtractedItemWithHints => Boolean((i as ExtractedItemWithHints)._ambiguous))
    if (ambiguous.length > 0) {
      const ambigLines = ambiguous.map(i => {
        const suggestions = i._suggestions ?? []
        return `• "${i.rawName}" podría ser: ${suggestions.map(s => `**${s}**`).join(', ')}`
      })
      return {
        intent,
        items: [],
        duplicateWarnings: [],
        confirmationText: `⚠️ **Nombres ambiguos — necesito que aclares:**\n${ambigLines.join('\n')}\n\nDecime el nombre exacto de cada producto para continuar.`,
        readyToExecute: false,
      }
    }

    // ── STRICT VALIDATION ──
    // 1. Reject ALL unmatched items — don't allow blind writes
    const unmatched = matched.filter(i => i.matchConfidence === 'none')
    if (unmatched.length > 0 && unmatched.length === matched.length) {
      // Try to provide suggestions from the stock list
      const { data: allStock } = await admin.from(source === 'barra' ? 'bar_stock_items' : 'stock_items')
        .select('name').eq('is_active', true)
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      const unmatchedLines = unmatched.map(i => {
        const n = norm(i.rawName)
        const mainWord = n.split(/\s+/).filter(w => w.length > 2)[0]
        const similar = (allStock ?? [])
          .filter(si => mainWord && norm(si.name).includes(mainWord))
          .slice(0, 3)
          .map(si => si.name)
        const suggestStr = similar.length > 0 ? ` → ¿Quisiste decir: ${similar.join(', ')}?` : ''
        return `• "${i.rawName}"${suggestStr}`
      })
      return {
        intent,
        items: [],
        duplicateWarnings: [],
        confirmationText: `❌ No encontré estos items en el stock:\n${unmatchedLines.join('\n')}\n\nUsá los nombres exactos como aparecen en la app. Podés preguntar "¿qué hay en stock?" para ver la lista completa.`,
        readyToExecute: false,
      }
    }

    // 2. Filter out unmatched items (only process those we can identify)
    const validItems = matched.filter(i => i.matchConfidence !== 'none')
    const rejectedNames = unmatched.map(i => `"${i.rawName}"`).join(', ')

    // 3. Validate quantities — no negatives, no absurd values, must be numeric
    const qtyErrors: string[] = []
    for (const item of validItems) {
      const qty = parseStockQuantity(item.quantity)
      if (isNaN(qty)) {
        qtyErrors.push(`${item.matchedStockName ?? item.rawName}: cantidad "${item.quantity}" no es un número válido`)
      } else if (qty < 0) {
        qtyErrors.push(`${item.matchedStockName ?? item.rawName}: no se puede cargar cantidad negativa (${qty})`)
      } else if (qty > 99999) {
        qtyErrors.push(`${item.matchedStockName ?? item.rawName}: cantidad ${qty} parece demasiado alta — verificá`)
      }
    }

    if (qtyErrors.length > 0) {
      return {
        intent,
        items: [],
        duplicateWarnings: [],
        confirmationText: `❌ **Cantidades inválidas:**\n${qtyErrors.map(e => `• ${e}`).join('\n')}\n\nCorregí y probá de nuevo.`,
        readyToExecute: false,
      }
    }

    // 4. Fetch current quantities for change preview
    const currentQtys = new Map<string | number, { qty: number; unit: string; source: string; actionable: boolean }>()
    if (source === 'barra') {
      const { data: barItems } = await admin.from('bar_stock_items').select('id, current_qty, unit').eq('is_active', true)
      for (const bi of barItems ?? []) currentQtys.set(bi.id, {
        qty: bi.current_qty,
        unit: bi.unit ?? '',
        source: 'Barra LVE',
        actionable: true,
      })
    } else {
      const ids = validItems.map(i => String(i.matchedStockId)).filter(Boolean)
      if (ids.length > 0) {
        const { data: siItems } = await admin
          .from('stock_items')
          .select('id, name, current_qty, unit, fudo_ingredient_id, fudo_product_id, fudo_skip')
          .in('id', ids)
        for (const si of siItems ?? []) {
          const sourceInfo = describeStockSource(si)
          currentQtys.set(si.id, {
            qty: si.current_qty,
            unit: si.unit ?? '',
            source: sourceInfo.label,
            actionable: sourceInfo.actionable,
          })
        }
      }
    }

    const mappingErrors = validItems
      .map((i) => ({ item: i, current: currentQtys.get(i.matchedStockId!) }))
      .filter(({ current }) => current && !current.actionable)
      .map(({ item }) => item.matchedStockName ?? item.rawName)

    if (mappingErrors.length > 0) {
      return {
        intent,
        items: [],
        duplicateWarnings: [],
        confirmationText: `❌ No puedo actualizar por chat hasta corregir mapeo Fudo/Local LVE:\n${mappingErrors.map((name) => `• ${name}`).join('\n')}`,
        readyToExecute: false,
      }
    }

    const itemLines = validItems.map(i => {
      const name = i.matchedStockName ?? i.rawName
      const confidence = i.matchConfidence === 'probable' ? ' ⚠️ (coincidencia probable — verificá)' : ''
      const cur = currentQtys.get(i.matchedStockId!)
      const newQty = parseStockQuantity(i.quantity)
      const changeStr = cur ? ` (actual: ${cur.qty} ${cur.unit} → ${newQty} ${cur.unit})` : ''
      const sourceTag = cur ? ` · ${cur.source}` : ''
      return `• **${name}** → ${i.quantity}${changeStr}${sourceTag}${confidence}`
    })

    let confirmText = `📦 **Sobrescribir stock actual:**\n${itemLines.join('\n')}`
    if (rejectedNames) {
      confirmText += `\n\n⚠️ Ignorados (no encontrados): ${rejectedNames}`
    }
    confirmText += source === 'barra'
      ? `\n\nEsto reemplaza la cantidad actual en stock de barra. ¿Confirmo?`
      : `\n\nEsto reemplaza la cantidad actual y exige confirmación de Fudo antes de dejar el cambio en LVE. ¿Confirmo?`

    return {
      intent,
      items: validItems, // Only valid items — unmatched are excluded
      duplicateWarnings: [],
      confirmationText: confirmText,
      readyToExecute: false,
    }
  }

  if (intent === 'PRODUCCION_COMPLETA') {
    // message carries JSON-serialized { input: { name, qty, unit }, outputs: [{ name, qty, unit }] }
    let prodData: { input?: { name: string; qty: number; unit?: string }; outputs?: { name: string; qty: number; unit?: string }[] } = {}
    try { prodData = JSON.parse(message ?? '{}') } catch {
      return {
        intent,
        items: [],
        message: message ?? '',
        duplicateWarnings: [],
        confirmationText: '❌ Los datos de producción no tienen el formato correcto. Indicá: qué procesaste, cuánto, y qué salió.',
        readyToExecute: false,
      }
    }

    const inp = prodData.input
    const outs = prodData.outputs ?? []

    // ── STRICT VALIDATION ──
    if (!inp?.name || typeof inp.name !== 'string' || !inp.name.trim()) {
      return {
        intent, items: [], message: message ?? '', duplicateWarnings: [],
        confirmationText: '❌ Falta el nombre del insumo de entrada. Indicá qué procesaste (ej: "nalga", "mozzarella").',
        readyToExecute: false,
      }
    }

    if (!inp.qty || typeof inp.qty !== 'number' || inp.qty <= 0) {
      return {
        intent, items: [], message: message ?? '', duplicateWarnings: [],
        confirmationText: `❌ La cantidad de entrada debe ser un número positivo. Recibí: "${inp.qty}".`,
        readyToExecute: false,
      }
    }

    if (inp.qty > 9999) {
      return {
        intent, items: [], message: message ?? '', duplicateWarnings: [],
        confirmationText: `❌ La cantidad de entrada (${inp.qty}) parece demasiado alta. Verificá y probá de nuevo.`,
        readyToExecute: false,
      }
    }

    if (outs.length === 0) {
      return {
        intent, items: [], message: message ?? '', duplicateWarnings: [],
        confirmationText: '❌ Falta indicar qué productos salieron de la producción. Ej: "7kg de milanesas y 2kg de bife".',
        readyToExecute: false,
      }
    }

    // Validate each output
    const outErrors: string[] = []
    for (let i = 0; i < outs.length; i++) {
      const o = outs[i]
      if (!o.name || typeof o.name !== 'string' || !o.name.trim()) {
        outErrors.push(`Salida ${i + 1}: falta nombre`)
      }
      if (!o.qty || typeof o.qty !== 'number' || o.qty <= 0) {
        outErrors.push(`${o.name ?? `Salida ${i + 1}`}: cantidad inválida (${o.qty})`)
      }
      if (o.qty > 99999) {
        outErrors.push(`${o.name}: cantidad ${o.qty} parece demasiado alta`)
      }
    }

    if (outErrors.length > 0) {
      return {
        intent, items: [], message: message ?? '', duplicateWarnings: [],
        confirmationText: `❌ **Errores en las salidas:**\n${outErrors.map(e => `• ${e}`).join('\n')}`,
        readyToExecute: false,
      }
    }

    // Validate total output doesn't exceed input (sanity)
    const totalOut = outs.reduce((acc, o) => acc + o.qty, 0)
    if (totalOut > inp.qty * 1.1) {
      return {
        intent, items: [], message: message ?? '', duplicateWarnings: [],
        confirmationText: `❌ Las salidas (${totalOut.toFixed(2)} ${inp.unit ?? 'kg'}) superan la entrada (${inp.qty} ${inp.unit ?? 'kg'}). Revisá las cantidades.`,
        readyToExecute: false,
      }
    }

    // Pre-validate input stock item exists — with ambiguity detection
    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const { data: stockCheck } = await admin.from('stock_items').select('id, name, current_qty, unit').eq('is_active', true)
    const inputNorm = norm(inp.name)

    // First try exact match
    let matchedInput = (stockCheck ?? []).find((si) => norm(si.name) === inputNorm)

    // If no exact, try contains — but check for ambiguity
    if (!matchedInput) {
      const containsMatches = (stockCheck ?? []).filter(
        (si) => norm(si.name).includes(inputNorm) || inputNorm.includes(norm(si.name))
      )
      if (containsMatches.length === 1) {
        matchedInput = containsMatches[0]
      } else if (containsMatches.length > 1) {
        // Ambiguous input — ask user to clarify
        const options = containsMatches.slice(0, 5).map(si => `**${si.name}** (${si.current_qty} ${si.unit})`).join(', ')
        return {
          intent, items: [], message: message ?? '', duplicateWarnings: [],
          confirmationText: `⚠️ "${inp.name}" coincide con varios items:\n${options}\n\n¿Cuál es? Decime el nombre exacto.`,
          readyToExecute: false,
        }
      }
    }

    if (!matchedInput) {
      const suggestions = (stockCheck ?? [])
        .filter(si => {
          const n = norm(si.name)
          const mainWord = inputNorm.split(/\s+/).filter(w => w.length > 2)[0]
          return mainWord && n.includes(mainWord)
        })
        .slice(0, 5)
        .map(si => si.name)
      const suggestStr = suggestions.length > 0
        ? `\n\n¿Quisiste decir?: ${suggestions.join(', ')}`
        : '\n\nRevisá el nombre exacto en la sección de Stock de la app.'
      return {
        intent, items: [], message: message ?? '', duplicateWarnings: [],
        confirmationText: `❌ No encontré "${inp.name}" en el stock activo.${suggestStr}`,
        readyToExecute: false,
      }
    }

    // Check current stock is sufficient for the declared input
    if (matchedInput.current_qty < inp.qty) {
      const diff = inp.qty - matchedInput.current_qty
      return {
        intent, items: [], message: message ?? '', duplicateWarnings: [],
        confirmationText: `⚠️ **${matchedInput.name}** tiene solo ${matchedInput.current_qty} ${matchedInput.unit} en stock, pero querés procesar ${inp.qty} ${inp.unit ?? 'kg'}. Faltan ${diff.toFixed(2)}.\n\n¿Querés actualizar el stock primero?`,
        readyToExecute: false,
      }
    }

    const waste = Math.max(0, inp.qty - totalOut)
    const efficiency = inp.qty > 0 ? Math.round(((inp.qty - waste) / inp.qty) * 1000) / 10 : 0

    // Check outputs match stock items — with ambiguity detection
    const outputWarnings: string[] = []
    const resolvedOutputNames: string[] = []
    for (const o of outs) {
      const outNorm = norm(o.name)
      // Exact match first
      const exactOut = (stockCheck ?? []).find(si => norm(si.name) === outNorm)
      if (exactOut) {
        resolvedOutputNames.push(exactOut.name)
        continue
      }
      // Contains match — check ambiguity
      const containsOut = (stockCheck ?? []).filter(
        si => norm(si.name).includes(outNorm) || outNorm.includes(norm(si.name))
      )
      if (containsOut.length === 1) {
        resolvedOutputNames.push(containsOut[0].name)
      } else if (containsOut.length > 1) {
        const options = containsOut.slice(0, 4).map(si => si.name).join(', ')
        outputWarnings.push(`"${o.name}" coincide con varios items (${options}) — se registra con el nombre dado, verificá`)
        resolvedOutputNames.push(o.name)
      } else {
        outputWarnings.push(`"${o.name}" no está en stock — se registra pero no actualiza stock automáticamente`)
        resolvedOutputNames.push(o.name)
      }
    }

    const inputLine = `📥 **Entrada:** ${inp.qty} ${inp.unit ?? 'kg'} de **${matchedInput.name}** (stock actual: ${matchedInput.current_qty} ${matchedInput.unit})`
    const outputLines = outs.map((o, idx) => `  • ${resolvedOutputNames[idx] ?? o.name}: ${o.qty} ${o.unit ?? 'kg'}`)
    const wasteLine = waste > 0 ? `  • Merma: ${waste.toFixed(3)} ${inp.unit ?? 'kg'}` : ''
    const effLine = `📊 **Eficiencia:** ${efficiency}%`
    const warningLines = outputWarnings.length > 0
      ? `\n\n⚠️ **Avisos:**\n${outputWarnings.map(w => `• ${w}`).join('\n')}`
      : ''

    const confirmText = `🔪 **Registrar producción:**\n${inputLine}\n📤 **Salidas:**\n${outputLines.join('\n')}${wasteLine ? '\n' + wasteLine : ''}\n${effLine}${warningLines}\n\nEsto actualiza el stock inmediatamente. ¿Confirmo?`

    return {
      intent,
      items: [],
      message: message ?? '',
      duplicateWarnings: [],
      confirmationText: confirmText,
      readyToExecute: false,
    }
  }

  if (intent === 'REPORTE_PROBLEMA') {
    return {
      intent,
      items: [],
      message: message ?? '',
      urgency: 'urgente',
      duplicateWarnings: [],
      confirmationText: `⚠️ **Reportar problema:**\n"${message}"\n\nEsto crea un aviso urgente para los encargados. ¿Confirmo?`,
      readyToExecute: false,
    }
  }

  if (intent === 'AVISO_ENCARGADO') {
    return {
      intent,
      items: [],
      message: message ?? '',
      urgency: (urgency as 'normal' | 'alta' | 'urgente') ?? 'normal',
      duplicateWarnings: [],
      confirmationText: `📢 **Aviso para encargados:**\n"${message}"\n\n¿Lo envío?`,
      readyToExecute: false,
    }
  }

  if (intent === 'MISE_EN_PLACE') {
    // Mise en place matches against mise_en_place_items, not stock — do a dedicated match
    const todayStr = new Date().toISOString().split('T')[0]
    const { data: activeShift } = await admin
      .from('kitchen_shifts')
      .select('id, shift_type')
      .eq('date', todayStr)
      .in('status', ['pending', 'in_progress'])
      .limit(1)
      .maybeSingle()

    if (!activeShift) {
      return {
        intent, items: [], duplicateWarnings: [],
        confirmationText: '❌ No hay turno de cocina activo hoy. Abrí un turno primero en la app.',
        readyToExecute: false,
      }
    }

    const { data: miseItems } = await admin
      .from('mise_en_place_items')
      .select('id, name')
      .eq('is_active', true)
      .in('shift', [activeShift.shift_type, 'both'])

    if (!miseItems?.length) {
      return {
        intent, items: [], duplicateWarnings: [],
        confirmationText: '❌ No hay items de mise en place configurados para este turno.',
        readyToExecute: false,
      }
    }

    const norm2 = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const itemLines: string[] = []
    const validItems: ExtractedItem[] = []
    const errors: string[] = []

    for (const raw of rawItems) {
      const n = norm2(raw.name)
      // Exact match
      let found = miseItems.find(m => norm2(m.name) === n)
      if (!found) {
        // Contains — check ambiguity
        const candidates = miseItems.filter(m => norm2(m.name).includes(n) || n.includes(norm2(m.name)))
        if (candidates.length === 1) {
          found = candidates[0]
        } else if (candidates.length > 1) {
          errors.push(`"${raw.name}" coincide con varios: ${candidates.map(c => `**${c.name}**`).join(', ')}. ¿Cuál es?`)
          continue
        }
      }
      if (!found) {
        const allNames = miseItems.map(m => m.name).join(', ')
        errors.push(`"${raw.name}" no está en mise en place. Items disponibles: ${allNames}`)
        continue
      }
      itemLines.push(`- ✅ ${found.name}: ${raw.quantity}`)
      validItems.push({
        rawName: raw.name,
        quantity: raw.quantity,
        matchedStockId: found.id,
        matchedStockName: found.name,
        matchConfidence: 'exact',
      })
    }

    if (errors.length > 0) {
      return {
        intent, items: [], duplicateWarnings: [],
        confirmationText: `⚠️ **Necesito que aclares:**\n${errors.map(e => `• ${e}`).join('\n')}`,
        readyToExecute: false,
      }
    }

    if (validItems.length === 0) {
      return {
        intent, items: [], duplicateWarnings: [],
        confirmationText: '❌ No pude identificar ningún item de mise en place. Revisá los nombres.',
        readyToExecute: false,
      }
    }

    return {
      intent,
      items: validItems,
      duplicateWarnings: [],
      confirmationText: `👨‍🍳 **Mise en place completado:**\n${itemLines.join('\n')}\n\n¿Marco como listo?`,
      readyToExecute: false,
    }
  }

  return {
    intent: 'NONE',
    items: [],
    duplicateWarnings: [],
    confirmationText: '',
    readyToExecute: false,
  }
}

// ---------------------------------------------------------------------------
// 5. Execute Action — actually creates records in the database
// ---------------------------------------------------------------------------

export async function executeAction(
  admin: SupabaseClient,
  proposal: ActionProposal,
  userId: string,
  userName: string,
  userRole: string,
): Promise<ActionResult> {
  const result: ActionResult = { success: true, created: 0, details: [], errors: [] }

  try {
    if (proposal.intent === 'PEDIDO_MERCADERIA') {
      const source = getStockSource(userRole)

      for (const item of proposal.items) {
        const productName = item.matchedStockName ?? item.rawName

        if (source === 'barra') {
          const { error } = await admin.from('bar_orders').insert({
            product_name: productName,
            category: 'general',
            quantity: item.quantity,
            urgency: proposal.urgency ?? 'normal',
            status: 'pending',
            bar_stock_item_id: typeof item.matchedStockId === 'number' ? item.matchedStockId : null,
            requested_by: userId,
          })
          if (error) {
            result.errors.push(`Error al pedir ${productName}: ${error.message}`)
          } else {
            result.created++
            result.details.push(`${productName} × ${item.quantity}`)
          }
        } else {
          const { error } = await admin.from('kitchen_orders').insert({
            product_name: productName,
            category: 'general',
            quantity: item.quantity,
            urgency: proposal.urgency ?? 'normal',
            status: 'pending',
            created_by: userId,
          })
          if (error) {
            result.errors.push(`Error al pedir ${productName}: ${error.message}`)
          } else {
            result.created++
            result.details.push(`${productName} × ${item.quantity}`)
          }
        }
      }

      // Create notification for encargados
      if (result.created > 0) {
        const itemList = result.details.join(', ')
        const icon = source === 'barra' ? '☕' : '🍳'
        await admin.from('announcements').insert({
          author_id: userId,
          type: 'operativo',
          priority: proposal.urgency === 'urgente' ? 'critica' : proposal.urgency === 'alta' ? 'alta' : 'media',
          title: `${icon} Pedido de ${source === 'barra' ? 'Barra' : 'Cocina'} (vía chat)`,
          body: `${userName} solicita: ${itemList}`,
          scope: 'role',
          target_role: 'encargado',
          is_active: true,
        })
      }

      // Audit trail (non-blocking)
      try {
        await admin.from('audit_trail').insert({
          user_id: userId,
          user_name: userName,
          action: 'chatbot_order',
          module: source === 'barra' ? 'barra' : 'cocina',
          entity_type: source === 'barra' ? 'bar_order' : 'kitchen_order',
          description: `${userName} creó ${result.created} pedido(s) vía chatbot: ${result.details.join(', ')}`,
          metadata: { items: proposal.items, source, channel: 'chatbot' },
        })
      } catch { /* audit is non-blocking */ }
    }

    if (proposal.intent === 'ACTUALIZAR_STOCK') {
      const source = getStockSource(userRole)
      const requestedUpdates: { item: ExtractedItem; stockItemId: string; newQty: number }[] = []
      const seenIds = new Set<string>()

      for (const item of proposal.items) {
        if (!item.matchedStockId || item.matchConfidence === 'none') {
          result.errors.push(`${item.rawName}: no encontrado en stock`)
          continue
        }

        const newQty = parseStockQuantity(item.quantity)
        const stockItemId = String(item.matchedStockId)

        if (isNaN(newQty)) {
          result.errors.push(`${item.matchedStockName ?? item.rawName}: cantidad "${item.quantity}" no es numérica`)
          continue
        }
        if (newQty < 0) {
          result.errors.push(`${item.matchedStockName ?? item.rawName}: cantidad negativa no permitida`)
          continue
        }
        if (newQty > 99999) {
          result.errors.push(`${item.matchedStockName ?? item.rawName}: cantidad ${newQty} excede el máximo`)
          continue
        }
        if (seenIds.has(stockItemId)) {
          result.errors.push(`${item.matchedStockName ?? item.rawName}: item repetido en la misma acción`)
          continue
        }
        seenIds.add(stockItemId)
        requestedUpdates.push({ item, stockItemId, newQty })
      }

      if (result.errors.length > 0 || requestedUpdates.length === 0) {
        result.success = false
        if (requestedUpdates.length === 0 && result.errors.length === 0) {
          result.errors.push('No hay items válidos para actualizar')
        }
        return result
      }

      if (source === 'barra') {
        for (const update of requestedUpdates) {
          const { error } = await admin
            .from('bar_stock_items')
            .update({ current_qty: update.newQty, updated_at: new Date().toISOString() })
            .eq('id', Number(update.stockItemId))

          if (error) {
            result.errors.push(`${update.item.matchedStockName ?? update.item.rawName}: ${error.message}`)
          } else {
            result.created++
            result.details.push(`${update.item.matchedStockName ?? update.item.rawName} → ${update.newQty} (barra)`)
          }
        }

        if (result.errors.length > 0) result.success = false
      } else {
        try {
          const [criticalIncidents, failedWrites] = await Promise.all([
            admin
              .from('fudo_sync_incidents')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'open')
              .eq('severity', 'critical'),
            admin
              .from('fudo_sync_events')
              .select('id', { count: 'exact', head: true })
              .eq('status', 'failed')
              .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
          ])

          if ((criticalIncidents.count ?? 0) > 0 || (failedWrites.count ?? 0) > 0) {
            result.success = false
            result.errors.push(`Stock bloqueado por seguridad Fudo: ${criticalIncidents.count ?? 0} incidentes críticos abiertos y ${failedWrites.count ?? 0} escrituras fallidas en 24h. Revisá Control de mercadería antes de sobrescribir por chat.`)
            return result
          }
        } catch {
          // Guardrail tables may not exist until the migration is applied.
        }

        const { fudo } = await import('@/lib/fudoClient')
        const fudoConnection = await fudo.testConnection()
        if (!fudoConnection.ok) {
          result.success = false
          result.errors.push(`Stock no actualizado: Fudo no está disponible (${fudoConnection.error})`)
          return result
        }

        const ids = requestedUpdates.map((update) => update.stockItemId)
        const { data: stockRows, error: stockErr } = await admin
          .from('stock_items')
          .select('id, name, fudo_ingredient_id, fudo_product_id, fudo_skip')
          .in('id', ids)

        if (stockErr) {
          result.success = false
          result.errors.push(`No pude validar mapeos Fudo: ${stockErr.message}`)
          return result
        }

        const rowsById = new Map((stockRows ?? []).map((row) => [String(row.id), row]))
        const mappingErrors: string[] = []
        for (const update of requestedUpdates) {
          const row = rowsById.get(update.stockItemId)
          const name = update.item.matchedStockName ?? update.item.rawName
          if (!row) {
            mappingErrors.push(`${name}: no encontré el item al ejecutar`)
            continue
          }
          const isLocalOnly = (row as Record<string, unknown>).fudo_skip === true
          if (!row.fudo_ingredient_id && !row.fudo_product_id && !isLocalOnly) {
            mappingErrors.push(`${row.name}: no está mapeado a Fudo ni marcado como local`)
          }
        }

        if (mappingErrors.length > 0) {
          result.success = false
          result.errors.push(`No actualicé nada. Corregí mapeos antes de usar el chatbot: ${mappingErrors.join('; ')}`)
          return result
        }

        const { syncFromFudo, syncToFudo } = await import('@/lib/fudo/stock-sync')
        for (const update of requestedUpdates) {
          try {
            const syncResult = await syncToFudo(admin, update.stockItemId, update.newQty, userId)

            if (syncResult.success) {
              result.created++
              const fudoTag = syncResult.fudoSynced ? ' (+ Fudo ✓)' : ' (LVE local explícito)'
              result.details.push(`${update.item.matchedStockName ?? update.item.rawName} → ${update.newQty}${fudoTag}`)
            } else {
              result.errors.push(`${update.item.matchedStockName ?? update.item.rawName}: ${syncResult.error ?? 'Error al sincronizar'}`)
              break
            }
          } catch (err) {
            result.errors.push(`${update.item.matchedStockName ?? update.item.rawName}: ${err instanceof Error ? err.message : 'Error inesperado'}`)
            break
          }
        }

        if (result.errors.length > 0) {
          await syncFromFudo(admin).catch(() => null)
          result.success = false
          result.errors.push('LVE se re-sincronizó desde Fudo cuando fue posible para evitar cantidades falsas.')
        }
      }

      // Audit (non-blocking)
      try {
        await admin.from('audit_trail').insert({
          user_id: userId,
          user_name: userName,
          action: 'chatbot_stock_update',
          module: 'stock',
          entity_type: 'stock_item',
          description: `${userName} actualizó ${result.created} item(s) de stock vía chatbot: ${result.details.join(', ')}${result.errors.length > 0 ? ` | Errores: ${result.errors.join(', ')}` : ''}`,
          metadata: { items: proposal.items, errors: result.errors, channel: 'chatbot' },
        })
      } catch { /* audit is non-blocking */ }
    }

    if (proposal.intent === 'PRODUCCION_COMPLETA') {
      let prodData: { input?: { name: string; qty: number; unit?: string }; outputs?: { name: string; qty: number; unit?: string }[] } = {}
      try { prodData = JSON.parse(proposal.message ?? '{}') } catch {
        result.success = false
        result.errors.push('Datos de producción con formato inválido')
        return result
      }

      const inp = prodData.input
      const outs = prodData.outputs ?? []

      // ── STRICT RE-VALIDATION at execution time (belt + suspenders) ──
      if (!inp?.name?.trim() || !inp.qty || typeof inp.qty !== 'number' || inp.qty <= 0) {
        result.success = false
        result.errors.push('Datos de producción incompletos o inválidos')
        return result
      }

      if (outs.length === 0) {
        result.success = false
        result.errors.push('Faltan las salidas de producción')
        return result
      }

      // Validate each output
      for (const o of outs) {
        if (!o.name?.trim() || !o.qty || typeof o.qty !== 'number' || o.qty <= 0) {
          result.success = false
          result.errors.push(`Salida "${o.name ?? '?'}" tiene datos inválidos`)
          return result
        }
      }

      // Validate total output vs input
      const totalOut = outs.reduce((acc, o) => acc + o.qty, 0)
      if (totalOut > inp.qty * 1.1) {
        result.success = false
        result.errors.push(`Las salidas (${totalOut.toFixed(2)}) superan la entrada (${inp.qty}). Operación rechazada.`)
        return result
      }

      // Match input stock item — strict: exact first, then unique contains, reject ambiguous
      const { data: stockItems } = await admin.from('stock_items').select('id, name, current_qty, unit').eq('is_active', true)
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      const inputNorm = norm(inp.name)

      let matchedInput = (stockItems ?? []).find((si) => norm(si.name) === inputNorm)
      if (!matchedInput) {
        const containsMatches = (stockItems ?? []).filter(
          (si) => norm(si.name).includes(inputNorm) || inputNorm.includes(norm(si.name))
        )
        if (containsMatches.length === 1) {
          matchedInput = containsMatches[0]
        } else if (containsMatches.length > 1) {
          result.success = false
          result.errors.push(`"${inp.name}" coincide con varios items: ${containsMatches.slice(0, 5).map(si => si.name).join(', ')}. Usá el nombre exacto.`)
          return result
        }
      }

      if (!matchedInput) {
        result.success = false
        result.errors.push(`No encontré "${inp.name}" en el stock activo. Usá el nombre exacto.`)
        return result
      }

      // Re-check stock availability at execution time (could've changed since proposal)
      if (matchedInput.current_qty < inp.qty) {
        result.success = false
        result.errors.push(`Stock insuficiente: ${matchedInput.name} tiene ${matchedInput.current_qty} ${matchedInput.unit} pero querés procesar ${inp.qty}. Actualizá el stock primero.`)
        return result
      }

      const { fudo } = await import('@/lib/fudoClient')
      const fudoConnection = await fudo.testConnection()
      if (!fudoConnection.ok) {
        result.success = false
        result.errors.push(`Producción no registrada: Fudo no está disponible (${fudoConnection.error}).`)
        return result
      }

      // Create production order
      const { data: order, error: orderErr } = await admin
        .from('production_orders')
        .insert({
          name: `Despiece ${matchedInput.name} ${inp.qty}${inp.unit ?? 'kg'} (chat)`,
          status: 'draft',
          chef_id: userId,
          notes: `Registrado vía chatbot por ${userName}`,
        })
        .select('id')
        .single()

      if (orderErr || !order) {
        result.success = false
        result.errors.push(`Error al crear la orden: ${orderErr?.message ?? 'respuesta vacía'}`)
        return result
      }

      // Add input
      const { error: inputErr } = await admin.from('production_inputs').insert({
        production_order_id: order.id,
        stock_item_id: matchedInput.id,
        qty_used: inp.qty,
        unit: inp.unit ?? 'kg',
      })

      if (inputErr) {
        // Rollback: delete the order since input failed
        await admin.from('production_orders').delete().eq('id', order.id)
        result.success = false
        result.errors.push(`Error al registrar entrada: ${inputErr.message}`)
        return result
      }

      // Add outputs (match stock items by name — strict: exact first, unique contains, reject ambiguous)
      let outputsFailed = false
      for (const out of outs) {
        const outNorm = norm(out.name)
        // Exact match first
        let matchedOut = (stockItems ?? []).find((si) => norm(si.name) === outNorm)
        if (!matchedOut) {
          // Contains match — only if unambiguous
          const outContains = (stockItems ?? []).filter(
            (si) => norm(si.name).includes(outNorm) || outNorm.includes(norm(si.name))
          )
          if (outContains.length === 1) matchedOut = outContains[0]
          // If ambiguous (>1), leave as null — won't link to stock
        }
        const { error: outErr } = await admin.from('production_outputs').insert({
          production_order_id: order.id,
          stock_item_id: matchedOut?.id ?? null,
          output_name: out.name,
          qty_produced: out.qty,
          unit: out.unit ?? 'kg',
          is_waste: false,
        })
        if (outErr) {
          result.errors.push(`Error al registrar salida "${out.name}": ${outErr.message}`)
          outputsFailed = true
        }
      }

      if (outputsFailed) {
        // Don't complete — leave as draft so it can be fixed in the UI
        result.success = false
        result.errors.push('Orden dejada como borrador por errores. Completala desde la app en Producción.')
        return result
      }

      // Complete the order (updates stock via RPC)
      const { data: completed, error: completeErr } = await admin.rpc('complete_production_order', {
        p_order_id: order.id,
        p_user_id: userId,
      })

      if (completeErr) {
        result.success = false
        result.errors.push(`Error al completar producción: ${completeErr.message}. La orden quedó como borrador.`)
        return result
      }

      const completedData = completed as { efficiency_pct?: number; movements?: { stock_item_id: string; change: number }[] }
      const efficiency = completedData?.efficiency_pct ?? 0

      // Sync affected stock items to Fudo
      const movements = completedData?.movements ?? []
      let fudoTag = ''
      if (movements.length > 0) {
        try {
          const { syncFromFudo, syncProductionToFudo } = await import('@/lib/fudo/stock-sync')
          const fudoResult = await syncProductionToFudo(admin, movements, userId)
          if (fudoResult.errors.length > 0) {
            await syncFromFudo(admin).catch(() => null)
            result.success = false
            result.errors.push(`Producción cerrada en LVE, pero Fudo no confirmó el stock: ${fudoResult.errors.join('; ')}. Re-sincronicé LVE desde Fudo cuando fue posible; revisá la orden ${order.id}.`)
            return result
          }
          fudoTag = fudoResult.encolados.length > 0
            ? ` (Fudo ✓ ${fudoResult.synced} items; ${fudoResult.encolados.length} pendientes, se reintentan solos)`
            : fudoResult.synced > 0 ? ` (Fudo ✓ ${fudoResult.synced} items)` : ' (Fudo: sin items vinculados)'
        } catch (err) {
          const { syncFromFudo } = await import('@/lib/fudo/stock-sync')
          await syncFromFudo(admin).catch(() => null)
          result.success = false
          result.errors.push(`Producción cerrada en LVE, pero falló la sincronización con Fudo: ${err instanceof Error ? err.message : 'error de sync'}. Re-sincronicé LVE desde Fudo cuando fue posible; revisá la orden ${order.id}.`)
          return result
        }
      }

      result.created = 1
      result.details.push(`Producción completada — ${inp.qty}${inp.unit ?? 'kg'} de ${matchedInput.name} → ${outs.length} productos, ${efficiency}% eficiencia${fudoTag}`)

      try {
        await admin.from('audit_trail').insert({
          user_id: userId,
          user_name: userName,
          action: 'chatbot_produccion',
          module: 'cocina',
          entity_type: 'production_order',
          description: `${userName} registró producción vía chatbot: ${inp.qty}${inp.unit ?? 'kg'} de ${matchedInput.name}`,
          metadata: { order_id: order.id, input: inp, outputs: outs, efficiency, movements_count: movements.length, channel: 'chatbot' },
        })
      } catch { /* audit is non-blocking */ }
    }

    if (proposal.intent === 'REPORTE_PROBLEMA') {
      const { error } = await admin.from('announcements').insert({
        author_id: userId,
        type: 'urgente',
        priority: 'critica',
        title: `🚨 Reporte de problema — ${userName}`,
        body: proposal.message ?? '',
        scope: 'role',
        target_role: 'encargado',
        is_active: true,
      })

      if (error) {
        result.errors.push(`Error al reportar: ${error.message}`)
        result.success = false
      } else {
        result.created = 1
        result.details.push('Reporte enviado a encargados')
      }

      try {
        await admin.from('audit_trail').insert({
          user_id: userId,
          user_name: userName,
          action: 'chatbot_report',
          module: 'avisos',
          entity_type: 'announcement',
          description: `${userName} reportó problema vía chatbot: ${(proposal.message ?? '').slice(0, 100)}`,
          metadata: { message: proposal.message, channel: 'chatbot' },
        })
      } catch { /* audit is non-blocking */ }
    }

    if (proposal.intent === 'AVISO_ENCARGADO') {
      const { error } = await admin.from('announcements').insert({
        author_id: userId,
        type: 'operativo',
        priority: proposal.urgency === 'urgente' ? 'alta' : 'media',
        title: `💬 Aviso de ${userName}`,
        body: proposal.message ?? '',
        scope: 'role',
        target_role: 'encargado',
        is_active: true,
      })

      if (error) {
        result.errors.push(`Error al enviar aviso: ${error.message}`)
        result.success = false
      } else {
        result.created = 1
        result.details.push('Aviso enviado a encargados')
      }

      try {
        await admin.from('audit_trail').insert({
          user_id: userId,
          user_name: userName,
          action: 'chatbot_notice',
          module: 'avisos',
          entity_type: 'announcement',
          description: `${userName} envió aviso vía chatbot: ${(proposal.message ?? '').slice(0, 100)}`,
          metadata: { message: proposal.message, channel: 'chatbot' },
        })
      } catch { /* audit is non-blocking */ }
    }

    // ── MISE_EN_PLACE — mark items as done in current shift ──
    if (proposal.intent === 'MISE_EN_PLACE') {
      const todayStr = new Date().toISOString().split('T')[0]

      // Find active kitchen shift
      const { data: activeShift } = await admin
        .from('kitchen_shifts')
        .select('id, shift_type')
        .eq('date', todayStr)
        .in('status', ['pending', 'in_progress'])
        .limit(1)
        .maybeSingle()

      if (!activeShift) {
        result.errors.push('No hay turno de cocina activo hoy. Abrí un turno primero.')
        result.success = false
      } else {
        // Get all mise en place items for this shift
        const { data: miseItems } = await admin
          .from('mise_en_place_items')
          .select('id, name')
          .eq('is_active', true)
          .in('shift', [activeShift.shift_type, 'both'])

        const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

        for (const item of proposal.items) {
          const itemName = norm(item.rawName)

          // Strict matching: exact first, then unique contains, reject ambiguous
          let match = (miseItems ?? []).find(m => norm(m.name) === itemName)
          if (!match) {
            const candidates = (miseItems ?? []).filter(m =>
              norm(m.name).includes(itemName) || itemName.includes(norm(m.name))
            )
            if (candidates.length === 1) {
              match = candidates[0]
            } else if (candidates.length > 1) {
              result.errors.push(`"${item.rawName}" coincide con varios items: ${candidates.map(c => c.name).join(', ')}. Usá el nombre exacto.`)
              continue
            }
          }

          if (!match) {
            result.errors.push(`No encontré "${item.rawName}" en mise en place`)
            continue
          }

          // Upsert mise_en_place_records
          const qty = parseFloat(item.quantity) || 0
          const { error } = await admin
            .from('mise_en_place_records')
            .upsert({
              kitchen_shift_id: activeShift.id,
              mise_en_place_item_id: match.id,
              status: 'done',
              quantity_produced: qty > 0 ? qty : null,
              produced_by: userId,
              note: 'Registrado vía chatbot',
            }, { onConflict: 'kitchen_shift_id,mise_en_place_item_id' })

          if (error) {
            result.errors.push(`Error al registrar ${match.name}: ${error.message}`)
          } else {
            result.created++
            result.details.push(`✅ ${match.name}${qty > 0 ? ` (${qty})` : ''} marcado como listo`)
          }
        }

        result.success = result.errors.length === 0

        try {
          await admin.from('audit_trail').insert({
            user_id: userId,
            user_name: userName,
            action: 'chatbot_mise_en_place',
            module: 'cocina',
            entity_type: 'mise_en_place_record',
            description: `${userName} completó ${result.created} items de mise en place vía chatbot`,
            metadata: { items: proposal.items.map(i => i.rawName), shift_id: activeShift.id },
          })
        } catch { /* audit is non-blocking */ }
      }
    }

  } catch (err) {
    result.success = false
    result.errors.push(err instanceof Error ? err.message : 'Error desconocido')
  }

  return result
}
