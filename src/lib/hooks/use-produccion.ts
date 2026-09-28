'use client'

import useSWR from 'swr'
import { SWR_KEYS } from '@/lib/swr/keys'
import { apiFetcher } from '@/lib/swr/fetchers'

// ---------------------------------------------------------------------------
// Types (mirrored from produccion page)
// ---------------------------------------------------------------------------

export type OrderSummary = {
  id: number
  name: string
  status: 'draft' | 'in_progress' | 'pending_review' | 'completed' | 'cancelled'
  parent_order_id: number | null
  template_name: string | null
  chef_name: string | null
  created_at: string
  completed_at: string | null
  submitted_at: string | null
  reviewed_at: string | null
  inputs: { name: string; qty: number; unit: string }[]
  outputs: { name: string; qty: number; unit: string; is_waste: boolean }[]
  summary: {
    total_input_qty: number
    total_output_qty: number
    total_waste_qty: number
    efficiency_pct: number | null
    total_input_cost?: number
    cost_per_output_unit?: number | null
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProduccionOrders(days = 30) {
  const { data, error, isLoading, mutate } = useSWR(
    SWR_KEYS.produccionOrders(days),
    () => apiFetcher<{ orders: OrderSummary[] }>(`/api/produccion/orders?days=${days}`).then(r => r.orders),
    {
      revalidateOnFocus: true,
      dedupingInterval: 15_000,
    },
  )

  return {
    orders: data ?? [],
    error,
    isLoading,
    mutate,
  }
}
