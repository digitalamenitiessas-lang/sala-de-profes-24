'use client'

import { useEffect, useState, useCallback } from 'react'
import useSWR from 'swr'
import { format, addDays } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Users,
  ClipboardList,
  Plus,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  Calendar,
  Phone,
  ShieldAlert,
  Pencil,
  Loader2,
  Search,
  UserCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { FadeIn, StaggerList, StaggerItem, ScalePress, AnimatedNumber, AnimatedSwitch, PulseRing } from '@/components/ui/motion'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { mustClockIn, puestoDe } from '@/lib/roles'
import { errorToast } from '@/lib/toast-helpers'
import { createClient } from '@/lib/supabase/client'
import { SWR_KEYS } from '@/lib/swr/keys'
import { ROLES } from '@/lib/constants'
import { ETIQUETA_AUSENCIA, MOTIVOS_AUSENCIA, type Ausencia, type MotivoAusencia } from '@/lib/attendance/ausencias'
import type { Profile, AppRole } from '@/types/database'

import { CreateUserDialog } from '@/components/equipo/CreateUserDialog'
import { EditUserDialog } from '@/components/equipo/EditUserDialog'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AttendanceRecord = {
  id: string
  user_id: string
  clock_in_at: string
  clock_out_at: string | null
  status: 'open' | 'closed' | 'missing_checkout'
  clock_out_type?: string | null
  edited_by?: string | null
}

type EmployeeAttendance = {
  profile: Profile
  attendance: AttendanceRecord | null
  hasShiftToday: boolean
  /** Motivo anotado por el encargado si tenía turno y no fichó */
  ausencia: Ausencia | null
  shiftStart?: string
  shiftEnd?: string
}

