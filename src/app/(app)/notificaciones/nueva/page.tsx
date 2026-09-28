'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2,
  ShieldAlert,
  ArrowLeft,
} from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import {
  ANNOUNCEMENT_TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  ROLE_OPTIONS,
} from '@/lib/constants'
import type { AppRole, AnnouncementInsert, AnnouncementTypeValue, PriorityValue } from '@/types/database'
import { logAuditClient } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Scope options
// ---------------------------------------------------------------------------

const SCOPE_OPTIONS = [
  { value: 'todos', label: 'Todos' },
  { value: 'por_rol', label: 'Por Rol' },
  { value: 'usuario', label: 'Usuario especifico' },
] as const

type Scope = (typeof SCOPE_OPTIONS)[number]['value']

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EmployeeOption = {
  id: string
  first_name: string
  last_name: string
  role: AppRole
}

// ---------------------------------------------------------------------------
// Create Notification Page
// ---------------------------------------------------------------------------

export default function NuevaNotificacionPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const router = useRouter()
  const [supabase] = useState(() => createClient())

  // Todos pueden crear anuncios generales
  const canCreate = !!profile

  // Form state
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [type, setType] = useState<AnnouncementTypeValue>('general')
  const [priority, setPriority] = useState<PriorityValue>('baja')
  const [scope, setScope] = useState<Scope>('todos')
  const [targetRole, setTargetRole] = useState<AppRole | ''>('')
  const [targetUserId, setTargetUserId] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [saving, setSaving] = useState(false)

  // Employees (for scope=usuario)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])

  // ------------------------------------------
  // Fetch employees
  // ------------------------------------------
  const fetchEmployees = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, role')
        .eq('is_active', true)
        .order('first_name')

      if (error) throw error
      setEmployees(data ?? [])
    } catch (err) {
      console.error('Error al cargar empleados:', err)
    }
  }, [supabase])

  useEffect(() => {
    if (canCreate) {
      fetchEmployees()
    }
  }, [canCreate, fetchEmployees])

  // ------------------------------------------
  // Submit
  // ------------------------------------------
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!profile) return
    if (!title.trim() || !body.trim()) {
      toast.error('El titulo y el contenido son obligatorios')
      return
    }
    if (scope === 'por_rol' && !targetRole) {
      toast.error('Selecciona un rol destinatario')
      return
    }
    if (scope === 'usuario' && !targetUserId) {
      toast.error('Selecciona un usuario destinatario')
      return
    }

    setSaving(true)
    try {
      // Determine scope and targets based on form selection
      let dbScope: 'all' | 'role' | 'user' = 'all'
      let dbTargetRole: AppRole | null = null
      let dbTargetUserId: string | null = null

      if (scope === 'por_rol') {
        dbScope = 'role'
        dbTargetRole = targetRole as AppRole
      } else if (scope === 'usuario') {
        dbScope = 'user'
        dbTargetUserId = targetUserId
      }

      const insertData: AnnouncementInsert = {
        title: title.trim(),
        body: body.trim(),
        type,
        priority,
        author_id: profile.id,
        scope: dbScope,
        target_role: dbTargetRole,
        target_user_id: dbTargetUserId,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      }

      const { error } = await supabase.from('announcements').insert(insertData)

      if (error) throw error

      // Trigger push notifications (non-blocking)
      fetch('/api/push/send-announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          message: body.trim(),
          scope: dbScope,
          target_role: dbTargetRole,
          target_user_id: dbTargetUserId,
        }),
      }).catch(() => {})

      logAuditClient({
        action: 'create_announcement',
        module: 'avisos',
        entityType: 'announcement',
        description: `User creó aviso: ${title.trim()}`,
      })

      toast.success('Notificacion creada correctamente')
      router.push('/notificaciones')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al crear la notificacion'
      toast.error('Error', { description: message })
    } finally {
      setSaving(false)
    }
  }

  // ------------------------------------------
  // Loading / Permission
  // ------------------------------------------
  if (profileLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-[#a39e97]">
          <Loader2 className="size-8 animate-spin text-[#006d5a]" />
          <p className="text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!profile || !canCreate) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#e8f5f1]">
            <ShieldAlert className="size-7 text-[#006d5a]" />
          </div>
          <h3 className="font-display text-base font-semibold text-[#3d2c24]">Sin permisos</h3>
          <p className="max-w-xs text-sm text-[#a39e97]">
            Necesitás estar logueado para crear notificaciones.
          </p>
        </div>
      </div>
    )
  }

  // ------------------------------------------
  // Render
  // ------------------------------------------
  return (
    <div className="mx-auto max-w-lg space-y-6 pb-12">
      {/* Back button */}
      <button
        type="button"
        onClick={() => router.push('/notificaciones')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#a39e97] transition-colors hover:text-[#3d2c24]"
      >
        <ArrowLeft className="size-4" />
        Volver
      </button>

      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[#3d2c24]">
          Nuevo Aviso
        </h1>
        <p className="section-label mt-2">
          Crea un aviso o comunicado para el equipo
        </p>
      </div>

      {/* Form card */}
      <div className="card-elevated-lg p-6 md:p-8">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="notif-title" className="text-sm font-medium text-[#3d2c24]">Titulo <span className="text-[#ea504c]">*</span></Label>
            <Input
              id="notif-title"
              placeholder="Titulo del aviso"
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5]"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Body */}
          <div className="space-y-2">
            <Label htmlFor="notif-body" className="text-sm font-medium text-[#3d2c24]">Contenido <span className="text-[#ea504c]">*</span></Label>
            <Textarea
              id="notif-body"
              placeholder="Escribe el contenido del aviso..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="min-h-[5rem] rounded-xl border-[#ebe6df] bg-[#faf8f5]"
              required
            />
          </div>

          {/* Type + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="notif-type" className="text-sm font-medium text-[#3d2c24]">Tipo</Label>
              <Select value={type} onValueChange={(v) => v && setType(v as AnnouncementTypeValue)}>
                <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5]" id="notif-type">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[#ebe6df]">
                  {ANNOUNCEMENT_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notif-priority" className="text-sm font-medium text-[#3d2c24]">Prioridad</Label>
              <Select value={priority} onValueChange={(v) => v && setPriority(v as PriorityValue)}>
                <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5]" id="notif-priority">
                  <SelectValue placeholder="Prioridad" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[#ebe6df]">
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Scope */}
          <div className="space-y-2">
            <Label htmlFor="notif-scope" className="text-sm font-medium text-[#3d2c24]">Alcance</Label>
            <Select
              value={scope}
              onValueChange={(v) => {
                if (!v) return
                setScope(v as Scope)
                setTargetRole('')
                setTargetUserId('')
              }}
            >
              <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5]" id="notif-scope">
                <SelectValue placeholder="Alcance" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#ebe6df]">
                {SCOPE_OPTIONS
                  .filter((opt) => {
                    // Non-managers can only send to 'todos'
                    if (profile?.role !== 'socio' && profile?.role !== 'encargado') {
                      return opt.value === 'todos'
                    }
                    return true
                  })
                  .map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Conditional: role select */}
          {scope === 'por_rol' && (
            <div className="space-y-2">
              <Label htmlFor="notif-target-role" className="text-sm font-medium text-[#3d2c24]">Rol destinatario</Label>
              <Select
                value={targetRole}
                onValueChange={(v) => v && setTargetRole(v as AppRole)}
              >
                <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5]" id="notif-target-role">
                  <SelectValue placeholder="Seleccionar rol" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[#ebe6df]">
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Conditional: user select */}
          {scope === 'usuario' && (
            <div className="space-y-2">
              <Label htmlFor="notif-target-user" className="text-sm font-medium text-[#3d2c24]">
                Usuario destinatario
              </Label>
              <Select
                value={targetUserId}
                onValueChange={(v) => v && setTargetUserId(v)}
              >
                <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5]" id="notif-target-user">
                  <SelectValue placeholder="Seleccionar usuario" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[#ebe6df]">
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.first_name} {emp.last_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Expiration date */}
          <div className="space-y-2">
            <Label htmlFor="notif-expires" className="text-sm font-medium text-[#3d2c24]">
              Fecha de expiracion (opcional)
            </Label>
            <Input
              id="notif-expires"
              type="datetime-local"
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5]"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 pt-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#005a4a] disabled:opacity-50"
            >
              {saving && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Publicar
            </button>
            <button
              type="button"
              onClick={() => router.push('/notificaciones')}
              className="inline-flex w-full items-center justify-center rounded-xl border border-[#ebe6df] bg-[#fefcf9] px-4 py-3.5 text-sm font-medium text-[#3d2c24] transition-colors hover:bg-[#f3efe9]"
            >
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
