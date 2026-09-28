'use client'

import React, { useEffect, useState } from 'react'
import { Info, Loader2, Sparkles, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn, AnimatedSwitch, motion } from '@/components/ui/motion'
import { formatPrice } from './types'

// ---------------------------------------------------------------------------
// MomentosView — ¿Qué conviene promocionar en cada momento del día?
// 4 tarjetas (desayuno / almuerzo / merienda / noche) con revenue y unidades;
// la elegida se expande y muestra "⭐ Para promocionar" (top 5 por margen $
// unitario entre los de margen % ≥ mediana del momento) y los más vendidos.
// Horas ARGENTINA (el endpoint convierte sold_at UTC → AR). Solo managers.
// ---------------------------------------------------------------------------

type MomentoKey = 'desayuno_merienda' | 'almuerzo_cena'

type MomentoProduct = {
  menu_item_id: string
  name: string
  units: number
  revenue: number
  avg_price: number
  cost: number
  margin_unit: number
  margin_pct: number
}

type MomentoPromo = MomentoProduct & {
  reason: 'alto_margen_popular' | 'alto_margen_dormido'
}

type Momento = {
  key: MomentoKey
  units_total: number
  revenue_total: number
  revenue_costeado: number
  coverage_pct: number | null
  productos_costeados: number
  median_margin_pct: number
  para_promocionar: MomentoPromo[]
  mas_vendidos: MomentoProduct[]
}

type MomentosData = {
  days: number
  from: string
  to: string
  revenue_total: number
  units_total: number
  momentos: Momento[]
}

const DAY_OPTIONS = [7, 30, 90] as const

const MOMENTO_META: Record<MomentoKey, { emoji: string; label: string; desc: string }> = {
  desayuno_merienda: { emoji: '☕', label: 'Desayunos y Meriendas', desc: 'café, tostadas, medialunas, meriendas' },
  almuerzo_cena:     { emoji: '🍽️', label: 'Almuerzos y Cenas',    desc: 'platos, pizzas, milanesas, menú del día' },
}

const REASON_META: Record<MomentoPromo['reason'], { label: string; color: string; bg: string }> = {
  alto_margen_popular: { label: 'popular acá', color: '#006d5a', bg: '#e8f5f1' },
  alto_margen_dormido: { label: 'dormido: la promo lo despierta', color: '#d4943a', bg: '#fdf6ec' },
}

