// ---------------------------------------------------------------------------
// Operational Events — unified transversal event system
// ---------------------------------------------------------------------------
// Single contract for all operational events across the app.
// Generators produce events from real data. IA enriches, never replaces logic.
// ---------------------------------------------------------------------------

export type EventPriority = 'alta' | 'media' | 'baja'
export type EventStatus = 'pending' | 'in_progress' | 'resolved' | 'dismissed'
export type EventDomain = 'stock' | 'proveedores' | 'compras' | 'expedientes' | 'turnos' | 'cocina' | 'avisos'

export type OperationalEvent = {
  id: string
  domain: EventDomain
  type: string
  priority: EventPriority
  title: string
  description: string
  reference_id: string | null
  reference_label: string | null
  href: string
  source_data: Record<string, unknown> | null
  created_at: string
  status: EventStatus
  suggested_action: string | null
  groupable_key: string | null // for dedup/grouping similar events
}

// ---------------------------------------------------------------------------
// Priority rules — explicit in code, not in prompts
// ---------------------------------------------------------------------------
// alta: requires action TODAY
// media: should resolve soon (this week)
// baja: informative / follow-up

// ---------------------------------------------------------------------------
// STOCK events
// ---------------------------------------------------------------------------

type StockInput = {
  id: string
  name: string
  current_qty: number
  min_qty: number
  supplier_id: string | null
  category: string
  last_ordered_at: string | null
}

export function generateStockEvents(items: StockInput[]): OperationalEvent[] {
  const now = new Date().toISOString()
  const events: OperationalEvent[] = []

  // Group critical items by supplier for aggregated events
  const criticalBySupplier = new Map<string, StockInput[]>()
  const criticalNoSupplier: StockInput[] = []

  for (const item of items) {
    if (item.current_qty > item.min_qty) continue // only critical/zero

    if (item.current_qty === 0) {
      events.push({
        id: `stock-zero-${item.id}`,
        domain: 'stock',
        type: 'stock_zero',
        priority: 'alta',
        title: `${item.name} — agotado`,
        description: `Sin stock. ${item.supplier_id ? 'Pedir al proveedor.' : 'Sin proveedor asignado.'}`,
        reference_id: item.id,
        reference_label: item.name,
        href: '/stock',
        source_data: { qty: 0, min: item.min_qty, category: item.category },
        created_at: now,
        status: 'pending',
        suggested_action: item.supplier_id ? 'Generar pedido' : 'Asignar proveedor',
        groupable_key: item.supplier_id ? `supplier-${item.supplier_id}` : 'no-supplier',
      })
    } else {
      // Below minimum but not zero — group by supplier
      if (item.supplier_id) {
        if (!criticalBySupplier.has(item.supplier_id)) criticalBySupplier.set(item.supplier_id, [])
        criticalBySupplier.get(item.supplier_id)!.push(item)
      } else {
        criticalNoSupplier.push(item)
      }
    }
  }

  // Aggregate: N items críticos del proveedor X → 1 event
  for (const [supplierId, supplierItems] of criticalBySupplier) {
    if (supplierItems.length === 1) {
      const item = supplierItems[0]
      events.push({
        id: `stock-low-${item.id}`,
        domain: 'stock',
        type: 'stock_low',
        priority: 'alta',
        title: `${item.name} bajo mínimo`,
        description: `Tiene ${item.current_qty}, mínimo ${item.min_qty}`,
        reference_id: item.id,
        reference_label: item.name,
        href: '/pedidos',
        source_data: { qty: item.current_qty, min: item.min_qty },
        created_at: now,
        status: 'pending',
        suggested_action: 'Incluir en próximo pedido',
        groupable_key: `supplier-${supplierId}`,
      })
    } else {
      // Grouped event
      events.push({
        id: `stock-group-${supplierId}`,
        domain: 'compras',
        type: 'purchase_needed',
        priority: 'alta',
        title: `${supplierItems.length} items críticos`,
        description: supplierItems.slice(0, 3).map(i => i.name).join(', ') + (supplierItems.length > 3 ? ` +${supplierItems.length - 3}` : ''),
        reference_id: supplierId,
        reference_label: null, // supplier name not available here
        href: '/pedidos',
        source_data: { item_count: supplierItems.length, supplier_id: supplierId },
        created_at: now,
        status: 'pending',
        suggested_action: 'Generar pedido al proveedor',
        groupable_key: `supplier-${supplierId}`,
      })
    }
  }

  // No supplier group
  if (criticalNoSupplier.length > 0) {
    events.push({
      id: 'stock-no-supplier-group',
      domain: 'proveedores',
      type: 'items_without_supplier',
      priority: criticalNoSupplier.length > 5 ? 'alta' : 'media',
      title: `${criticalNoSupplier.length} items críticos sin proveedor`,
      description: criticalNoSupplier.slice(0, 3).map(i => i.name).join(', ') + (criticalNoSupplier.length > 3 ? '...' : ''),
      reference_id: null,
      reference_label: null,
      href: '/proveedores',
      source_data: { count: criticalNoSupplier.length },
      created_at: now,
      status: 'pending',
      suggested_action: 'Asignar proveedores para poder pedir',
      groupable_key: 'no-supplier',
    })
  }

  return events
}

