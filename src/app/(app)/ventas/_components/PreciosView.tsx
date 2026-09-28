'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// PreciosView — precio de COMPRA REAL por insumo, del módulo de GASTOS de Fudo.
// Consume /api/compras/precios (gastos con exactamente 1 ingrediente → el
// monto es el precio real de ese insumo). Grupos expandibles con último precio,
// mín/prom/máx, tendencia ±5% vs promedio y detalle de cada compra.
// ---------------------------------------------------------------------------

type PricePoint = {
  date: string
  amount: number
  provider: string | null
}

type IngredientPrices = {
  name: string
  last_price: number | null
  last_provider: string | null
  last_date: string | null
  min: number | null
  max: number | null
  avg: number | null
  count: number
  points: PricePoint[]
}

function money(n: number | null): string {
  if (n == null) return '—'
  return `$${Math.round(n).toLocaleString('es-AR')}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })
}

export function PreciosView() {
  const [data, setData] = useState<IngredientPrices[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(90)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/compras/precios?days=${days}`, { credentials: 'include' })
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'No se pudo cargar')
        const json = await res.json()
        if (!cancelled) setData(json.items ?? [])
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Error al cargar')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [days])

  const totalPoints = useMemo(() => data.reduce((s, g) => s + g.count, 0), [data])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Gastos reales de compra, del <b>módulo de gastos de Fudo</b>. Ojo: cada $ es el
          <b> monto total de esa compra</b> (no el precio por kg/unidad). Sirve para ver qué
          proveedor te remarcó y qué insumo se está <b>encareciendo</b>.
        </p>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="shrink-0 rounded-lg border border-[#ebe6df] bg-white px-2 py-1 text-[12px] focus:outline-none"
        >
          <option value={30}>30 días</option>
          <option value={90}>90 días</option>
          <option value={180}>180 días</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" /> Cargando…
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-[#ebe6df]">
          <p className="text-[14px] text-[#3d2c24]">Todavía no hay gastos con precio de un solo insumo.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Cada gasto de Fudo con un único ingrediente registra el precio real de ese insumo.
          </p>
        </div>
      ) : (
        <FadeIn>
          <div className="space-y-3">
            {data.map((g) => {
              const key = g.name
              const isOpen = expanded === key
              // Tendencia: comparar el más reciente vs el promedio (±5%).
              const latest = g.last_price ?? 0
              const avg = g.avg ?? 0
              const trendUp = g.count > 1 && latest > avg * 1.05
              const trendDown = g.count > 1 && latest < avg * 0.95
              return (
                <div key={key} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
                  <button
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-bold text-[#3d2c24]">{g.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {g.count} compra{g.count === 1 ? '' : 's'}
                        {g.last_provider && <span> · {g.last_provider}</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right">
                        <p className="text-[11px] text-muted-foreground">última compra ($ total)</p>
                        <p className="flex items-center gap-1 text-[18px] font-bold text-[#006d5a]">
                          {trendUp && <TrendingUp className="size-4 text-[#ea504c]" />}
                          {trendDown && <TrendingDown className="size-4 text-[#006d5a]" />}
                          {!trendUp && !trendDown && g.count > 1 && <Minus className="size-3.5 text-muted-foreground" />}
                          {money(g.last_price)}
                        </p>
                      </div>
                      {isOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {g.count > 1 && (
                    <div className="flex gap-3 border-t border-[#f3efe9] px-4 py-2 text-[11px] text-muted-foreground">
                      <span>mín <b className="text-[#006d5a]">{money(g.min)}</b></span>
                      <span>prom <b className="text-[#3d2c24]">{money(g.avg)}</b></span>
                      <span>máx <b className="text-[#ea504c]">{money(g.max)}</b></span>
                      <span className="ml-auto">$ por compra</span>
                    </div>
                  )}

                  {isOpen && (
                    <div className="border-t border-[#f3efe9] bg-[#faf8f5] px-4 py-3">
                      <div className="space-y-2">
                        {g.points.map((p, i) => (
                          <div key={`${p.date}-${i}`} className="flex items-center justify-between gap-2 text-[13px]">
                            <div className="min-w-0">
                              <span className="text-[#3d2c24]">{fmtDate(p.date)}</span>
                              {p.provider && (
                                <span className="ml-2 text-[11px] text-muted-foreground">{p.provider}</span>
                              )}
                            </div>
                            <span className="shrink-0 font-bold text-[#006d5a]">{money(p.amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            {totalPoints} compras de un solo insumo · montos totales por compra (no precio unitario) · la tendencia compara la última compra contra el promedio del período
          </p>
        </FadeIn>
      )}
    </div>
  )
}
