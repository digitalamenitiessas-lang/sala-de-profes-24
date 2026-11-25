import { z } from 'zod'

// ---------------------------------------------------------------------------
// Informe que arma La Vieja para bajar en PDF
// ---------------------------------------------------------------------------
// La IA responde con un bloque INFORME_JSON con esta forma; acá se valida y se
// recorta antes de mostrar el botón y de armar el PDF. Los límites evitan que
// un informe desbordado rompa el PDF o tarde demasiado.
// ---------------------------------------------------------------------------

// La IA a veces se pasa de largo: se recorta en vez de descartar el informe entero
const texto = (max: number) => z.string().transform((v) => v.trim().slice(0, max))
const lista = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).transform((a) => a.slice(0, max))
const celda = z.union([z.string(), z.number(), z.null()]).transform((v) =>
  v == null ? '' : typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 2 }) : v.trim().slice(0, 200))

export const esquemaInforme = z.object({
  titulo: texto(120).refine((v) => v.length >= 3, 'Falta el título'),
  subtitulo: texto(160).optional(),
  resumen: texto(2000).optional(),
  indicadores: lista(z.object({ etiqueta: texto(40), valor: texto(40), detalle: texto(90).optional() }), 6).optional(),
  secciones: lista(z.object({
    titulo: texto(120),
    texto: texto(4000).optional(),
    puntos: lista(texto(400), 40).optional(),
    tabla: z.object({
      columnas: lista(texto(40), 8).refine((c) => c.length > 0, 'Tabla sin columnas'),
      filas: lista(lista(celda, 8), 300),
      total: lista(celda, 8).optional(),
    }).optional(),
  }), 20).default([]),
  notas: lista(texto(400), 10).optional(),
})

export type Informe = z.infer<typeof esquemaInforme>

/** Saca el bloque INFORME_JSON de la respuesta de la IA. Si no se puede leer, avisa sin romper el chat. */
export function extraerInforme(respuesta: string): { texto: string; informe: Informe | null; fallo: boolean } {
  const m = respuesta.match(/```INFORME_JSON\s*([\s\S]*?)\s*```/)
  if (!m) {
    // La respuesta se cortó a mitad del informe: se saca el pedazo para no mostrar código suelto
    const corte = respuesta.indexOf('```INFORME_JSON')
    return corte === -1
      ? { texto: respuesta, informe: null, fallo: false }
      : { texto: respuesta.slice(0, corte).trim(), informe: null, fallo: true }
  }
  const texto = respuesta.replace(/```INFORME_JSON[\s\S]*?```/, '').trim()
  try {
    const r = esquemaInforme.safeParse(JSON.parse(m[1]))
    return r.success ? { texto, informe: r.data, fallo: false } : { texto, informe: null, fallo: true }
  } catch {
    return { texto, informe: null, fallo: true }
  }
}
