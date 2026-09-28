// ---------------------------------------------------------------------------
// Lectura de la planilla de turnos (Excel / CSV)
// ---------------------------------------------------------------------------
// La usa /api/shifts/upload. Reglas:
//   · Horario: "7 a 16", "07 A 16", "15:30 a 00", "7-16", "7 a 16hs",
//     "07:00 a 16:00", "15.30 a 00". Franco/descanso: vacío, FRANCO,
//     DESCANSO, LIBRE, X, -, VACACIONES, LICENCIA.
//     Lo que no se entiende NO se ignora: vuelve como error con fila y día.
//   · Persona: nombre y apellido. Si solo se pone el nombre y hay dos o más
//     con ese nombre (hay 3 "Facundo"), es error: no se adivina.
// ---------------------------------------------------------------------------

export const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']

/** Encabezados de sección (fila con solo esto en la columna A) → rol del turno */
export const ROLES_SECCION: Record<string, string> = {
  runner: 'runner', runners: 'runner', mozo: 'runner', mozos: 'runner', moza: 'runner', mozas: 'runner', salon: 'runner',
  barista: 'barista', baristas: 'barista', barra: 'barista',
  cocina: 'cocina', cocinero: 'cocina', cocineros: 'cocina', cocinera: 'cocina', cocineras: 'cocina',
  bacha: 'bacha', bachas: 'bacha', bachero: 'bacha', bacheros: 'bacha', bachera: 'bacha',
  encargado: 'encargado', encargados: 'encargado', encargada: 'encargado', encargadas: 'encargado',
  chef: 'chef', chefs: 'chef',
  socio: 'socio', socios: 'socio',
}

export const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

const DESCANSO = new Set(['', '-', 'X', 'F', 'FRANCO', 'DESCANSO', 'LIBRE', 'VACACIONES', 'LICENCIA', 'OFF'])

/** 'descanso' si no trabaja, el horario si se entiende, null si NO se entiende. */
export function leerHorario(valor: unknown): { start: string; end: string } | 'descanso' | null {
  const s = String(valor ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
  if (DESCANSO.has(s)) return 'descanso'
  const limpio = s.replace(/\s*(HS|HRS|H)\b\.?/g, ' ').replace(/\s+/g, ' ').trim()
  const m = limpio.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(?:A|AL|HASTA|-|–)\s*(\d{1,2})(?:[:.](\d{2}))?$/)
  if (!m) return null
  const hora = (h: string, min?: string) => {
    const hh = Number(h) === 24 ? 0 : Number(h)
    const mm = Number(min ?? 0)
    if (hh > 23 || mm > 59) return null
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  const start = hora(m[1], m[2])
  const end = hora(m[3], m[4])
  if (!start || !end || start === end) return null
  return { start, end }
}

export type Empleado = { id: string; first_name: string | null; last_name: string | null; role: string }

/** Busca a la persona por nombre y apellido; nunca adivina entre homónimos. */
export function buscarEmpleado(texto: string, empleados: Empleado[]): { ok: Empleado } | { error: string } {
  const t = normalizar(texto)
  const completo = (e: Empleado) => normalizar(`${e.first_name ?? ''} ${e.last_name ?? ''}`)
  const nombre = (e: Empleado) => normalizar(e.first_name ?? '')
  const unico = (lista: Empleado[]) => (lista.length === 1 ? lista[0] : null)

  const exacto = unico(empleados.filter((e) => completo(e) === t))
  if (exacto) return { ok: exacto }

  const porNombre = empleados.filter((e) => nombre(e) === t)
  if (porNombre.length === 1) return { ok: porNombre[0] }
  if (porNombre.length > 1) {
    return { error: `hay ${porNombre.length} personas llamadas "${texto}" (${porNombre.map((e) => `${e.first_name} ${e.last_name}`).join(', ')}): poné nombre y apellido` }
  }

  // "Facundo T", "Juan Pablo Ledesma" con un espacio de más, etc.
  const parecidos = empleados.filter((e) => completo(e).startsWith(t) || (t.startsWith(nombre(e) + ' ') && completo(e).includes(t.slice(nombre(e).length + 1))))
  if (parecidos.length === 1) return { ok: parecidos[0] }
  if (parecidos.length > 1) return { error: `"${texto}" coincide con ${parecidos.map((e) => `${e.first_name} ${e.last_name}`).join(' y ')}: poné el apellido completo` }

  return { error: `no se encontró a "${texto}" entre el personal activo` }
}
