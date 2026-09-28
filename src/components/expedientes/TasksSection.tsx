'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Plus, CheckCircle, Circle, Clock, X, User, Calendar,
  Loader2, Ban, ArrowRightLeft,
} from 'lucide-react'
import { toast } from 'sonner'
import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'
import type { TaskWithAssignee } from '@/types/expedientes'

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const TASK_STATUS = {
  pending:     { label: 'Pendiente',    icon: Circle,      color: '#a39e97', bg: '#f3efe9' },
  in_progress: { label: 'En progreso', icon: Clock,       color: '#d4943a', bg: '#fdf6ec' },
  done:        { label: 'Completada',  icon: CheckCircle, color: '#006d5a', bg: '#e8f5f1' },
  cancelled:   { label: 'Cancelada',   icon: Ban,         color: '#ea504c', bg: '#fef2f2' },
} as const

type TeamMember = { id: string; first_name: string; last_name: string; role: string }

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type TasksSectionProps = {
  expedienteId: string
  currentUserId: string // logged in user
  isSocio: boolean      // only socios can create/assign tasks
  canManage: boolean    // socio/encargado can change statuses
  isClosed: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TasksSection({ expedienteId, currentUserId, isSocio, canManage, isClosed }: TasksSectionProps) {
  const [tasks, setTasks] = useState<TaskWithAssignee[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [socios, setSocios] = useState<TeamMember[]>([])
  const [sociosLoaded, setSociosLoaded] = useState(false)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [creating, setCreating] = useState(false)

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/expedientes/${expedienteId}/tasks`)
      const json = await res.json()
      setTasks(json.data ?? [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [expedienteId])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  // Fetch socios only for assignment (lazy)
  const loadSocios = useCallback(async () => {
    if (sociosLoaded) return
    try {
      const res = await fetch('/api/expedientes/team')
      const json = await res.json()
      // Filter only socios
      const allMembers: TeamMember[] = json.data ?? []
      setSocios(allMembers.filter((m) => m.role === 'socio'))
      setSociosLoaded(true)
    } catch {
      // silent
    }
  }, [sociosLoaded])

  // Create task
  const handleCreate = async () => {
    if (!title.trim() || creating) return
    setCreating(true)
    try {
      const res = await fetch(`/api/expedientes/${expedienteId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          assigned_to: assignedTo || null,
          due_date: dueDate || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Error')
      }
      toast.success('Tarea creada')
      setTitle('')
      setDescription('')
      setAssignedTo('')
      setDueDate('')
      setShowForm(false)
      fetchTasks()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear tarea')
    } finally {
      setCreating(false)
    }
  }

  // Reassignment state
  const [reassigningTaskId, setReassigningTaskId] = useState<string | null>(null)

  // Update task status
  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/expedientes/${expedienteId}/tasks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, status: newStatus }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Error')
      }
      fetchTasks()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar tarea')
    }
  }

  // Reassign task
  const handleReassign = async (taskId: string, newAssignedTo: string) => {
    try {
      const res = await fetch(`/api/expedientes/${expedienteId}/tasks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, assigned_to: newAssignedTo || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Error')
      }
      toast.success('Tarea reasignada')
      setReassigningTaskId(null)
      fetchTasks()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al reasignar')
    }
  }

  // Stats
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  const progress = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Tareas
          </h2>
          {total > 0 && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {done}/{total} completadas
            </p>
          )}
        </div>
        {isSocio && !isClosed && (
          <button
            onClick={() => {
              setShowForm(!showForm)
              if (!showForm) loadSocios()
            }}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#005a4a] active:scale-95"
          >
            {showForm ? <X className="size-3" /> : <Plus className="size-3" />}
            {showForm ? 'Cancelar' : 'Nueva tarea'}
          </button>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="h-1.5 w-full rounded-full bg-[#ebe6df] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#006d5a] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border bg-card p-3 sm:p-4 space-y-2.5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título de la tarea *"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
            autoFocus
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descripción (opcional)"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
          />
          {/* Asignar + fecha — stack en mobile, side-by-side en desktop */}
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
            <select
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a] sm:flex-1"
            >
              <option value="">Asignar a socio...</option>
              {socios.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.first_name} {m.last_name}
                </option>
              ))}
            </select>
            <div className="w-full sm:w-44">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'f' || e.key === 'F') {
                    e.preventDefault()
                    setDueDate(new Date().toISOString().split('T')[0])
                  }
                }}
                placeholder="Vencimiento"
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground"><kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] font-semibold">F</kbd> = hoy</p>
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || creating}
            className="w-full rounded-lg bg-[#006d5a] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#005a4a] disabled:opacity-50 active:scale-[0.98]"
          >
            {creating ? 'Creando...' : 'Crear tarea'}
          </button>
        </div>
      )}

      {/* Tasks list */}
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : tasks.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">
          Sin tareas aún
        </p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const statusConfig = TASK_STATUS[task.status as keyof typeof TASK_STATUS] ?? TASK_STATUS.pending
            const StatusIcon = statusConfig.icon
            const isActive = task.status !== 'done' && task.status !== 'cancelled'
            const isOverdue = task.due_date && new Date(task.due_date) < new Date() && isActive
            // Only the assigned person can manage the task (it's a "pase")
            const isAssignedToMe = task.assigned_to === currentUserId
            const canActOnTask = isAssignedToMe || (!task.assigned_to && isSocio)

            return (
              <div
                key={task.id}
                className={`rounded-xl border bg-card p-3 transition-all ${
                  task.status === 'done' ? 'opacity-60' : ''
                }`}
                style={{ borderLeftWidth: 3, borderLeftColor: statusConfig.color }}
              >
                {/* Row: status icon + content + actions */}
                <div className="flex items-start gap-2">
                  {/* Status toggle — only assigned person can act */}
                  {!isClosed && isActive && canActOnTask ? (
                    <button
                      onClick={() => handleStatusChange(task.id, task.status === 'pending' ? 'in_progress' : 'done')}
                      className="mt-0.5 shrink-0 transition-colors hover:opacity-70"
                      title={task.status === 'pending' ? 'Marcar en progreso' : 'Marcar completada'}
                    >
                      <StatusIcon className="size-5 sm:size-4" style={{ color: statusConfig.color }} />
                    </button>
                  ) : (
                    <StatusIcon className="mt-0.5 size-5 shrink-0 sm:size-4" style={{ color: statusConfig.color }} />
                  )}

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p className={`text-[13px] font-medium leading-snug sm:text-sm ${
                      task.status === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'
                    }`}>
                      {task.title}
                    </p>
                    {task.description && (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
                        {task.description}
                      </p>
                    )}

                    {/* Meta row */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {task.assignee && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <User className="size-2.5" />
                          {task.assignee.first_name} {task.assignee.last_name}
                        </span>
                      )}
                      {task.due_date && (
                        <span className={`inline-flex items-center gap-1 text-[10px] ${
                          isOverdue ? 'font-semibold text-[#ea504c]' : 'text-muted-foreground'
                        }`}>
                          <Calendar className="size-2.5" />
                          {new Date(task.due_date + 'T12:00:00').toLocaleDateString('es-AR')}
                        </span>
                      )}
                      <span
                        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                        style={{ color: statusConfig.color, backgroundColor: statusConfig.bg }}
                      >
                        {statusConfig.label}
                      </span>
                    </div>
                  </div>

                  {/* Quick actions */}
                  {!isClosed && isActive && (
                    <div className="flex shrink-0 gap-1">
                      {/* Reassign button — socios or assigned person */}
                      {(isSocio || canActOnTask) && (
                        <button
                          onClick={() => {
                            loadSocios()
                            setReassigningTaskId(reassigningTaskId === task.id ? null : task.id)
                          }}
                          className="rounded-lg p-1.5 text-[#8b5e34] hover:bg-[#faf0e4] active:scale-90"
                          title="Reasignar"
                        >
                          <ArrowRightLeft className="size-4" />
                        </button>
                      )}
                      {canActOnTask && task.status !== 'done' && (
                        <button
                          onClick={() => handleStatusChange(task.id, 'done')}
                          className="rounded-lg p-1.5 text-[#006d5a] hover:bg-[#e8f5f1] active:scale-90"
                          title="Completar"
                        >
                          <CheckCircle className="size-4" />
                        </button>
                      )}
                      {canActOnTask && (
                        <button
                          onClick={() => handleStatusChange(task.id, 'cancelled')}
                          className="rounded-lg p-1.5 text-[#ea504c] hover:bg-[#fef2f2] active:scale-90"
                          title="Cancelar"
                        >
                          <Ban className="size-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Inline reassignment selector */}
                {reassigningTaskId === task.id && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg bg-[#faf0e4] p-2.5">
                    <ArrowRightLeft className="size-3.5 shrink-0 text-[#8b5e34]" />
                    <select
                      defaultValue={task.assigned_to ?? ''}
                      onChange={(e) => handleReassign(task.id, e.target.value)}
                      className="flex-1 rounded-lg border border-[#ebe6df] bg-white px-2.5 py-2 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                    >
                      <option value="">Sin asignar</option>
                      {socios.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.first_name} {m.last_name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setReassigningTaskId(null)}
                      className="rounded-lg p-1.5 text-[#a39e97] hover:bg-white"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
