import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa, instanteDe } from '@/lib/attendance/jornada'
import { sendPushToUser } from '@/lib/push/send'
import { ROLES_ENCARGADO_TURNO, turnoEnCurso, turnosDelDia } from '@/lib/turnos/rol-del-turno'

// ---------------------------------------------------------------------------
// Protocolos con horario (limpieza del baño, etc.)
// ---------------------------------------------------------------------------
// Ciclo de cada tarea (un horario de un día):
//   hora         → si el protocolo tiene puesto automático (tolva → barista) y
//                  hay alguien fichado con ese puesto, se le asigna sola;
//                  si no, aviso al encargado de turno: "asigná a alguien"
//   hora + 15'   → si sigue sin asignar, se vuelve a avisar
//   asignada+30' → si no está hecha, recordatorio a quien la tiene (y a quien asignó)
//   hora + 60'   → si no está hecha, aviso de atraso a encargados y socios
// Se completa con todos los pasos marcados y una foto.
// ---------------------------------------------------------------------------

export const REAVISO_MIN = 15
export const RECORDATORIO_MIN = 30
export const ATRASO_MIN = 60

export type Protocolo = {
  id: string; nombre: string; descripcion: string | null; horarios: string[]; pasos: string[]; fotos: string[]; requiere_foto: boolean; activo: boolean
  /** Número a registrar al completar (ej. peso de la tolva) */
  medicion_etiqueta?: string | null; medicion_unidad?: string | null; registro?: string | null
  /** Roles del turno a los que se puede asignar (null = cualquiera). Ej. elaborados: cocina y chef */
  roles?: string[] | null
  /** Días de la semana en que sale (0 = domingo … 6 = sábado). null/vacío = todos los días */
  dias?: number[] | null
  /** La tarea no sale por horario: aparece cuando se termina una producción (conteo de elaborados) */
  al_terminar_produccion?: boolean | null
  /** A su hora se asigna sola a quien esté fichado con este puesto (ej. tolva → barista). null = la asigna el encargado */
  asignar_auto_rol?: string | null
}

export const NOMBRE_DIA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

/** Día de la semana (0 = domingo) de una fecha operativa YYYY-MM-DD */
export function diaSemana(fecha: string): number {
  return new Date(`${fecha}T12:00:00-03:00`).getUTCDay()
}

/** ¿Este protocolo tiene tareas por horario ese día? */
export function saleElDia(p: Pick<Protocolo, 'dias'>, fecha: string): boolean {
  return !p.dias || p.dias.length === 0 || p.dias.includes(diaSemana(fecha))
}
export type Tarea = {
  id: string; protocolo_id: string; fecha: string; hora: string
  estado: 'pendiente' | 'asignada' | 'hecha'
  asignado_a: string | null; asignado_por: string | null; asignado_at: string | null
  hecho_por: string | null; hecho_at: string | null; foto_path: string | null; fotos: string[] | null; pasos_ok: string[] | null; nota: string | null
  medicion?: number | null
  avisado_at: string | null; reaviso_at: string | null; recordatorio_at: string | null; atraso_at: string | null
  created_at: string
}

/** Cómo se ve una tarea ahora */
export type EstadoVisible = 'programada' | 'sin_asignar' | 'asignada' | 'atrasada' | 'hecha' | 'hecha_tarde'

export function estadoVisible(t: Pick<Tarea, 'fecha' | 'hora' | 'estado' | 'hecho_at'>, ahora = new Date()): EstadoVisible {
  const inicio = instanteDe(t.fecha, t.hora).getTime()
  const limite = inicio + ATRASO_MIN * 60_000
  if (t.estado === 'hecha') return t.hecho_at && Date.parse(t.hecho_at) > limite ? 'hecha_tarde' : 'hecha'
  if (ahora.getTime() >= limite) return 'atrasada'
  if (ahora.getTime() < inicio) return t.estado === 'asignada' ? 'asignada' : 'programada'
  return t.estado === 'asignada' ? 'asignada' : 'sin_asignar'
}

/** Se puede cerrar desde un rato antes de la hora (no a la mañana la de la tarde). */
export const ANTICIPO_MIN = 30
export function sePuedeCerrar(t: Pick<Tarea, 'fecha' | 'hora'>, ahora = new Date()): boolean {
  return ahora.getTime() >= instanteDe(t.fecha, t.hora).getTime() - ANTICIPO_MIN * 60_000
}

