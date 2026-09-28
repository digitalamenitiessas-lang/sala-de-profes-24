'use client'

import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { SWR_KEYS } from '@/lib/swr/keys'
import { isStockCritical } from '@/lib/contracts/stock'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardData = {
  criticalStockCount: number
  stockItems: { id: string; name: string; current_qty: number; min_qty: number; supplier_id: string | null; category: string }[]
  pendingOrders: number
  expedientesActivos: number
  expedientesData: { id: string; code: string; title: string; status: string; urgency: string; target_date: string | null; updated_at: string; responsible_id: string | null }[]
  ventasHoy: { total: number; tickets: number; peakHour: string | null; peakRevenue: number } | null
  fudoLastSync: string | null
  barUrgent: number
}

// ---------------------------------------------------------------------------
// Role-specific dashboard data — heavy queries run by role
// ---------------------------------------------------------------------------

export function useDashboardData(
  userId: string | undefined,
  todayStr: string,
  role: string | undefined,
  isEncargado: boolean,
) {
  const { data, error, isLoading, mutate } = useSWR(
    userId ? SWR_KEYS.dashboardKpis(userId, todayStr) : null,
    async (): Promise<DashboardData> => {
      const supabase = createClient()

      const stockPromise = isEncargado
        ? supabase.from('stock_items').select('id, name, current_qty, min_qty, supplier_id, category').eq('is_active', true)
        : null

      const ordersPromise = isEncargado
        ? Promise.all([
            supabase.from('kitchen_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
            supabase.from('bar_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          ])
        : null

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expedientesPromise = role === 'socio'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (supabase as any).from('expedientes').select('id, code, title, status, urgency, target_date, updated_at, responsible_id').neq('status', 'cumplido').neq('status', 'cerrado_sin_implementacion').neq('status', 'archivado')
        : null

      const ventasPromise = role === 'socio'
        ? fetch('/api/fudo/auto-sync', { credentials: 'include' }).then(async r => {
            const json = await r.json()
            if (json.error) console.error('[Ventas Home]', json.error)
            return json
          }).catch((err) => { console.error('[Ventas Home fetch]', err); return null })
        : null

      const barUrgentPromise = role === 'barista'
        ? supabase.from('bar_stock_items').select('id', { count: 'exact', head: true }).eq('is_urgent', true).eq('is_active', true)
        : null

      const [stockRes, ordersRes, expedientesRes, ventasRes, barUrgentRes] = await Promise.all([
        stockPromise,
        ordersPromise,
        expedientesPromise,
        ventasPromise,
        barUrgentPromise,
      ])

      const stockItems = (stockRes?.data ?? []) as DashboardData['stockItems']
      const criticalStockCount = stockItems.filter(item => isStockCritical(item.current_qty ?? 0, item.min_qty ?? 0)).length

      let pendingOrders = 0
      if (ordersRes) {
        const [kitchenRes, barRes] = ordersRes
        pendingOrders = (kitchenRes.count ?? 0) + (barRes.count ?? 0)
      }

      const expedientesData = expedientesRes?.data ?? []
      const expedientesActivos = expedientesData.length

      let ventasHoy: DashboardData['ventasHoy'] = null
      let fudoLastSync: string | null = null
      if (ventasRes?.today) {
        const byHour = (ventasRes.today.byHour ?? []) as { hour: string; revenue: number }[]
        const peak = byHour.reduce<{ hour: string; revenue: number } | null>(
          (max, h) => (h.revenue > (max?.revenue ?? 0) ? h : max),
          null,
        )
        ventasHoy = {
          total: ventasRes.today.totalFacturado ?? 0,
          tickets: ventasRes.today.totalTickets ?? 0,
          peakHour: peak?.hour ?? null,
          peakRevenue: peak?.revenue ?? 0,
        }
        if (ventasRes.lastSync) fudoLastSync = ventasRes.lastSync
      }

      const barUrgent = barUrgentRes?.count ?? 0

      return {
        criticalStockCount,
        stockItems,
        pendingOrders,
        expedientesActivos,
        expedientesData,
        ventasHoy,
        fudoLastSync,
        barUrgent,
      }
    },
    {
      revalidateOnFocus: true,
      dedupingInterval: 30_000,
    },
  )

  return {
    data: data ?? null,
    error,
    isLoading,
    mutate,
  }
}
