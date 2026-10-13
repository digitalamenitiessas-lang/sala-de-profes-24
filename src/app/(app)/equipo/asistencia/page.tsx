'use client'

import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  RefreshCw, CheckCircle, Clock, AlertTriangle, UserX, Check, X,
  ShieldAlert, Loader2, ChevronDown, ChevronUp, Timer, MinusCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import { ROLES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { errorToast } from '@/lib/toast-helpers'
import { fechaOperativa } from '@/lib/attendance/jornada'
import type { AttendanceDashboardRow } from '@/types/database'
import type { AppRole } from '@/types/database'

type Correction = {
  id: string
  employee: { first_name: string; last_name: string; role: string } | null
  requester: { first_name: string; last_name: string } | null
  correction_type: string
  reason: string
  status: string
  created_at: string
  new_value: Record<string, unknown>
}

type HistoryRecord = {
  id: string
  operative_date: string
  clock_in_at: string
  clock_out_at: string | null
  status: string
  is_suspicious: boolean
}

const ROLE_ORDER: AppRole[] = ['encargado', 'cajero', 'chef', 'cocina', 'barista', 'runner', 'bacha']

// Filtros de la lista: mismo criterio que el estado que muestra cada fila
type Filtro = 'todos' | 'trabajando' | 'salieron' | 'no_ficharon' | 'sin_fichar' | 'sin_turno'
const FILTROS: { key: Filtro; label: string; test: (e: AttendanceDashboardRow) => boolean }[] = [
  { key: 'todos', label: 'Todos', test: () => true },
  { key: 'trabajando', label: 'Trabajando', test: (e) => e.is_currently_in },
  { key: 'salieron', label: 'Salieron', test: (e) => !e.is_currently_in && !!e.last_event_time },
  { key: 'no_ficharon', label: 'No ficharon', test: (e) => !e.is_currently_in && !e.last_event_time && e.no_show },
  { key: 'sin_fichar', label: 'Todavía no entran', test: (e) => !e.is_currently_in && !e.last_event_time && !e.no_show && !!e.shift_today },
  { key: 'sin_turno', label: 'Sin turno hoy', test: (e) => !e.is_currently_in && !e.last_event_time && !e.no_show && !e.shift_today },
]

function fmtDuration(start: string, end: string | null): string {
  if (!end) return ''
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms <= 0) return ''
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60), m = totalMin % 60
  return h === 0 ? `${m}m` : `${h}h ${m > 0 ? `${m}m` : ''}`
}

