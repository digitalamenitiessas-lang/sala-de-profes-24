import type { StockCategoryValue } from '@/types/database'

export type StockSector = 'salon' | 'bar' | 'cocina' | 'compras'
export type StockPriority = 'high' | 'medium' | 'low'
export type StockConfidence = 'high' | 'medium' | 'low'

export type StockSectorAction = {
  id: string
  stock_item_id: string
  stock_item_name: string
  sector: StockSector
  priority: StockPriority
  confidence: StockConfidence
  kind: 'promo' | 'push' | 'use_first' | 'freeze_purchase' | 'replenish'
  title: string
  detail: string
  current_qty: number
  unit: string
  menu_item_name: string | null
}

export type StockSetupIssue = {
  id: string
  stock_item_id: string
  stock_item_name: string
  severity: StockPriority
  type:
    | 'missing_shelf_life'
    | 'category_review'
    | 'missing_menu_mapping'
    | 'unit_review'
    | 'quantity_anomaly'
    | 'negative_stock'
    | 'stale_stock'
    | 'missing_lot_control'
    | 'expired_lot_stock'
    | 'mapping_conflict'
    | 'missing_fudo_mapping'
    | 'sales_stock_mismatch'
  title: string
  detail: string
  current_qty: number
  unit: string
  suggested_shelf_life_days: number | null
  suggested_category: StockCategoryValue | null
  rule_id?: string | null
  decision_state?: 'open' | 'confirmed_ok' | 'snoozed' | 'rule_created' | null
}

export type StockIntelligenceResponse = {
  summary: {
    active_items: number
    finished_goods: number
    finished_goods_with_shelf_life: number
    perishable_missing_shelf_life: number
    low_stock_items: number
    overstock_finished_goods: number
    setup_issues: number
    anomalies: number
    anomaly_rules: number
  }
  sectors: Array<{
    sector: StockSector
    label: string
    icon: string
    counts: Record<StockPriority, number>
    actions: StockSectorAction[]
  }>
  setup_issues: StockSetupIssue[]
  /**
   * Intermedios (elaborados usados como ingrediente en otras recetas) cuyo
   * vínculo receta ↔ stock_item está roto: sin output_stock_item_id y sin
   * match por nombre. El costeo de los platos que los usan queda incompleto.
   * Opcional para compatibilidad con respuestas cacheadas viejas.
   */
  unlinked_intermediates?: {
    count: number
    names: string[]
  }
  /**
   * Items activos vinculados a un ingrediente Fudo cuyo cost_per_unit local
   * difiere más de 30% del costo que reporta Fudo. Señal de precio desactualizado
   * en Fudo o de una recepción mal cargada. Opcional para compatibilidad con
   * respuestas cacheadas viejas; si Fudo no responde, la sección no aparece.
   */
  cost_divergence?: {
    count: number
    items: Array<{
      name: string
      costo_lve: number
      costo_fudo: number
      diff_pct: number
    }>
  }
  generated_at: string
}

export const STOCK_SECTOR_META: Record<StockSector, { label: string; icon: string; color: string; bg: string }> = {
  salon: { label: 'Salon', icon: '🏷️', color: '#8b5e34', bg: '#faf0e4' },
  bar: { label: 'Bar', icon: '🥤', color: '#006d5a', bg: '#e8f5f1' },
  cocina: { label: 'Cocina', icon: '🍳', color: '#d4943a', bg: '#fdf6ec' },
  compras: { label: 'Compras', icon: '🧾', color: '#7d5f50', bg: '#f3efe9' },
}

const BAR_MENU_CATEGORIES = new Set([
  'bebidas sin alcohol',
  'cafeteria',
  'cafe frio',
  'filtrados',
  'filtrados proximamente',
  'infusiones',
  'tragos',
  'bebidas con alcohol',
])

const PANADERIA_MENU_CATEGORIES = new Set([
  'pasteleria',
  'postres',
  'desayunos meriendas',
  'sin tacc',
])

const COCINA_MENU_CATEGORIES = new Set([
  'platos principales',
  'entre panes',
  'pizzas',
  'entradas',
  'no vives de ensalada',
  'lve kids',
])

const PERISHABLE_CATEGORIES = new Set<StockCategoryValue>([
  'lacteos',
  'carnes',
  'verduras',
  'frutas',
  'panaderia',
  'bebidas',
])

function normalize(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function isFinishedGood(item: { fudo_product_id?: string | null; unit?: string | null }) {
  return Boolean(item.fudo_product_id) && (item.unit ?? '') === 'unidad'
}

export function isPerishableCandidate(item: {
  category: StockCategoryValue
  fudo_product_id?: string | null
  unit?: string | null
}) {
  return isFinishedGood(item) || PERISHABLE_CATEGORIES.has(item.category)
}

export function guessShelfLifeDays(
  category: StockCategoryValue,
  menuCategoryName?: string | null,
): number | null {
  const menu = normalize(menuCategoryName)

  if (BAR_MENU_CATEGORIES.has(menu)) {
    return category === 'bebidas' ? 30 : 7
  }
  if (PANADERIA_MENU_CATEGORIES.has(menu)) return 7
  if (COCINA_MENU_CATEGORIES.has(menu)) return 3

  if (category === 'panaderia') return 7
  if (category === 'lacteos') return 5
  if (category === 'verduras' || category === 'frutas') return 4
  if (category === 'carnes') return 3
  if (category === 'bebidas') return 30

  return null
}

export function guessCategoryForFinishedGood(menuCategoryName?: string | null): StockCategoryValue | null {
  const menu = normalize(menuCategoryName)

  if (BAR_MENU_CATEGORIES.has(menu)) return 'bebidas'
  if (PANADERIA_MENU_CATEGORIES.has(menu)) return 'panaderia'
  if (COCINA_MENU_CATEGORIES.has(menu)) return 'otros'

  return null
}

export function deriveSector(params: {
  category: StockCategoryValue
  unit: string
  fudo_product_id?: string | null
  menuCategoryName?: string | null
}): StockSector {
  const menu = normalize(params.menuCategoryName)

  if (BAR_MENU_CATEGORIES.has(menu) || params.category === 'bebidas') return 'bar'
  if (isFinishedGood(params)) return 'salon'
  if (params.category === 'limpieza' || params.category === 'desechables') return 'compras'

  return 'cocina'
}

export function getOverstockThreshold(item: {
  category: StockCategoryValue
  unit: string
  min_qty: number
  fudo_product_id?: string | null
}) {
  const minBased = item.min_qty > 0 ? item.min_qty * 3 : 0

  if (isFinishedGood(item)) {
    if (item.category === 'bebidas') return Math.max(minBased, 8)
    return Math.max(minBased, 12)
  }

  if (item.category === 'lacteos' || item.category === 'frutas' || item.category === 'verduras') {
    return Math.max(item.min_qty * 2.5, 6)
  }

  return Math.max(item.min_qty * 3, 10)
}

export function getPromoTitle(itemName: string, sector: StockSector) {
  if (sector === 'bar') return `Impulsar ${itemName}`
  return `Saca promo de ${itemName}`
}
