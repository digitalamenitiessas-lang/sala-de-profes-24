import type { SupabaseClient } from '@supabase/supabase-js'
import { calcularLiquidacion } from '@/lib/liquidacion/calcular'
import { ventasPorDia } from '@/lib/fudo/ventas-diarias'
import { ventanaTurno } from '@/lib/turnos/rol-del-turno'
import { fechaOperativa, instanteDe } from '@/lib/attendance/jornada'
import { ETIQUETA_AUSENCIA, type MotivoAusencia } from '@/lib/attendance/ausencias'

// ---------------------------------------------------------------------------
// Informe de control del personal: asistencia + costo laboral vs ventas
// ---------------------------------------------------------------------------
// Asistencia (por persona): turnos, cuántos fichó, llegadas tarde (>10'),
// salidas antes (>10'), ausencias por motivo, sin fichar sin motivo, horas
// extra autorizadas y por quién, turnos mal cargados, "Llegó" marcados.
// Encargados: qué corrigió, autorizó y anotó cada uno.
// Costo laboral: sueldo del día (misma cuenta que la liquidación) contra lo
// vendido según Fudo (ventas cerradas, con descuentos); por día, por día de
// la semana y por hora (ventas por persona trabajando).
// ---------------------------------------------------------------------------

const TOLERANCIA_MIN = 10
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
// Horas del día operativo en orden (06 → 05 del día siguiente)
const HORAS_OPERATIVAS = Array.from({ length: 24 }, (_, i) => (i + 6) % 24)

type Turno = { user_id: string; shift_date: string; start_time: string; end_time: string; shift_role: string | null; created_by: string | null }
type Log = {
  id: string; user_id: string; operative_date: string; clock_in_at: string; clock_out_at: string | null
  clock_out_type: string | null; clock_in_type: string | null; edited_by: string | null
}

