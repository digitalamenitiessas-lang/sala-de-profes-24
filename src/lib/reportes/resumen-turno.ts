import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa, instanteDe } from '@/lib/attendance/jornada'
import { ETIQUETA_AUSENCIA, type MotivoAusencia } from '@/lib/attendance/ausencias'
import { computeConsumption } from '@/lib/compras/sugerencias'
import { ATRASO_MIN } from '@/lib/protocolos/protocolos'
import { ROLES } from '@/lib/constants'

// ---------------------------------------------------------------------------
// Resumen de cada turno (para Telegram), con detalle
// ---------------------------------------------------------------------------
// Al cierre del turno:
//   👥 Equipo: cada persona con su turno cargado, a qué hora fichó la entrada
//      y la salida, cuánto llegó tarde, horas trabajadas; quién no fichó (y
//      si tiene motivo); quién fichó sin turno.
//   ✅ Tareas con horario: cada una, quién y a qué hora (o sin hacer).
//   🧾 Qué hizo cada uno en la app.
//   📦 Stock: cada conteo (antes → ahora y quién), mermas, producciones,
//      compras recibidas y pedidos/sugerencias.
//   ⚠️ Para revisar: conteos que no cierran contra lo que se vende (ej. 400 kg
//      de granola), tareas sin hacer o tarde, salidas sin fichar, elaborados
//      en negativo.
// Turno mañana = 06 a 16 h; tarde/noche = 16 a 06 h del día operativo.
// Devuelve partes en HTML de Telegram (cada una entra en un mensaje).
// ---------------------------------------------------------------------------

export type Turno = 'TM' | 'TT'
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 })
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })
const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '?')
const duracion = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
const rolLabel = (r: string | null | undefined) => (r && r in ROLES ? ROLES[r as keyof typeof ROLES].label.toLowerCase() : r ?? '')

export function ventanaDeTurno(fecha: string, turno: Turno): { desde: Date; hasta: Date } {
  return turno === 'TM'
    ? { desde: instanteDe(fecha, '06:00'), hasta: instanteDe(fecha, '16:00') }
    : { desde: instanteDe(fecha, '16:00'), hasta: new Date(instanteDe(fecha, '06:00').getTime() + 86_400_000) }
}

/** Qué turno acaba de terminar (el cron de las 16:30 → mañana; el de la madrugada → tarde). */
export function turnoQueTermino(ahora = new Date()): { fecha: string; turno: Turno } {
  const fecha = fechaOperativa(ahora)
  return ahora.getTime() >= instanteDe(fecha, '16:00').getTime() && ahora.getTime() < instanteDe(fecha, '23:59').getTime()
    ? { fecha, turno: 'TM' }
    : { fecha, turno: 'TT' }
}

