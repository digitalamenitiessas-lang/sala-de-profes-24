'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// ProduccionCostosView — costo histórico de producción por intermedio.
// Absorbido de /stock/produccion/costos como modo de /ventas ("Números").
// ---------------------------------------------------------------------------

type Run = {
  order_id: number
  name: string
  date: string
  output_qty: number
  output_unit: string
  total_cost: number
  cost_per_unit: number
  partial_cost: boolean
}

type Intermediate = {
  stock_item_id: string | null
  name: string
  unit: string
  runs: Run[]
  latest_cost_per_unit: number | null
  avg_cost_per_unit: number | null
  min_cost_per_unit: number | null
  max_cost_per_unit: number | null
  total_produced: number
  run_count: number
}

function money(n: number | null): string {
  if (n == null) return '—'
  return `$${Math.round(n).toLocaleString('es-AR')}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: '2-digit' })
}

export function ProduccionCostosView() {
  const [data, setData] = useState<Intermediate[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(180)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/produccion/costos?days=${days}`)
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'No se pudo cargar')
        const json = await res.json()
        setData(json.intermediates ?? [])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al cargar')
      } finally {
        setLoading(false)
      }
    })()
  }, [days])

  const totalRuns = useMemo(() => data.reduce((s, g) => s + g.run_count, 0), [data])

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Cuánto costó producir cada intermedio, con el precio de los insumos <b>congelado</b> al momento de cada
          producción. Así ves si un producto se está encareciendo.
        </p>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="shrink-0 rounded-lg border border-[#ebe6df] bg-white px-2 py-1 text-[12px] focus:outline-none"
        >
          <option value={30}>30 días</option>
          <option value={90}>90 días</option>
          <option value={180}>180 días</option>
          <option value={365}>1 año</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" /> Cargando…
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-[#ebe6df]">
          <p className="text-[14px] text-[#3d2c24]">Todavía no hay producciones completadas con costo.</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Cada vez que valides una producción, su costo queda registrado acá.
          </p>
        </div>
      ) : (
        <FadeIn>
          <div className="space-y-3">
            {data.map((g) => {
              const key = g.stock_item_id ?? g.name
              const isOpen = expanded === key
              // Tendencia: comparar el más reciente vs el promedio.
              const latest = g.latest_cost_per_unit ?? 0
              const avg = g.avg_cost_per_unit ?? 0
              const trendUp = g.run_count > 1 && latest > avg * 1.05
              const trendDown = g.run_count > 1 && latest < avg * 0.95
              return (
                <div key={key} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
                  <button
                    onClick={() => setExpanded(isOpen ? null : key)}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-bold text-[#3d2c24]">{g.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {g.run_count} producci{g.run_count === 1 ? 'ón' : 'ones'} · {Math.round(g.total_produced)} {g.unit} en total
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="text-right">
                        <p className="text-[11px] text-muted-foreground">último costo</p>
                        <p className="flex items-center gap-1 text-[18px] font-bold text-[#006d5a]">
                          {trendUp && <TrendingUp className="size-4 text-[#ea504c]" />}
                          {trendDown && <TrendingDown className="size-4 text-[#006d5a]" />}
                          {!trendUp && !trendDown && g.run_count > 1 && <Minus className="size-3.5 text-muted-foreground" />}
                          {money(g.latest_cost_per_unit)}
                          <span className="text-[11px] font-medium text-muted-foreground">/{g.unit}</span>
                        </p>
                      </div>
                      {isOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {g.run_count > 1 && (
                    <div className="flex gap-3 border-t border-[#f3efe9] px-4 py-2 text-[11px] text-muted-foreground">
                      <span>mín <b className="text-[#006d5a]">{money(g.min_cost_per_unit)}</b></span>
                      <span>prom <b className="text-[#3d2c24]">{money(g.avg_cost_per_unit)}</b></span>
                      <span>máx <b className="text-[#ea504c]">{money(g.max_cost_per_unit)}</b></span>
                    </div>
                  )}

                  {isOpen && (
                    <div className="border-t border-[#f3efe9] bg-[#faf8f5] px-4 py-3">
                      <div className="space-y-2">
                        {g.runs.map((r) => (
                          <div key={r.order_id} className="flex items-center justify-between gap-2 text-[13px]">
                            <div className="min-w-0">
                              <span className="text-[#3d2c24]">{fmtDate(r.date)}</span>
                              <span className="ml-2 text-[11px] text-muted-foreground">
                                {Math.round(r.output_qty)} {r.output_unit} · insumos {money(r.total_cost)}
                                {r.partial_cost && <span className="ml-1 text-[#d4943a]">·parcial</span>}
                              </span>
                            </div>
                            <span className="shrink-0 font-bold text-[#006d5a]">{money(r.cost_per_unit)}/{r.output_unit}</span>
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
            {totalRuns} producciones registradas · &quot;parcial&quot; = algún insumo sin costo cargado, el total quedó subestimado
          </p>
        </FadeIn>
      )}
    </div>
  )
}
