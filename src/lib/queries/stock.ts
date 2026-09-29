import { createAdminClient } from '@/lib/supabase/admin'
import { esErrorColumnaFaltante } from '@/lib/costos/confiable'

// Field presets
const FIELDS = {
  minimal: 'id, name, unit, current_qty' as const,
  summary: 'id, name, unit, current_qty, min_qty, category' as const,
  full: 'id, name, unit, current_qty, min_qty, category, is_active, is_produced, supplier_id, fudo_ingredient_id, fudo_product_id, fudo_skip, cost_per_unit, cost_source, cost_updated_at, shelf_life_days, purchase_lead_time_days, notes, updated_at' as const,
  withSupplier: 'id, name, unit, current_qty, min_qty, category, is_active, supplier_id, fudo_ingredient_id, fudo_product_id, fudo_skip, shelf_life_days, purchase_lead_time_days, notes, updated_at, suppliers!stock_items_supplier_id_fkey(id, name, phone, email)' as const,
} as const

// 'full' sin las columnas de la migración 20260909 (costo confiable), para
// cuando todavía no está aplicada.
const FULL_LEGACY = 'id, name, unit, current_qty, min_qty, category, is_active, is_produced, supplier_id, fudo_ingredient_id, fudo_product_id, fudo_skip, cost_per_unit, shelf_life_days, purchase_lead_time_days, notes, updated_at' as const

type FieldPreset = keyof typeof FIELDS

/**
 * Centralized stock items query.
 * Avoids duplicating .from('stock_items').select(...) across 15+ files.
 * El preset 'full' incluye cost_source/cost_updated_at con fallback si la
 * migración de costo confiable no está aplicada.
 *
 * @param preset - Field set to select: 'minimal' | 'summary' | 'full' | 'withSupplier'
 * @param options.activeOnly - Filter to is_active=true (default: true)
 */
export async function getStockItems(
  preset: FieldPreset = 'summary',
  options: { activeOnly?: boolean } = {},
) {
  const { activeOnly = true } = options
  const admin = createAdminClient()
  const run = (select: string) => {
    let query = admin.from('stock_items').select(select)
    if (activeOnly) query = query.eq('is_active', true)
    return query.order('name')
  }
  const res = await run(FIELDS[preset])
  if (res.error && preset === 'full' && esErrorColumnaFaltante(res.error.message, ['cost_source', 'cost_updated_at'])) {
    return run(FULL_LEGACY)
  }
  return res
}

/**
 * Get a single stock item by ID.
 */
export async function getStockItem(id: string, preset: FieldPreset = 'summary') {
  const admin = createAdminClient()
  const res = await admin.from('stock_items').select(FIELDS[preset]).eq('id', id).single()
  if (res.error && preset === 'full' && esErrorColumnaFaltante(res.error.message, ['cost_source', 'cost_updated_at'])) {
    return admin.from('stock_items').select(FULL_LEGACY).eq('id', id).single()
  }
  return res
}

/**
 * Get stock items by IDs.
 */
export async function getStockItemsByIds(ids: string[], preset: FieldPreset = 'summary') {
  if (ids.length === 0) return { data: [], error: null }
  const admin = createAdminClient()
  const res = await admin.from('stock_items').select(FIELDS[preset]).in('id', ids)
  if (res.error && preset === 'full' && esErrorColumnaFaltante(res.error.message, ['cost_source', 'cost_updated_at'])) {
    return admin.from('stock_items').select(FULL_LEGACY).in('id', ids)
  }
  return res
}

export { FIELDS as STOCK_FIELDS }
