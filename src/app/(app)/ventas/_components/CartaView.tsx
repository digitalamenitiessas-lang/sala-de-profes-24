'use client'

import { useEffect, useState } from 'react'
import { PlatosSinRecetaCard } from '@/components/ventas/PlatosSinRecetaCard'
import { ChevronDown, Info, Loader2, Percent, UtensilsCrossed } from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/ui/motion'
import { formatPrice } from './types'

// ---------------------------------------------------------------------------
// CartaView — Food Cost % + Ingeniería de menú.
// Hero con el food cost teórico vs real (la brecha es merma/desperdicio/sin
// registrar) y matriz de 4 grupos: estrellas, caballitos, incógnitas, perros.
// Solo managers (el botón se oculta en la página para el resto).
// ---------------------------------------------------------------------------

type CartaDish = {
  menu_item_id: string
  name: string
  units: number
  revenue: number
  avg_price: number
  cost_per_portion: number
  margin_unit: number
  margin_pct: number
  food_cost_pct: number
  group: 'estrella' | 'caballito' | 'incognita' | 'perro'
}

type CartaData = {
  days: number
  from: string
  to: string
  dishes: CartaDish[]
  sin_datos: { menu_item_id: string; name: string; motivo: string }[]
  summary: {
    revenue_total: number
    revenue_costeado: number
    cmv_teorico: number
    food_cost_teorico_pct: number | null
    compras_total: number
    food_cost_real_pct: number | null
    coverage_pct: number | null
  }
}

const DAY_OPTIONS = [7, 30, 90] as const

const GROUPS: {
  key: CartaDish['group']
  emoji: string
  label: string
  advice: string
}[] = [
  { key: 'estrella', emoji: '⭐', label: 'Estrellas', advice: 'Populares y rentables: empujalas — que el mozo las ofrezca primero.' },
  { key: 'caballito', emoji: '🐎', label: 'Caballitos', advice: 'Se venden mucho pero dejan poco: subí el precio o bajá el costo de la receta.' },
  { key: 'incognita', emoji: '❓', label: 'Incógnitas', advice: 'Dejan buen margen pero se venden poco: promocionalas o dales mejor lugar en la carta.' },
  { key: 'perro', emoji: '🐕', label: 'Perros', advice: 'Ni se venden ni rinden: evaluá sacarlas de la carta o reformularlas.' },
]

/** Semáforo de food cost: verde ≤32%, ámbar 33–38%, rojo >38%. */
function fcColor(pct: number | null): string {
  if (pct == null) return '#a39e97'
  if (pct <= 32) return '#006d5a'
  if (pct <= 38) return '#d4943a'
  return '#ea504c'
}

function fcLabel(pct: number | null): string {
  if (pct == null) return 'Sin datos'
  if (pct <= 32) return 'Sano'
  if (pct <= 38) return 'Atención'
  return 'Alto'
}

