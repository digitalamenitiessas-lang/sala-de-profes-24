// ---------------------------------------------------------------------------
// Recetario de producción — La Vieja Escuela
// ---------------------------------------------------------------------------
// Fuente: recetario físico de cocina. Estas son recetas de producción (mise en place),
// no platos finales. Se usan en el wizard de producción para pre-llenar insumos
// de forma proporcional al lote que se va a hacer.
//
// baseQty + baseUnit definen el lote de referencia.
// Todos los insumos secondarios se escalan: real_qty = base_qty × (entered / baseQty)
// ---------------------------------------------------------------------------

export type BatchIngredient = {
  /** Nombre de pantalla — usado también para fuzzy-match con stock_items */
  name: string
  /** Cantidad para el lote base */
  qty: number
  /** Unidad: 'g', 'ml', 'u', 'kg', 'lt' */
  unit: string
  /** Nota opcional (ej. "brunoise", "en juliana") */
  note?: string
}

export type ProductionBatch = {
  slug: string
  /** Nombre visible en el selector */
  displayName: string
  /** Nombre del insumo principal que define la escala */
  mainIngredientName: string
  /** Cantidad de insumo principal para este lote base */
  baseQty: number
  baseUnit: string
  /** Ingredientes secundarios — todos escalan proporcionalmente */
  secondary: BatchIngredient[]
  /** Qué sale de esta producción (el elaborado). Se autocarga como salida. */
  output?: {
    /** Nombre del elaborado — se fuzzy-matchea con stock_items */
    name: string
    unit: string
    /** Cuántas unidades salen del lote base (baseQty) */
    yieldPerBase: number
  }
  /** Info de rendimiento para mostrar al usuario */
  yieldNote?: string
}

// ---------------------------------------------------------------------------
// AUDITORÍA 2026-07-21 — varios ingredientes fuzzy-matcheaban al producto
// INCORRECTO en stock porque el matcher viejo aceptaba substrings crudos:
// "Sal" matcheaba "Salsa inglesa" (contiene "sal"), "Azúcar" matcheaba
// "Cereales sin azúcar", "Canela" matcheaba "Roll de canela", "Agua" matcheaba
// una marca de agua embotellada. Como las unidades "coincidían" (ambas decían
// el mismo string), la validación NO bloqueaba — se cargaba stock del
// producto equivocado en silencio. Fix: (1) matcher nuevo por palabras
// completas (ver matchIngredientToStock), (2) acá, referenciar el NOMBRE
// EXACTO del stock_item real para eliminar cualquier ambigüedad.
//
// Ingredientes que hoy NO tienen un stock_item real (quedan sin vincular a
// propósito — bloquean la producción hasta vincularlos a mano, en vez de
// adivinar mal): Morrón, Vino tinto, Romero, Cereal triturado, Aceite de
// oliva, Canela (spice), Carne molida, Queso dambo, Pollo (bulto/cajón).
// Ver reporte al usuario para la lista completa y qué falta decidir.
// ---------------------------------------------------------------------------