/** Crea (si faltan) las tareas del día para cada horario de cada protocolo activo. */
export async function asegurarTareasDelDia(admin: SupabaseClient, fecha = fechaOperativa()): Promise<void> {
  // select('*'): tolera que todavía no existan las columnas dias / al_terminar_produccion
  const { data: protocolos } = await admin.from('protocolos').select('*').eq('activo', true)
  // El día se arma UNA vez: si un control ya tiene tareas ese día, no se le
  // agregan más. Si no, un cambio de horarios a mitad del día sumaba los
  // nuevos encima de los ya asignados (tolva con 5 controles). Los cambios
  // desde la pantalla de Protocolos aplican a hoy por su cuenta (config PUT).
  const { data: yaArmadas } = await admin.from('protocolo_tareas').select('protocolo_id').eq('fecha', fecha)
  const conTareas = new Set(((yaArmadas ?? []) as { protocolo_id: string }[]).map((t) => t.protocolo_id))
  const filas = ((protocolos ?? []) as Pick<Protocolo, 'id' | 'horarios' | 'dias'>[])
    .filter((p) => saleElDia(p, fecha) && !conTareas.has(p.id))
    .flatMap((p) => (p.horarios ?? []).map((hora) => ({ protocolo_id: p.id, fecha, hora })))
  if (filas.length === 0) return
  await admin.from('protocolo_tareas').upsert(filas, { onConflict: 'protocolo_id,fecha,hora', ignoreDuplicates: true })
}

export type Persona = {
  id: string; nombre: string
  /** Rol con el que trabaja hoy: el de su turno (o el del perfil si fichó sin turno cargado) */
  role: string
  presente: boolean
  turnos: { rol: string; inicio: number; fin: number; desde: string; hasta: string }[]
}
/** Persona habilitada para una tarea: con el rol y el horario del turno que la cubre. */
export type Candidato = { id: string; nombre: string; role: string; presente: boolean; turno: string | null }

/** Quién trabaja hoy: fichado ahora o con turno cargado (con el rol de cada turno). */
export async function personalDeTurno(admin: SupabaseClient, fecha = fechaOperativa(), ahora = new Date()): Promise<Persona[]> {
  const [{ data: abiertos }, turnos, { data: perfiles }] = await Promise.all([
    admin.from('attendance_logs').select('user_id').eq('status', 'open'),
    turnosDelDia(admin, fecha),
    admin.from('profiles').select('id, first_name, last_name, role').eq('is_active', true),
  ])
  const presentes = new Set((abiertos ?? []).map((a: { user_id: string }) => a.user_id))
  return ((perfiles ?? []) as { id: string; first_name: string | null; last_name: string | null; role: string }[])
    .map((p) => {
      const suyos = turnos.filter((t) => t.user_id === p.id).sort((a, b) => a.inicio - b.inicio)
      const actual = suyos.find((t) => turnoEnCurso(t, ahora.getTime())) ?? suyos[0]
      return {
        id: p.id,
        nombre: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Sin nombre',
        role: actual?.rol ?? p.role,
        presente: presentes.has(p.id),
        turnos: suyos.map(({ rol, inicio, fin, desde, hasta }) => ({ rol, inicio, fin, desde, hasta })),
      }
    })
    .filter((p) => p.presente || p.turnos.length > 0)
    .sort((a, b) => Number(b.presente) - Number(a.presente) || a.nombre.localeCompare(b.nombre, 'es'))
}

/**
 * Quiénes pueden hacer la tarea de ese horario: los que tienen un turno que se
 * superpone con su plazo (hora → hora + 60'), o los que están fichados si la
 * tarea es de ahora. Nadie fuera de turno.
 */
export function candidatosPara(personal: Persona[], t: Pick<Tarea, 'fecha' | 'hora'>, ahora = new Date(), roles?: string[] | null): Candidato[] {
  const inicio = instanteDe(t.fecha, t.hora).getTime()
  const limite = inicio + ATRASO_MIN * 60_000
  const esDeAhora = ahora.getTime() >= inicio - ATRASO_MIN * 60_000 && ahora.getTime() < limite
  const out: Candidato[] = []
  for (const p of personal) {
    const turno = p.turnos.find((x) => x.inicio < limite && x.fin > inicio)
    if (!turno && !(p.presente && esDeAhora)) continue
    const rol = turno?.rol ?? p.role
    if (roles?.length && !roles.includes(rol)) continue
    out.push({ id: p.id, nombre: p.nombre, role: rol, presente: p.presente, turno: turno ? `${turno.desde}–${turno.hasta}` : null })
  }
  return out
}

