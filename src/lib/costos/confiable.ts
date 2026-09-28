// ---------------------------------------------------------------------------
// Costo confiable — criterio único en toda la app.
// ---------------------------------------------------------------------------
// Decisión de producto (Marco): los costos que vienen por API de Fudo NO son
// reales. Un costo solo se muestra como número cuando su fuente es directa:
//   - 'compra'     → salió de una recepción de mercadería con precio real
//   - 'manual'     → lo cargó un manager a mano
//   - 'produccion' → lo calculó una tanda cuyos insumos eran todos confiables
// Todo lo demás ('estimado', 'fudo', sin fuente) se trata como "sin costo
// real": no se suma, no se promedia, no se rankea.
// ---------------------------------------------------------------------------

export const COSTO_FUENTES_CONFIABLES = ['compra', 'manual', 'produccion'] as const

export type FuenteCosto = 'compra' | 'manual' | 'produccion' | 'estimado' | 'fudo'

/**
 * true solo si la fuente es confiable Y el costo es un número > 0.
 * Si no se pasa `cost` (undefined) se evalúa solo la fuente.
 */
export function esCostoConfiable(
  source: string | null | undefined,
  cost?: number | null,
): boolean {
  if (!source || !(COSTO_FUENTES_CONFIABLES as readonly string[]).includes(source)) return false
  if (cost === undefined) return true
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0
}

/**
 * Error de PostgREST por columna inexistente (migración de cost_source
 * pendiente). Mismo patrón que isMissingColumnError de stock-sync: permite
 * caer a un select legacy sin la columna.
 */
export function esErrorColumnaFaltante(
  message: string | undefined | null,
  columns: string[],
): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return columns.some((c) => m.includes(c.toLowerCase())) && (m.includes('column') || m.includes('schema cache'))
}

/** Etiqueta humana de la fuente del costo, para fichas y tooltips. */
export function etiquetaFuenteCosto(source: string | null | undefined): string {
  switch (source) {
    case 'compra': return 'compra real'
    case 'manual': return 'cargado a mano'
    case 'produccion': return 'producción'
    case 'estimado': return 'estimado'
    case 'fudo': return 'Fudo (no confiable)'
    default: return 'sin dato'
  }
}
