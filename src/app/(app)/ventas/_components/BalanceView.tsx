'use client'

import { useEffect, useState } from 'react'
import { Loader2, Scale, ShoppingCart, TrendingUp, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/ui/motion'
import { ChartCard } from '@/components/admin/ChartCard'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { formatPrice } from './types'
import { InsumosVendidos } from './InsumosVendidos'

// ---------------------------------------------------------------------------
// BalanceView — "lo que se compra se compensa con lo que se vende"
// $ vendido (fudo_sales) vs $ comprado (módulo de GASTOS de Fudo) por día.
// El "comprado" sale de /api/compras/diario (compras reales de Fudo), NO de
// stock_receipts (que está vacía). El "a pagar pendiente" sí sigue saliendo de
// stock_receipts (eso es data LVE) vía /api/ventas/balance.
// Solo managers (el botón se oculta en la página para el resto).
// ---------------------------------------------------------------------------

type BalanceData = {
  days: number
  from: string
  to: string
  series: { date: string; sold: number; purchased: number }[]
  totals: { sold: number; purchased: number; balance: number }
  payments: { pagado: number; a_pagar: number }
}

type ComprasDiario = {
  days: number
  from: string
  to: string
  series: { date: string; total: number }[]
  total: number
  top_providers: { name: string; total: number }[]
}

const DAY_OPTIONS = [7, 30, 90] as const

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export function BalanceView() {
  const [data, setData] = useState<BalanceData | null>(null)
  const [compras, setCompras] = useState<ComprasDiario | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState<number>(30)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [balRes, comprasRes] = await Promise.all([
          fetch(`/api/ventas/balance?days=${days}`, { credentials: 'include' }),
          fetch(`/api/compras/diario?days=${days}`, { credentials: 'include' }),
        ])
        if (!balRes.ok) throw new Error((await balRes.json().catch(() => ({})))?.error ?? 'No se pudo cargar el balance')
        const balJson: BalanceData = await balRes.json()
        // Las compras de Fudo son la fuente real del "comprado"; si fallan, se
        // reporta pero el balance de ventas igual se muestra.
        const comprasJson: ComprasDiario | null = comprasRes.ok ? await comprasRes.json() : null

        if (cancelled) return

        if (comprasJson) {
          // Sobrescribir el "comprado" con las compras reales de Fudo.
          const purchasedByDay = new Map(comprasJson.series.map((s) => [s.date, s.total]))
          const series = balJson.series.map((d) => ({
            ...d,
            purchased: purchasedByDay.get(d.date) ?? 0,
          }))
          const totalPurchased = comprasJson.total
          balJson.series = series
          balJson.totals = {
            ...balJson.totals,
            purchased: totalPurchased,
            balance: balJson.totals.sold - totalPurchased,
          }
        }

        setData(balJson)
        setCompras(comprasJson)
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : 'Error al cargar el balance')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [days])

  const positive = (data?.totals.balance ?? 0) >= 0
  const maxProvider = compras?.top_providers[0]?.total ?? 0
  // Con 90 días el eje X se satura: mostrar 1 de cada n etiquetas
  const tickInterval = days > 30 ? 13 : days > 7 ? 4 : 0

  return (
    <div className="space-y-4">
      {/* Selector de período */}
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground">
          Comparación de lo vendido contra lo comprado, día por día.
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
          <Loader2 className="mr-2 size-5 animate-spin" /> Cargando balance…
        </div>
      ) : !data ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-[#ebe6df]">
          <p className="text-[14px] text-[#3d2c24]">No se pudo cargar el balance.</p>
        </div>
      ) : (
        <FadeIn>
          <div className="space-y-4">
            {/* Balance del período */}
            <div
              className="relative overflow-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-[#ebe6df]"
              style={{
                borderLeftWidth: 4,
                borderLeftColor: positive ? '#006d5a' : '#ea504c',
                backgroundImage: positive
                  ? 'linear-gradient(135deg, rgba(0,109,90,0.06) 0%, rgba(255,255,255,0) 55%)'
                  : 'linear-gradient(135deg, rgba(234,80,76,0.06) 0%, rgba(255,255,255,0) 55%)',
              }}
            >
              <div className="flex items-center gap-2">
                <Scale className={`size-4 ${positive ? 'text-[#006d5a]' : 'text-[#ea504c]'}`} />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                  Balance del período ({data.days} días)
                </span>
              </div>
              <p className={`mt-1.5 font-display text-4xl font-bold tabular-nums tracking-tight ${positive ? 'text-[#006d5a]' : 'text-[#ea504c]'}`}>
                {positive ? '+' : '−'}{formatPrice(Math.abs(data.totals.balance))}
              </p>
              <p className="mt-0.5 text-[11px] text-[#a39e97]">
                {positive
                  ? 'Lo vendido cubre lo comprado.'
                  : 'Se compró más de lo que se vendió — ojo con el flujo.'}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <div className="rounded-xl bg-[#e8f5f1] px-3 py-2.5">
                  <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-[#006d5a]">
                    <TrendingUp className="size-3" /> Vendido
                  </span>
                  <p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#006d5a]">{formatPrice(data.totals.sold)}</p>
                </div>
                <div className="rounded-xl bg-[#fdf6ec] px-3 py-2.5">
                  <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-[#d4943a]">
                    <ShoppingCart className="size-3" /> Comprado
                  </span>
                  <p className="mt-0.5 text-[16px] font-bold tabular-nums text-[#d4943a]">{formatPrice(data.totals.purchased)}</p>
                  <p className="text-[9px] text-[#a39e97]">compras de Fudo</p>
                </div>
              </div>

              {data.payments.a_pagar > 0 && (
                <div className="mt-2.5 flex items-center justify-between rounded-xl bg-[#fdf6ec] px-3 py-2 ring-1 ring-[#d4943a]/20">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#3d2c24]">
                    <Wallet className="size-3.5 text-[#d4943a]" /> A pagar pendiente
                  </span>
                  <span className="text-[13px] font-bold tabular-nums text-[#d4943a]">{formatPrice(data.payments.a_pagar)}</span>
                </div>
              )}
            </div>

            {/* Barras diarias vendido vs comprado */}
            <ChartCard
              title="Vendido vs comprado por día"
              subtitle={`${shortDate(data.from)} → ${shortDate(data.to)} · comprado: Fudo`}
              isEmpty={data.series.every((d) => d.sold === 0 && d.purchased === 0)}
              emptyMessage="Sin ventas ni compras en el período"
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.series} margin={{ top: 4, right: 0, left: -12, bottom: 0 }} barGap={0}>
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    interval={tickInterval}
                    tick={{ fontSize: 10, fill: '#a39e97' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    tick={{ fontSize: 10, fill: '#a39e97' }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                  />
                  <Tooltip
                    formatter={(value, name) => [formatPrice(Number(value)), name === 'sold' ? 'Vendido' : 'Comprado']}
                    labelFormatter={(label) => shortDate(String(label))}
                    contentStyle={{ borderRadius: 12, border: '1px solid #ebe6df', fontSize: 12 }}
                  />
                  <Legend
                    formatter={(value: string) => (
                      <span style={{ fontSize: 11, color: '#3d2c24' }}>{value === 'sold' ? 'Vendido' : 'Comprado'}</span>
                    )}
                    iconSize={10}
                  />
                  <Bar dataKey="sold" fill="#006d5a" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="purchased" fill="#d4943a" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Insumos más vendidos — la conexión venta → insumo */}
            <InsumosVendidos />

            {/* Top proveedores por gasto (compras reales de Fudo) */}
            {compras && compras.top_providers.length > 0 && (
              <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-[#ebe6df]">
                <div className="mb-3 flex items-center gap-2">
                  <ShoppingCart className="size-4 text-[#d4943a]" />
                  <h2 className="text-[14px] font-bold text-[#3d2c24]">Top proveedores por gasto</h2>
                  <span className="ml-auto text-[10px] text-[#a39e97]">compras de Fudo</span>
                </div>
                <div className="space-y-2.5">
                  {compras.top_providers.map((s, i) => (
                    <div key={s.name}>
                      <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="min-w-0 truncate text-[#3d2c24]">
                          <span className="mr-1.5 text-[11px] font-bold text-[#a39e97]">{i + 1}.</span>
                          {s.name}
                        </span>
                        <span className="shrink-0 font-bold tabular-nums text-[#3d2c24]">{formatPrice(s.total)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#f3efe9]">
                        <div
                          className="h-full rounded-full bg-[#d4943a]"
                          style={{ width: `${maxProvider > 0 ? Math.max((s.total / maxProvider) * 100, 3) : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </FadeIn>
      )}
    </div>
  )
}
