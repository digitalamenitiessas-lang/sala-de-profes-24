'use client'

import { useEffect, useState } from 'react'
import { ChefHat, Loader2 } from 'lucide-react'
import { motion } from '@/components/ui/motion'
import { formatPrice } from './types'

// ---------------------------------------------------------------------------
// InsumosVendidos — "¿qué insumos se están vendiendo más?"
// Ranking de insumos consumidos por las ventas del período, calculado desde
// la cadena fudo_sales → recetas → ingredientes (GET /api/ventas/insumos).
// ---------------------------------------------------------------------------

type InsumoRow = {
  stock_item_id: string
  name: string
  unit: string
  qty_consumed: number
  sales_count: number
  cost_estimate: number | null
}

type InsumosData = {
  days: number
  from: string
  to: string
  total_dishes_sold: number
  items: InsumoRow[]
}

const DAY_OPTIONS = [7, 14, 30] as const

function formatQty(qty: number, unit: string): string {
  const n = new Intl.NumberFormat('es-AR', {
    maximumFractionDigits: qty >= 100 ? 0 : qty >= 10 ? 1 : 2,
  }).format(qty)
  return `${n} ${unit}`
}

export function InsumosVendidos() {
  const [data, setData] = useState<InsumosData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState<number>(7)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/ventas/insumos?days=${days}`, { credentials: 'include' })
        if (!res.ok) throw new Error('No se pudo cargar')
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch {
        if (!cancelled) setData(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [days])

  const maxSales = data?.items[0]?.sales_count ?? 0
  const totalCost = (data?.items ?? []).reduce((s, i) => s + (i.cost_estimate ?? 0), 0)

  return (
    <div className="card-elevated-lg overflow-hidden">
      {/* Header con selector de período */}
      <div className="flex items-center justify-between gap-2 border-b border-[#ebe6df] bg-gradient-to-r from-[#f4faf8] to-white px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#006d5a]">
            <ChefHat className="size-4.5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-display text-[16px] font-bold tracking-tight text-[#3d2c24]">
              Insumos más vendidos
            </h2>
            <p className="text-[10px] text-[#a39e97]">Lo que la cocina consume según las ventas</p>
          </div>
        </div>
        <div className="flex shrink-0 rounded-full bg-secondary p-0.5">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="relative rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors"
            >
              {days === d && (
                <motion.span
                  layoutId="insumos-days-pill"
                  className="absolute inset-0 rounded-full bg-[#006d5a]"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className={`relative z-10 ${days === d ? 'text-white' : 'text-muted-foreground'}`}>{d}d</span>
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            <span className="text-[12px]">Calculando consumo…</span>
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-[#a39e97]">
            Sin datos de consumo — verificá que los platos tengan receta vinculada.
          </p>
        ) : (
          <>
            <div className="space-y-3">
              {data.items.map((item, i) => {
                const pct = maxSales > 0 ? Math.max((item.sales_count / maxSales) * 100, 4) : 0
                const isTop3 = i < 3
                return (
                  <div key={item.stock_item_id}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className={`shrink-0 font-display text-[13px] font-bold tabular-nums ${isTop3 ? 'text-[#006d5a]' : 'text-[#c5bfb7]'}`}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className={`truncate text-[13px] ${isTop3 ? 'font-semibold' : 'font-medium'} text-[#3d2c24]`}>
                          {item.name}
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-[#a39e97]">
                          ×{item.sales_count} platos
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="text-[12px] font-bold tabular-nums text-[#3d2c24]">
                          {formatQty(item.qty_consumed, item.unit)}
                        </span>
                        {item.cost_estimate != null && item.cost_estimate > 0 && (
                          <span className="ml-1.5 text-[10px] font-semibold tabular-nums text-[#d4943a]">
                            {formatPrice(item.cost_estimate)}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#f3efe9]">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, delay: i * 0.04, ease: [0.25, 0.46, 0.45, 0.94] }}
                        className={`h-full rounded-full ${isTop3 ? 'bg-gradient-to-r from-[#006d5a] to-[#2d9d84]' : 'bg-[#8fc7b8]'}`}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-4 flex items-center justify-between rounded-xl bg-[#f8f5f0] px-3.5 py-2.5 text-[11px]">
              <span className="text-[#a39e97]">
                {new Intl.NumberFormat('es-AR').format(data.total_dishes_sold)} platos con receta vendidos en {data.days} días
              </span>
              {totalCost > 0 && (
                <span className="font-bold tabular-nums text-[#3d2c24]">
                  ≈ {formatPrice(totalCost)} <span className="font-normal text-[#a39e97]">consumido</span>
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