export function CartaView() {
  const [data, setData] = useState<CartaData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState<number>(30)
  const [open, setOpen] = useState<Record<string, boolean>>({ estrella: true })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/ventas/carta?days=${days}`, { credentials: 'include' })
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'No se pudo cargar la carta')
        const json = await res.json()
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Error al cargar la carta')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [days])

  const teorico = data?.summary.food_cost_teorico_pct ?? null
  const real = data?.summary.food_cost_real_pct ?? null
  const brecha = teorico != null && real != null ? Math.round((real - teorico) * 10) / 10 : null
  const color = fcColor(teorico)
  const maxMargin = data ? Math.max(...data.dishes.map(d => d.margin_unit), 1) : 1

  return (
    <div className="space-y-4">
      {/* Selector de período */}
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground">
          Cuánto de cada peso vendido se va en ingredientes.
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
          <Loader2 className="mr-2 size-5 animate-spin" /> Cargando carta…
        </div>
      ) : !data ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-[#ebe6df]">
          <p className="text-[14px] text-[#3d2c24]">No se pudo cargar la carta.</p>
        </div>
      ) : (
        <FadeIn>
          <div className="space-y-4">
            {/* Hero: Food Cost % */}
            <div
              className="relative overflow-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-[#ebe6df]"
              style={{
                borderLeftWidth: 4,
                borderLeftColor: color,
                backgroundImage: `linear-gradient(135deg, ${color}0f 0%, rgba(255,255,255,0) 55%)`,
              }}
            >
              <div className="flex items-center gap-2">
                <Percent className="size-4" style={{ color }} />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                  Food Cost teórico ({data.days} días)
                </span>
                <span
                  className="ml-auto rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
                  style={{ backgroundColor: color }}
                >
                  {fcLabel(teorico)}
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline gap-3">
                <p className="font-display text-5xl font-bold tabular-nums tracking-tight" style={{ color }}>
                  {teorico != null ? `${teorico}%` : '—'}
                </p>
                <div className="text-[11px] leading-tight text-[#a39e97]">
                  <p>
                    Real:{' '}
                    <span className="font-bold tabular-nums" style={{ color: fcColor(real) }}>
                      {real != null ? `${real}%` : '—'}
                    </span>
                  </p>
                  {brecha != null && (
                    <p>
                      Brecha: <span className="font-bold tabular-nums text-[#3d2c24]">{brecha > 0 ? '+' : ''}{brecha} pts</span>
                    </p>
                  )}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-[#a39e97]">
                El teórico sale de las recetas; el real, de las compras. La diferencia es merma, desperdicio o compras sin registrar.
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <div className="rounded-xl bg-[#e8f5f1] px-3 py-2.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-[#006d5a]">CMV teórico</span>
                  <p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#006d5a]">{formatPrice(data.summary.cmv_teorico)}</p>
                </div>
                <div className="rounded-xl bg-[#fdf6ec] px-3 py-2.5">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-[#d4943a]">Compras</span>
                  <p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#d4943a]">{formatPrice(data.summary.compras_total)}</p>
                </div>
              </div>

              {data.summary.coverage_pct != null && (
                <p className="mt-2.5 flex items-center gap-1.5 text-[10px] text-[#a39e97]">
                  <Info className="size-3 shrink-0" />
                  Basado en el {data.summary.coverage_pct}% de las ventas con receta cargada ({formatPrice(data.summary.revenue_costeado)} de {formatPrice(data.summary.revenue_total)}).
                </p>
              )}
            </div>

            {/* Matriz de ingeniería de menú */}
            {data.dishes.length === 0 ? (
              <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-[#ebe6df]">
                <UtensilsCrossed className="mx-auto mb-2 size-6 text-[#a39e97]" />
                <p className="text-[14px] text-[#3d2c24]">No hay platos con receta costeada y ventas en el período.</p>
              </div>
            ) : (
              GROUPS.map((g) => {
                const dishes = data.dishes.filter(d => d.group === g.key)
                if (dishes.length === 0) return null
                const isOpen = open[g.key] ?? false
                return (
                  <div key={g.key} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
                    <button
                      onClick={() => setOpen(prev => ({ ...prev, [g.key]: !isOpen }))}
                      className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left"
                    >
                      <span className="text-[18px]">{g.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-bold text-[#3d2c24]">
                          {g.label}
                          <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                            {dishes.length}
                          </span>
                        </p>
                        <p className="truncate text-[10px] text-[#a39e97]">{g.advice}</p>
                      </div>
                      <ChevronDown className={`size-4 shrink-0 text-[#a39e97] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isOpen && (
                      <div className="divide-y divide-[#f3efe9] border-t border-[#ebe6df]">
                        {dishes.map((d) => (
                          <div key={d.menu_item_id} className="px-4 py-2.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="min-w-0 truncate text-[13px] font-semibold text-[#3d2c24]">{d.name}</p>
                              <p className="shrink-0 text-[12px] font-bold tabular-nums text-[#006d5a]">
                                +{formatPrice(d.margin_unit)}
                                <span className="ml-1 font-semibold text-[#a39e97]">({d.margin_pct}%)</span>
                              </p>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] tabular-nums text-[#a39e97]">
                              <span>{d.units} u · precio {formatPrice(d.avg_price)} · costo {formatPrice(d.cost_per_portion)}</span>
                              <span style={{ color: fcColor(d.food_cost_pct) }} className="font-semibold">FC {d.food_cost_pct}%</span>
                            </div>
                            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
                              <div
                                className="h-full rounded-full bg-[#006d5a]"
                                style={{ width: `${Math.max(Math.min((d.margin_unit / maxMargin) * 100, 100), 2)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}

            {/* Transparencia: platos sin datos, con el motivo de cada uno */}
            {data.sin_datos.length > 0 && (
              <details className="px-1">
                <summary className="flex cursor-pointer items-center gap-1.5 text-[10px] text-[#a39e97]">
                  <Info className="size-3 shrink-0" />
                  {data.sin_datos.length} {data.sin_datos.length === 1 ? 'plato quedó afuera' : 'platos quedaron afuera'} por falta de datos reales. Nada se estima — tocá para ver por qué.
                </summary>
                <ul className="mt-1.5 space-y-0.5 pl-4">
                  {data.sin_datos.map((d) => (
                    <li key={d.menu_item_id} className="text-[10px] text-[#a39e97]">
                      <span className="font-medium text-[#6b6560]">{d.name}</span>
                      {' — '}{d.motivo}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* Platos sin receta: se vinculan desde /ventas/vincular (desaparece cuando no queda ninguno) */}
            <PlatosSinRecetaCard />
          </div>
        </FadeIn>
      )}
    </div>
  )
}

