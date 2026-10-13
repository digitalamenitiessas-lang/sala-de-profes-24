import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa, instanteDe } from '@/lib/attendance/jornada'
import { isManagerOrAbove } from '@/lib/roles'

// ---------------------------------------------------------------------------
// Rol del turno
// ---------------------------------------------------------------------------
// El rol del perfil es fijo, pero en la práctica la gente rota: una barista a
// veces hace de runner, un runner a veces es encargado. El rol real de
// cada día es el de su turno (`shifts.shift_role`). Estas funciones lo
// resuelven para avisos, asignación de tareas y permisos operativos.
// ---------------------------------------------------------------------------

/** Margen alrededor del turno: llegar un rato antes o quedarse cerrando. */
export const MARGEN_TURNO_MIN = 30

export type TurnoDia = { user_id: string; rol: string; inicio: number; fin: number; desde: string; hasta: string }

/** Instantes de inicio y fin de un turno (cruza la medianoche si termina antes de empezar). */
export function ventanaTurno(fecha: string, start: string, end: string): { inicio: number; fin: number } {
  const inicio = instanteDe(fecha, start).getTime()
  let fin = instanteDe(fecha, end).getTime()
  if (fin <= inicio) fin += 86_400_000
  return { inicio, fin }
}

/** Turnos del día operativo, con su rol y sus instantes. */
export async function turnosDelDia(admin: SupabaseClient, fecha = fechaOperativa()): Promise<TurnoDia[]> {
  const { data } = await admin.from('shifts').select('user_id, start_time, end_time, shift_role').eq('shift_date', fecha)
  return ((data ?? []) as { user_id: string; start_time: string; end_time: string; shift_role: string | null }[])
    .filter((s) => s.shift_role && s.start_time && s.end_time)
    .map((s) => ({
      user_id: s.user_id,
      rol: s.shift_role!,
      ...ventanaTurno(fecha, s.start_time, s.end_time),
      desde: s.start_time.slice(0, 5),
      hasta: s.end_time.slice(0, 5),
    }))
}

/** ¿El turno está en curso en ese instante (con el margen)? */
export function turnoEnCurso(t: Pick<TurnoDia, 'inicio' | 'fin'>, ahora = Date.now()): boolean {
  const m = MARGEN_TURNO_MIN * 60_000
  return t.inicio - m <= ahora && ahora < t.fin + m
}

/** Ids (activos) de quienes están trabajando ahora con alguno de esos roles según su turno. */
export async function idsConRolEnTurno(admin: SupabaseClient, roles: readonly string[], ahora = new Date()): Promise<string[]> {
  if (roles.length === 0) return []
  const turnos = await turnosDelDia(admin, fechaOperativa(ahora))
  const ids = [...new Set(turnos.filter((t) => roles.includes(t.rol) && turnoEnCurso(t, ahora.getTime())).map((t) => t.user_id))]
  if (ids.length === 0) return []
  const { data } = await admin.from('profiles').select('id').in('id', ids).eq('is_active', true)
  return (data ?? []).map((p: { id: string }) => p.id)
}

/**
 * Rol con el que la persona trabaja ahora: el del turno en curso o, si está
 * fichada, el de su turno de hoy. Null si hoy no trabaja.
 */
export async function rolEnTurnoAhora(admin: SupabaseClient, userId: string, ahora = new Date()): Promise<string | null> {
  const fecha = fechaOperativa(ahora)
  const [{ data: turnos }, { data: abierto }] = await Promise.all([
    admin.from('shifts').select('start_time, end_time, shift_role').eq('shift_date', fecha).eq('user_id', userId),
    admin.from('attendance_logs').select('id').eq('user_id', userId).eq('status', 'open').limit(1),
  ])
  const lista = ((turnos ?? []) as { start_time: string; end_time: string; shift_role: string | null }[])
    .filter((s) => s.shift_role && s.start_time && s.end_time)
    .map((s) => ({ rol: s.shift_role!, ...ventanaTurno(fecha, s.start_time, s.end_time) }))
  const enCurso = lista.find((t) => turnoEnCurso(t, ahora.getTime()))
  if (enCurso) return enCurso.rol
  if ((abierto ?? []).length > 0 && lista.length > 0) return lista[0].rol
  return null
}

/** Turnos que llevan permisos de encargado (el cajero tiene los mismos). */
export const ROLES_ENCARGADO_TURNO = ['encargado', 'cajero'] as const

/** Encargado o socio de perfil, o trabajando ahora como encargado/cajero según su turno. */
export async function esEncargadoAhora(admin: SupabaseClient, user: { id: string; role: string }): Promise<boolean> {
  if (isManagerOrAbove(user.role)) return true
  const rol = await rolEnTurnoAhora(admin, user.id)
  return !!rol && (ROLES_ENCARGADO_TURNO as readonly string[]).includes(rol)
}