// ---------------------------------------------------------------------------
// EXPEDIENTES events
// ---------------------------------------------------------------------------

type ExpedienteInput = {
  id: string
  code: string
  title: string
  status: string
  urgency: string
  target_date: string | null
  updated_at: string
  responsible_id: string | null
}

const CLOSED_STATUSES = new Set(['cumplido', 'cerrado_sin_implementacion', 'archivado'])
const PAUSED_STATUSES = new Set(['pausado', 'pendiente_tercero', 'pendiente_decision'])

export function generateExpedienteEvents(expedientes: ExpedienteInput[]): OperationalEvent[] {
  const now = new Date()
  const nowStr = now.toISOString()
  const events: OperationalEvent[] = []

  let overdueCount = 0
  let noResponsibleCount = 0

  for (const exp of expedientes) {
    if (CLOSED_STATUSES.has(exp.status)) continue

    // Overdue
    if (exp.target_date && !PAUSED_STATUSES.has(exp.status)) {
      const target = new Date(exp.target_date)
      if (target < now) {
        const daysOver = Math.ceil((now.getTime() - target.getTime()) / 86400000)
        overdueCount++
        if (overdueCount <= 3) { // Only show top 3 individually
          events.push({
            id: `exp-overdue-${exp.id}`,
            domain: 'expedientes',
            type: 'expediente_overdue',
            priority: daysOver > 7 ? 'alta' : 'media',
            title: `${exp.code} vencido (${daysOver}d)`,
            description: exp.title,
            reference_id: exp.id,
            reference_label: exp.code,
            href: `/expedientes/${exp.id}`,
            source_data: { days_overdue: daysOver, urgency: exp.urgency },
            created_at: nowStr,
            status: 'pending',
            suggested_action: 'Revisar estado y actualizar',
            groupable_key: 'expedientes-overdue',
          })
        }
      }
    }

    // No responsible (not draft)
    if (!exp.responsible_id && exp.status !== 'borrador') {
      noResponsibleCount++
    }
  }

  // Overdue summary if many
  if (overdueCount > 3) {
    events.push({
      id: 'exp-overdue-summary',
      domain: 'expedientes',
      type: 'expedientes_overdue_summary',
      priority: 'alta',
      title: `${overdueCount} expedientes vencidos`,
      description: 'Varios expedientes pasaron su fecha objetivo',
      reference_id: null,
      reference_label: null,
      href: '/expedientes?status=activos',
      source_data: { count: overdueCount },
      created_at: nowStr,
      status: 'pending',
      suggested_action: 'Revisar expedientes vencidos',
      groupable_key: 'expedientes-overdue',
    })
  }

  // No responsible summary
  if (noResponsibleCount > 0) {
    events.push({
      id: 'exp-no-responsible',
      domain: 'expedientes',
      type: 'expedientes_no_responsible',
      priority: 'media',
      title: `${noResponsibleCount} expediente${noResponsibleCount > 1 ? 's' : ''} sin responsable`,
      description: 'Asignar responsable para avanzar',
      reference_id: null,
      reference_label: null,
      href: '/expedientes?status=activos',
      source_data: { count: noResponsibleCount },
      created_at: nowStr,
      status: 'pending',
      suggested_action: 'Asignar responsables',
      groupable_key: 'expedientes-no-responsible',
    })
  }

  return events
}

