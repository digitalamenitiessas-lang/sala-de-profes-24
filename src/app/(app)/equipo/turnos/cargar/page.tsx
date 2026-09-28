'use client'

// ---------------------------------------------------------------------------
// Carga semanal de turnos — reemplaza el Excel.
// Modelo mental del equipo: personas × días, con ~8 turnos que se repiten.
// Interacción: tocás el día → elegís la ficha del turno → guardado. Un botón
// "Copiar semana anterior" precarga todo y solo se ajustan las diferencias.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { addDays, addWeeks, format, startOfWeek, subDays } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ArrowLeft, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight,
  ChevronUp, Copy, Loader2, Megaphone, Moon, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import { logAuditClient } from '@/lib/audit'
import { LoadingState } from '@/components/ui/LoadingState'
import { FadeIn } from '@/components/ui/motion'
import type { AppRole, ShiftInsert } from '@/types/database'

type Employee = { id: string; first_name: string; last_name: string; role: AppRole }
type Shift = { id: string; user_id: string; shift_date: string; start_time: string; end_time: string }

const ROLE_SECTIONS: { role: AppRole; label: string }[] = [
  { role: 'encargado', label: 'Encargados' },
  { role: 'cocina', label: 'Cocina' },
  { role: 'chef', label: 'Chef' },
  { role: 'barista', label: 'Baristas' },
  { role: 'runner', label: 'Runners' },
  { role: 'bacha', label: 'Bacha' },
]

// Patrones históricos del Excel del equipo — se complementan con los más
// usados de las últimas 4 semanas.
const DEFAULT_PRESETS: { start: string; end: string }[] = [
  { start: '07:00', end: '16:00' },
  { start: '08:00', end: '16:00' },
  { start: '09:00', end: '16:00' },
  { start: '12:00', end: '18:00' },
  { start: '15:30', end: '22:00' },
  { start: '15:30', end: '00:00' },
  { start: '16:00', end: '00:00' },
  { start: '17:00', end: '00:00' },
]

const hhmm = (t: string) => t.slice(0, 5)
const presetLabel = (p: { start: string; end: string }) => `${hhmm(p.start)}–${hhmm(p.end)}`

