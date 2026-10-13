import { canon } from '@/lib/recipes/recipe-cost'

// ---------------------------------------------------------------------------
// Recetario de platos — reglas compartidas (pantalla y servidor)
// ---------------------------------------------------------------------------
// Qué lleva cada plato por porción. Se guarda en recipe_ingredients
// (qty_per_portion + ingredient_unit) y lo usan costos, compras sugeridas y
// cocina para armar igual. Las cantidades se cargan en la unidad cómoda
// (g, ml, unidad) y se controla que no haya errores de unidad como
// "200 kg de molida" en una hamburguesa.
// ---------------------------------------------------------------------------

export const UNIDADES_RECETA = ['g', 'kg', 'ml', 'l', 'unidad'] as const
export type UnidadReceta = (typeof UNIDADES_RECETA)[number]

/** Unidad cómoda para cargar según la unidad del insumo en stock. */
export function unidadSugerida(unidadStock: string): UnidadReceta {
  const u = unidadStock.trim().toLowerCase()
  if (u === 'kg') return 'g'
  if (u === 'l' || u === 'lt') return 'ml'
  return 'unidad'
}

/** ¿La unidad de la receta se puede convertir a la del insumo? */
export function unidadCompatible(unidadReceta: string | null, unidadStock: string): boolean {
  if (!unidadReceta) return true
  const a = canon(1, unidadReceta).unit
  const b = canon(1, unidadStock).unit
  return a === b
}

/**
 * Aviso si la cantidad por porción no parece real. `grave` = no se puede
 * guardar así (sin cantidad, unidad que no se convierte, o un disparate
 * como 200 kg por plato); si no, es solo una advertencia (ej. menú del
 * personal, que lleva mucho a propósito).
 */
export function avisoCantidad(qty: number, unidad: string | null, unidadStock: string, insumo: string): { texto: string; grave: boolean } | null {
  if (!(qty > 0)) return { texto: 'Falta la cantidad', grave: true }
  if (!unidadCompatible(unidad, unidadStock)) {
    const sug = unidadSugerida(unidadStock)
    return { texto: `"${insumo}" se cuenta en ${unidadStock}: usá ${sug === 'unidad' ? 'unidades' : `${sug} o ${unidadStock}`}`, grave: true }
  }
  const c = canon(qty, unidad ?? unidadStock)
  const grande = c.unit === 'unidad' ? 30 : 1.5
  const disparate = c.unit === 'unidad' ? 100 : 20
  if (c.qty <= grande) return null
  const u = c.unit === 'unidad' ? 'unidades' : c.unit
  const enChico = c.unit === 'kg' ? 'g' : c.unit === 'l' ? 'ml' : null
  if (c.qty > disparate) {
    return { texto: `${num(c.qty)} ${u} por porción es imposible${enChico && unidad === c.unit ? `: ¿quisiste decir ${num(qty)} ${enChico}?` : ': revisá la cantidad'}`, grave: true }
  }
  return { texto: `${num(c.qty)} ${u} por porción es mucho: revisá que sea por porción`, grave: false }
}

const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 })