// ---------------------------------------------------------------------------
// TURNOS / EQUIPO events
// ---------------------------------------------------------------------------

type TurnoInput = {
  scheduled_count: number
  present_count: number
  missing_checkouts: number
}

export function generateTurnoEvents(data: TurnoInput): OperationalEvent[] {
  const now = new Date().toISOString()
  const events: OperationalEvent[] = []

  const missing = data.scheduled_count - data.present_count
  if (missing > 0 && data.scheduled_count > 0) {
    events.push({
      id: 'turno-missing-coverage',
      domain: 'turnos',
      type: 'missing_coverage',
      priority: missing >= 2 ? 'alta' : 'media',
      title: `${missing} persona${missing > 1 ? 's' : ''} sin fichar`,
      description: `${data.present_count} de ${data.scheduled_count} programados presente${data.present_count !== 1 ? 's' : ''}`,
      reference_id: null,
      reference_label: null,
      href: '/equipo',
      source_data: { scheduled: data.scheduled_count, present: data.present_count },
      created_at: now,
      status: 'pending',
      suggested_action: 'Verificar con equipo',
      groupable_key: 'turno-coverage',
    })
  }

  if (data.missing_checkouts > 0) {
    events.push({
      id: 'turno-missing-checkout',
      domain: 'turnos',
      type: 'missing_checkout',
      priority: 'media',
      title: `${data.missing_checkouts} egreso${data.missing_checkouts > 1 ? 's' : ''} sin marcar`,
      description: 'Personas que ficharon ingreso pero no egreso',
      reference_id: null,
      reference_label: null,
      href: '/equipo',
      source_data: { count: data.missing_checkouts },
      created_at: now,
      status: 'pending',
      suggested_action: 'Verificar egresos',
      groupable_key: 'turno-checkouts',
    })
  }

  return events
}

// ---------------------------------------------------------------------------
// PENDING ORDERS events
// ---------------------------------------------------------------------------

export function generateOrderEvents(pendingKitchen: number, pendingBar: number): OperationalEvent[] {
  const now = new Date().toISOString()
  const events: OperationalEvent[] = []
  const total = pendingKitchen + pendingBar

  if (total > 0) {
    const parts: string[] = []
    if (pendingKitchen > 0) parts.push(`${pendingKitchen} de cocina`)
    if (pendingBar > 0) parts.push(`${pendingBar} de barra`)
    events.push({
      id: 'orders-pending',
      domain: 'compras',
      type: 'orders_pending',
      priority: total >= 5 ? 'alta' : 'media',
      title: `${total} pedido${total > 1 ? 's' : ''} pendiente${total > 1 ? 's' : ''}`,
      description: parts.join(', '),
      reference_id: null,
      reference_label: null,
      href: '/pedidos',
      source_data: { kitchen: pendingKitchen, bar: pendingBar },
      created_at: now,
      status: 'pending',
      suggested_action: 'Gestionar pedidos',
      groupable_key: 'orders-pending',
    })
  }

  return events
}

// ---------------------------------------------------------------------------
// Sorting, dedup, filtering
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<EventPriority, number> = { alta: 0, media: 1, baja: 2 }

export function sortEvents(events: OperationalEvent[]): OperationalEvent[] {
  return [...events].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
}

export function deduplicateEvents(events: OperationalEvent[]): OperationalEvent[] {
  const seen = new Set<string>()
  return events.filter(e => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })
}

export function filterPending(events: OperationalEvent[]): OperationalEvent[] {
  return events.filter(e => e.status === 'pending')
}
