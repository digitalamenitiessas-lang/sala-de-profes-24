import { NextResponse } from 'next/server'
import { mustClockIn } from '@/lib/roles'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/attendance/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
// ---------------------------------------------------------------------------
// Panel de asistencia para encargados/socios, calculado contra el modelo REAL:
// attendance_logs (una fila por jornada, con GPS y flags) + shifts (turnos
// cargados) + profiles.
//
// Historia: la versión anterior llamaba a una función `attendance_dashboard`
// y a tablas `attendance_anomalies` / `wifi_access_points` que NUNCA
// existieron en esta base — la pantalla llevaba rota desde entonces.
//
// Por empleado devuelve, además del estado (presente / salió / sin fichar):
//   - horas trabajadas del período (los turnos abiertos cuentan hasta ahora)
//   - horas programadas del período (según shifts, con vuelta de medianoche)
//   - el turno de HOY y la comparación contra la fichada real:
//     minutos de llegada tarde, salida anticipada, egreso automático,
//     "no fichó" cuando el turno ya empezó hace rato.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

type LogRow = {
  user_id: string
  operative_date: string
  clock_in_at: string
  clock_out_at: string | null
  status: string
  clock_out_type: string | null
  is_suspicious: boolean | null
}

type ShiftRow = {
  user_id: string
  shift_date: string
  start_time: string
  end_time: string
}

const TEAM_ROLES = ['encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha'] as const

// Día operativo (corte 06:00): misma regla que al fichar
function todayAR(): string {
  return fechaOperativa()
}

/** timestamp absoluto (UTC) de una hora local AR en una fecha dada */
function arTimestamp(date: string, time: string, nextDay = false): Date {
  const d = new Date(`${date}T12:00:00Z`)
  if (nextDay) d.setUTCDate(d.getUTCDate() + 1)
  const dateStr = d.toISOString().slice(0, 10)
  return new Date(`${dateStr}T${time.slice(0, 5)}:00-03:00`)
}

