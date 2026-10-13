import type { SupabaseClient } from '@supabase/supabase-js'
import { differenceInMinutes, parseISO } from 'date-fns'
import { ventanaTurno } from '@/lib/turnos/rol-del-turno'
import { ETIQUETA_AUSENCIA, type MotivoAusencia } from '@/lib/attendance/ausencias'

// Hora en Argentina (el servidor corre en UTC: format() mostraba 3 h corridas)
const horaAR = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })

// ---------------------------------------------------------------------------
// Liquidación de un período: horas y sueldo por persona.
// La usan la pantalla (/api/admin/liquidacion) y el PDF (/api/admin/liquidacion/pdf).
//
// Cada fichaje se paga con la tarifa del ROL DE SU TURNO de ese día (un
// runner que hace un turno de encargado cobra esas horas como encargado).
// Si no hay turno cargado, se usa el rol del perfil. Los socios no se liquidan.
//
// Reglas de pago (Marco, 10/10/2026):
//   · Llegar antes no cuenta: se paga desde el inicio del turno.
//   · Irse antes resta: se paga hasta la salida.
//   · Quedarse después solo cuenta si el encargado lo autorizó (corrigió la
//     salida en Equipo → clock_out_type 'edited'); si no, hasta el fin del turno.
//   · Sin turno cargado, o turno mal cargado (lo fichado cae casi todo fuera
//     del turno): las horas fichadas, marcado para revisar.
//   · Feriado (tabla feriados, por fecha operativa): 50% más.
//   · Licencia y demás ausencias: no suman horas (se informan).
// ---------------------------------------------------------------------------