/** A quién avisar para asignar: encargados de turno fichados → con turno de encargado hoy → todos los encargados. */
async function encargadosDeTurno(admin: SupabaseClient, fecha: string): Promise<string[]> {
  const personal = await personalDeTurno(admin, fecha)
  const esEnc = (r: string) => (ROLES_ENCARGADO_TURNO as readonly string[]).includes(r)
  const fichados = personal.filter((p) => p.presente && esEnc(p.role)).map((p) => p.id)
  if (fichados.length > 0) return fichados
  const conTurno = personal.filter((p) => p.turnos.some((t) => esEnc(t.rol))).map((p) => p.id)
  if (conTurno.length > 0) return conTurno
  const { data } = await admin.from('profiles').select('id').eq('is_active', true).eq('role', 'encargado')
  return (data ?? []).map((p: { id: string }) => p.id)
}

async function socios(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.from('profiles').select('id').eq('is_active', true).eq('role', 'socio')
  return (data ?? []).map((p: { id: string }) => p.id)
}

async function avisar(ids: string[], payload: { title: string; body: string; url: string }) {
  await Promise.allSettled([...new Set(ids)].map((id) => sendPushToUser(id, payload)))
}

/** Revisa las tareas del día y manda los avisos que correspondan (idempotente). */
export async function procesarAvisos(admin: SupabaseClient, ahora = new Date()): Promise<Record<string, number>> {
  const fecha = fechaOperativa(ahora)
  await asegurarTareasDelDia(admin, fecha)
  const [{ data: tareasDelDia }, { data: protocolos }] = await Promise.all([
    admin.from('protocolo_tareas').select('*').eq('fecha', fecha),
    // select('*'): tolera que todavía no exista la columna asignar_auto_rol
    admin.from('protocolos').select('*'),
  ])
  const delDia = (tareasDelDia ?? []) as Tarea[]
  const tareas = delDia.filter((t) => t.estado !== 'hecha')
  const prot = new Map(((protocolos ?? []) as Protocolo[]).map((p) => [p.id, p]))
  const cont = { auto: 0, aviso: 0, reaviso: 0, recordatorio: 0, atraso: 0 }
  let encargados: string[] | null = null
  const getEncargados = async () => (encargados ??= await encargadosDeTurno(admin, fecha))
  let personal: Persona[] | null = null
  const url = '/protocolos'
  const t0 = ahora.getTime()

  /**
   * Tarea con puesto automático: se la asigna a quien esté FICHADO con ese
   * puesto y turno a esa hora (no a quien todavía no llegó). Si hay varios, a
   * quien le tocaron menos de este protocolo hoy. false = no había nadie.
   */
  const asignarSola = async (t: Tarea, p: Protocolo | undefined): Promise<boolean> => {
    if (!p?.asignar_auto_rol) return false
    personal ??= await personalDeTurno(admin, fecha, ahora)
    const yaLeTocaron = (id: string) => delDia.filter((x) => x.protocolo_id === t.protocolo_id && x.asignado_a === id).length
    const elegido = candidatosPara(personal, t, ahora, [p.asignar_auto_rol])
      .filter((c) => c.presente)
      .sort((a, b) => yaLeTocaron(a.id) - yaLeTocaron(b.id) || a.nombre.localeCompare(b.nombre, 'es'))[0]
    if (!elegido) return false
    // Solo si sigue sin asignar (el encargado pudo haberla asignado recién)
    const { data } = await admin.from('protocolo_tareas').update({
      estado: 'asignada', asignado_a: elegido.id, asignado_por: null, asignado_at: ahora.toISOString(), recordatorio_at: null,
      avisado_at: t.avisado_at ?? ahora.toISOString(),
    }).eq('id', t.id).eq('estado', 'pendiente').select('id')
    if ((data ?? []).length === 0) return true
    t.asignado_a = elegido.id
    await avisar([elegido.id], { title: `🧽 Te toca: ${p.nombre} (${t.hora})`, body: `Te tocó por estar de ${p.asignar_auto_rol} en turno. Al terminar, marcá los pasos y subí las fotos.`, url })
    cont.auto++
    return true
  }

  for (const t of tareas) {
    const n = prot.get(t.protocolo_id)?.nombre ?? 'Protocolo'
    const inicio = instanteDe(t.fecha, t.hora).getTime()
    // Creada después de su límite (arranque del sistema o horario agregado a
    // mitad del día): no se avisa un atraso que nadie pudo cumplir.
    if (Date.parse(t.created_at) >= inicio + ATRASO_MIN * 60_000) continue
    // Reserva el aviso ANTES de mandarlo: si dos procesos corren a la vez
    // (reloj + app abierta), solo uno lo consigue y el aviso sale una vez.
    const reservar = async (campo: string): Promise<boolean> => {
      const { data } = await admin.from('protocolo_tareas').update({ [campo]: ahora.toISOString() }).eq('id', t.id).is(campo, null).select('id')
      return (data ?? []).length > 0
    }

    if (t0 >= inicio + ATRASO_MIN * 60_000) {
      if (!t.atraso_at && await reservar('atraso_at')) {
        await avisar([...(await getEncargados()), ...(await socios(admin)), ...(t.asignado_a ? [t.asignado_a] : [])], {
          title: `⚠️ No se hizo: ${n} (${t.hora})`,
          body: t.estado === 'asignada' ? 'Estaba asignada y no se completó. Hacela y subí las fotos.' : 'Nadie la asignó. Asignala ahora.',
          url,
        })
        cont.atraso++
      }
      continue
    }
    if (t0 < inicio) continue

    if (t.estado === 'pendiente') {
      // Puesto automático: se reintenta en cada vuelta (el barista pudo fichar después)
      if (await asignarSola(t, prot.get(t.protocolo_id))) continue
      if (!t.avisado_at) {
        if (await reservar('avisado_at')) {
          await avisar(await getEncargados(), { title: `🧽 Es la hora: ${n} (${t.hora})`, body: 'Asigná a alguien del turno (o a vos) para hacerla y subir las fotos.', url })
          cont.aviso++
        }
      } else if (!t.reaviso_at && t0 >= inicio + REAVISO_MIN * 60_000 && await reservar('reaviso_at')) {
        await avisar(await getEncargados(), { title: `⏰ Sigue sin asignar: ${n} (${t.hora})`, body: 'Asignala ahora: se tiene que hacer y registrar con fotos.', url })
        cont.reaviso++
      }
    } else if (t.estado === 'asignada' && t.asignado_at && !t.recordatorio_at && t0 >= Date.parse(t.asignado_at) + RECORDATORIO_MIN * 60_000 && await reservar('recordatorio_at')) {
      await avisar([t.asignado_a!, ...(t.asignado_por ? [t.asignado_por] : [])], { title: `⏰ Falta completar: ${n} (${t.hora})`, body: 'Marcá los pasos y subí las fotos cuando termines.', url })
      cont.recordatorio++
    }
  }
  return cont
}