/** Horas de un turno programado, con vuelta de medianoche (18:00→00:00 = 6h). */
function scheduledHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let hours = (eh * 60 + em - (sh * 60 + sm)) / 60
  if (hours <= 0) hours += 24
  return hours
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['socio', 'encargado'].includes(profile.role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const hoy = todayAR()
  const from = searchParams.get('from') ?? hoy
  const to = searchParams.get('to') ?? from

  const admin = createAdminClient()
  const now = new Date()

  const [profilesRes, logsRes, shiftsRes] = await Promise.all([
    admin
      .from('profiles')
      .select('id, first_name, last_name, role')
      .eq('is_active', true),
    admin
      .from('attendance_logs')
      .select('user_id, operative_date, clock_in_at, clock_out_at, status, clock_out_type, is_suspicious')
      .gte('operative_date', from)
      .lte('operative_date', to),
    admin
      .from('shifts')
      .select('user_id, shift_date, start_time, end_time')
      .gte('shift_date', from)
      .lte('shift_date', to),
  ])

  if (profilesRes.error) return NextResponse.json({ error: profilesRes.error.message }, { status: 500 })
  if (logsRes.error) return NextResponse.json({ error: logsRes.error.message }, { status: 500 })

  const logs = (logsRes.data ?? []) as LogRow[]
  const shifts = (shiftsRes.data ?? []) as ShiftRow[]

  const logsByUser = new Map<string, LogRow[]>()
  for (const l of logs) logsByUser.set(l.user_id, [...(logsByUser.get(l.user_id) ?? []), l])
  const shiftsByUser = new Map<string, ShiftRow[]>()
  for (const s of shifts) shiftsByUser.set(s.user_id, [...(shiftsByUser.get(s.user_id) ?? []), s])

  // Quien tiene que fichar (incluye socios que fichan, ej. Ricardo)
  const employees = (profilesRes.data ?? []).filter((p) => mustClockIn(p) || (TEAM_ROLES as readonly string[]).includes(p.role)).map((p) => {
    const myLogs = (logsByUser.get(p.id) ?? []).sort((a, b) => a.clock_in_at.localeCompare(b.clock_in_at))
    const myShifts = shiftsByUser.get(p.id) ?? []

    // Horas trabajadas del período: turno abierto cuenta hasta ahora.
    let totalMs = 0
    const workedDays = new Set<string>()
    let suspicious = 0
    for (const l of myLogs) {
      const start = new Date(l.clock_in_at).getTime()
      const end = l.clock_out_at ? new Date(l.clock_out_at).getTime() : now.getTime()
      if (end > start) { totalMs += end - start; workedDays.add(l.operative_date) }
      if (l.is_suspicious) suspicious++
    }

    const totalScheduled = myShifts.reduce((acc, s) => acc + scheduledHours(s.start_time, s.end_time), 0)

    const openLog = myLogs.find((l) => l.status === 'open' && !l.clock_out_at) ?? null
    const lastLog = myLogs[myLogs.length - 1] ?? null

    // ── Precisión de HOY: turno programado vs fichada real ──
    const shiftToday = myShifts
      .filter((s) => s.shift_date === hoy)
      .sort((a, b) => a.start_time.localeCompare(b.start_time))[0] ?? null
    const logToday = myLogs.filter((l) => l.operative_date === hoy).sort((a, b) => a.clock_in_at.localeCompare(b.clock_in_at))[0] ?? null

    let lateMin: number | null = null
    let leftEarlyMin: number | null = null
    let noShow = false
    if (shiftToday) {
      const shiftStart = arTimestamp(hoy, shiftToday.start_time)
      const endsNextDay = shiftToday.end_time <= shiftToday.start_time
      const shiftEnd = arTimestamp(hoy, shiftToday.end_time, endsNextDay)
      if (logToday) {
        lateMin = Math.round((new Date(logToday.clock_in_at).getTime() - shiftStart.getTime()) / 60000)
        if (logToday.clock_out_at && logToday.clock_out_type !== 'auto') {
          const early = Math.round((shiftEnd.getTime() - new Date(logToday.clock_out_at).getTime()) / 60000)
          if (early > 0) leftEarlyMin = early
        }
      } else {
        // Turno arrancó hace más de 15 minutos y no fichó
        noShow = now.getTime() > shiftStart.getTime() + 15 * 60000 && now.getTime() < shiftEnd.getTime() + 6 * 3600000
      }
    }

    return {
      employee_id: p.id,
      first_name: p.first_name,
      last_name: p.last_name,
      role: p.role,
      is_currently_in: Boolean(openLog),
      last_event_time: lastLog ? (lastLog.clock_out_at ?? lastLog.clock_in_at) : null,
      days_worked: workedDays.size,
      total_hours: Math.round((totalMs / 3600000) * 100) / 100,
      // Mantiene el nombre histórico del campo: hoy cuenta fichajes sospechosos.
      open_anomalies: suspicious,
      scheduled_hours: Math.round(totalScheduled * 100) / 100,
      shift_today: shiftToday ? { start: shiftToday.start_time.slice(0, 5), end: shiftToday.end_time.slice(0, 5) } : null,
      today_in: logToday?.clock_in_at ?? null,
      today_out: logToday?.clock_out_at ?? null,
      today_out_type: logToday?.clock_out_type ?? null,
      late_min: lateMin,
      left_early_min: leftEarlyMin,
      no_show: noShow,
    }
  })

  // Resumen del rango para el encabezado de la pantalla
  const summary = {
    present_now: employees.filter((e) => e.is_currently_in).length,
    with_shift_today: employees.filter((e) => e.shift_today).length,
    no_show_now: employees.filter((e) => e.no_show).length,
    worked_hours: Math.round(employees.reduce((a, e) => a + e.total_hours, 0) * 10) / 10,
    scheduled_hours: Math.round(employees.reduce((a, e) => a + e.scheduled_hours, 0) * 10) / 10,
  }

  return NextResponse.json({ employees, summary, from, to })
}
