import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa, instanteDe } from '@/lib/attendance/jornada'
import { sendPushToUser } from '@/lib/push/send'

// ---------------------------------------------------------------------------
// Protocolos con horario (limpieza del baño, etc.)
// ---------------------------------------------------------------------------
// Ciclo de cada tarea (un horario de un día):
//   hora         → aviso al encargado de turno: "asigná a alguien"
//   hora + 15'   → si sigue sin asignar, se vuelve a avisar
//   asignada+30' → si no está hecha, recordatorio a quien la tiene (y a quien asignó)
//   hora + 60'   → si no está hecha, aviso de atraso a encargados y socios
// Se completa con todos los pasos marcados y una foto.
// ---------------------------------------------------------------------------

export const REAVISO_MIN = 15
export const RECORDATORIO_MIN = 30
export const ATRASO_MIN = 60

export type Protocolo = { id: string; nombre: string; descripcion: string | null; horarios: string[]; pasos: string[]; fotos: string[]; requiere_foto: boolean; activo: boolean }
export type Tarea = {
  id: string; protocolo_id: string; fecha: string; hora: string
  estado: 'pendiente' | 'asignada' | 'hecha'
  asignado_a: string | null; asignado_por: string | null; asignado_at: string | null
  hecho_por: string | null; hecho_at: string | null; foto_path: string | null; fotos: string[] | null; pasos_ok: string[] | null; nota: string | null
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

/** Crea (si faltan) las tareas del día para cada horario de cada protocolo activo. */
export async function asegurarTareasDelDia(admin: SupabaseClient, fecha = fechaOperativa()): Promise<void> {
  const { data: protocolos } = await admin.from('protocolos').select('id, horarios').eq('activo', true)
  const filas = ((protocolos ?? []) as { id: string; horarios: string[] }[])
    .flatMap((p) => p.horarios.map((hora) => ({ protocolo_id: p.id, fecha, hora })))
  if (filas.length === 0) return
  await admin.from('protocolo_tareas').upsert(filas, { onConflict: 'protocolo_id,fecha,hora', ignoreDuplicates: true })
}

export type Persona = { id: string; nombre: string; role: string; presente: boolean }

/** Quién está trabajando ahora: fichado (presente) o con turno hoy. */
export async function personalDeTurno(admin: SupabaseClient, fecha = fechaOperativa()): Promise<Persona[]> {
  const [{ data: abiertos }, { data: turnos }, { data: perfiles }] = await Promise.all([
    admin.from('attendance_logs').select('user_id').eq('status', 'open'),
    admin.from('shifts').select('user_id').eq('shift_date', fecha),
    admin.from('profiles').select('id, first_name, last_name, role').eq('is_active', true),
  ])
  const presentes = new Set((abiertos ?? []).map((a: { user_id: string }) => a.user_id))
  const conTurno = new Set((turnos ?? []).map((t: { user_id: string }) => t.user_id))
  return ((perfiles ?? []) as { id: string; first_name: string | null; last_name: string | null; role: string }[])
    .filter((p) => presentes.has(p.id) || conTurno.has(p.id))
    .map((p) => ({ id: p.id, nombre: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Sin nombre', role: p.role, presente: presentes.has(p.id) }))
    .sort((a, b) => Number(b.presente) - Number(a.presente) || a.nombre.localeCompare(b.nombre, 'es'))
}

/** A quién avisar para asignar: encargados fichados → con turno hoy → todos los encargados. */
async function encargadosDeTurno(admin: SupabaseClient, fecha: string): Promise<string[]> {
  const personal = await personalDeTurno(admin, fecha)
  const fichados = personal.filter((p) => p.presente && p.role === 'encargado').map((p) => p.id)
  if (fichados.length > 0) return fichados
  const conTurno = personal.filter((p) => p.role === 'encargado').map((p) => p.id)
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
  const [{ data: tareas }, { data: protocolos }] = await Promise.all([
    admin.from('protocolo_tareas').select('*').eq('fecha', fecha).neq('estado', 'hecha'),
    admin.from('protocolos').select('id, nombre'),
  ])
  const nombre = new Map((protocolos ?? []).map((p: { id: string; nombre: string }) => [p.id, p.nombre]))
  const cont = { aviso: 0, reaviso: 0, recordatorio: 0, atraso: 0 }
  let encargados: string[] | null = null
  const getEncargados = async () => (encargados ??= await encargadosDeTurno(admin, fecha))
  const url = '/protocolos'
  const t0 = ahora.getTime()

  for (const t of (tareas ?? []) as Tarea[]) {
    const n = nombre.get(t.protocolo_id) ?? 'Protocolo'
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