export default function CargarTurnosPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const supabase = useMemo(() => createClient(), [])

  // Semana editada: arranca en la PRÓXIMA (el caso de uso real: cargar la que viene)
  const [weekStart, setWeekStart] = useState<Date>(() => addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), 1))
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [frequents, setFrequents] = useState<{ start: string; end: string }[]>(DEFAULT_PRESETS)
  const [loading, setLoading] = useState(true)
  const [copying, setCopying] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const [openEmployee, setOpenEmployee] = useState<string | null>(null)
  const [pickerCell, setPickerCell] = useState<{ userId: string; date: string } | null>(null)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [savingCell, setSavingCell] = useState(false)

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )
  const weekStartStr = format(weekStart, 'yyyy-MM-dd')
  const weekEndStr = format(addDays(weekStart, 6), 'yyyy-MM-dd')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [empRes, shiftRes, histRes] = await Promise.all([
        supabase.from('profiles').select('id, first_name, last_name, role').eq('is_active', true).order('first_name'),
        supabase.from('shifts').select('id, user_id, shift_date, start_time, end_time').gte('shift_date', weekStartStr).lte('shift_date', weekEndStr),
        supabase.from('shifts').select('start_time, end_time').gte('shift_date', format(subDays(new Date(), 28), 'yyyy-MM-dd')).limit(1000),
      ])
      setEmployees((empRes.data ?? []) as Employee[])
      setShifts((shiftRes.data ?? []) as Shift[])

      // Turnos frecuentes reales de las últimas 4 semanas
      const counts = new Map<string, { start: string; end: string; n: number }>()
      for (const s of (histRes.data ?? []) as { start_time: string; end_time: string }[]) {
        const key = `${hhmm(s.start_time)}-${hhmm(s.end_time)}`
        const prev = counts.get(key) ?? { start: hhmm(s.start_time), end: hhmm(s.end_time), n: 0 }
        prev.n++
        counts.set(key, prev)
      }
      const top = Array.from(counts.values()).sort((a, b) => b.n - a.n).slice(0, 8)
      if (top.length >= 4) setFrequents(top)
      else {
        // mezclar históricos con defaults sin duplicar
        const seen = new Set(top.map(t => `${t.start}-${t.end}`))
        setFrequents([...top, ...DEFAULT_PRESETS.filter(p => !seen.has(`${p.start}-${p.end}`))].slice(0, 8))
      }
    } finally {
      setLoading(false)
    }
  }, [supabase, weekStartStr, weekEndStr])

  useEffect(() => { fetchAll() }, [fetchAll])

  const shiftFor = useCallback(
    (userId: string, date: string) => shifts.find(s => s.user_id === userId && s.shift_date === date) ?? null,
    [shifts],
  )

  // --- Acciones por celda: tocar ficha = guardar al instante ---

  async function setShift(userId: string, date: string, start: string, end: string) {
    if (!profile) return
    setSavingCell(true)
    try {
      const existing = shiftFor(userId, date)
      const emp = employees.find(e => e.id === userId)
      if (existing) {
        const { error } = await supabase.from('shifts')
          .update({ start_time: start, end_time: end })
          .eq('id', existing.id)
        if (error) throw error
        setShifts(prev => prev.map(s => s.id === existing.id ? { ...s, start_time: start, end_time: end } : s))
      } else {
        const insertData: ShiftInsert = {
          user_id: userId,
          shift_date: date,
          start_time: start,
          end_time: end,
          shift_role: emp?.role ?? 'runner',
          created_by: profile.id,
        }
        const { data, error } = await supabase.from('shifts').insert(insertData).select('id').single()
        if (error) throw error
        setShifts(prev => [...prev, { id: data.id, user_id: userId, shift_date: date, start_time: start, end_time: end }])
      }
      setPickerCell(null)
    } catch (err) {
      // Mostrar el motivo real (permisos, datos): antes solo decía "no se pudo"
      toast.error(`No se pudo guardar el turno${err && typeof err === 'object' && 'message' in err ? `: ${String((err as { message: unknown }).message)}` : ''}`)
    } finally {
      setSavingCell(false)
    }
  }

  async function clearShift(userId: string, date: string) {
    const existing = shiftFor(userId, date)
    if (!existing) { setPickerCell(null); return }
    setSavingCell(true)
    try {
      const { error } = await supabase.from('shifts').delete().eq('id', existing.id)
      if (error) throw error
      setShifts(prev => prev.filter(s => s.id !== existing.id))
      setPickerCell(null)
    } catch (err) {
      toast.error(`No se pudo borrar el turno${err && typeof err === 'object' && 'message' in err ? `: ${String((err as { message: unknown }).message)}` : ''}`)
    } finally {
      setSavingCell(false)
    }
  }

  // --- Copiar semana anterior ---

  async function copyPreviousWeek() {
    if (!profile) return
    setCopying(true)
    try {
      // La semana anterior; si está vacía, la última semana con turnos
      // (hasta 8 semanas atrás): así se puede retomar después de un parate.
      let semanasAtras = 0
      let prevShifts: Pick<ShiftInsert, 'user_id' | 'shift_date' | 'start_time' | 'end_time' | 'shift_role'>[] = []
      for (let k = 1; k <= 8 && prevShifts.length === 0; k++) {
        const { data, error } = await supabase
          .from('shifts')
          .select('user_id, shift_date, start_time, end_time, shift_role')
          .gte('shift_date', format(addDays(weekStart, -7 * k), 'yyyy-MM-dd'))
          .lte('shift_date', format(addDays(weekStart, -7 * k + 6), 'yyyy-MM-dd'))
        if (error) throw error
        if (data && data.length > 0) { prevShifts = data as typeof prevShifts; semanasAtras = k }
      }
      if (prevShifts.length === 0) {
        toast.error('No hay turnos cargados en las últimas 8 semanas para copiar')
        return
      }

      const existingKeys = new Set(shifts.map(s => `${s.user_id}|${s.shift_date}`))
      const activeIds = new Set(employees.map(e => e.id))
      const rows: ShiftInsert[] = []
      for (const s of prevShifts) {
        if (!activeIds.has(s.user_id)) continue
        const newDate = format(addDays(new Date(s.shift_date + 'T12:00:00'), 7 * semanasAtras), 'yyyy-MM-dd')
        if (existingKeys.has(`${s.user_id}|${newDate}`)) continue
        rows.push({
          user_id: s.user_id,
          shift_date: newDate,
          start_time: s.start_time,
          end_time: s.end_time,
          shift_role: s.shift_role,
          created_by: profile.id,
        })
      }

      if (rows.length === 0) {
        toast.success('Nada para copiar: la semana ya está cargada')
        return
      }

      const { error: insErr } = await supabase.from('shifts').insert(rows)
      if (insErr) throw insErr
      toast.success(`${rows.length} turnos copiados ${semanasAtras === 1 ? 'de la semana anterior' : `de la semana del ${format(addDays(weekStart, -7 * semanasAtras), 'd/M')}`}`)
      logAuditClient({ userId: profile.id, userName: profile.first_name ?? null, action: 'copy_week_shifts', module: 'turnos', entityType: 'shift', description: `Copió ${rows.length} turnos a la semana del ${weekStartStr}` })
      await fetchAll()
    } catch (err) {
      toast.error(`Error al copiar los turnos${err && typeof err === 'object' && 'message' in err ? `: ${String((err as { message: unknown }).message)}` : ''}`)
    } finally {
      setCopying(false)
    }
  }

  // --- Notificar al equipo ---

  async function notifyTeam() {
    if (!profile) return
    setNotifying(true)
    try {
      const { error } = await supabase.from('announcements').insert({
        author_id: profile.id,
        type: 'operativo',
        priority: 'alta',
        title: `🗓️ Turnos de la semana del ${format(weekStart, "d 'de' MMMM", { locale: es })}`,
        body: 'Ya están cargados los turnos de la semana. Revisá los tuyos en "Mis horarios".',
        scope: 'all',
        is_active: true,
        expires_at: addDays(weekStart, 7).toISOString(),
      })
      if (error) throw error
      toast.success('Equipo notificado 📣')
    } catch {
      toast.error('No se pudo notificar')
    } finally {
      setNotifying(false)
    }
  }

  // --- Derivados para el resumen ---

  const summary = useMemo(() => {
    const withShifts = new Set(shifts.map(s => s.user_id))
    const missing = employees.filter(e => !withShifts.has(e.id))
    return { total: shifts.length, missing }
  }, [shifts, employees])

  if (profileLoading || loading) return <LoadingState />

  if (profile && !isManagerOrAbove(profile.role)) {
    return (
      <div className="mx-auto max-w-lg pb-28 pt-8 text-center">
        <p className="text-sm font-medium text-[#3d2c24]">Solo encargados y socios pueden cargar turnos.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-28">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center gap-3">
          <Link href="/equipo/turnos" className="rounded-xl bg-[#f3efe9] p-2 text-[#3d2c24]">
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-[#3d2c24]">Cargar turnos</h1>
            <p className="text-xs text-[#a39e97]">Tocá el día, elegí el horario. Nada de Excel.</p>
          </div>
        </div>
      </FadeIn>

      {/* Selector de semana */}
      <div className="flex items-center justify-between rounded-2xl bg-white px-3 py-2.5 ring-1 ring-[#ebe6df]">
        <button onClick={() => setWeekStart(w => addWeeks(w, -1))} className="rounded-lg p-2 hover:bg-[#f3efe9]">
          <ChevronLeft className="size-4 text-[#3d2c24]" />
        </button>
        <div className="text-center">
          <p className="flex items-center justify-center gap-1.5 text-sm font-bold text-[#3d2c24]">
            <CalendarDays className="size-3.5 text-[#006d5a]" />
            Semana del {format(weekStart, "d 'de' MMMM", { locale: es })}
          </p>
          <p className="text-[10px] text-[#a39e97]">
            {summary.total} turnos cargados
            {summary.missing.length > 0 && ` · sin turnos: ${summary.missing.slice(0, 3).map(e => e.first_name).join(', ')}${summary.missing.length > 3 ? ` +${summary.missing.length - 3}` : ''}`}
          </p>
        </div>
        <button onClick={() => setWeekStart(w => addWeeks(w, 1))} className="rounded-lg p-2 hover:bg-[#f3efe9]">
          <ChevronRight className="size-4 text-[#3d2c24]" />
        </button>
      </div>

      {/* Acciones de semana */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={copyPreviousWeek}
          disabled={copying}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-[#3d2c24] py-2.5 text-xs font-semibold text-white active:scale-[0.98] disabled:opacity-50"
        >
          {copying ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
          Copiar semana anterior
        </button>
        <button
          onClick={notifyTeam}
          disabled={notifying || summary.total === 0}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-2.5 text-xs font-semibold text-white active:scale-[0.98] disabled:opacity-50"
        >
          {notifying ? <Loader2 className="size-3.5 animate-spin" /> : <Megaphone className="size-3.5" />}
          Notificar al equipo
        </button>
      </div>

      {/* Empleados por rol */}
      {ROLE_SECTIONS.map(({ role, label }) => {
        const roleEmployees = employees.filter(e => e.role === role)
        if (roleEmployees.length === 0) return null
        return (
          <div key={role} className="space-y-1.5">
            <h2 className="px-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#a39e97]">{label}</h2>
            {roleEmployees.map(emp => {
              const isOpen = openEmployee === emp.id
              const empShifts = shifts.filter(s => s.user_id === emp.id)
              return (
                <div key={emp.id} className="rounded-2xl bg-white ring-1 ring-[#ebe6df]">
                  <button
                    onClick={() => { setOpenEmployee(isOpen ? null : emp.id); setPickerCell(null) }}
                    className="flex w-full items-center justify-between px-4 py-3"
                  >
                    <span className="text-sm font-semibold text-[#3d2c24]">
                      {emp.first_name} {emp.last_name}
                    </span>
                    <span className="flex items-center gap-2 text-[10px] text-[#a39e97]">
                      {empShifts.length > 0 ? `${empShifts.length} turnos` : 'sin turnos'}
                      {isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    </span>
                  </button>

                  {isOpen && (
                    <div className="space-y-1 border-t border-[#ebe6df]/60 px-3 py-2">
                      {weekDays.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd')
                        const shift = shiftFor(emp.id, dateStr)
                        const isPicking = pickerCell?.userId === emp.id && pickerCell?.date === dateStr
                        return (
                          <div key={dateStr}>
                            <button
                              onClick={() => {
                                setPickerCell(isPicking ? null : { userId: emp.id, date: dateStr })
                                setCustomStart(shift ? hhmm(shift.start_time) : '')
                                setCustomEnd(shift ? hhmm(shift.end_time) : '')
                              }}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors ${
                                isPicking ? 'bg-[#e8f5f1] ring-1 ring-[#006d5a]/30' : 'hover:bg-[#faf8f5]'
                              }`}
                            >
                              <span className="text-xs font-medium capitalize text-[#3d2c24]">
                                {format(day, 'EEE d', { locale: es })}
                              </span>
                              {shift ? (
                                <span className="rounded-full bg-[#e8f5f1] px-2.5 py-1 text-[11px] font-bold text-[#006d5a]">
                                  {hhmm(shift.start_time)}–{hhmm(shift.end_time)}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 rounded-full bg-[#f3efe9] px-2.5 py-1 text-[11px] font-semibold text-[#a39e97]">
                                  <Moon className="size-3" /> Descanso
                                </span>
                              )}
                            </button>

                            {isPicking && (
                              <div className="mt-1 space-y-2 rounded-xl bg-[#faf8f5] p-2.5">
                                <div className="flex flex-wrap gap-1.5">
                                  {frequents.map(p => (
                                    <button
                                      key={presetLabel(p)}
                                      disabled={savingCell}
                                      onClick={() => setShift(emp.id, dateStr, p.start, p.end)}
                                      className="rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-[#3d2c24] ring-1 ring-[#ebe6df] transition-all hover:ring-[#006d5a] active:scale-95 disabled:opacity-50"
                                    >
                                      {presetLabel(p)}
                                    </button>
                                  ))}
                                  <button
                                    disabled={savingCell}
                                    onClick={() => clearShift(emp.id, dateStr)}
                                    className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-[#ea504c] ring-1 ring-[#f3d0cf] active:scale-95 disabled:opacity-50"
                                  >
                                    <Trash2 className="size-3" /> Descanso
                                  </button>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="time" value={customStart}
                                    onChange={e => setCustomStart(e.target.value)}
                                    className="flex-1 rounded-lg border border-[#ebe6df] bg-white px-2 py-1.5 text-xs"
                                  />
                                  <span className="text-[10px] text-[#a39e97]">a</span>
                                  <input
                                    type="time" value={customEnd}
                                    onChange={e => setCustomEnd(e.target.value)}
                                    className="flex-1 rounded-lg border border-[#ebe6df] bg-white px-2 py-1.5 text-xs"
                                  />
                                  <button
                                    disabled={savingCell || !customStart || !customEnd}
                                    onClick={() => setShift(emp.id, dateStr, customStart, customEnd)}
                                    className="rounded-lg bg-[#006d5a] p-2 text-white active:scale-95 disabled:opacity-40"
                                  >
                                    {savingCell ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