export const PRODUCTION_BATCHES: ProductionBatch[] = [
  {
    slug: 'milanesa-nalga',
    displayName: 'Milanesa de Nalga',
    mainIngredientName: 'Nalga',
    baseQty: 2.314,
    baseUnit: 'kg',
    secondary: [
      { name: 'Ajo',             qty: 30,  unit: 'g',  note: 'picado' },
      { name: 'Perejil',         qty: 90,  unit: 'g',  note: 'picado' },
      { name: 'Huevo',           qty: 12,  unit: 'unidad' },
      { name: 'Leche entera',   qty: 180, unit: 'ml' },
      { name: 'Mostaza',         qty: 20,  unit: 'g' },
      { name: 'Sal fina celusal', qty: 40, unit: 'g' },
      { name: 'Pimienta Blanca', qty: 20,  unit: 'g' },
      { name: 'Oregano',         qty: 15,  unit: 'g' },
    ],
    output: { name: 'Milanesa cruda', unit: 'unidad', yieldPerBase: 13 },
    yieldNote: 'Bife 178g bruto (compra) → 150-160g neto tras limpieza. Cargar el PESO BRUTO comprado: 2,314kg ≈ 13 milanesas. La merma de limpieza (~15%) ya está incluida en el costo.',
  },

  {
    slug: 'albondiga',
    displayName: 'Albóndigas',
    mainIngredientName: 'Carne molida', // sin stock_item hoy — avisar cuando se cree/confirme el nombre real
    baseQty: 1,
    baseUnit: 'kg',
    secondary: [
      { name: 'Cebolla',          qty: 90,  unit: 'g',  note: 'sofrita en brunoise' },
      { name: 'Ajo',              qty: 10,  unit: 'g',  note: '2 dientes' },
      { name: 'Perejil',          qty: 20,  unit: 'g',  note: 'picado' },
      { name: 'Sal fina celusal', qty: 18,  unit: 'g' },
      { name: 'Pimienta negra',   qty: 10,  unit: 'g' },
      { name: 'Oregano',          qty: 5,   unit: 'g' },
      { name: 'Pimenton',         qty: 10,  unit: 'g' },
      { name: 'Salsa inglesa',    qty: 7,   unit: 'ml' },
      { name: 'Salsa de soja',    qty: 7,   unit: 'ml' },
      { name: 'Pan rallado',      qty: 100, unit: 'g' },
      { name: 'Huevo',            qty: 2,   unit: 'unidad' },
    ],
    output: { name: 'Albóndiga cruda', unit: 'unidad', yieldPerBase: 6 },
    yieldNote: '70g en crudo → 60-65g cocido. Por 1kg salen 19 albóndigas / 6 porciones x3u',
  },

  {
    slug: 'salsa-portuguesa',
    displayName: 'Salsa Portuguesa',
    mainIngredientName: 'Tomate Triturado Sachet 2kg',
    baseQty: 3,
    baseUnit: 'lt',
    secondary: [
      { name: 'Cebolla',    qty: 500, unit: 'g',  note: 'juliana fina' },
      { name: 'Zanahoria',  qty: 250, unit: 'g',  note: 'en rodajas' },
      { name: 'Morrón',     qty: 500, unit: 'g',  note: 'juliana — sin stock_item hoy (¿Pimiento rojo/verde?)' },
      { name: 'Ajo',        qty: 15,  unit: 'g',  note: 'en lonjas' },
      { name: 'Vino tinto', qty: 200, unit: 'ml', note: 'sin stock_item hoy — confirmar producto' },
      { name: 'Sal fina celusal', qty: 20, unit: 'g' },
      { name: 'Pimienta negra',   qty: 12, unit: 'g' },
      { name: 'Romero',     qty: 3,   unit: 'g',  note: 'sin stock_item hoy — confirmar producto' },
      { name: 'Oregano',    qty: 3,   unit: 'g' },
      { name: 'Pimenton',   qty: 8,   unit: 'g' },
    ],
    yieldNote: 'Porcionar en bolsitas de 170g. Por 3lt de tomate ≈ 18 porciones',
  },

  {
    slug: 'cajón-pollo',
    displayName: 'Porcionado de Cajón de Pollo',
    mainIngredientName: 'Pollo', // sin stock_item hoy — "Pollo entero" fue dado de baja, "Filet de pollo" no es correcto como insumo (es lo que sale de este proceso)
    baseQty: 15,
    baseUnit: 'kg',
    secondary: [],
    output: { name: 'Pollo porcionado', unit: 'unidad', yieldPerBase: 68 },
    yieldNote: 'Filetear y porcionar en bolsitas de 200g. 15kg → 68 porciones',
  },

  {
    slug: 'bastones-dambo',
    displayName: 'Bastones de Dambo / Mozzarella',
    mainIngredientName: 'Queso dambo', // sin stock_item hoy — avisar cuando se cree/confirme el nombre real
    baseQty: 1,
    baseUnit: 'kg',
    secondary: [
      { name: 'Huevo',            qty: 8,   unit: 'unidad', note: 'para menjunje' },
      { name: 'Sal fina celusal', qty: 15,  unit: 'g' },
      { name: 'Pimienta negra',   qty: 10,  unit: 'g' },
      { name: 'Romero',           qty: 1,   unit: 'g',  note: '1 pizca — sin stock_item hoy' },
      { name: 'Aji Molido Rojo',  qty: 6,   unit: 'g' },
      { name: 'Salsa inglesa',    qty: 4,   unit: 'ml' },
      { name: 'Provenzal',        qty: 5,   unit: 'g' },
      { name: 'Oregano',          qty: 5,   unit: 'g' },
      { name: 'Pan rallado',      qty: 1000, unit: 'g' },
      { name: 'Pimenton',         qty: 40,  unit: 'g',  note: 'se mezcla en el pan rallado' },
      { name: 'Cereal triturado', qty: 150, unit: 'g', note: 'se mezcla en el pan rallado — sin stock_item hoy' },
    ],
    yieldNote: 'Bastones de 40g (4 bastones = 1 porción). Sin rebozar: 6 porciones / 1kg. Rebozado: bastón de 70g, porción 280g',
  },

  {
    slug: 'pre-pizza-porteña',
    displayName: 'Pre Pizza Porteña',
    mainIngredientName: 'Harina 000 Graciela Real 5Kg', // confirmar: hay también "Harina 000 Celestial 1Kg" (bolsa más chica)
    baseQty: 1150,
    baseUnit: 'g',
    secondary: [
      { name: 'Levadura Cordobesa',    qty: 34, unit: 'g' },
      { name: 'Aceite Girasol Natura', qty: 35, unit: 'ml' },
      { name: 'Aceite de oliva',       qty: 15, unit: 'ml', note: 'sin stock_item hoy — confirmar producto' },
      { name: 'Manteca Clucelat Pilon x2,5kg', qty: 20, unit: 'g' },
      { name: 'Sal fina celusal',      qty: 22, unit: 'g' },
      // Agua de red — no se cuenta como stock, se excluye de insumos a descontar.
    ],
    output: { name: 'Pre Pizza porteña', unit: 'unidad', yieldPerBase: 3 },
    yieldNote: '3 pre pizzas de 650g. Armado: 400g mozzarella + 150g salsa para las 3. Agua (688ml) no se descuenta de stock.',
  },

  {
    slug: 'arroz-leche',
    displayName: 'Arroz con Leche',
    mainIngredientName: 'Leche entera',
    baseQty: 1300,
    baseUnit: 'ml',
    secondary: [
      { name: 'Arroz Doble Gallo 500g', qty: 180, unit: 'g', note: 'receta dice "doble carolina" — confirmar si Gallo es el sustituto correcto' },
      { name: 'Azucar comun',           qty: 170, unit: 'g' },
      { name: 'Canela',                 qty: 3,   unit: 'g', note: 'sin stock_item hoy (solo existe "Roll de canela", no es lo mismo) — confirmar producto' },
    ],
    yieldNote: 'Rinde 1,1kg cocido. Porción 150g → 7 porciones',
  },

  {
    slug: 'masa-wraps',
    displayName: 'Masa de Wraps',
    mainIngredientName: 'Harina 0000 Celestial 1kg', // confirmar: hay tambien un item "harina 0000" genérico
    baseQty: 1,
    baseUnit: 'kg',
    secondary: [
      { name: 'Aceite Girasol Natura', qty: 100, unit: 'ml' },
      { name: 'Sal fina celusal',      qty: 20,  unit: 'g' },
      // Agua de red — no se cuenta como stock, se excluye de insumos a descontar.
    ],
    output: { name: 'Masa de wrap', unit: 'unidad', yieldPerBase: 8 },
    yieldNote: 'Masa base para wraps. Wrap individual: 125g. Agua (550ml) no se descuenta de stock.',
  },

  {
    slug: 'bondiola',
    displayName: 'Bondiola Braseada',
    mainIngredientName: 'bondiola',
    baseQty: 5,
    baseUnit: 'kg',
    secondary: [
      { name: 'Cebolla',           qty: 1200, unit: 'g', note: 'juliana' },
      { name: 'Morrón',            qty: 1000, unit: 'g', note: 'sin stock_item hoy' },
      { name: 'Zanahoria',         qty: 500,  unit: 'g', note: 'rallada' },
      { name: 'Ketchup Hellmans',  qty: 1000, unit: 'g' },
      { name: 'Cerveza Guiness Extra Stout Lata', qty: 3, unit: 'unidad', note: '3 latas ≈ 1100ml — confirmar que esta es la marca correcta' },
      { name: 'Caldo maggi verduras', qty: 2, unit: 'unidad', note: 'cubos — confirmar cuántos cubos rinden 1500ml' },
      { name: 'Sal fina celusal',  qty: 20,   unit: 'g' },
    ],
    output: { name: 'Bondiola deshebrada', unit: 'unidad', yieldPerBase: 16 },
    yieldNote: 'Se deshebra. Wrap: 180g de bondiola. Rinde ≈16 porciones por 5kg crudo (ajustable)',
  },

  {
    slug: 'hamburguesa',
    displayName: 'Hamburguesas',
    mainIngredientName: 'Carne molida', // sin stock_item hoy — mismo insumo que Albóndigas
    baseQty: 1,
    baseUnit: 'kg',
    secondary: [
      { name: 'Sal fina celusal', qty: 20, unit: 'g' },
      { name: 'Pimienta negra',   qty: 12, unit: 'g' },
      { name: 'Oregano',          qty: 5,  unit: 'g' },
    ],
    output: { name: 'Medallón de hamburguesa', unit: 'unidad', yieldPerBase: 10 },
    yieldNote: 'Bollos de 100g. Por 1kg salen 10 medallones',
  },
]

