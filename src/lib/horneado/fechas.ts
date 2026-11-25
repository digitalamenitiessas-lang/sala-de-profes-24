// Fechas del horneado (YYYY-MM-DD, día operativo). En Santa Fe vienen de
// lib/operaciones/fechas, que la 24 no tiene: son las mismas funciones.

export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
export const DC = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Día de la semana (0 = domingo) */
export const dow = (s: string) => new Date(`${s}T12:00:00Z`).getUTCDay()

export function sumar(s: string, n: number): string {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10)
}

/** "2026-11-25" → "25/11" */
export const corta = (s: string) => { const [, m, d] = s.split('-'); return `${+d}/${+m}` }