type TabValue = 'asistencia' | 'equipo'

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EquipoPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const supabase = createClient()

  const [tab, setTab] = useState<TabValue>('asistencia')
  const [selectedDate, setSelectedDate] = useState(new Date())
  // /equipo?date=YYYY-MM-DD abre ese día (enlaces de la liquidación y de los avisos)
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get('date')
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const fecha = new Date(`${d}T12:00:00`)
      if (!Number.isNaN(fecha.getTime()) && fecha <= new Date()) setSelectedDate(fecha)
    }
  }, [])
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState<Profile | null>(null)

  // Edit egreso
  const [editingEgresoId, setEditingEgresoId] = useState<string | null>(null)
  const [egresoTime, setEgresoTime] = useState('')
  const [ingresoTime, setIngresoTime] = useState('')
  const [ingresoOriginal, setIngresoOriginal] = useState('')
  const [egresoOriginal, setEgresoOriginal] = useState('')
  const [egresoReason, setEgresoReason] = useState('')
  const [savingEgreso, setSavingEgreso] = useState(false)
  const [marcandoId, setMarcandoId] = useState<string | null>(null)
  // Motivo de ausencia (por qué no fichó)
  const [motivoUserId, setMotivoUserId] = useState<string | null>(null)
  const [motivoSel, setMotivoSel] = useState<MotivoAusencia | null>(null)
  const [motivoNota, setMotivoNota] = useState('')
  const [savingMotivo, setSavingMotivo] = useState(false)
  const [anulandoId, setAnulandoId] = useState<string | null>(null)

  const isManager = profile?.role === 'socio' || profile?.role === 'encargado'

  const dateStr = format(selectedDate, 'yyyy-MM-dd')
  const isToday = dateStr === format(new Date(), 'yyyy-MM-dd')

  // ---------------------------------------------------------------------------
  // SWR — attendance for selected date
  // ---------------------------------------------------------------------------

  const { data: employees = [], isLoading: loadingAttendance, mutate: mutateAttendance } = useSWR(
    profile && tab === 'asistencia' ? ['equipo_attendance', dateStr] : null,
    async () => {
      const [profilesRes, attendanceRes, shiftsRes, ausenciasRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('is_active', true).order('first_name'),
        supabase.from('attendance_logs').select('id, user_id, clock_in_at, clock_out_at, status, clock_out_type, edited_by').eq('operative_date', dateStr),
        supabase.from('shifts').select('user_id, start_time, end_time').eq('shift_date', dateStr),
        // Solo encargados/socios pueden verlas; al resto le responde 403 y queda vacío
        fetch(`/api/admin/ausencias?desde=${dateStr}`).then((r) => (r.ok ? r.json() : { ausencias: [] })).catch(() => ({ ausencias: [] })),
      ])
      const ausenciaMap = new Map(((ausenciasRes.ausencias ?? []) as Ausencia[]).map((a) => [a.user_id, a]))
      const attendanceMap = new Map(
        (attendanceRes.data ?? []).map((a) => [a.user_id, a as AttendanceRecord]),
      )
      const shiftMap = new Map(
        (shiftsRes.data ?? []).map((s) => [s.user_id, s]),
      )
      // Excluir perfiles que no fichan (socios salvo SOCIOS_QUE_FICHAN)
      return (profilesRes.data ?? [])
        .filter((p) => mustClockIn(p as Profile))
        .map((p) => {
          const shift = shiftMap.get(p.id)
          return {
            profile: p as Profile,
            attendance: attendanceMap.get(p.id) ?? null,
            hasShiftToday: !!shift,
            ausencia: ausenciaMap.get(p.id) ?? null,
            shiftStart: shift?.start_time,
            shiftEnd: shift?.end_time,
          }
        }) as EmployeeAttendance[]
    },
    { revalidateOnFocus: true },
  )

  // ---------------------------------------------------------------------------
  // SWR — profiles list (team tab)
  // ---------------------------------------------------------------------------

  const { data: allProfiles = [], isLoading: loadingProfiles, mutate: mutateProfiles } = useSWR(
    profile && tab === 'equipo' ? SWR_KEYS.profilesList(showInactive) : null,
    async () => {
      const query = supabase.from('profiles').select('*').order('first_name')
      if (!showInactive) query.eq('is_active', true)
      const { data } = await query
      return (data ?? []) as Profile[]
    },
    { revalidateOnFocus: true },
  )

  const loading = tab === 'asistencia' ? loadingAttendance : loadingProfiles

  const handleSaveEgreso = async (attendanceId: string, operativeDate: string) => {
    const cambiaIngreso = !!ingresoTime && ingresoTime !== ingresoOriginal
    const cambiaEgreso = !!egresoTime && egresoTime !== egresoOriginal
    if ((!cambiaEgreso && !cambiaIngreso) || savingEgreso) return
    setSavingEgreso(true)
    try {
      // Hora del día operativo → instante (antes de las 06 es el día siguiente)
      const aIso = (hhmm: string) => {
        const [h] = hhmm.split(':').map(Number)
        const baseDate = h < 6
          ? format(addDays(new Date(operativeDate + 'T12:00:00'), 1), 'yyyy-MM-dd')
          : operativeDate
        return `${baseDate}T${hhmm}:00-03:00`
      }

      const res = await fetch('/api/admin/extend-shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendance_id: attendanceId,
          ...(cambiaEgreso ? { new_clock_out: aIso(egresoTime) } : {}),
          ...(cambiaIngreso ? { new_clock_in: aIso(ingresoTime) } : {}),
          reason: egresoReason.trim() || 'Corrección del encargado',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      toast.success('Fichaje corregido')
      setEditingEgresoId(null)
      setEgresoTime('')
      setEgresoReason('')
      mutateAttendance() // revalidate SWR
    } catch (err) {
      errorToast('No se pudo guardar el egreso', err)
    } finally {
      setSavingEgreso(false)
    }
  }

  // El encargado marca "Llegó" a quien está trabajando y no fichó
  const handleLlego = async (userId: string, nombre: string) => {
    if (marcandoId) return
    setMarcandoId(userId)
    try {
      const res = await fetch('/api/admin/marcar-ingreso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      toast.success(`Entrada de ${nombre} marcada. Si llegó antes, corregí la hora con el lápiz.`)
      mutateAttendance()
    } catch (err) {
      errorToast('No se pudo marcar la entrada', err)
    } finally {
      setMarcandoId(null)
    }
  }

  // Deshace una entrada marcada por error ("Llegó" sin querer)
  // Anota (o quita) el motivo por el que alguien con turno no fichó ese día
  const handleMotivo = async (userId: string, quitarId?: string) => {
    if (savingMotivo || (!quitarId && !motivoSel)) return
    setSavingMotivo(true)
    try {
      const res = await fetch('/api/admin/ausencias', {
        method: quitarId ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quitarId ? { id: quitarId } : { user_id: userId, fecha: dateStr, motivo: motivoSel, nota: motivoNota }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      toast.success(quitarId ? 'Motivo quitado' : 'Motivo anotado')
      setMotivoUserId(null)
      mutateAttendance()
    } catch (err) {
      errorToast('No se pudo guardar el motivo', err)
    } finally {
      setSavingMotivo(false)
    }
  }

  const handleAnular = async (attendanceId: string, nombre: string) => {
    if (anulandoId) return
    if (!window.confirm(`¿Anular la entrada de ${nombre}? Se borra como si no hubiera fichado hoy.`)) return
    setAnulandoId(attendanceId)
    try {
      const res = await fetch('/api/admin/anular-ingreso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance_id: attendanceId, reason: egresoReason.trim() || 'Marcada por error' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      toast.success(`Entrada de ${nombre} anulada`)
      setEditingEgresoId(null)
      mutateAttendance()
    } catch (err) {
      errorToast('No se pudo anular la entrada', err)
    } finally {
      setAnulandoId(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Date navigation
  // ---------------------------------------------------------------------------

  function goDay(delta: number) {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + delta)
    if (d <= new Date()) setSelectedDate(d)
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function getAttendanceStatus(ea: EmployeeAttendance) {
    if (!ea.attendance) {
      // Sin fichaje: rojo si tenía turno, gris si no
      if (ea.hasShiftToday && ea.ausencia) {
        return { label: ETIQUETA_AUSENCIA[ea.ausencia.motivo], color: '#3b6ab5', bg: '#eef3fb', icon: ClipboardList }
      }
      if (ea.hasShiftToday) {
        return { label: 'Sin fichar', color: '#ea504c', bg: '#fef2f2', icon: XCircle }
      }
      return { label: 'Sin turno', color: '#a39e97', bg: '#f3efe9', icon: XCircle }
    }
    if (ea.attendance.clock_out_at) {
      return { label: 'Completado', color: '#006d5a', bg: '#e8f5f1', icon: CheckCircle }
    }
    return { label: 'En turno', color: '#d4943a', bg: '#fdf6ec', icon: Clock }
  }

  function getInitials(p: Profile) {
    return `${p.first_name[0] ?? ''}${p.last_name[0] ?? ''}`.toUpperCase()
  }

  function getRoleBadge(role: AppRole) {
    const r = ROLES[role]
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
        style={{ color: r.color, backgroundColor: r.bg }}
      >
        {r.emoji} {r.label}
      </span>
    )
  }

  // ---------------------------------------------------------------------------
  // Access control
  // ---------------------------------------------------------------------------

  if (profileLoading) return <LoadingState message="Cargando..." />

  if (!profile || (profile.role !== 'encargado' && profile.role !== 'socio')) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <ShieldAlert className="size-12 text-[#ea504c]" strokeWidth={1.5} />
        <h2 className="font-display text-xl font-semibold text-[#3d2c24]">Acceso restringido</h2>
        <p className="text-sm text-[#a39e97]">Solo el encargado puede gestionar el equipo.</p>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-28">
      {/* Header */}
      <FadeIn className="flex items-center justify-between pt-2">
        <h1 className="font-display text-2xl font-bold text-[#3d2c24]">Equipo</h1>
        <Link
          href="/equipo/turnos"
          className="flex items-center gap-1.5 rounded-xl bg-[#f0f7f5] px-3 py-2 text-xs font-medium text-[#006d5a] transition hover:bg-[#e0efe9]"
        >
          <Calendar className="size-3.5" />
          Turnos
        </Link>
      </FadeIn>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-[#f3efe9] p-1">
        <button
          onClick={() => setTab('asistencia')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            tab === 'asistencia'
              ? 'bg-white text-[#3d2c24] shadow-sm'
              : 'text-[#a39e97] hover:text-[#3d2c24]'
          }`}
        >
          <ClipboardList className="size-4" />
          Asistencia
        </button>
        <button
          onClick={() => setTab('equipo')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
            tab === 'equipo'
              ? 'bg-white text-[#3d2c24] shadow-sm'
              : 'text-[#a39e97] hover:text-[#3d2c24]'
          }`}
        >
          <Users className="size-4" />
          Miembros
        </button>
      </div>

      {/* ================================================================= */}
      {/* TAB: ASISTENCIA                                                    */}
      {/* ================================================================= */}
      {tab === 'asistencia' && (
        <div className="space-y-4">
          {/* Date picker */}
          <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-[#ebe6df]">
            <button
              onClick={() => goDay(-1)}
              className="icon-btn"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold capitalize text-[#3d2c24]">
                {isToday
                  ? 'Hoy'
                  : format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
              </p>
              {isToday && (
                <p className="text-xs capitalize text-[#a39e97]">
                  {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
                </p>
              )}
            </div>
            <button
              onClick={() => goDay(1)}
              disabled={isToday}
              className="icon-btn disabled:opacity-30"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>

          {/* Summary badges */}
          {!loading && (
            <div className="flex flex-wrap gap-2">
              {(() => {
                const withShift = employees.filter((e) => e.hasShiftToday)
                const completed = withShift.filter((e) => e.attendance?.clock_out_at).length
                const inProgress = withShift.filter(
                  (e) => e.attendance && !e.attendance.clock_out_at,
                ).length
                const missing = withShift.filter((e) => !e.attendance).length
                return (
                  <>
                    <span className="rounded-full bg-[#e8f5f1] px-3 py-1 text-xs font-medium text-[#006d5a]">
                      {completed} completados
                    </span>
                    <span className="rounded-full bg-[#fdf6ec] px-3 py-1 text-xs font-medium text-[#d4943a]">
                      {inProgress} en turno
                    </span>
                    <span className="rounded-full bg-[#fef2f2] px-3 py-1 text-xs font-medium text-[#ea504c]">
                      {missing} sin fichar
                    </span>
                  </>
                )
              })()}
            </div>
          )}

          {/* Search input */}
          {!loading && employees.length > 0 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre o rol..."
                className="w-full rounded-xl border border-[#ebe6df] bg-white py-2.5 pl-9 pr-3 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
              />
            </div>
          )}

          {/* Employee list — agrupado por con/sin turno hoy */}
          {loading ? (
            <LoadingState message="Cargando asistencia..." />
          ) : employees.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Sin empleados"
              description="No hay empleados activos registrados"
            />
          ) : (() => {
            const q = search.trim().toLowerCase()
            const matchSearch = (e: EmployeeAttendance) =>
              !q ||
              `${e.profile.first_name} ${e.profile.last_name}`.toLowerCase().includes(q) ||
              e.profile.role.toLowerCase().includes(q)
            const filtered = employees.filter(matchSearch)
            const withShift = filtered.filter((e) => e.hasShiftToday)
            const withoutShift = filtered.filter((e) => !e.hasShiftToday)

            const renderRow = (ea: EmployeeAttendance) => {
              const status = getAttendanceStatus(ea)
              const StatusIcon = status.icon
              return (
                <div
                  key={ea.profile.id}
                  className="flex flex-col rounded-xl bg-white shadow-sm ring-1 ring-[#ebe6df]"
                  style={{ borderLeftWidth: '3px', borderLeftColor: status.color }}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div
                      className="flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: ROLES[ea.profile.role]?.color ?? '#a39e97' }}
                    >
                      {getInitials(ea.profile)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-[#3d2c24]">
                          {ea.profile.first_name} {ea.profile.last_name}
                        </p>
                        {getRoleBadge(puestoDe(ea.profile))}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-[#a39e97]">
                        {ea.hasShiftToday && ea.shiftStart && ea.shiftEnd && (
                          <span className="rounded-md bg-[#f3efe9] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[#6b5d52]">
                            {ea.shiftStart.slice(0, 5)}–{ea.shiftEnd.slice(0, 5)}
                          </span>
                        )}
                        {ea.attendance ? (
                          <>
                            <span className="tabular-nums">
                              {format(new Date(ea.attendance.clock_in_at), 'HH:mm')}
                            </span>
                            <span>→</span>
                            <span className="tabular-nums">
                              {ea.attendance.clock_out_at
                                ? format(new Date(ea.attendance.clock_out_at), 'HH:mm')
                                : '...'}
                            </span>
                          </>
                        ) : ea.ausencia?.nota ? (
                          <span className="truncate italic">“{ea.ausencia.nota}”</span>
                        ) : (
                          <span>Sin registro</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{ color: status.color, backgroundColor: status.bg }}
                      >
                        <StatusIcon className="size-3" />
                        {status.label}
                      </span>
                      {isManager && !ea.attendance && ea.hasShiftToday && (
                        <button
                          onClick={() => {
                            if (motivoUserId === ea.profile.id) { setMotivoUserId(null); return }
                            setMotivoUserId(ea.profile.id)
                            setMotivoSel(ea.ausencia?.motivo ?? null)
                            setMotivoNota(ea.ausencia?.nota ?? '')
                          }}
                          className="rounded-lg px-2 py-1.5 text-xs font-semibold text-[#3b6ab5] hover:bg-[#eef3fb]"
                          title="Anotar por qué no fichó"
                        >
                          {ea.ausencia ? 'Cambiar' : '¿Por qué?'}
                        </button>
                      )}
                      {isManager && isToday && !ea.attendance && ea.hasShiftToday && !ea.ausencia && (
                        <button
                          onClick={() => handleLlego(ea.profile.id, ea.profile.first_name ?? '')}
                          disabled={!!marcandoId}
                          className="flex items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          title="Marcarle la entrada"
                        >
                          {marcandoId === ea.profile.id ? <Loader2 className="size-3 animate-spin" /> : <UserCheck className="size-3.5" />}
                          Llegó
                        </button>
                      )}
                      {isManager && ea.attendance && (
                        <button
                          onClick={() => {
                            if (editingEgresoId === ea.attendance!.id) {
                              setEditingEgresoId(null)
                            } else {
                              setEditingEgresoId(ea.attendance!.id)
                              const egreso = ea.attendance!.clock_out_at
                                ? format(new Date(ea.attendance!.clock_out_at), 'HH:mm')
                                : ''
                              setEgresoTime(egreso)
                              setEgresoOriginal(egreso)
                              const ingreso = format(new Date(ea.attendance!.clock_in_at), 'HH:mm')
                              setIngresoTime(ingreso)
                              setIngresoOriginal(ingreso)
                              setEgresoReason('')
                            }
                          }}
                          className="rounded-lg p-1.5 text-[#a39e97] hover:bg-[#f3efe9] hover:text-[#3d2c24]"
                          title="Corregir fichaje"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {motivoUserId === ea.profile.id && !ea.attendance && (
                    <div className="mx-3 mb-3 space-y-2 rounded-lg bg-[#faf8f5] p-3">
                      <p className="text-xs font-medium text-[#3d2c24]">¿Por qué no fichó?</p>
                      <div className="flex flex-wrap gap-1.5">
                        {MOTIVOS_AUSENCIA.map((m) => (
                          <button
                            key={m}
                            onClick={() => setMotivoSel(m)}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                              motivoSel === m ? 'bg-[#3d2c24] text-white' : 'bg-white text-[#5c4a42] ring-1 ring-[#ebe6df]'
                            }`}
                          >
                            {ETIQUETA_AUSENCIA[m]}
                          </button>
                        ))}
                      </div>
                      <input
                        value={motivoNota}
                        onChange={(e) => setMotivoNota(e.target.value)}
                        maxLength={300}
                        placeholder="Detalle (opcional): hasta cuándo, certificado, con quién cambió…"
                        className="w-full rounded-lg border border-[#ebe6df] bg-white px-2.5 py-1.5 text-sm placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                      />
                      <div className="flex gap-2">
                        {ea.ausencia ? (
                          <button
                            onClick={() => handleMotivo(ea.profile.id, ea.ausencia!.id)}
                            disabled={savingMotivo}
                            className="flex-1 rounded-lg border border-[#f3d0cf] py-2 text-xs font-semibold text-[#ea504c] hover:bg-white disabled:opacity-50"
                          >
                            Quitar
                          </button>
                        ) : (
                          <button
                            onClick={() => setMotivoUserId(null)}
                            className="flex-1 rounded-lg border border-[#ebe6df] py-2 text-xs font-semibold text-[#a39e97] hover:bg-white"
                          >
                            Cancelar
                          </button>
                        )}
                        <button
                          onClick={() => handleMotivo(ea.profile.id)}
                          disabled={!motivoSel || savingMotivo}
                          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#006d5a] py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {savingMotivo ? <Loader2 className="size-3 animate-spin" /> : null}
                          Guardar
                        </button>
                      </div>
                    </div>
                  )}
                  {editingEgresoId === ea.attendance?.id && ea.attendance && (
                    <div className="mx-3 mb-3 rounded-lg bg-[#faf8f5] p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-1">
                          <span className="block text-xs font-medium text-[#3d2c24]">Entrada</span>
                          <input
                            type="time"
                            value={ingresoTime}
                            onChange={(e) => setIngresoTime(e.target.value)}
                            className="w-full rounded-lg border border-[#ebe6df] bg-white px-2.5 py-1.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-xs font-medium text-[#3d2c24]">Salida</span>
                          <input
                            type="time"
                            value={egresoTime}
                            onChange={(e) => setEgresoTime(e.target.value)}
                            className="w-full rounded-lg border border-[#ebe6df] bg-white px-2.5 py-1.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                          />
                        </label>
                      </div>
                      <input
                        value={egresoReason}
                        onChange={(e) => setEgresoReason(e.target.value)}
                        placeholder="Motivo (opcional)"
                        className="w-full rounded-lg border border-[#ebe6df] bg-white px-2.5 py-1.5 text-sm placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingEgresoId(null)}
                          className="flex-1 rounded-lg border border-[#ebe6df] py-2 text-xs font-semibold text-[#a39e97] hover:bg-white"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => {
                            handleSaveEgreso(
                              ea.attendance!.id,
                              format(selectedDate, 'yyyy-MM-dd'),
                            )
                          }}
                          disabled={((!egresoTime || egresoTime === egresoOriginal) && (!ingresoTime || ingresoTime === ingresoOriginal)) || savingEgreso}
                          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#006d5a] py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {savingEgreso ? <Loader2 className="size-3 animate-spin" /> : null}
                          Guardar
                        </button>
                      </div>
                      {isToday && !ea.attendance.clock_out_at && (
                        <button
                          onClick={() => handleAnular(ea.attendance!.id, ea.profile.first_name ?? '')}
                          disabled={!!anulandoId}
                          className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold text-[#ea504c] hover:bg-[#fef2f2] disabled:opacity-50"
                        >
                          {anulandoId === ea.attendance.id ? <Loader2 className="size-3 animate-spin" /> : null}
                          Anular entrada (marcada por error)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <div className="space-y-5">
                {filtered.length === 0 && q && (
                  <p className="py-6 text-center text-sm text-[#a39e97]">
                    Sin resultados para "{search}"
                  </p>
                )}
                {withShift.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="section-label">Con turno hoy ({withShift.length})</h3>
                    <div className="space-y-2">{withShift.map(renderRow)}</div>
                  </div>
                )}
                {withoutShift.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="section-label">Sin turno hoy ({withoutShift.length})</h3>
                    <div className="space-y-2 opacity-80">{withoutShift.map(renderRow)}</div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB: EQUIPO (MIEMBROS)                                            */}
      {/* ================================================================= */}
      {tab === 'equipo' && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowInactive(!showInactive)}
              className="text-xs font-medium text-[#a39e97] transition hover:text-[#3d2c24]"
            >
              {showInactive ? 'Ocultar inactivos' : 'Mostrar inactivos'}
            </button>
            <Button
              onClick={() => setCreateOpen(true)}
              size="sm"
              className="gap-1.5 bg-[#006d5a] text-white hover:bg-[#005a4a]"
            >
              <Plus className="size-4" />
              Nuevo
            </Button>
          </div>

          {/* Members list */}
          {allProfiles.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Sin miembros"
              description="Creá el primer miembro del equipo"
            />
          ) : (
            <div className="space-y-2">
              {allProfiles.map((p) => (
                <Link
                  key={p.id}
                  href={`/equipo/${p.id}`}
                  className="flex w-full items-center gap-3 rounded-xl bg-white px-4 py-3 text-left shadow-sm ring-1 ring-[#ebe6df] transition hover:ring-[#006d5a]/20"
                >
                  {/* Avatar */}
                  <div
                    className={`flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                      !p.is_active ? 'opacity-40' : ''
                    }`}
                    style={{ backgroundColor: ROLES[p.role]?.color ?? '#a39e97' }}
                  >
                    {getInitials(p)}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className={`truncate text-sm font-semibold ${p.is_active ? 'text-[#3d2c24]' : 'text-[#a39e97] line-through'}`}
                      >
                        {p.first_name} {p.last_name}
                      </p>
                      {getRoleBadge(puestoDe(p))}
                      {!p.is_active && (
                        <span className="rounded-full bg-[#f3efe9] px-2 py-0.5 text-[10px] font-medium text-[#a39e97]">
                          Inactivo
                        </span>
                      )}
                    </div>
                    {p.phone && (
                      <div className="mt-0.5 flex items-center gap-1 text-xs text-[#a39e97]">
                        <Phone className="size-3" />
                        {p.phone}
                      </div>
                    )}
                  </div>

                  <ChevronRight className="size-4 shrink-0 text-[#d1cdc7]" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => mutateProfiles()}
        callerRole={profile?.role as import('@/types/database').AppRole | undefined}
      />
      <EditUserDialog
        open={!!editUser}
        onOpenChange={(open) => { if (!open) setEditUser(null) }}
        user={editUser}
        onUpdated={() => {
          mutateProfiles()
          if (tab === 'asistencia') mutateAttendance()
        }}
      />
    </div>
  )
}