export async function informeControl(admin: SupabaseClient, from: string, to: string) {
  const ayer = fechaOperativa(new Date(Date.now() - 86_400_000))
  const hastaCerrado = to < ayer ? to : ayer // asistencia: solo días ya terminados

  const [liq, ventas, { data: turnosData }, { data: logsData }, { data: ausData }, { data: perfiles }, { data: tareasData }] = await Promise.all([
    calcularLiquidacion(admin, from, to),
    ventasPorDia(admin, from, to),
    admin.from('shifts').select('user_id, shift_date, start_time, end_time, shift_role, created_by').gte('shift_date', from).lte('shift_date', to),
    admin.from('attendance_logs').select('id, user_id, operative_date, clock_in_at, clock_out_at, clock_out_type, clock_in_type, edited_by').gte('operative_date', from).lte('operative_date', to),
    admin.from('ausencias').select('user_id, fecha, motivo, created_by').gte('fecha', from).lte('fecha', to),
    admin.from('profiles').select('id, first_name, last_name, role, puesto, is_active'),
    admin.from('protocolo_tareas').select('fecha, hora, estado, asignado_a, hecho_por, hecho_at, protocolos(nombre)').gte('fecha', from).lte('fecha', hastaCerrado),
  ])
  const turnos = (turnosData ?? []) as Turno[]
  const logs = (logsData ?? []) as Log[]
  const ausencias = (ausData ?? []) as { user_id: string; fecha: string; motivo: MotivoAusencia; created_by: string | null }[]
  const perfil = new Map(((perfiles ?? []) as { id: string; first_name: string; last_name: string; role: string; puesto: string | null; is_active: boolean }[]).map((p) => [p.id, p]))
  const nombre = (id: string | null) => (id && perfil.get(id) ? `${perfil.get(id)!.first_name} ${perfil.get(id)!.last_name}` : 'Sin dato')

  // ---------------- Asistencia por persona ----------------
  type Fila = {
    id: string; nombre: string; puesto: string
    turnos: number; fichados: number; cumplimiento: number
    tarde: number; minutosTardeProm: number; salidasAntes: number
    sinFicharSinMotivo: number; ausencias: Record<string, number>
    horasExtra: number; extraAutorizadaPor: string[]; malCargados: number; llegoPorEncargado: number
  }
  const filas = new Map<string, Fila & { _minTarde: number }>()
  const fila = (id: string) => {
    let f = filas.get(id)
    if (!f) {
      const p = perfil.get(id)
      f = {
        id, nombre: nombre(id), puesto: p?.puesto ?? p?.role ?? '',
        turnos: 0, fichados: 0, cumplimiento: 0, tarde: 0, minutosTardeProm: 0, salidasAntes: 0,
        sinFicharSinMotivo: 0, ausencias: {}, horasExtra: 0, extraAutorizadaPor: [], malCargados: 0, llegoPorEncargado: 0, _minTarde: 0,
      }
      filas.set(id, f)
    }
    return f
  }

  const turnosPor = new Map<string, Turno[]>()
  for (const t of turnos) {
    const k = `${t.user_id}|${t.shift_date}`
    turnosPor.set(k, [...(turnosPor.get(k) ?? []), t])
  }
  const logsPor = new Map<string, Log[]>()
  for (const l of logs) {
    const k = `${l.user_id}|${l.operative_date}`
    logsPor.set(k, [...(logsPor.get(k) ?? []), l])
  }
  const ausPor = new Map(ausencias.map((a) => [`${a.user_id}|${a.fecha}`, a]))

  // Días con turno (ya terminados): cumplimiento y ausencias
  for (const [k, ts] of turnosPor) {
    const [uid, fecha] = k.split('|')
    if (fecha > hastaCerrado || perfil.get(uid)?.role === 'socio' || !ts.length) continue
    const f = fila(uid)
    f.turnos++
    if (logsPor.has(k)) f.fichados++
    else {
      const a = ausPor.get(k)
      if (a) f.ausencias[ETIQUETA_AUSENCIA[a.motivo] ?? a.motivo] = (f.ausencias[ETIQUETA_AUSENCIA[a.motivo] ?? a.motivo] ?? 0) + 1
      else f.sinFicharSinMotivo++
    }
  }

  // Días con turno mal cargado (trabajó en otro horario): no son tardanzas
  const malCargado = new Set<string>()
  for (const emp of liq.employees) for (const d of emp.days) if (d.revisar) malCargado.add(`${emp.id}|${d.date}`)

  // Fichajes: tarde, salidas antes, horas extra, "Llegó"
  for (const l of logs) {
    if (perfil.get(l.user_id)?.role === 'socio') continue
    const f = fila(l.user_id)
    if (l.clock_in_type === 'encargado') f.llegoPorEncargado++
    const ts = turnosPor.get(`${l.user_id}|${l.operative_date}`)
    if (!ts?.length || malCargado.has(`${l.user_id}|${l.operative_date}`)) continue
    const entrada = Date.parse(l.clock_in_at)
    const t = ts.map((x) => ({ ...x, ...ventanaTurno(x.shift_date, x.start_time, x.end_time) }))
      .reduce((a, b) => (Math.abs(b.inicio - entrada) < Math.abs(a.inicio - entrada) ? b : a))
    const tardeMin = (entrada - t.inicio) / 60_000
    if (tardeMin > TOLERANCIA_MIN && tardeMin < 6 * 60) { f.tarde++; f._minTarde += tardeMin }
    if (l.clock_out_at) {
      const salida = Date.parse(l.clock_out_at)
      if (l.clock_out_type !== 'auto' && salida < t.fin - TOLERANCIA_MIN * 60_000 && salida > t.inicio) f.salidasAntes++
      if (l.clock_out_type === 'edited' && salida > t.fin) {
        f.horasExtra += (salida - t.fin) / 3_600_000
        const quien = nombre(l.edited_by)
        if (!f.extraAutorizadaPor.includes(quien)) f.extraAutorizadaPor.push(quien)
      }
    }
  }
  for (const e of liq.employees) {
    const f = filas.get(e.id)
    if (f) f.malCargados = e.days.filter((d) => d.revisar).length
  }
  const asistencia: Fila[] = [...filas.values()]
    .map(({ _minTarde, ...f }) => ({
      ...f,
      cumplimiento: f.turnos > 0 ? Math.round((100 * f.fichados) / f.turnos) : 100,
      minutosTardeProm: f.tarde > 0 ? Math.round(_minTarde / f.tarde) : 0,
      horasExtra: Math.round(f.horasExtra * 10) / 10,
    }))
    .filter((f) => f.turnos > 0 || f.fichados > 0)
    .sort((a, b) => a.cumplimiento - b.cumplimiento || b.tarde - a.tarde || a.nombre.localeCompare(b.nombre, 'es'))

  // ---------------- Encargados: qué hizo cada uno ----------------
  const enc = new Map<string, { id: string; nombre: string; correcciones: number; llegoMarcados: number; horasExtraAutorizadas: number; ausenciasAnotadas: number; turnosCargados: number }>()
  const e = (id: string) => {
    let x = enc.get(id)
    if (!x) { x = { id, nombre: nombre(id), correcciones: 0, llegoMarcados: 0, horasExtraAutorizadas: 0, ausenciasAnotadas: 0, turnosCargados: 0 }; enc.set(id, x) }
    return x
  }
  for (const l of logs) {
    if (!l.edited_by) continue
    if (l.clock_in_type === 'encargado') e(l.edited_by).llegoMarcados++
    if (l.clock_out_type === 'edited' || l.clock_in_type === 'edited') e(l.edited_by).correcciones++
  }
  for (const f of asistencia) {
    // reparto de horas extra autorizadas por quien corrigió la salida
    for (const l of logs.filter((x) => x.user_id === f.id && x.clock_out_type === 'edited' && x.edited_by)) {
      const ts = turnosPor.get(`${l.user_id}|${l.operative_date}`)
      if (!ts?.length || !l.clock_out_at) continue
      const fin = Math.max(...ts.map((x) => ventanaTurno(x.shift_date, x.start_time, x.end_time).fin))
      const extra = (Date.parse(l.clock_out_at) - fin) / 3_600_000
      if (extra > 0) e(l.edited_by!).horasExtraAutorizadas += extra
    }
  }
  for (const a of ausencias) if (a.created_by) e(a.created_by).ausenciasAnotadas++
  for (const t of turnos) if (t.created_by) e(t.created_by).turnosCargados++
  const encargados = [...enc.values()]
    .map((x) => ({ ...x, horasExtraAutorizadas: Math.round(x.horasExtraAutorizadas * 10) / 10 }))
    .sort((a, b) => b.turnosCargados + b.correcciones - (a.turnosCargados + a.correcciones))

  // ---------------- Costo laboral vs ventas ----------------
  const costoDia = new Map<string, number>()
  const horasDia = new Map<string, number>()
  for (const emp of liq.employees) {
    for (const d of emp.days) {
      costoDia.set(d.date, (costoDia.get(d.date) ?? 0) + d.pay)
      horasDia.set(d.date, (horasDia.get(d.date) ?? 0) + d.hours)
    }
  }
  const dias = ventas.map((v) => {
    const costo = Math.round(costoDia.get(v.fecha) ?? 0)
    return {
      fecha: v.fecha,
      diaSemana: DIAS_SEMANA[new Date(`${v.fecha}T12:00:00`).getDay()],
      ventas: Math.round(v.total), tickets: v.tickets, costo,
      horas: Math.round((horasDia.get(v.fecha) ?? 0) * 10) / 10,
      pct: v.total > 0 ? Math.round((1000 * costo) / v.total) / 10 : null,
    }
  })
  const totalVentas = dias.reduce((s, d) => s + d.ventas, 0)
  const totalCosto = dias.reduce((s, d) => s + d.costo, 0)
  const totalHoras = dias.reduce((s, d) => s + d.horas, 0)

  const porDiaSemana = DIAS_SEMANA.map((nombreDia, i) => {
    const ds = dias.filter((d) => new Date(`${d.fecha}T12:00:00`).getDay() === i && d.ventas > 0)
    const v = ds.reduce((s, d) => s + d.ventas, 0)
    const c = ds.reduce((s, d) => s + d.costo, 0)
    return { dia: nombreDia, dias: ds.length, ventasProm: ds.length ? Math.round(v / ds.length) : 0, costoProm: ds.length ? Math.round(c / ds.length) : 0, pct: v > 0 ? Math.round((1000 * c) / v) / 10 : null }
  }).filter((x) => x.dias > 0)

  // Por hora: ventas promedio y personas trabajando (según fichajes)
  const diasConVenta = dias.filter((d) => d.ventas > 0).map((d) => d.fecha)
  const porHora = HORAS_OPERATIVAS.map((h) => {
    let ventasH = 0
    let personasH = 0
    for (const fecha of diasConVenta) {
      ventasH += ventas.find((v) => v.fecha === fecha)?.porHora[String(h)] ?? 0
      // instante a mitad de esa hora del día operativo
      const base = Date.parse(`${fecha}T${String(h).padStart(2, '0')}:30:00-03:00`) + (h < 6 ? 86_400_000 : 0)
      personasH += logs.filter((l) => l.operative_date === fecha && Date.parse(l.clock_in_at) <= base && (l.clock_out_at ? Date.parse(l.clock_out_at) : Date.now()) > base).length
    }
    const n = diasConVenta.length || 1
    const ventasProm = ventasH / n
    const personasProm = personasH / n
    return { hora: h, ventasProm: Math.round(ventasProm), personasProm: Math.round(personasProm * 10) / 10, ventasPorPersona: personasProm > 0 ? Math.round(ventasProm / personasProm) : null }
  }).filter((x) => x.ventasProm > 0 || x.personasProm > 0)

  // ---------------- Tareas con horario (baño, tolva, descartables…) ----------------
  // A tiempo = hecha dentro de la hora; tarde = hecha después; no hecha = el día
  // terminó sin hacerse (asignada a alguien o sin asignar).
  type TareaRow = { fecha: string; hora: string; estado: string; asignado_a: string | null; hecho_por: string | null; hecho_at: string | null; protocolos: { nombre: string } | null }
  const porProto = new Map<string, { nombre: string; total: number; aTiempo: number; tarde: number; noHechas: number; sinAsignar: number }>()
  const porPersonaT = new Map<string, { id: string; nombre: string; asignadas: number; aTiempo: number; tarde: number; noHechas: number }>()
  const tp = (id: string) => {
    let x = porPersonaT.get(id)
    if (!x) { x = { id, nombre: nombre(id), asignadas: 0, aTiempo: 0, tarde: 0, noHechas: 0 }; porPersonaT.set(id, x) }
    return x
  }
  for (const t of (tareasData ?? []) as unknown as TareaRow[]) {
    const nom = t.protocolos?.nombre ?? 'Protocolo'
    const pr = porProto.get(nom) ?? { nombre: nom, total: 0, aTiempo: 0, tarde: 0, noHechas: 0, sinAsignar: 0 }
    pr.total++
    const limite = instanteDe(t.fecha, t.hora).getTime() + 60 * 60_000
    const quien = t.asignado_a ?? t.hecho_por
    if (t.estado === 'hecha') {
      const aTiempo = !t.hecho_at || Date.parse(t.hecho_at) <= limite
      if (aTiempo) pr.aTiempo++; else pr.tarde++
      if (quien) { const x = tp(quien); x.asignadas++; if (aTiempo) x.aTiempo++; else x.tarde++ }
    } else {
      pr.noHechas++
      if (t.asignado_a) { const x = tp(t.asignado_a); x.asignadas++; x.noHechas++ } else pr.sinAsignar++
    }
    porProto.set(nom, pr)
  }
  const tareas = {
    protocolos: [...porProto.values()].map((x) => ({ ...x, cumplimiento: x.total ? Math.round((100 * x.aTiempo) / x.total) : 100 })),
    personas: [...porPersonaT.values()]
      .map((x) => ({ ...x, cumplimiento: x.asignadas ? Math.round((100 * x.aTiempo) / x.asignadas) : 100 }))
      .sort((a, b) => a.cumplimiento - b.cumplimiento || b.asignadas - a.asignadas),
  }

  return {
    period: { from, to, asistenciaHasta: hastaCerrado },
    tareas,
    asistencia,
    encargados,
    costo: {
      dias,
      totalVentas, totalCosto,
      totalHoras: Math.round(totalHoras * 10) / 10,
      pct: totalVentas > 0 ? Math.round((1000 * totalCosto) / totalVentas) / 10 : null,
      ventasPorHoraTrabajada: totalHoras > 0 ? Math.round(totalVentas / totalHoras) : null,
      porDiaSemana,
      porHora,
    },
    // Sucursal 24: abrió el 13/10/2026; antes no hay fichajes ni ventas propias
    avisoDatos: from < '2026-10-13' ? 'La sucursal abrió el 13/10/2026: antes de esa fecha no hay fichajes ni ventas, el informe de esos días sale vacío.' : null,
  }
}

export type InformeControl = Awaited<ReturnType<typeof informeControl>>
