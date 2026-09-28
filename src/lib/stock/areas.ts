// ---------------------------------------------------------------------------
// Áreas operativas del stock — UNA sola definición para sync, API y UI.
// ---------------------------------------------------------------------------
// El local se controla por área (quién cuenta qué): cocina, pastelería/dulces,
// barra, descartables y limpieza. El área de cada insumo se deriva de la
// categoría REAL de Fudo (24 categorías de ingredientes + categorías de
// producto) y se persiste en stock_items.area. Un encargado puede fijarla a
// mano (area_locked) y el sync no la pisa.
//
// Este archivo no importa nada de servidor: es seguro en cliente.
// ---------------------------------------------------------------------------

export type StockArea = 'cocina' | 'pasteleria' | 'barra' | 'descartables' | 'limpieza' | 'otros'

export const STOCK_AREAS: { value: StockArea; label: string; short: string; icon: string; hint: string }[] = [
  { value: 'cocina',       label: 'Cocina',        short: 'Cocina',   icon: '🍳', hint: 'Carnes, verduras, lácteos, almacén y elaborados' },
  { value: 'pasteleria',   label: 'Pastelería',    short: 'Dulces',   icon: '🧁', hint: 'Panes, budines, tortas, cookies y postres' },
  { value: 'barra',        label: 'Barra',         short: 'Barra',    icon: '☕', hint: 'Bebidas, café, infusiones y alcohol' },
  { value: 'descartables', label: 'Descartables',  short: 'Descart.', icon: '🥡', hint: 'Vasos, bandejas, bolsas, servilletas' },
  { value: 'limpieza',     label: 'Limpieza',      short: 'Limpieza', icon: '🧹', hint: 'Artículos de limpieza' },
  { value: 'otros',        label: 'Sin área',      short: 'Otros',    icon: '📦', hint: 'Todavía sin área asignada' },
]

export const AREA_LABEL: Record<StockArea, string> = Object.fromEntries(
  STOCK_AREAS.map((a) => [a.value, a.label]),
) as Record<StockArea, string>

export function isStockArea(value: unknown): value is StockArea {
  return typeof value === 'string' && STOCK_AREAS.some((a) => a.value === value)
}

/** Área por defecto desde la categoría LVE (fallback cuando Fudo no dice nada). */
export function areaFromLveCategory(category: string | null | undefined): StockArea {
  switch (category) {
    case 'carnes':
    case 'verduras':
    case 'frutas':
    case 'lacteos':
    case 'condimentos':
    case 'elaborados':
    case 'proteinas':
    case 'pastas':
      return 'cocina'
    case 'panaderia':
      return 'pasteleria'
    case 'bebidas':
      return 'barra'
    case 'desechables':
      return 'descartables'
    case 'limpieza':
      return 'limpieza'
    default:
      return 'otros'
  }
}

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

/**
 * Categoría de INGREDIENTE de Fudo → área + categoría LVE sugerida.
 * Nombres reales relevados el 2026-09-06 (24 categorías). La categoría LVE
 * solo se aplica si el item está en 'otros' (no pisa una elección manual).
 */
export function mapFudoIngredientCategory(fudoCategory: string | null | undefined): {
  area: StockArea
  category: string | null
  isPreProduct: boolean
} {
  const c = norm(fudoCategory)
  if (!c) return { area: 'otros', category: null, isPreProduct: false }

  // Intermedios de cocina y de barra
  if (c.includes('pre') && c.includes('producto')) {
    const barra = c.includes('cafe')
    return { area: barra ? 'barra' : 'cocina', category: barra ? 'bebidas' : 'elaborados', isPreProduct: true }
  }
  if (c.includes('limpieza')) return { area: 'limpieza', category: 'limpieza', isPreProduct: false }
  if (c.includes('descart')) return { area: 'descartables', category: 'desechables', isPreProduct: false }
  if (c.includes('bebida') || c.includes('cafeter') || c.includes('infusion')) {
    return { area: 'barra', category: 'bebidas', isPreProduct: false }
  }
  if (c.startsWith('pan')) return { area: 'pasteleria', category: 'panaderia', isPreProduct: false }
  if (c.includes('fruta') || c.includes('verdura')) return { area: 'cocina', category: 'verduras', isPreProduct: false }
  if (c.includes('carne')) return { area: 'cocina', category: 'carnes', isPreProduct: false }
  if (c.includes('fiambre')) return { area: 'cocina', category: 'carnes', isPreProduct: false }
  if (c.includes('lacteo') || c.includes('queso')) return { area: 'cocina', category: 'lacteos', isPreProduct: false }
  if (c.includes('condimento') || c.includes('especia') || c.includes('aceite')) {
    return { area: 'cocina', category: 'condimentos', isPreProduct: false }
  }
  if (c.includes('empanada')) return { area: 'cocina', category: 'elaborados', isPreProduct: false }
  // Almacén, Forrajería, Harina y +, Congelados, Varios, Sin Tacc → cocina, sin
  // categoría LVE forzada (la categoría de Fudo se muestra tal cual en la UI).
  return { area: 'cocina', category: null, isPreProduct: false }
}

/**
 * Categoría de PRODUCTO de Fudo (para stock_items con fudo_product_id, ej.
 * budines, gaseosas, empanadas) → área + categoría LVE sugerida.
 */
export function mapFudoProductCategory(fudoCategory: string | null | undefined): {
  area: StockArea
  category: string | null
} {
  const c = norm(fudoCategory)
  if (!c) return { area: 'otros', category: null }
  if (c.includes('pastel') || c.includes('postre') || c.includes('desayuno') || c.includes('merienda')) {
    return { area: 'pasteleria', category: 'panaderia' }
  }
  if (c.includes('bebida') || c.includes('leche') || c.includes('cafe') || c.includes('infusion') || c.includes('copa') || c.includes('filtrado')) {
    return { area: 'barra', category: 'bebidas' }
  }
  // Platos, entradas, pizzas, take away, PEYA, personal, etc.
  return { area: 'cocina', category: 'elaborados' }
}

/** Etiqueta legible de agrupación: categoría Fudo si existe, si no la LVE. */
export function groupLabel(item: { fudo_category?: string | null; category?: string | null }, lveLabel: (c: string) => string): string {
  const fc = (item.fudo_category ?? '').trim()
  if (fc) return fc
  return lveLabel(item.category ?? 'otros')
}

/**
 * Frecuencia sugerida de conteo por área/tipo (días). Sirve para el conteo
 * guiado: "qué toca contar hoy". Intermedios y proteínas van seguido;
 * descartables y limpieza, semanal.
 */
export function suggestedCountEveryDays(item: {
  area?: string | null
  is_produced?: boolean | null
  category?: string | null
}): number {
  if (item.is_produced) return 1
  const area = isStockArea(item.area) ? item.area : areaFromLveCategory(item.category)
  if (area === 'pasteleria') return 1
  if (item.category === 'carnes' || item.category === 'verduras' || item.category === 'frutas' || item.category === 'lacteos') return 3
  if (area === 'barra') return 7
  if (area === 'descartables' || area === 'limpieza') return 14
  return 7
}
