'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Users, TrendingDown, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isSocio, isManagerOrAbove } from '@/lib/roles'
import { FadeIn } from '@/components/ui/motion'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingState } from '@/components/ui/LoadingState'

// ---------------------------------------------------------------------------
// PersonalView — costo del consumo del personal (tickets Fudo a $0).
// Absorbido de /admin/personal como modo de /ventas ("Números").
// ---------------------------------------------------------------------------

type ProductBreakdown = {
  fudo_product_id: string
  name: string
  times: number
  qty: number
  cost_total: number | null
  costed: boolean
}

type DailyPoint = { date: string; cost: number }

type Payload = {
  days: number
  from: string
  to: string
  total_cost: number
  total_consumos: number
  total_qty: number
  sin_costeo: number
  products: ProductBreakdown[]
  daily: DailyPoint[]
}

function money(n: number | null): string {
  if (n == null) return '—'
  return `$${Math.round(n).toLocaleString('es-AR')}`
}

export function PersonalView() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  const canAccess = isSocio(profile?.role) || isManagerOrAbove(profile?.role)

  useEffect(() => {
    if (profileLoading || !canAccess) return
    setLoading(true)
    fetch(`/api/personal/consumo?days=${days}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'No se pudo cargar')
        return res.json()
      })
      .then(setData)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Error al cargar'))
      .finally(() => setLoading(false))
  }, [days, profileLoading, canAccess])

  const maxDaily = useMemo(() => Math.max(1, ...(data?.daily ?? []).map((d) => d.cost)), [data])
  const maxProduct = useMemo(() => Math.max(1, ...(data?.products ?? []).map((p) => p.cost_total ?? 0)), [data])

  if (profileLoading) return <LoadingState />
  if (!canAccess) {
    return <EmptyState icon={Users} title="Sin acceso" description="Solo socios y encargados pueden ver el consumo del personal." />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Lo que consume el personal se ticketea en Fudo a $0, pero <b>igual cuesta producirlo</b>. Acá ves ese costo real
          (calculado por receta) — plata que no se factura y que conviene controlar.
        </p>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="shrink-0 rounded-lg border border-[#ebe6df] bg-white px-2 py-1 text-[12px] focus:outline-none"
        >
          <option value={7}>7 días</option>
          <option value={30}>30 días</option>
          <option value={90}>90 días</option>
        </select>
      </div>

      {loading || !data ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" /> Cargando…
        </div>
      ) : data.total_consumos === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-[#ebe6df]">
          <p className="text-[14px] text-[#3d2c24]">No hay consumos de personal registrados en el período.</p>
        </div>
      ) : (
        <FadeIn>
          {/* Hero: costo total */}
          <div className="mb-4 overflow-hidden rounded-2xl bg-gradient-to-br from-[#ea504c] to-[#c43d3a] p-5 text-white shadow-sm">
            <p className="text-[12px] font-medium uppercase tracking-wider text-white/80">Costo del consumo del personal</p>
            <p className="mt-1 font-display text-[38px] font-bold leading-none tabular-nums">{money(data.total_cost)}</p>
            <p className="mt-2 text-[12px] text-white/85">
              {data.total_consumos} consumos · {data.days} días
              {data.sin_costeo > 0 && ` · ${data.sin_costeo} sin costeo`}
            </p>
          </div>

          {/* Serie diaria */}
          {data.daily.some((d) => d.cost > 0) && (
            <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
              <p className="mb-3 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                <TrendingDown className="size-3.5" /> Por día
              </p>
              <div className="flex h-24 items-end gap-0.5">
                {data.daily.map((d) => (
                  <div
                    key={d.date}
                    className="flex-1 rounded-t bg-[#ea504c]/70"
                    style={{ height: `${Math.max(2, (d.cost / maxDaily) * 100)}%` }}
                    title={`${d.date}: ${money(d.cost)}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Ranking de productos */}
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Qué consume más el personal</p>
            <div className="space-y-2.5">
              {data.products.map((p) => (
                <div key={p.fudo_product_id}>
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate text-[#3d2c24]">{p.name}</span>
                    <span className="shrink-0 font-bold text-[#3d2c24]">
                      {p.cost_total != null ? money(p.cost_total) : <span className="text-[11px] font-medium text-[#d4943a]">sin costeo</span>}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f5f2ee]">
                      <div className="h-full rounded-full bg-[#ea504c]/70" style={{ width: `${((p.cost_total ?? 0) / maxProduct) * 100}%` }} />
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{p.times}×</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {data.sin_costeo > 0 && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <AlertCircle className="mt-0.5 size-3 shrink-0 text-[#d4943a]" />
              {data.sin_costeo} consumos no tienen receta cargada del producto equivalente, así que su costo no se pudo calcular todavía — el total real es algo mayor.
            </p>
          )}
        </FadeIn>
      )}
    </div>
  )
}