/** "tareas asignadas" → "tarea asignada", "platos servidos (Salón)" → "plato servido (Salón)" */
function singular(q: string): string {
  const [base, resto] = q.split(/ (?=\()/)
  const s = base.split(' ').map((w, i) => (i === 0 || /^(asignadas|servidos|contados|recibidas|pedidos|extendidos)$/.test(w))
    ? w.replace(/iones$/, 'ión').replace(/es$/, (m) => (/(ción|ión)es$/.test(w) ? '' : m)).replace(/s$/, '') : w).join(' ')
  return resto ? `${s} ${resto}` : s
}

/** Parte el texto en mensajes de hasta ~3900 caracteres, sin cortar líneas. */
export function partirMensaje(texto: string, max = 3900): string[] {
  const partes: string[] = []
  let actual = ''
  for (const linea of texto.split('\n')) {
    if (actual && actual.length + linea.length + 1 > max) { partes.push(actual); actual = '' }
    actual = actual ? `${actual}\n${linea}` : linea
  }
  if (actual) partes.push(actual)
  return partes.length > 1 ? partes.map((p, i) => (i === 0 ? p : `<i>(sigue ${i + 1}/${partes.length})</i>\n${p}`)) : partes
}

type Persona = { nombre: string; role: string }

export async function armarResumenTurno(admin: SupabaseClient, fecha: string, turno: Turno, ahora = new Date()): Promise<string> {
  const { desde, hasta: finTurno } = ventanaDeTurno(fecha, turno)
  const hasta = new Date(Math.min(finTurno.getTime(), ahora.getTime()))
  const d = desde.toISOString(), h = hasta.toISOString()
  const enTurno = (hora: string) => (turno === 'TM' ? hora >= '06:00' && hora < '16:00' : hora >= '16:00' || hora < '06:00')

  const [
    { data: perfiles }, { data: turnos }, { data: logs }, { data: ausencias },
    { data: tareas }, { data: protos }, { data: salon }, { data: movs }, { data: pedidos },
    { data: recibos }, { data: tolva }, { data: prods }, { data: audit },
  ] = await Promise.all([
    admin.from('profiles').select('id, first_name, last_name, role'),
    admin.from('shifts').select('user_id, start_time, end_time, shift_role').eq('shift_date', fecha).order('start_time'),
    admin.from('attendance_logs').select('user_id, clock_in_at, clock_out_at, clock_out_type').eq('operative_date', fecha),
    admin.from('ausencias').select('user_id, motivo, nota').eq('fecha', fecha),
    admin.from('protocolo_tareas').select('protocolo_id, hora, estado, asignado_a, hecho_por, hecho_at, fecha, nota, medicion').eq('fecha', fecha).order('hora'),
    admin.from('protocolos').select('id, nombre, medicion_unidad'),
    admin.from('salon_item_status').select('served_by').gte('served_at', d).lt('served_at', h),
    admin.from('stock_movements').select('stock_item_id, created_by, reason, previous_qty, new_qty, qty, created_at, note').gte('created_at', d).lt('created_at', h).order('created_at'),
    admin.from('kitchen_orders').select('created_by, status, product_name, quantity, urgency').gte('created_at', d).lt('created_at', h),
    admin.from('stock_receipts').select('received_by, qty, unit, cost_total, stock_item_id, supplier_id').gte('received_at', d).lt('received_at', h),
    admin.from('tolva_logs').select('created_by').gte('updated_at', d).lt('updated_at', h),
    admin.from('production_orders').select('id, chef_id, name, status, created_at').gte('created_at', d).lt('created_at', h),
    admin.from('audit_trail').select('user_id, action').gte('created_at', d).lt('created_at', h),
  ])

  const gente = new Map<string, Persona>(((perfiles ?? []) as { id: string; first_name: string | null; last_name: string | null; role: string }[])
    .map((p) => [p.id, { nombre: [p.first_name, p.last_name?.[0] ? `${p.last_name[0]}.` : ''].filter(Boolean).join(' ') || 'Alguien', role: p.role }]))
  const nombre = (id: string | null | undefined) => (id ? gente.get(id)?.nombre ?? 'Alguien' : 'Alguien')
  type Proto = { id: string; nombre: string; medicion_unidad: string | null }
  const proto = new Map(((protos ?? []) as Proto[]).map((p) => [p.id, p]))

  // Nombres de insumos y proveedores que aparecen
  type Mov = { stock_item_id: string; created_by: string | null; reason: string | null; previous_qty: number | null; new_qty: number | null; qty: number | null; created_at: string; note: string | null }
  type Recibo = { received_by: string | null; qty: number | null; unit: string | null; cost_total: number | null; stock_item_id: string | null; supplier_id: string | null }
  const movsL = (movs ?? []) as Mov[]
  const recibosL = (recibos ?? []) as Recibo[]
  const prodsL = (prods ?? []) as { id: number; chef_id: string | null; name: string | null; status: string; created_at: string }[]
  const itemIds = [...new Set([...movsL.map((m) => m.stock_item_id), ...recibosL.map((r) => r.stock_item_id).filter((x): x is string => !!x)])]
  const [{ data: items }, { data: provs }, { data: salidas }] = await Promise.all([
    itemIds.length ? admin.from('stock_items').select('id, name, unit, is_produced').in('id', itemIds) : Promise.resolve({ data: [] }),
    admin.from('suppliers').select('id, name'),
    prodsL.length ? admin.from('production_outputs').select('production_order_id, output_name, qty_produced, unit, is_waste').in('production_order_id', prodsL.map((p) => p.id)) : Promise.resolve({ data: [] }),
  ])
  const item = new Map(((items ?? []) as { id: string; name: string; unit: string; is_produced: boolean | null }[]).map((i) => [i.id, i]))
  const prov = new Map(((provs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]))

  // ---- Qué hizo cada uno en la app ----
  const hizo = new Map<string, Map<string, number>>()
  const sumar = (uid: string | null | undefined, que: string, n = 1) => {
    if (!uid) return
    const m = hizo.get(uid) ?? new Map()
    m.set(que, (m.get(que) ?? 0) + n)
    hizo.set(uid, m)
  }
  type TareaRow = { protocolo_id: string; hora: string; estado: string; asignado_a: string | null; hecho_por: string | null; hecho_at: string | null; fecha: string; nota: string | null; medicion: number | null }
  const todasTareas = (tareas ?? []) as TareaRow[]
  const tareasTurno = todasTareas.filter((t) => enTurno(t.hora.slice(0, 5)))
  // Cuenta en este turno: las tareas de este turno que se hicieron (aunque se cierren un rato después)
  // y las de otro turno que se hicieron durante este
  for (const t of todasTareas) {
    const delTurno = enTurno(t.hora.slice(0, 5))
    if (t.estado === 'hecha' && t.hecho_at && (delTurno || (t.hecho_at >= d && t.hecho_at < h))) sumar(t.hecho_por, `tarea|${(proto.get(t.protocolo_id)?.nombre ?? 'tarea').replace(/ \(.*\)$/, '').toLowerCase()}`)
  }
  for (const s of (salon ?? []) as { served_by: string | null }[]) sumar(s.served_by, 'platos servidos (Salón)')
  const conteos = movsL.filter((m) => m.reason === 'physical_count')
  const mermas = movsL.filter((m) => m.reason === 'waste' && m.created_by)
  for (const m of conteos) sumar(m.created_by, 'insumos contados')
  for (const m of mermas) sumar(m.created_by, 'mermas')
  for (const p of prodsL) sumar(p.chef_id, 'producciones ("Lo hice")')
  const pedidosL = (pedidos ?? []) as { created_by: string | null; status: string; product_name: string; quantity: string; urgency: string | null }[]
  const esManager = (uid: string | null) => { const r = uid ? gente.get(uid)?.role : null; return r === 'encargado' || r === 'socio' }
  for (const o of pedidosL) sumar(o.created_by, esManager(o.created_by) ? 'productos pedidos' : 'sugerencias de compra')
  for (const r of recibosL) sumar(r.received_by, 'compras recibidas ("Llegó")')
  for (const t of (tolva ?? []) as { created_by: string | null }[]) sumar(t.created_by, 'registros de tolva')
  const ACCIONES: Record<string, string> = {
    conteo_diario: 'conteos de elaborados', ask_question: 'preguntas a La Vieja', protocolo_asignar: 'tareas asignadas',
    create_shift: 'cambios de horarios', update_shift: 'cambios de horarios', delete_shift: 'cambios de horarios',
    attendance_corrected: 'correcciones de asistencia', attendance_marked_by_manager: 'correcciones de asistencia', shift_extended: 'turnos extendidos',
    ausencia_motivo: 'motivos de ausencia', fudo_import_recetas: 'importaciones de recetas', faltante_reportado: 'faltantes avisados',
    receta_plato_armado: 'recetas editadas (cómo se arma)', guardar_receta_produccion: 'recetas de producción cargadas',
  }
  for (const a of (audit ?? []) as { user_id: string | null; action: string }[]) if (ACCIONES[a.action]) sumar(a.user_id, ACCIONES[a.action])

  // ---- Equipo del turno ----
  type Shift = { user_id: string; start_time: string; end_time: string | null; shift_role: string | null }
  // Un turno cargado entra si empieza en este turno o si pasa 2 h o más dentro de su franja
  // (ej. 13:30–22:00 aparece en la mañana y en la tarde)
  const rango = (x: Shift) => {
    const ini = instanteDe(fecha, hm(x.start_time)).getTime()
    let fin = x.end_time ? instanteDe(fecha, hm(x.end_time)).getTime() : ini + 8 * 3_600_000
    if (fin <= ini) fin += 86_400_000
    return { ini, fin }
  }
  // Turno que empieza antes de las 14 → mañana; desde las 14 → tarde/noche
  const empiezaAca = (x: Shift) => { const t = hm(x.start_time); return turno === 'TM' ? t >= '06:00' && t < '14:00' : t >= '14:00' || t < '06:00' }
  const turnosDelTurno = ((turnos ?? []) as Shift[]).filter((x) => {
    const { ini, fin } = rango(x)
    return empiezaAca(x) || Math.min(fin, finTurno.getTime()) - Math.max(ini, desde.getTime()) >= 2 * 3_600_000
  })
  type Log = { user_id: string; clock_in_at: string | null; clock_out_at: string | null; clock_out_type: string | null }
  const logPor = new Map<string, Log>()
  for (const l of (logs ?? []) as Log[]) if (l.clock_in_at) logPor.set(l.user_id, l)
  const ausente = new Map(((ausencias ?? []) as { user_id: string; motivo: MotivoAusencia; nota: string | null }[]).map((a) => [a.user_id, a]))
  const trabajaron = new Set<string>()
  const lineasEquipo: string[] = []
  const revisar: string[] = []
  let noFicharon = 0, tardes = 0

  // Una línea por persona (si tiene dos turnos cargados en el mismo turno, se avisa)
  const porPersona = new Map<string, Shift[]>()
  for (const s of turnosDelTurno) porPersona.set(s.user_id, [...(porPersona.get(s.user_id) ?? []), s])
  for (const [uid, lista] of porPersona) {
    if (lista.length > 1) revisar.push(`${esc(nombre(uid))} tiene ${lista.length} turnos cargados el mismo día (${lista.map((x) => `${hm(x.start_time)}–${hm(x.end_time)}`).join(' y ')}): borrar el que sobra.`)
  }
  for (const [, lista] of porPersona) {
    const s = { ...lista[0], end_time: lista.map((x) => x.end_time).filter(Boolean).sort().at(-1) ?? lista[0].end_time }
    const quien = `<b>${esc(nombre(s.user_id))}</b> (${esc(rolLabel(s.shift_role ?? gente.get(s.user_id)?.role))})`
    const horario = `turno ${lista.map((x) => `${hm(x.start_time)}–${hm(x.end_time)}`).join(' y ')}${lista.length > 1 ? ' (⚠️ repetido)' : ''}`
    const l = logPor.get(s.user_id)
    if (!l?.clock_in_at) {
      const a = ausente.get(s.user_id)
      if (a) lineasEquipo.push(`• ${quien} · ${horario} · no vino: ${esc(ETIQUETA_AUSENCIA[a.motivo]?.toLowerCase() ?? a.motivo)}${a.nota ? ` (${esc(a.nota)})` : ''}`)
      else if (instanteDe(fecha, hm(s.start_time)).getTime() < hasta.getTime()) {
        noFicharon++
        lineasEquipo.push(`• ${quien} · ${horario} · 🚫 <b>no fichó</b> y no tiene motivo cargado`)
      } else lineasEquipo.push(`• ${quien} · ${horario} · todavía no empezaba`)
      continue
    }
    const inicio = instanteDe(fecha, hm(s.start_time)).getTime()
    // ¿El fichaje corresponde a este turno? (ej. turno 16–22 cargado, pero fichó 08–16)
    const finTurnoP = s.end_time ? instanteDe(fecha, hm(s.end_time)).getTime() : inicio + 8 * 3_600_000
    const finFichaje = l.clock_out_at ? Date.parse(l.clock_out_at) : hasta.getTime()
    const solape = Math.max(0, Math.min(finTurnoP, finFichaje) - Math.max(inicio, Date.parse(l.clock_in_at)))
    if (solape < (finTurnoP - inicio) * 0.3) {
      lineasEquipo.push(`• ${quien} · ${horario} · ⚠️ fichó ${hhmm(l.clock_in_at)}–${l.clock_out_at ? hhmm(l.clock_out_at) : '?'}, que no coincide con este turno`)
      revisar.push(`${esc(nombre(s.user_id))}: tenía turno ${hm(s.start_time)}–${hm(s.end_time)} pero fichó ${hhmm(l.clock_in_at)}–${l.clock_out_at ? hhmm(l.clock_out_at) : '?'}. ¿Turno mal cargado? (la liquidación paga lo fichado y lo marca para revisar)`)
      continue
    }
    trabajaron.add(s.user_id)
    const minTarde = Math.round((Date.parse(l.clock_in_at) - inicio) / 60000)
    const viene = !empiezaAca(s)
    const entrada = viene
      ? `venía del turno ${turno === 'TT' ? 'mañana' : 'anterior'} (entró ${hhmm(l.clock_in_at)})`
      : `entró ${hhmm(l.clock_in_at)}${minTarde > 10 ? ` (⏰ ${minTarde} min tarde)` : minTarde < -30 ? ` (${-minTarde} min antes)` : ''}`
    if (minTarde > 10 && !viene) tardes++
    let salida: string
    if (l.clock_out_at) {
      const trabajado = Math.round((Date.parse(l.clock_out_at) - Date.parse(l.clock_in_at)) / 60000)
      const tipo = l.clock_out_type === 'auto' ? ' (cierre automático)' : l.clock_out_type === 'edited' ? ' (corregida por encargado)' : ''
      salida = `salió ${hhmm(l.clock_out_at)}${tipo} · ${duracion(trabajado)}`
    } else {
      const finT = s.end_time ? instanteDe(fecha, hm(s.end_time)).getTime() : null
      salida = finT && hasta.getTime() - finT > 3_600_000 ? '⚠️ sin fichar la salida' : 'todavía adentro'
      if (finT && hasta.getTime() - finT > 3_600_000 && finT <= finTurno.getTime()) revisar.push(`${esc(nombre(s.user_id))} no fichó la salida (su turno terminaba ${hm(s.end_time)}).`)
    }
    lineasEquipo.push(`• ${quien} · ${horario} · ${entrada} · ${salida}`)
  }
  // Ficharon en este turno sin turno cargado
  const horaAR = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })
  for (const l of logPor.values()) {
    if (!l.clock_in_at || turnosDelTurno.some((s) => s.user_id === l.user_id)) continue
    // Sin turno cargado: va al turno según la hora de entrada (antes de las 14 → mañana)
    const entraManana = horaAR(l.clock_in_at) >= '06:00' && horaAR(l.clock_in_at) < '14:00'
    if ((turno === 'TM') !== entraManana) continue
    // Si tiene turno cargado en el OTRO turno, ya se avisa ahí (turno mal cargado)
    if (((turnos ?? []) as Shift[]).some((x) => x.user_id === l.user_id)) continue
    trabajaron.add(l.user_id)
    lineasEquipo.push(`• <b>${esc(nombre(l.user_id))}</b> (${esc(rolLabel(gente.get(l.user_id)?.role))}) · <i>sin turno cargado</i> · entró ${hhmm(l.clock_in_at)} · ${l.clock_out_at ? `salió ${hhmm(l.clock_out_at)} · ${duracion(Math.round((Date.parse(l.clock_out_at) - Date.parse(l.clock_in_at)) / 60000))}` : 'sin salida'}`)
  }
  if (noFicharon) revisar.unshift(`${noFicharon === 1 ? '1 persona no fichó' : `${noFicharon} personas no ficharon`} y no tiene${noFicharon === 1 ? '' : 'n'} motivo cargado (ver Equipo).`)

  // ---- Tareas con horario ----
  const ahoraMs = ahora.getTime()
  const lineasTareas: string[] = []
  for (const t of tareasTurno) {
    const p = proto.get(t.protocolo_id)
    const nombreT = esc((p?.nombre ?? 'Tarea').replace(/ \(.*\)$/, ''))
    const inicio = instanteDe(fecha, hm(t.hora)).getTime()
    if (t.estado === 'hecha' && t.hecho_at) {
      const tarde = Date.parse(t.hecho_at) > inicio + ATRASO_MIN * 60_000
      const med = t.medicion != null ? ` · ${num(Number(t.medicion))} ${p?.medicion_unidad ?? ''}`.trimEnd() : ''
      lineasTareas.push(`• ${hm(t.hora)} ${nombreT} — ✅ ${esc(nombre(t.hecho_por))} a las ${hhmm(t.hecho_at)}${tarde ? ' (⏰ tarde)' : ''}${med}${t.nota ? ` · “${esc(t.nota.replace(/\s*\n\s*/g, ' / ').trim().slice(0, 160))}”` : ''}`)
      if (tarde) revisar.push(`Tarea hecha tarde: ${nombreT} de las ${hm(t.hora)} (la hizo ${esc(nombre(t.hecho_por))} a las ${hhmm(t.hecho_at)}).`)
      const antesMin = Math.round((inicio - Date.parse(t.hecho_at)) / 60000)
      if (antesMin > 30) {
        lineasTareas[lineasTareas.length - 1] += ` (⚠️ ${antesMin >= 90 ? `${Math.round(antesMin / 60)} h` : `${antesMin} min`} antes de hora)`
        revisar.push(`Tarea cerrada antes de hora: ${nombreT} de las ${hm(t.hora)}, la cerró ${esc(nombre(t.hecho_por))} a las ${hhmm(t.hecho_at)}.`)
      }
    } else if (inicio + ATRASO_MIN * 60_000 < ahoraMs) {
      lineasTareas.push(`• ${hm(t.hora)} ${nombreT} — ❌ <b>sin hacer</b>${t.asignado_a ? ` (asignada a ${esc(nombre(t.asignado_a))})` : ' (nadie la asignó)'}`)
      revisar.push(`Tarea sin hacer: ${nombreT} de las ${hm(t.hora)}${t.asignado_a ? `, asignada a ${esc(nombre(t.asignado_a))}` : ', nadie la asignó'}.`)
    } else {
      lineasTareas.push(`• ${hm(t.hora)} ${nombreT} — pendiente`)
    }
  }

  // ---- Stock ----
  const lineasStock: string[] = []
  if (conteos.length) {
    const consumo = await computeConsumption(admin, 14).catch(() => ({ byItem: new Map<string, number>(), activeDays: 14 }))
    const porQuien = new Map<string, Mov[]>()
    for (const c of conteos) porQuien.set(c.created_by ?? '', [...(porQuien.get(c.created_by ?? '') ?? []), c])
    for (const [uid, lista] of porQuien) {
      lineasStock.push(`<b>Conteos de ${esc(nombre(uid))}</b> (${lista.length}):`)
      for (const c of lista) {
        const it = item.get(c.stock_item_id)
        if (!it) continue
        const nuevo = Number(c.new_qty ?? 0), antes = Number(c.previous_qty ?? 0)
        lineasStock.push(`   ${esc(it.name)}: ${num(antes)} → <b>${num(nuevo)}</b> ${esc(it.unit)} (${hhmm(c.created_at)})`)
        const uso = (consumo.byItem.get(it.id) ?? 0) / Math.max(1, consumo.activeDays)
        const dias = uso > 0 && nuevo > 0 ? nuevo / uso : null
        const grande = (it.unit === 'kg' || it.unit === 'l') && nuevo >= 100
        if ((dias != null && dias > 120) || (dias == null && grande) || (antes > 0 && nuevo >= antes * 10)) {
          const por = dias != null ? `alcanza para ${dias > 730 ? `${Math.round(dias / 365)} años` : `${Math.round(dias)} días`} con lo que se vende` : antes > 0 && nuevo >= antes * 10 ? `antes había ${num(antes)}` : 'es mucho'
          const pregunta = it.unit === 'kg' ? '¿Son kg o eran gramos?' : it.unit === 'l' ? '¿Son litros o eran ml?' : '¿Está bien la cantidad?'
          revisar.push(`Conteo de <b>${esc(it.name)}</b>: ${num(nuevo)} ${esc(it.unit)} (${por}). ${pregunta} Lo contó ${esc(nombre(c.created_by))} a las ${hhmm(c.created_at)}.`)
        }
      }
    }
  }
  if (mermas.length) {
    lineasStock.push('<b>Mermas:</b>')
    for (const m of mermas) {
      const it = item.get(m.stock_item_id)
      lineasStock.push(`   ${esc(it?.name ?? 'Insumo')}: ${num(Math.abs(Number(m.qty ?? 0)))} ${esc(it?.unit ?? '')} — ${esc(nombre(m.created_by))}${m.note ? ` · ${esc(m.note.replace(/\s*\n\s*/g, ' / ').slice(0, 80))}` : ''}`)
    }
  }
  if (prodsL.length) {
    lineasStock.push('<b>Producción ("Lo hice"):</b>')
    const salidasL = (salidas ?? []) as { production_order_id: number; output_name: string | null; qty_produced: number | null; unit: string | null; is_waste: boolean | null }[]
    for (const p of prodsL) {
      const out = salidasL.filter((s) => s.production_order_id === p.id && !s.is_waste).map((s) => `${num(Number(s.qty_produced ?? 0))} ${s.unit ?? ''} ${s.output_name ?? ''}`.replace(/\s+/g, ' ').trim())
      lineasStock.push(`   ${esc(out.join(', ') || p.name || `Producción #${p.id}`)} — ${esc(nombre(p.chef_id))} a las ${hhmm(p.created_at)}${p.status === 'pending_review' ? ' (falta validar)' : ''}`)
    }
  }
  if (recibosL.length) {
    lineasStock.push('<b>Compras recibidas ("Llegó"):</b>')
    for (const r of recibosL) {
      const it = r.stock_item_id ? item.get(r.stock_item_id) : null
      lineasStock.push(`   ${esc(it?.name ?? 'Producto')}: ${num(Number(r.qty ?? 0))} ${esc(r.unit ?? it?.unit ?? '')}${r.supplier_id ? ` de ${esc(prov.get(r.supplier_id) ?? 'proveedor')}` : ''}${Number(r.cost_total ?? 0) > 0 ? ` · $${Math.round(Number(r.cost_total)).toLocaleString('es-AR')}` : ' · ⚠️ sin precio'} — ${esc(nombre(r.received_by))}`)
    }
  }
  if (pedidosL.length) {
    lineasStock.push('<b>Pedidos y sugerencias de compra:</b>')
    for (const o of pedidosL) lineasStock.push(`   ${esc(o.product_name)} · ${esc(o.quantity)}${o.urgency && o.urgency !== 'normal' ? ` (${esc(o.urgency)})` : ''} — ${esc(nombre(o.created_by))}${esManager(o.created_by) ? '' : ' (sugerencia)'}`)
  }

  // Una vez por día (en el resumen de la noche): elaborados vendidos sin producción registrada
  if (turno === 'TT') {
    const { data: neg } = await admin.from('stock_items').select('name, current_qty').eq('is_active', true).eq('is_produced', true).lt('current_qty', 0).order('current_qty').limit(10)
    const n = (neg ?? []) as { name: string; current_qty: number }[]
    if (n.length) revisar.push(`Elaborados en negativo (se venden pero no se registra "Lo hice"): ${n.map((x) => `${esc(x.name)} ${num(Number(x.current_qty))}`).join(', ')}.`)
  }

  // ---- Armar el texto ----
  const titulo = turno === 'TM' ? 'Turno mañana' : 'Turno tarde/noche'
  const dia = new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'UTC' })
  const tHechas = tareasTurno.filter((t) => t.estado === 'hecha').length
  const L: string[] = [
    // Los socios reciben los resúmenes de las dos sucursales: el título dice de cuál es
    `📋 <b>24 y Maipú · ${titulo}</b> · ${dia} (${turno === 'TM' ? '06 a 16 h' : '16 a 06 h'})`,
    `Trabajaron ${trabajaron.size} · no ficharon ${noFicharon} · llegaron tarde ${tardes} · tareas ${tHechas}/${tareasTurno.length}`,
  ]

  L.push('', '👥 <b>Equipo</b>')
  L.push(...(lineasEquipo.length ? lineasEquipo : ['• No había turnos cargados.']))

  if (lineasTareas.length) L.push('', '✅ <b>Tareas con horario</b>', ...lineasTareas)

  const porRol = (r: string) => (r === 'encargado' || r === 'socio' ? 0 : r === 'runner' ? 1 : r === 'barista' ? 2 : r === 'chef' || r === 'cocina' ? 3 : 4)
  const personas = [...new Set([...trabajaron, ...hizo.keys()])].map((id) => ({ id, ...(gente.get(id) ?? { nombre: 'Alguien', role: '' }) }))
    .sort((a, b) => porRol(a.role) - porRol(b.role) || a.nombre.localeCompare(b.nombre, 'es'))
  const conActividad = personas.filter((p) => hizo.has(p.id))
  const soloFicharon = personas.filter((p) => !hizo.has(p.id) && p.role !== 'socio')
  L.push('', '🧾 <b>Qué hizo cada uno en la app</b>')
  for (const p of conActividad) {
    const todo = [...hizo.get(p.id)!.entries()]
    const tareasHechas = todo.filter(([q]) => q.startsWith('tarea|')).map(([q, n]) => `${q.slice(6)}${n > 1 ? ` (${n})` : ''}`)
    const cosas = todo.filter(([q]) => !q.startsWith('tarea|')).sort((a, b) => b[1] - a[1]).map(([q, n]) => `${n} ${n === 1 ? singular(q) : q}`)
    if (tareasHechas.length) cosas.unshift(`${tareasHechas.length === 1 && !/\(\d+\)$/.test(tareasHechas[0]) ? 'tarea' : 'tareas'}: ${tareasHechas.join(', ')}`)
    L.push(`• <b>${esc(p.nombre)}</b>: ${esc(cosas.join(' · '))}`)
  }
  if (!conActividad.length) L.push('• Nadie usó la app en este turno (más allá de fichar).')
  if (soloFicharon.length) L.push(`🕐 <b>Solo ficharon</b> (no usaron nada más): ${soloFicharon.map((p) => esc(p.nombre)).join(', ')}`)

  if (lineasStock.length) L.push('', '📦 <b>Stock</b>', ...lineasStock)

  L.push('')
  if (revisar.length) L.push('⚠️ <b>Para revisar</b>', ...revisar.map((r) => `• ${r}`))
  else L.push('✅ Nada para revisar.')

  return L.join('\n')
}
