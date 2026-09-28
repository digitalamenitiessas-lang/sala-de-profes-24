// ---------------------------------------------------------------------------
// Operational Actions — centralized event → action system
// ---------------------------------------------------------------------------
// Detects real problems from data and generates prioritized actions.
// Used by Stock, Expedientes, Dashboard and any module that needs accionabilidad.
// ---------------------------------------------------------------------------

export type ActionPriority = 'alta' | 'media' | 'baja'
export type ActionDomain = 'stock' | 'expedientes' | 'turnos' | 'proveedores' | 'ventas' | 'cocina' | 'barra'

export type OperationalAction = {
  id: string
  domain: ActionDomain
  priority: ActionPriority
  type: string
  title: string
  description: string
  href: string
  referenceId?: string
  timestamp: string
}

// ---------------------------------------------------------------------------
// Stock actions
// ---------------------------------------------------------------------------

type StockItem = {
  id: string
  name: string
  current_qty: number
  min_qty: number
  supplier_id: string | null
  category: string
  is_urgent?: boolean
  last_ordered_at?: string | null
}

export function deriveStockActions(items: StockItem[]): OperationalAction[] {
  const now = new Date().toISOString()
  const actions: OperationalAction[] = []
  const seen = new Set<string>()

  for (const item of items) {
    // Critical stock — needs reorder
    if (item.current_qty <= item.min_qty && item.current_qty > 0) {
      const key = `stock-low-${item.id}`
      if (!seen.has(key)) {
        seen.add(key)
        actions.push({
          id: key,
          domain: 'stock',
          priority: 'alta',
          type: 'stock_critical',
          title: `${item.name} bajo mínimo`,
          description: `Tiene ${item.current_qty}, mínimo ${item.min_qty}${item.supplier_id ? '' : ' · Sin proveedor'}`,
          href: '/stock',
          referenceId: item.id,
          timestamp: now,
        })
      }
    }

    // Zero stock — urgent
    if (item.current_qty === 0) {
      const key = `stock-zero-${item.id}`
      if (!seen.has(key)) {
        seen.add(key)
        actions.push({
          id: key,
          domain: 'stock',
          priority: 'alta',
          type: 'stock_zero',
          title: `${item.name} — sin stock`,
          description: `Agotado${item.supplier_id ? ' · Pedir al proveedor' : ' · Sin proveedor asignado'}`,
          href: '/stock',
          referenceId: item.id,
          timestamp: now,
        })
      }
    }

    // No supplier assigned on critical item
    if (!item.supplier_id && item.current_qty <= item.min_qty) {
      const key = `stock-nosupplier-${item.id}`
      if (!seen.has(key)) {
        seen.add(key)
        actions.push({
          id: key,
          domain: 'proveedores',
          priority: 'media',
          type: 'no_supplier',
          title: `${item.name} sin proveedor`,
          description: 'Item crítico sin proveedor asignado. Asignar para poder pedir.',
          href: '/proveedores',
          referenceId: item.id,
          timestamp: now,
        })
      }
    }
  }

  return actions
}

// ---------------------------------------------------------------------------
// Expedientes actions
// ---------------------------------------------------------------------------

type ExpedienteItem = {
  id: string
  code: string
  title: string
  status: string
  urgency: string
  target_date: string | null
  updated_at: string
  responsible_id: string | null
  tasks_pending?: number
}

export function deriveExpedienteActions(expedientes: ExpedienteItem[]): OperationalAction[] {
  const now = new Date()
  const nowStr = now.toISOString()
  const actions: OperationalAction[] = []
  const closedStatuses = ['cumplido', 'cerrado_sin_implementacion', 'archivado']
  const pausedStatuses = ['pausado', 'pendiente_tercero', 'pendiente_decision']

  for (const exp of expedientes) {
    if (closedStatuses.includes(exp.status)) continue

    // Overdue
    if (exp.target_date && !pausedStatuses.includes(exp.status)) {
      const target = new Date(exp.target_date)
      if (target < now) {
        const daysOver = Math.ceil((now.getTime() - target.getTime()) / 86400000)
        actions.push({
          id: `exp-overdue-${exp.id}`,
          domain: 'expedientes',
          priority: daysOver > 7 ? 'alta' : 'media',
          type: 'expediente_overdue',
          title: `${exp.code} vencido`,
          description: `"${exp.title}" — ${daysOver} día${daysOver !== 1 ? 's' : ''} de atraso`,
          href: `/expedientes/${exp.id}`,
          referenceId: exp.id,
          timestamp: nowStr,
        })
      }
    }

    // No responsible assigned
    if (!exp.responsible_id && !['borrador'].includes(exp.status)) {
      actions.push({
        id: `exp-noresp-${exp.id}`,
        domain: 'expedientes',
        priority: 'media',
        type: 'expediente_no_responsible',
        title: `${exp.code} sin responsable`,
        description: `"${exp.title}" — asignar para avanzar`,
        href: `/expedientes/${exp.id}`,
        referenceId: exp.id,
        timestamp: nowStr,
      })
    }

    // Inactive for >7 days
    const lastUpdate = new Date(exp.updated_at)
    const daysSinceUpdate = Math.ceil((now.getTime() - lastUpdate.getTime()) / 86400000)
    if (daysSinceUpdate > 7 && !pausedStatuses.includes(exp.status)) {
      actions.push({
        id: `exp-stale-${exp.id}`,
        domain: 'expedientes',
        priority: 'baja',
        type: 'expediente_stale',
        title: `${exp.code} sin movimiento`,
        description: `"${exp.title}" — ${daysSinceUpdate} días sin actualizaciones`,
        href: `/expedientes/${exp.id}`,
        referenceId: exp.id,
        timestamp: nowStr,
      })
    }

    // Pending tasks
    if ((exp.tasks_pending ?? 0) > 0) {
      actions.push({
        id: `exp-tasks-${exp.id}`,
        domain: 'expedientes',
        priority: exp.urgency === 'critica' ? 'alta' : 'media',
        type: 'expediente_tasks_pending',
        title: `${exp.code} — ${exp.tasks_pending} tarea${(exp.tasks_pending ?? 0) > 1 ? 's' : ''} pendiente${(exp.tasks_pending ?? 0) > 1 ? 's' : ''}`,
        description: `"${exp.title}"`,
        href: `/expedientes/${exp.id}`,
        referenceId: exp.id,
        timestamp: nowStr,
      })
    }
  }

  return actions
}

// ---------------------------------------------------------------------------
// Sort by priority
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<ActionPriority, number> = { alta: 0, media: 1, baja: 2 }

export function sortActions(actions: OperationalAction[]): OperationalAction[] {
  return [...actions].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
}

// ---------------------------------------------------------------------------
// Deduplicate by id
// ---------------------------------------------------------------------------

export function deduplicateActions(actions: OperationalAction[]): OperationalAction[] {
  const seen = new Set<string>()
  return actions.filter((a) => {
    if (seen.has(a.id)) return false
    seen.add(a.id)
    return true
  })
}
