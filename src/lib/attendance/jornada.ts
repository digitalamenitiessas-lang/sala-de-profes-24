import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Jornada de trabajo — reglas comunes del fichaje
// ---------------------------------------------------------------------------
// Día operativo: el local cierra a las 00:00 (01:00 viernes y sábado), así que
// una jornada no termina a medianoche. Todo lo que pasa antes de las 06:00
// (hora Argentina) pertenece al día anterior: quien entra a las 19:00 y sale a
// la 01:00 tiene UN fichaje del mismo día, y puede marcar la salida.
// Antes se usaba la fecha de calendario: pasada la medianoche la app mostraba
// "Marcar ingreso" y la salida no se podía marcar.
// ---------------------------------------------------------------------------

const AR_MS = 3 * 3_600_000
export const CORTE_HORA = 6

/** Fecha operativa (YYYY-MM-DD) de un instante, con corte a las 06:00 AR. */
export function fechaOperativa(d: Date = new Date()): string {
  return new Date(d.getTime() - AR_MS - CORTE_HORA * 3_600_000).toISOString().slice(0, 10)
}

/** Instante de una hora "HH:MM" de un día operativo (antes de las 06 = día siguiente). */
export function instanteDe(fecha: string, hhmm: string): Date {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number)
  const base = new Date(`${fecha}T${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00-03:00`)
  return h < CORTE_HORA ? new Date(base.getTime() + 86_400_000) : base
}

type Turno = { user_id: string; shift_date: string; start_time: string | null; end_time: string | null }
type Cierre = { day_of_week: number; closing_time: string; override_date: string | null; is_default: boolean | null }

export type DatosCierre = { turnos: Turno[]; cierres: Cierre[] }

export async function cargarDatosCierre(admin: SupabaseClient, fechas: string[]): Promise<DatosCierre> {
  const [{ data: turnos }, { data: cierres }] = await Promise.all([
    admin.from('shifts').select('user_id, shift_date, start_time, end_time').in('shift_date', [...new Set(fechas)]),
    admin.from('closing_hours').select('day_of_week, closing_time, override_date, is_default'),
  ])
  return { turnos: (turnos ?? []) as Turno[], cierres: (cierres ?? []) as Cierre[] }
}

/**
 * Hora prevista de salida de un fichaje abierto:
 *   1. el turno cargado de ese día (si hay dos, el que corresponde a la hora
 *      de entrada: el que empieza más cerca antes de entrar)
 *   2. el horario de cierre del local de ese día (excepción por fecha o el
 *      de ese día de la semana)
 * Sin la vieja regla "si entró antes de las 12 cierra a las 16": cortaba a
 * quien hacía turno doble.
 */
export function cierrePrevisto(
  log: { user_id: string; operative_date: string; clock_in_at: string },
  datos: DatosCierre,
): { at: Date; fuente: 'turno' | 'horario de cierre' } {
  const entrada = new Date(log.clock_in_at).getTime()
  const turnos = datos.turnos
    .filter((t) => t.user_id === log.user_id && t.shift_date === log.operative_date && t.end_time)
    .map((t) => {
      const inicio = t.start_time ? instanteDe(t.shift_date, t.start_time).getTime() : entrada
      let fin = instanteDe(t.shift_date, t.end_time!).getTime()
      if (fin <= inicio) fin += 86_400_000 // termina después de medianoche
      return { inicio, fin }
    })
    .sort((a, b) => a.inicio - b.inicio)
  if (turnos.length > 0) {
    // el último turno que empieza antes de la entrada (con 2 h de tolerancia), o el primero
    const elegido = [...turnos].reverse().find((t) => t.inicio <= entrada + 2 * 3_600_000) ?? turnos[0]
    if (elegido.fin > entrada) return { at: new Date(elegido.fin), fuente: 'turno' }
  }

  const dow = new Date(`${log.operative_date}T12:00:00-03:00`).getUTCDay()
  const cierre = datos.cierres.find((c) => c.override_date === log.operative_date)?.closing_time
    ?? datos.cierres.find((c) => c.is_default && c.day_of_week === dow)?.closing_time
    ?? '00:00'
  let at = instanteDe(log.operative_date, cierre)
  if (at.getTime() <= entrada) at = new Date(entrada + 60_000) // nunca antes de la entrada
  return { at, fuente: 'horario de cierre' }
}