export function MomentosView() {
  const [data, setData] = useState<MomentosData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState<number>(30)
  const [selected, setSelected] = useState<MomentoKey>('almuerzo_cena')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/ventas/momentos?days=${days}`, { credentials: 'include' })
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'No se pudieron cargar los momentos')
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Error al cargar los momentos')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [days])

  // Al cargar, arrancar en el momento que más factura (donde más sirve promocionar)
  useEffect(() => {
    if (!data) return
    const best = [...data.momentos].sort((a, b) => b.revenue_total - a.revenue_total)[0]
    if (best && best.revenue_total > 0) setSelected(best.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.days])

  const momento = data?.momentos.find(m => m.key === selected) ?? null
  const maxRevenue = data ? Math.max(...data.momentos.map(m => m.revenue_total), 1) : 1

  return (
    <div className="space-y-4">
      {/* Selector de período */}
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground">
          Qué conviene promocionar según el servicio del día.
        </p>
        <div className="flex shrink-0 rounded-full bg-secondary p-0.5">
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                days === d ? 'bg-[#006d5a] text-white' : 'text-muted-foreground'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" /> Cargando momentos…
        </div>
      ) : !data ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-[#ebe6df]">
          <p className="text-[14px] text-[#3d2c24]">No se pudieron cargar los momentos.</p>
        </div>
      ) : (
        <FadeIn>
          <div className="space-y-4">
            {/* 2 tarjetas de servicio */}
            <div className="grid grid-cols-2 gap-2.5">
              {data.momentos.map((m) => {
                const meta = MOMENTO_META[m.key]
                const isSelected = m.key === selected
                const share = data.revenue_total > 0 ? Math.round((m.revenue_total / data.revenue_total) * 100) : 0
                const accentColor = m.key === 'desayuno_merienda' ? '#d4943a' : '#006d5a'
                const accentBg = m.key === 'desayuno_merienda' ? '#fdf6ec' : '#e8f5f1'
                return (
                  <motion.button
                    key={m.key}
                    onClick={() => setSelected(m.key)}
                    whileTap={{ scale: 0.97 }}
                    animate={{ scale: isSelected ? 1.02 : 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    className={`relative overflow-hidden rounded-2xl p-3.5 text-left shadow-sm ring-1 transition-colors ${
                      isSelected ? 'ring-2' : 'bg-white ring-[#ebe6df]'
                    }`}
                    style={isSelected
                      ? { backgroundImage: `linear-gradient(135deg, ${accentBg} 0%, #ffffff 70%)`, '--tw-ring-color': accentColor } as React.CSSProperties
                      : undefined}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[20px] leading-none">{meta.emoji}</span>
                      <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-muted-foreground">
                        {share}%
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] font-bold text-[#3d2c24]">{meta.label}</p>
                    <p className={`font-display text-[19px] font-bold tabular-nums tracking-tight`}
                      style={{ color: isSelected ? accentColor : '#3d2c24' }}>
                      {formatPrice(m.revenue_total)}
                    </p>
                    <p className="text-[10px] tabular-nums text-[#a39e97]">{m.units_total.toLocaleString('es-AR')} u</p>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(Math.min((m.revenue_total / maxRevenue) * 100, 100), 2)}%`, backgroundColor: accentColor, opacity: isSelected ? 1 : 0.45 }}
                      />
                    </div>
                  </motion.button>
                )
              })}
            </div>

            {/* Detalle del momento elegido */}
            <AnimatedSwitch id={selected}>
              {momento && (
                <div className="space-y-4">
                  {momento.revenue_total <= 0 ? (
                    <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-[#ebe6df]">
                      <p className="text-[14px] text-[#3d2c24]">
                        Sin ventas en {MOMENTO_META[momento.key].label.toLowerCase()} en el período.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* ⭐ Para promocionar */}
                      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
                        <div
                          className="border-b border-[#ebe6df] px-4 py-3.5"
                          style={{ backgroundImage: 'linear-gradient(135deg, #e8f5f1 0%, rgba(255,255,255,0) 60%)' }}
                        >
                          <div className="flex items-center gap-2">
                            <Sparkles className="size-4 text-[#006d5a]" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                              Para promocionar — {MOMENTO_META[momento.key].label}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] leading-snug text-[#a39e97]">
                            Margen % arriba de la mediana de la franja, ordenados por lo que más plata dejan por unidad: empujar volumen acá no duele.
                          </p>
                        </div>

                        {momento.para_promocionar.length === 0 ? (
                          <p className="px-4 py-5 text-center text-[12px] text-[#a39e97]">
                            No hay productos con receta costeada vendidos en esta franja.
                          </p>
                        ) : (
                          <div className="divide-y divide-[#f3efe9]">
                            {momento.para_promocionar.map((p, idx) => {
                              const reason = REASON_META[p.reason]
                              const maxUnits = Math.max(...momento.para_promocionar.map(x => x.units), 1)
                              return (
                                <div key={p.menu_item_id} className="px-4 py-2.5">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <p className="min-w-0 truncate text-[13px] font-semibold text-[#3d2c24]">
                                      <span className="mr-1.5 text-[10px] font-bold tabular-nums text-[#a39e97]">{idx + 1}.</span>
                                      {p.name}
                                    </p>
                                    <span className="shrink-0 rounded-full bg-[#e8f5f1] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[#006d5a]">
                                      +{formatPrice(p.margin_unit)} · {p.margin_pct}%
                                    </span>
                                  </div>
                                  <div className="mt-1 flex items-center gap-2">
                                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                                      <div
                                        className="h-full rounded-full bg-[#006d5a]"
                                        style={{ width: `${Math.max(Math.min((p.units / maxUnits) * 100, 100), 2)}%` }}
                                      />
                                    </div>
                                    <span className="shrink-0 text-[10px] tabular-nums text-[#a39e97]">{p.units} u</span>
                                    <span
                                      className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                                      style={{ color: reason.color, backgroundColor: reason.bg }}
                                    >
                                      {reason.label}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Más vendidos del momento */}
                      {momento.mas_vendidos.length > 0 && (
                        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
                          <div className="flex items-center gap-2 border-b border-[#ebe6df] px-4 py-3">
                            <TrendingUp className="size-4 text-[#8b5e34]" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                              Más vendidos del momento
                            </span>
                          </div>
                          <div className="divide-y divide-[#f3efe9]">
                            {momento.mas_vendidos.map((p) => {
                              const maxUnits = Math.max(...momento.mas_vendidos.map(x => x.units), 1)
                              return (
                                <div key={p.menu_item_id} className="px-4 py-2.5">
                                  <div className="flex items-baseline justify-between gap-2">
                                    <p className="min-w-0 truncate text-[13px] font-semibold text-[#3d2c24]">{p.name}</p>
                                    <p className="shrink-0 text-[11px] font-bold tabular-nums text-[#006d5a]">
                                      +{formatPrice(p.margin_unit)}
                                      <span className="ml-1 font-semibold text-[#a39e97]">({p.margin_pct}%)</span>
                                    </p>
                                  </div>
                                  <div className="mt-1 flex items-center gap-2">
                                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
                                      <div
                                        className="h-full rounded-full bg-[#8b5e34]"
                                        style={{ width: `${Math.max(Math.min((p.units / maxUnits) * 100, 100), 2)}%` }}
                                      />
                                    </div>
                                    <span className="shrink-0 text-[10px] tabular-nums text-[#a39e97]">{p.units} u</span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Coverage del momento */}
                      {momento.coverage_pct != null && (
                        <p className="flex items-center gap-1.5 px-1 text-[10px] text-[#a39e97]">
                          <Info className="size-3 shrink-0" />
                          El {momento.coverage_pct}% de las ventas de este momento tienen receta cargada
                          ({formatPrice(momento.revenue_costeado)} de {formatPrice(momento.revenue_total)}). El resto queda fuera del ranking.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </AnimatedSwitch>
          </div>
        </FadeIn>
      )}
    </div>
  )
}