// ---------------------------------------------------------------------------
// Employee row with expandable history
// ---------------------------------------------------------------------------
function EmployeeRow({
  emp,
  isExpanded,
  history,
  loadingHistory,
  onToggle,
  anulandoId,
  onAnular,
}: {
  emp: AttendanceDashboardRow
  isExpanded: boolean
  history: HistoryRecord[] | null
  loadingHistory: boolean
  onToggle: () => void
  anulandoId: string | null
  onAnular: (recordId: string) => void
}) {
  const hoyOperativo = fechaOperativa()
  const roleConfig = ROLES[emp.role as AppRole] ?? { label: emp.role, color: '#a39e97', bg: '#f3efe9', emoji: '👤' }
  const hoursStr = emp.total_hours > 0
    ? `${Math.floor(emp.total_hours)}h ${Math.round((emp.total_hours % 1) * 60)}m`
    : null

  return (
    <div className={cn(
      'overflow-hidden rounded-xl border transition-colors',
      isExpanded ? 'border-[#006d5a]/30 bg-[#f7fbf9]' : 'border-[#ebe6df] bg-white',
      emp.open_anomalies > 0 && 'border-l-2 border-l-[#ea504c]',
    )}>
      {/* Row header — clickable */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-3 text-left"
      >
        {/* Role avatar */}
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm" style={{ backgroundColor: roleConfig.bg }}>
          {roleConfig.emoji}
        </div>

        {/* Name + role + turno vs fichada */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#3d2c24]">
            {emp.first_name} {emp.last_name}
          </p>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="text-[10px] font-semibold" style={{ color: roleConfig.color }}>
              {roleConfig.label}
            </span>
            {emp.shift_today && (
              <span className="text-[10px] tabular-nums text-[#7d6c64]">
                · turno {emp.shift_today.start}–{emp.shift_today.end}
              </span>
            )}
            {emp.late_min !== null && emp.late_min > 5 && (
              <span className="rounded-full bg-[#fdf6ec] px-1.5 py-px text-[9px] font-bold text-[#d4943a]">
                +{emp.late_min}′ tarde
              </span>
            )}
            {emp.late_min !== null && emp.late_min < -5 && (
              <span className="rounded-full bg-[#e8f5f1] px-1.5 py-px text-[9px] font-bold text-[#006d5a]">
                {Math.abs(emp.late_min)}′ antes
              </span>
            )}
            {emp.left_early_min !== null && emp.left_early_min > 5 && (
              <span className="rounded-full bg-[#fdf6ec] px-1.5 py-px text-[9px] font-bold text-[#d4943a]">
                salió {emp.left_early_min}′ antes
              </span>
            )}
            {emp.today_out_type === 'auto' && (
              <span className="rounded-full bg-[#f3efe9] px-1.5 py-px text-[9px] font-bold text-[#7d6c64]">
                egreso auto
              </span>
            )}
          </div>
        </div>

        {/* Status */}
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {emp.is_currently_in ? (
            <>
              <div className="flex items-center gap-1 text-[#006d5a]">
                <CheckCircle className="size-3.5" />
                <span className="text-xs font-semibold">Presente</span>
              </div>
              {hoursStr && <span className="text-[10px] text-[#a39e97]">{hoursStr}</span>}
            </>
          ) : emp.last_event_time ? (
            <>
              <div className="flex items-center gap-1 text-[#a39e97]">
                <Clock className="size-3.5" />
                <span className="text-xs">Salió</span>
              </div>
              <span className="text-[10px] text-[#a39e97]">
                {format(new Date(emp.last_event_time), 'HH:mm')}
              </span>
            </>
          ) : emp.no_show ? (
            <div className="flex items-center gap-1 text-[#ea504c]">
              <UserX className="size-3.5" />
              <span className="text-xs font-bold">No fichó</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-[#a39e97]">
              <UserX className="size-3.5" />
              <span className="text-xs">{emp.shift_today ? 'Sin fichar' : 'Sin turno hoy'}</span>
            </div>
          )}
          {emp.open_anomalies > 0 && (
            <div className="flex items-center gap-0.5 text-[#ea504c]">
              <AlertTriangle className="size-3" />
              <span className="text-[10px]">{emp.open_anomalies} anomalía{emp.open_anomalies > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Expand chevron */}
        <div className="ml-1 shrink-0 text-[#a39e97]">
          {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </div>
      </button>

      {/* Expandable history */}
      {isExpanded && (
        <div className="border-t border-[#ebe6df] px-3 pb-3 pt-2">
          {loadingHistory ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="size-4 animate-spin text-[#a39e97]" />
              <span className="ml-2 text-xs text-[#a39e97]">Cargando historial...</span>
            </div>
          ) : !history || history.length === 0 ? (
            <p className="py-4 text-center text-xs text-[#a39e97]">Sin registros en los últimos 14 días.</p>
          ) : (
            <div className="space-y-1">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                Últimos {history.length} días
              </p>
              {history.map(r => {
                const duration = fmtDuration(r.clock_in_at, r.clock_out_at)
                const isCompleto = !!r.clock_out_at
                const isSinEgreso = r.status === 'open'
                return (
                  <div
                    key={r.id}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-2.5 py-2',
                      r.is_suspicious ? 'bg-amber-50' : isCompleto ? 'bg-white' : 'bg-[#fef2f2]',
                    )}
                  >
                    {/* Date */}
                    <div className="w-16 shrink-0">
                      <p className="text-[10px] font-semibold capitalize text-[#3d2c24]">
                        {format(new Date(r.operative_date + 'T12:00:00'), 'EEE d', { locale: es })}
                      </p>
                      <p className="text-[9px] capitalize text-[#a39e97]">
                        {format(new Date(r.operative_date + 'T12:00:00'), 'MMMM', { locale: es })}
                      </p>
                    </div>

                    {/* Times */}
                    <div className="flex flex-1 items-center gap-1.5 font-mono text-xs tabular-nums">
                      <span className="text-[#3d2c24]">{format(new Date(r.clock_in_at), 'HH:mm')}</span>
                      <span className="text-[#d1cdc7]">→</span>
                      <span className={isSinEgreso ? 'text-[#ea504c]' : 'text-[#3d2c24]'}>
                        {r.clock_out_at ? format(new Date(r.clock_out_at), 'HH:mm') : '--:--'}
                      </span>
                    </div>

                    {/* Duration */}
                    {duration && (
                      <div className="flex items-center gap-1 text-[10px] text-[#a39e97]">
                        <Timer className="size-3" />
                        <span>{duration}</span>
                      </div>
                    )}

                    {/* Entrada de hoy sin salida: se puede anular si fue un error */}
                    {isSinEgreso && !r.clock_out_at && r.operative_date === hoyOperativo && (
                      <button
                        onClick={() => onAnular(r.id)}
                        disabled={!!anulandoId}
                        className="flex shrink-0 items-center gap-1 rounded-md border border-[#ea504c]/30 bg-white px-2 py-0.5 text-[10px] font-semibold text-[#ea504c] hover:bg-[#fef2f2] disabled:opacity-50"
                        title="Borrar esta entrada: fue marcada por error"
                      >
                        {anulandoId === r.id && <Loader2 className="size-3 animate-spin" />}
                        Anular
                      </button>
                    )}

                    {/* Status badge */}
                    <div className="shrink-0">
                      {r.is_suspicious ? (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">⚠</span>
                      ) : isCompleto ? (
                        <CheckCircle className="size-3.5 text-[#006d5a]" />
                      ) : (
                        <MinusCircle className="size-3.5 text-[#ea504c]" />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function EquipoAsistenciaPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const isEncargado = isManagerOrAbove(profile?.role)

  const today = format(new Date(), 'yyyy-MM-dd')
  const todayLabel = format(new Date(), "EEEE d 'de' MMMM", { locale: es })

  const [employees, setEmployees] = useState<AttendanceDashboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)

  // Expanded employee + history cache
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [historyCache, setHistoryCache] = useState<Record<string, HistoryRecord[]>>({})
  const [loadingHistoryFor, setLoadingHistoryFor] = useState<string | null>(null)
  const [anulandoId, setAnulandoId] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const elegirFiltro = (f: Filtro) => setFiltro((actual) => (actual === f ? 'todos' : f))

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const dashRes = await fetch(`/api/attendance/dashboard?from=${today}&to=${today}`)
      const dash = await dashRes.json()
      setEmployees(dash.employees ?? [])
    } catch {
      toast.error('No se pudo cargar la asistencia')
    } finally {
      setLoading(false)
    }
  }, [today])

  useEffect(() => {
    if (isEncargado) fetchData()
  }, [isEncargado, fetchData])

  async function toggleEmployee(empId: string) {
    if (expandedId === empId) {
      setExpandedId(null)
      return
    }
    setExpandedId(empId)
    if (historyCache[empId]) return // already fetched

    setLoadingHistoryFor(empId)
    try {
      const res = await fetch(`/api/attendance/history?user_id=${empId}&limit=14`)
      const data = await res.json()
      setHistoryCache(prev => ({ ...prev, [empId]: data.records ?? [] }))
    } catch {
      toast.error('No se pudo cargar el historial')
      setHistoryCache(prev => ({ ...prev, [empId]: [] }))
    } finally {
      setLoadingHistoryFor(null)
    }
  }

  // Deshace una entrada marcada por error ("Llegó" sin querer)
  async function anularIngreso(emp: AttendanceDashboardRow, recordId: string) {
    if (anulandoId) return
    if (!window.confirm(`¿Anular la entrada de ${emp.first_name}? Se borra como si no hubiera fichado hoy.`)) return
    setAnulandoId(recordId)
    try {
      const res = await fetch('/api/admin/anular-ingreso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance_id: recordId, reason: 'Marcada por error' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Error')
      toast.success(`Entrada de ${emp.first_name} anulada`)
      setHistoryCache(prev => ({ ...prev, [emp.employee_id]: (prev[emp.employee_id] ?? []).filter(r => r.id !== recordId) }))
      fetchData()
    } catch (err) {
      errorToast('No se pudo anular la entrada', err)
    } finally {
      setAnulandoId(null)
    }
  }

  if (profileLoading) return <LoadingState />

  if (!profile || !isEncargado) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#e8f5f1]">
            <ShieldAlert className="size-7 text-[#006d5a]" />
          </div>
          <p className="text-sm text-[#a39e97]">Solo los encargados pueden ver este panel.</p>
        </div>
      </div>
    )
  }

  const sorted = [...employees].sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.role as AppRole)
    const bi = ROLE_ORDER.indexOf(b.role as AppRole)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })

  const visibles = sorted.filter(FILTROS.find((f) => f.key === filtro)!.test)
  const present = employees.filter(e => e.is_currently_in).length
  const anomalyCount = employees.reduce((s, e) => s + e.open_anomalies, 0)
  const noShowCount = employees.filter(e => e.no_show).length
  const workedH = Math.round(employees.reduce((a, e) => a + e.total_hours, 0) * 10) / 10
  const scheduledH = Math.round(employees.reduce((a, e) => a + e.scheduled_hours, 0) * 10) / 10

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#3d2c24]">Asistencia</h1>
          <p className="section-label mt-1 capitalize">{todayLabel}</p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-xs font-semibold text-[#3d2c24] hover:border-[#006d5a] hover:text-[#006d5a] disabled:opacity-50"
        >
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          Actualizar
        </button>
      </div>

      {/* KPI strip: presencia + exactitud de horas del día */}
      <div className="grid grid-cols-4 gap-2">
        {/* Tocar Presentes / No ficharon filtra la lista */}
        <button
          type="button"
          onClick={() => elegirFiltro('trabajando')}
          className={cn('card-elevated rounded-xl p-3 text-center', filtro === 'trabajando' && 'ring-2 ring-[#006d5a]')}
        >
          <p className="font-display text-2xl font-bold text-[#006d5a]">{present}</p>
          <p className="mt-0.5 text-[10px] text-[#a39e97]">Presentes</p>
        </button>
        <button
          type="button"
          onClick={() => elegirFiltro('no_ficharon')}
          className={cn('rounded-xl p-3 text-center', noShowCount > 0 ? 'bg-[#fef2f2]' : 'card-elevated', filtro === 'no_ficharon' && 'ring-2 ring-[#ea504c]')}
        >
          <p className={cn('font-display text-2xl font-bold', noShowCount > 0 ? 'text-[#ea504c]' : 'text-[#3d2c24]')}>{noShowCount}</p>
          <p className={cn('mt-0.5 text-[10px]', noShowCount > 0 ? 'text-[#ea504c]' : 'text-[#a39e97]')}>No ficharon</p>
        </button>
        <div className="card-elevated rounded-xl p-3 text-center">
          <p className="font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
            {workedH}<span className="text-sm font-medium text-[#a39e97]">/{scheduledH}</span>
          </p>
          <p className="mt-0.5 text-[10px] text-[#a39e97]">Hs reales / plan</p>
        </div>
        <div className={cn('rounded-xl p-3 text-center', anomalyCount > 0 ? 'bg-[#fef2f2]' : 'card-elevated')}>
          <p className={cn('font-display text-2xl font-bold', anomalyCount > 0 ? 'text-[#ea504c]' : 'text-[#3d2c24]')}>{anomalyCount}</p>
          <p className={cn('mt-0.5 text-[10px]', anomalyCount > 0 ? 'text-[#ea504c]' : 'text-[#a39e97]')}>Sospechosos</p>
        </div>
      </div>

      {loading ? (
        <LoadingState message="Cargando asistencia..." />
      ) : (
        <>
          {/* Employee list */}
          <div className="space-y-1.5">
            {/* Filtros */}
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1.5">
              {FILTROS.map((f) => {
                const n = sorted.filter(f.test).length
                if (n === 0 && f.key !== 'todos' && f.key !== filtro) return null
                const activo = filtro === f.key
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFiltro(f.key)}
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                      activo ? 'border-[#006d5a] bg-[#006d5a] text-white' : 'border-[#ebe6df] bg-white text-[#7d6c64]',
                    )}
                  >
                    {f.label}
                    <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', activo ? 'bg-white/20' : 'bg-[#f3efe9]')}>{n}</span>
                  </button>
                )
              })}
            </div>
            <p className="section-label px-1">Equipo — tocá para ver historial</p>
            {visibles.map(emp => (
              <EmployeeRow
                key={emp.employee_id}
                emp={emp}
                isExpanded={expandedId === emp.employee_id}
                history={historyCache[emp.employee_id] ?? null}
                loadingHistory={loadingHistoryFor === emp.employee_id}
                onToggle={() => toggleEmployee(emp.employee_id)}
                anulandoId={anulandoId}
                onAnular={(recordId) => anularIngreso(emp, recordId)}
              />
            ))}
            {visibles.length === 0 && (
              <div className="rounded-xl border border-[#ebe6df] bg-white p-8 text-center text-sm text-[#a39e97]">
                {sorted.length === 0 ? 'No hay empleados registrados.' : 'Nadie en este filtro.'}
              </div>
            )}
          </div>

        </>
      )}
    </div>
  )
}
