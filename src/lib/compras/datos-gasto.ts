// ---------------------------------------------------------------------------
// Datos del gasto que se cargan al confirmar una compra ("Llegó" / "Llegó
// todo"): la categoría (con eso se hace el análisis de fin de mes) y el
// comprobante. Va a Fudo (categoría, tipo y número de comprobante) y queda en
// stock_receipts. IVA e IIBB (Factura A) se suman al gasto de Fudo para que
// quede el total a pagar, detallados en la descripción (la API de Fudo no deja
// cargarlos como impuestos del gasto), y quedan en un recibo "Impuestos de la
// factura": la suma de los recibos de una factura = el gasto de Fudo. El costo
// de los productos queda sin IVA. Sin imports de servidor: lo usan los
// diálogos y la API.
// ---------------------------------------------------------------------------

/** Nota del recibo con el IVA/IIBB de una factura (sin producto: no es costo de insumos) */
export const NOTA_IMPUESTOS = 'Impuestos de la factura'

export type ComprobanteTipo = 'sin_comprobante' | 'ticket' | 'factura_a' | 'factura_b' | 'factura_c'

export const COMPROBANTES: { key: ComprobanteTipo; label: string }[] = [
  { key: 'sin_comprobante', label: 'Sin comprobante' },
  { key: 'ticket', label: 'Ticket' },
  { key: 'factura_a', label: 'Factura A' },
  { key: 'factura_b', label: 'Factura B' },
  { key: 'factura_c', label: 'Factura C' },
]

export type DatosGasto = {
  categoriaId: string | null
  categoriaNombre: string | null
  comprobante: ComprobanteTipo | null
  numero: string | null
  /** Solo Factura A */
  iva: number | null
  /** Solo Factura A */
  iibb: number | null
  /**
   * Quién la cargó en Sala de Profes. Lo pone el SERVER (nunca el cliente):
   * por la API, Fudo registra como autor al usuario con el que se conecta la
   * app, así que el nombre real va en el comentario del gasto.
   */
  cargadoPor?: string | null
}

/** grupo: la categoría padre en Fudo (ej. "Compras y proveedores"); null si no tiene */
export type CategoriaGasto = { id: string; name: string; grupo: string | null }

export const esFactura = (c: ComprobanteTipo | null | undefined) => c === 'factura_a' || c === 'factura_b' || c === 'factura_c'

const monto = (v: unknown) => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) && n >= 0 && n < 100_000_000 ? Math.round(n * 100) / 100 : null
}
const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/**
 * Normaliza lo que manda el cliente; null si no vino nada.
 * confiable: viene de un reintento guardado por el server (conserva cargadoPor).
 */
export function parseDatosGasto(raw: unknown, { confiable = false } = {}): DatosGasto | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const comprobante = COMPROBANTES.some((c) => c.key === r.comprobante) ? r.comprobante as ComprobanteTipo : null
  const categoriaId = typeof r.categoriaId === 'string' && /^\d{1,10}$/.test(r.categoriaId) ? r.categoriaId : null
  const facturaA = comprobante === 'factura_a'
  return {
    categoriaId,
    categoriaNombre: categoriaId ? texto(r.categoriaNombre, 120) : null,
    comprobante,
    numero: esFactura(comprobante) || comprobante === 'ticket' ? texto(r.numero, 45) : null,
    iva: facturaA ? monto(r.iva) : null,
    iibb: facturaA ? monto(r.iibb) : null,
    cargadoPor: confiable ? texto(r.cargadoPor, 80) : null,
  }
}

/** Agrega quién cargó el gasto (aunque el cliente no haya mandado datos). */
export function conCargadoPor(d: DatosGasto | null, nombre: string | null): DatosGasto | null {
  if (!nombre) return d
  return { ...(d ?? { categoriaId: null, categoriaNombre: null, comprobante: null, numero: null, iva: null, iibb: null }), cargadoPor: nombre }
}

/** Comentario del gasto en Fudo: "Cargó <nombre> (Sala de Profes) · Factura A N° … · IVA $… · IIBB $…". */
export function descripcionGasto(d: DatosGasto | null): string | null {
  if (!d) return null
  const conComprobante = d.comprobante && d.comprobante !== 'sin_comprobante'
  const label = conComprobante ? COMPROBANTES.find((c) => c.key === d.comprobante)?.label ?? '' : ''
  const $ = (n: number) => `$${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
  const texto = [
    d.cargadoPor ? `Cargó ${d.cargadoPor} (Sala de Profes)` : null,
    conComprobante ? label + (d.numero ? ` N° ${d.numero}` : '') : null,
    d.iva != null ? `IVA ${$(d.iva)}` : null,
    d.iibb != null ? `IIBB ${$(d.iibb)}` : null,
  ].filter(Boolean).join(' · ').slice(0, 255)
  return texto || null
}
