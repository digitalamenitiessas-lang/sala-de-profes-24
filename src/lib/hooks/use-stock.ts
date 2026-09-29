'use client'

import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { SWR_KEYS } from '@/lib/swr/keys'
import type { StockCategoryValue } from '@/types/database'
import type { StockArea } from '@/lib/stock/areas'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StockItem = {
  id: string
  name: string
  category: StockCategoryValue
  unit: string
  current_qty: number
  min_qty: number
  shelf_life_days: number | null
  purchase_lead_time_days: number | null
  is_active: boolean
  notes: string | null
  updated_at: string
  supplier_id: string | null
  last_counted_at: string | null
  fudo_product_id?: string | null
  fudo_ingredient_id?: string | null
  fudo_skip?: boolean | null
  is_produced?: boolean | null
  cost_per_unit?: number | null
  /** Fuente del costo (migración 20260909): compra | manual | produccion | estimado | fudo | null. */
  cost_source?: string | null
  cost_updated_at?: string | null
  /** Área operativa (migración 20260906). null si todavía no está aplicada. */
  area?: StockArea | null
  /** Categoría real de Fudo (espejo). */
  fudo_category?: string | null
  area_locked?: boolean | null
  suppliers: { id: number; name: string; phone: string | null; contact_name: string | null } | null
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

const BASE_SELECT = 'id, name, category, unit, current_qty, min_qty, shelf_life_days, purchase_lead_time_days, is_active, notes, updated_at, supplier_id, last_counted_at, fudo_product_id, fudo_ingredient_id, fudo_skip, is_produced, cost_per_unit, suppliers!stock_items_supplier_id_fkey(id, name, phone, contact_name)'
const AREA_SELECT = `${BASE_SELECT}, area, fudo_category, area_locked`
const COSTO_SELECT = `${AREA_SELECT}, cost_source, cost_updated_at`

async function fetchStockItems(active: boolean): Promise<StockItem[]> {
  const supabase = createClient()
  const run = async (select: string) => {
    let query = supabase.from('stock_items').select(select).order('category').order('name')
    if (active) query = query.eq('is_active', true)
    return query
  }

  // Select tolerante: si una migración no está aplicada (costo confiable
  // 20260909 o áreas 20260906), PostgREST rechaza las columnas nuevas →
  // caer en cascada al select anterior.
  let { data, error } = await run(COSTO_SELECT)
  if (error && /cost_source|cost_updated_at/i.test(error.message)) {
    ({ data, error } = await run(AREA_SELECT))
  }
  if (error && /area|fudo_category/i.test(error.message)) {
    ({ data, error } = await run(BASE_SELECT))
  }
  if (error) throw error
  return (data ?? []) as unknown as StockItem[]
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStockItems(activeOnly = true) {
  const { data, error, isLoading, mutate } = useSWR(
    SWR_KEYS.stockItems(activeOnly),
    () => fetchStockItems(activeOnly),
    {
      revalidateOnFocus: true,
      dedupingInterval: 30_000,
    },
  )

  return {
    items: data ?? [],
    error,
    isLoading,
    mutate,
  }
}
