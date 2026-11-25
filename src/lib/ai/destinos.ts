import { getAllMoreItems, getNavItems } from '@/lib/navegacion'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// Pantallas a las que La Vieja puede mandar con un toque
// ---------------------------------------------------------------------------
// Traído de Santa Fe (baaab00). La Vieja escribe la dirección de la pantalla
// entre paréntesis, por ejemplo "**Horneado** (/cocina/horneado)", y el chat lo
// convierte en un botón «Ir a…». Solo vale si la pantalla está en el menú de
// esa persona, o es una de adentro conocida (NOMBRES, DETALLES) de una que
// tiene, como Stock → Conteo de cierre: si la IA inventa una dirección, no
// aparece botón. Sin dependencias de servidor: lo usan el chat flotante y
// /asistente. Todas las de NOMBRES existen en la 24 (src/app/(app)/…).
// ---------------------------------------------------------------------------

export type Destino = { href: string; label: string }

/** Pantallas de adentro que no están en el menú (se abren desde otra), y
 *  pestañas con filtro que tienen nombre propio (/pedidos?step=camino) */
const NOMBRES: Record<string, string> = {
  '/stock/conteo': 'Conteo guiado',
  '/stock/cierre': 'Conteo de cierre',
  '/pedidos?step=camino': 'En camino (Compras)',
  '/pedidos/cuentas': 'Cuentas por pagar',
  '/pedidos/gastos': 'Historial y descargas de compras',
  '/equipo/turnos': 'Turnos de la semana',
  '/equipo/turnos/cargar': 'Cargar turnos',
  '/admin/reportes/liquidacion': 'Liquidación de horas',
  '/admin/reportes/asistencia': 'Reporte de asistencia',
  '/cocina/elaborados': 'Elaborados',
}

/** Con número o id: el detalle de algo (en la 24 no se produce: sin /cocina/produccion/N) */
const DETALLES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^\/equipo\/[0-9a-f-]{36}$/i, () => 'la ficha'],
]

/** Para todos, aunque no estén en el menú */
const SIEMPRE: Record<string, string> = {
  '/cambiar-clave': 'Cambiar contraseña',
}

/**
 * Direcciones en el texto de La Vieja:
 *   [texto](/ruta)  → grupos 1 (texto) y 2 (ruta)
 *   (/ruta)         → grupo 3 (con el espacio de antes)
 *   /ruta suelta    → grupos 4 (lo de antes: espacio o principio) y 5 (ruta)
 * Sin lookbehind: Safari viejo no lo soporta y rompería todo el chat.
 * Una fecha (12/10) o "y/o" no matchean: la barra tiene que ir después de un
 * espacio o al principio y seguir con una letra.
 */
export const ENLACES = /\[([^\]\n]+)\]\((\/[^\s)]*)\)| ?\((\/[^\s)]*)\)|(^|[\s«"'])(\/[a-z][a-z0-9\-/]*(?:\?[a-z0-9=&_-]*)?)/gi

/** Pantallas que nombra el mensaje y esta persona tiene (sin repetir, en orden) */
export function destinosDelMensaje(texto: string, role: string | null | undefined): Destino[] {
  const vistos = new Map<string, Destino>()
  for (const m of texto.matchAll(ENLACES)) {
    const d = resolverDestino(m[2] ?? m[3] ?? m[5], role)
    if (d && !vistos.has(d.href)) vistos.set(d.href, d)
  }
  return [...vistos.values()]
}

/** Dirección interna y prolija: /algo/otra?x=y (nada externo ni raro) */
const DIRECCION = /^\/[a-z0-9][a-z0-9\-/]*(\?[a-z0-9=&_\-]*)?$|^\/$/i

function partes(href: string): { path: string; query: string } {
  const i = href.indexOf('?')
  const path = (i === -1 ? href : href.slice(0, i)).replace(/\/+$/, '') || '/'
  return { path, query: i === -1 ? '' : href.slice(i + 1) }
}

/** La pantalla a la que lleva esa dirección para este rol, o null si no la tiene */
export function resolverDestino(direccion: string, role: string | null | undefined): Destino | null {
  if (!role || !DIRECCION.test(direccion)) return null
  const { path, query } = partes(direccion)

  if (SIEMPRE[path]) return { href: path, label: SIEMPRE[path] }

  const nav = getNavItems(role as AppRole)
  const items = [...nav.items, ...getAllMoreItems(nav.more)]

  const propia = query ? `${path}?${query}` : path

  // Igual a una del menú. Sin filtro se usa el del menú (para la cocina,
  // /stock es Stock cocina → ?area=cocina), salvo las que tienen nombre propio
  // (/cocina/elaborados es la pestaña Elaborados, no Contar elaborados)
  const iguales = items.filter((i) => partes(i.href).path === path)
  if (iguales.length > 0) {
    const exacto = iguales.find((i) => partes(i.href).query === query)
    if (exacto) return { href: exacto.href, label: exacto.label }
    if (query || NOMBRES[path]) return { href: propia, label: NOMBRES[propia] ?? NOMBRES[path] ?? iguales[0].label }
    const elegido = iguales.find((i) => !partes(i.href).query) ?? iguales[0]
    return { href: elegido.href, label: elegido.label }
  }

  // De adentro de una del menú (Stock → Conteo guiado, Equipo → la ficha)
  const padre = items
    .map((i) => partes(i.href).path)
    .filter((p) => p !== '/' && path.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0]
  if (!padre) return null
  const detalle = DETALLES.map(([re, nombre]) => {
    const m = path.match(re)
    return m ? nombre(m) : null
  }).find(Boolean)
  // Solo las de adentro que existen (una inventada daría "página no encontrada")
  const label = NOMBRES[path] ?? detalle
  return label ? { href: propia, label } : null
}