export async function calcularLiquidacion(admin: SupabaseClient, from: string, to: string) {
  // Fetch all attendance logs in period
  const [logsRes, profilesRes, ratesRes, shiftsRes, ausenciasRes, feriadosRes] = await Promise.all([
    admin.from('attendance_logs')
      .select('id, user_id, operative_date, clock_in_at, clock_out_at, status, clock_out_type')
      .gte('operative_date', from)
      .lte('operative_date', to)
      .order('operative_date'),
    admin.from('profiles')
      .select('id, first_name, last_name, role, puesto')
      .eq('is_active', true),
    admin.from('payroll_rates')
      .select('role, hourly_rate, label'),
    admin.from('shifts')
      .select('user_id, shift_date, start_time, end_time, shift_role')
      .gte('shift_date', from)
      .lte('shift_date', to),
    admin.from('ausencias')
      .select('user_id, fecha, motivo, nota')
      .gte('fecha', from)
      .lte('fecha', to)
      .order('fecha'),
    admin.from('feriados')
      .select('fecha, nombre')
      .gte('fecha', from)
      .lte('fecha', to)
      .order('fecha'),
  ])
  const feriados = new Map(((feriadosRes.data ?? []) as { fecha: string; nombre: string }[]).map((f) => [f.fecha, f.nombre]))
  // Por qué no fichó (lo anota el encargado en Equipo): no suma horas, se informa
  const ausenciasPor = new Map<string, { fecha: string; motivo: string; etiqueta: string; nota: string | null }[]>()
  for (const a of (ausenciasRes.data ?? []) as { user_id: string; fecha: string; motivo: MotivoAusencia; nota: string | null }[]) {
    const lista = ausenciasPor.get(a.user_id) ?? []
    lista.push({ fecha: a.fecha, motivo: a.motivo, etiqueta: ETIQUETA_AUSENCIA[a.motivo] ?? a.motivo, nota: a.nota })
    ausenciasPor.set(a.user_id, lista)
  }

  const logs = logsRes.data
  const profiles = profilesRes.data
  const rates = ratesRes.data ?? []

  // Build rate map
  const rateMap = new Map<string, number>()
  for (const r of rates) rateMap.set(r.role, Number(r.hourly_rate))

  if (!logs || !profiles) throw new Error('Error al consultar datos')

  // Turnos por persona y día, para saber con qué rol trabajó cada fichaje
  // Sin turno: el puesto (el cajero tiene rol encargado y puesto cajero)
  const perfilRol = new Map(profiles.map((p) => [p.id, (p.puesto ?? p.role) as string]))
  const turnos = new Map<string, { rol: string; inicio: number; fin: number }[]>()
  for (const t of (shiftsRes.data ?? []) as { user_id: string; shift_date: string; start_time: string; end_time: string; shift_role: string | null }[]) {
    if (!t.shift_role || !t.start_time || !t.end_time) continue
    const k = `${t.user_id}|${t.shift_date}`
    const lista = turnos.get(k) ?? []
    lista.push({ rol: t.shift_role, ...ventanaTurno(t.shift_date, t.start_time, t.end_time) })
    turnos.set(k, lista)
  }
  /** Turno de ese día que corresponde al fichaje (el que empieza más cerca de la entrada). */
  const turnoDelFichaje = (userId: string, fecha: string, entrada: string) => {
    const lista = turnos.get(`${userId}|${fecha}`)
    if (!lista?.length) return null
    const t = Date.parse(entrada)
    return lista.reduce((a, b) => (Math.abs(b.inicio - t) < Math.abs(a.inicio - t) ? b : a))
  }

  // Aggregate per employee
  const empMap = new Map<string, {
    days: Map<string, { hours: number; hoursFichadas: number; clockIn: string; clockOut: string | null; status: string; clockOutType: string; attendanceId: string; tramos: number; revisar: boolean; motivoRevisar: string | null; role: string; pay: number; feriado: string | null }>
    porRol: Map<string, { hours: number; pay: number }>
    horasFeriado: number
    totalHours: number
    totalDays: number
    missingCheckouts: number
    lateArrivals: number
  }>()

  for (const log of logs) {
    if (!empMap.has(log.user_id)) {
      empMap.set(log.user_id, {
        days: new Map(),
        porRol: new Map(),
        horasFeriado: 0,
        totalHours: 0,
        totalDays: 0,
        missingCheckouts: 0,
        lateArrivals: 0,
      })
    }
    const emp = empMap.get(log.user_id)!

    // Entrada y salida son instantes completos: la diferencia ya cruza la
    // medianoche sola. Si da negativa es un dato mal cargado → 0 h y a revisar
    // (antes sumaba 24 h y pagaba un día de más).
    let hours = 0
    let fichadas = 0
    let revisar = false
    let motivoRevisar: string | null = null
    const turno = turnoDelFichaje(log.user_id, log.operative_date, log.clock_in_at)
    if (log.clock_out_at) {
      fichadas = differenceInMinutes(parseISO(log.clock_out_at), parseISO(log.clock_in_at)) / 60
      if (fichadas < 0 || fichadas > 20) {
        revisar = true
        motivoRevisar = fichadas < 0 ? 'Salida antes de la entrada' : 'Más de 20 horas seguidas'
        fichadas = Math.max(0, fichadas) > 20 ? fichadas : 0
      }
      hours = fichadas
      if (turno && !revisar) {
        // Desde el inicio del turno; hasta la salida, sin pasar el fin del
        // turno salvo que el encargado haya autorizado la salida (edited)
        const desde = Math.max(Date.parse(log.clock_in_at), turno.inicio)
        const out = Date.parse(log.clock_out_at)
        const hasta = log.clock_out_type === 'edited' ? out : Math.min(out, turno.fin)
        hours = Math.max(0, hasta - desde) / 3_600_000
        // Trabajó casi todo fuera del turno cargado: el turno estaba mal
        // cargado (cambio sin actualizar). Trabajó un turno, así que se paga
        // lo fichado (Marco, 10/10/2026) y se avisa para corregir el turno.
        if (fichadas >= 2 && hours < fichadas * 0.5) {
          hours = fichadas
          revisar = true
          motivoRevisar = 'Turno cargado distinto al trabajado: se paga lo fichado. Corregí el turno en Turnos'
        }
      }
    }

    const rol = turno?.rol ?? perfilRol.get(log.user_id) ?? ''
    const feriado = feriados.get(log.operative_date) ?? null
    const pago = hours * (rateMap.get(rol) ?? 0) * (feriado ? 1.5 : 1)
    const acum = emp.porRol.get(rol) ?? { hours: 0, pay: 0 }
    emp.porRol.set(rol, { hours: acum.hours + hours, pay: acum.pay + pago })
    if (feriado) emp.horasFeriado += hours

    // Turno cortado: dos fichajes el mismo día se suman en un solo día
    const prev = emp.days.get(log.operative_date)
    const salida = log.clock_out_at ? horaAR(log.clock_out_at) : null
    emp.days.set(log.operative_date, prev
      ? {
          ...prev,
          hours: Math.round((prev.hours + hours) * 100) / 100,
          hoursFichadas: Math.round((prev.hoursFichadas + fichadas) * 100) / 100,
          clockOut: salida ?? prev.clockOut,
          status: log.status === 'open' ? 'open' : prev.status,
          tramos: prev.tramos + 1,
          revisar: prev.revisar || revisar,
          motivoRevisar: prev.motivoRevisar ?? motivoRevisar,
          role: prev.role === rol ? rol : 'mixto',
          pay: prev.pay + pago,
        }
      : {
          hours: Math.round(hours * 100) / 100,
          hoursFichadas: Math.round(fichadas * 100) / 100,
          feriado,
          clockIn: horaAR(log.clock_in_at),
          clockOut: salida,
          status: log.status,
          clockOutType: (log as Record<string, unknown>).clock_out_type as string ?? 'manual',
          attendanceId: log.id,
          tramos: 1,
          revisar,
          motivoRevisar,
          role: rol,
          pay: pago,
        })

    emp.totalHours += hours
    if (!prev) emp.totalDays++
    if (!log.clock_out_at && log.status === 'open') emp.missingCheckouts++
  }

  // Build result
  const employees = profiles
    .filter(p => (empMap.has(p.id) || ausenciasPor.has(p.id)) && p.role !== 'socio')
    .map(p => {
      const emp = empMap.get(p.id) ?? { days: new Map(), porRol: new Map<string, { hours: number; pay: number }>(), horasFeriado: 0, totalHours: 0, totalDays: 0, missingCheckouts: 0, lateArrivals: 0 }
      const daysArray = Array.from(emp.days.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({ date, ...data, pay: Math.round(data.pay) }))

      const hourlyRate = rateMap.get(p.puesto ?? p.role) ?? 0
      const totalHours = Math.round(emp.totalHours * 100) / 100
      // Cada rol con su tarifa (de mayor a menor cantidad de horas)
      const byRole = [...emp.porRol.entries()]
        .map(([role, h]) => {
          const rate = rateMap.get(role) ?? 0
          // pay ya incluye el 50% de los feriados
          return { role, hours: Math.round(h.hours * 100) / 100, hourlyRate: rate, pay: Math.round(h.pay) }
        })
        .sort((a, b) => b.hours - a.hours)
      const totalPay = byRole.reduce((s, r) => s + r.pay, 0)

      return {
        id: p.id,
        firstName: p.first_name,
        lastName: p.last_name,
        role: p.puesto ?? p.role,
        hourlyRate,
        totalHours,
        totalDays: emp.totalDays,
        avgHoursPerDay: emp.totalDays > 0 ? Math.round((emp.totalHours / emp.totalDays) * 10) / 10 : 0,
        missingCheckouts: emp.missingCheckouts,
        totalPay,
        byRole,
        horasFeriado: Math.round(emp.horasFeriado * 100) / 100,
        ausencias: ausenciasPor.get(p.id) ?? [],
        days: daysArray,
      }
    })
    .sort((a, b) => b.totalHours - a.totalHours)

  return {
    period: { from, to },
    employees,
    rates: rates.map(r => ({ role: r.role, hourlyRate: Number(r.hourly_rate), label: r.label })),
    feriados: [...feriados.entries()].map(([fecha, nombre]) => ({ fecha, nombre })),
    summary: {
      totalEmployees: employees.length,
      totalHours: Math.round(employees.reduce((s, e) => s + e.totalHours, 0) * 100) / 100,
      totalDays: employees.reduce((s, e) => s + e.totalDays, 0),
      totalPay: employees.reduce((s, e) => s + e.totalPay, 0),
      missingCheckouts: employees.reduce((s, e) => s + e.missingCheckouts, 0),
      diasRevisar: employees.reduce((s, e) => s + e.days.filter((d) => d.revisar).length, 0),
    },
  }
}

export type Liquidacion = Awaited<ReturnType<typeof calcularLiquidacion>>