/**
 * Al terminar una producción: tarea de contar los elaborados (protocolos con
 * al_terminar_produccion). Si ya hay una de hoy sin hacer, no se crea otra
 * (varias producciones seguidas = un solo conteo). Best-effort: nunca corta
 * el cierre de la producción.
 */
export async function crearTareaAlTerminarProduccion(admin: SupabaseClient, ahora = new Date()): Promise<void> {
  try {
    const { data } = await admin.from('protocolos').select('*').eq('activo', true)
    const prots = ((data ?? []) as Protocolo[]).filter((p) => p.al_terminar_produccion)
    if (prots.length === 0) return
    const fecha = fechaOperativa(ahora)
    const hora = ahora.toLocaleTimeString('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })
    for (const p of prots) {
      const { data: abiertas } = await admin.from('protocolo_tareas').select('id')
        .eq('protocolo_id', p.id).eq('fecha', fecha).in('estado', ['pendiente', 'asignada']).limit(1)
      if ((abiertas ?? []).length > 0) continue
      await admin.from('protocolo_tareas').upsert({ protocolo_id: p.id, fecha, hora }, { onConflict: 'protocolo_id,fecha,hora', ignoreDuplicates: true })
    }
  } catch (err) {
    console.warn('[crearTareaAlTerminarProduccion]', err instanceof Error ? err.message : err)
  }
}