/**
 * Fuzzy-match un nombre de ingrediente contra la lista de nombres de stock.
 * Retorna el stock item si hay coincidencia suficientemente buena.
 *
 * IMPORTANTE: matchea por PALABRAS completas, no por substring crudo. Un
 * substring crudo hace que "Sal" matchee "Salsa inglesa" (contiene "sal") o
 * que "Azúcar" matchee "Cereales sin azúcar" — productos completamente
 * distintos que además silenciosamente pasan la validación porque las
 * unidades "coinciden" trivialmente. Con tokens, "sal" solo matchea items
 * cuyo nombre tiene la PALABRA "sal", no cualquiera que la contenga.
 */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export function matchIngredientToStock<T extends { name: string }>(
  ingredientName: string,
  stockItems: T[],
): T | null {
  const normalize = (s: string) => tokenize(s).join(' ')
  const needle = normalize(ingredientName)
  if (!needle) return null

  // Exact match first
  const exact = stockItems.find(item => normalize(item.name) === needle)
  if (exact) return exact

  const needleTokens = new Set(tokenize(ingredientName))

  // Coincidencia por palabras completas (en cualquier dirección), priorizando
  // el candidato con mayor proporción de palabras compartidas — así, entre
  // varios que comparten una palabra, gana el más parecido en su totalidad
  // (ej. "Azúcar" -> "Azucar comun" antes que "Cereales s/azucar").
  let best: { item: T; score: number } | null = null
  for (const item of stockItems) {
    const itemTokens = tokenize(item.name)
    if (itemTokens.length === 0) continue
    const itemTokenSet = new Set(itemTokens)
    const isSubsetOfNeedle = itemTokens.every(t => needleTokens.has(t))
    const isSupersetOfNeedle = [...needleTokens].every(t => itemTokenSet.has(t))
    if (!isSubsetOfNeedle && !isSupersetOfNeedle) continue

    const shared = itemTokens.filter(t => needleTokens.has(t)).length
    const score = shared / Math.max(needleTokens.size, itemTokens.length)
    if (!best || score > best.score) best = { item, score }
  }

  return best?.item ?? null
}
