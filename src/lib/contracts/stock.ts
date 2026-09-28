// ---------------------------------------------------------------------------
// Stock — Single source of truth for derivations
// ---------------------------------------------------------------------------
// Used by: stock page, dashboard, admin reports, chatbot, kitchen checklist,
//          proveedores, alerts, snapshots
// ---------------------------------------------------------------------------

export type SemaphoreValue = 'red' | 'yellow' | 'green'

export type StockSemaphore = {
  value: SemaphoreValue
  label: string
  color: string
  bg: string
}

const SEMAPHORE_CONFIG: Record<SemaphoreValue, Omit<StockSemaphore, 'value'>> = {
  red:    { label: 'Crítico',   color: '#ea504c', bg: '#fef2f2' },
  yellow: { label: 'Atención',  color: '#d4943a', bg: '#fdf6ec' },
  green:  { label: 'Normal',    color: '#006d5a', bg: '#e8f5f1' },
}

/**
 * Canonical semaphore derivation for stock items.
 * ONE place, ONE logic. Import this everywhere.
 *
 * Rules:
 * - RED:    qty ≤ 0 OR qty ≤ minQty
 * - YELLOW: minQty < qty ≤ minQty × 1.5
 * - GREEN:  qty > minQty × 1.5
 */
export function getStockSemaphore(currentQty: number, minQty: number): SemaphoreValue {
  if (currentQty <= 0) return 'red'
  if (currentQty <= minQty) return 'red'
  if (currentQty <= minQty * 1.5) return 'yellow'
  return 'green'
}

/** Get full semaphore config (value + label + color + bg) */
export function getStockSemaphoreConfig(currentQty: number, minQty: number): StockSemaphore {
  const value = getStockSemaphore(currentQty, minQty)
  return { value, ...SEMAPHORE_CONFIG[value] }
}

/** Count items by semaphore status */
export function countBySemaphore(items: { current_qty: number; min_qty: number }[]) {
  let red = 0, yellow = 0, green = 0
  for (const item of items) {
    const s = getStockSemaphore(item.current_qty ?? 0, item.min_qty ?? 0)
    if (s === 'red') red++
    else if (s === 'yellow') yellow++
    else green++
  }
  return { red, yellow, green, total: items.length }
}

/** Is this item critical? (same logic as semaphore red) */
export function isStockCritical(currentQty: number, minQty: number): boolean {
  return getStockSemaphore(currentQty, minQty) === 'red'
}

// Re-export config for badge rendering
export { SEMAPHORE_CONFIG }
