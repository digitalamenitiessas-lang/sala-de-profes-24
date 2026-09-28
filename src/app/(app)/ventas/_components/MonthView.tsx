'use client'

import { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { DollarSign, Trophy, CalendarDays, Loader2, Star } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { FadeIn } from '@/components/ui/motion'
import { ChartCard } from '@/components/admin/ChartCard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { formatPrice } from './types'

type MonthSummary = {
  totalFacturado: number
  totalTickets: number
  activeDays: number
  avgPerDay: number
  avgTicket: number
  topProducts: { name: string; qty: number; revenue: number }[]
  topByRevenue: { name: string; qty: number; revenue: number }[]
}

type AiResult = {
  analysis: string
  stats: {
    windowLabel: string
    totalFacturado: number
    totalTickets: number
    avgTicket: number
    categoryMix: { category: string; revenue: number; qty: number }[]
    byMomento: { momento: string; label: string; revenue: number; qty: number; topProducts: { name: string; qty: number; revenue: number }[] }[]
    byWeek: { week: string; total: number; tickets: number }[]
  }
}

type Props = {
  selectedDate: Date
  setSelectedDate: (d: Date) => void
}

const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const SERIES_COLORS = ['#006d5a', '#8b5e34', '#d4943a']

export function MonthView({ selectedDate, setSelectedDate }: Props) {
  const [monthData, setMonthData] = useState<{ date: string; total: number; tickets: number }[]>([])
  const [monthSummary, setMonthSummary] = useState<MonthSummary | null>(null)
  const [loadingMonth, setLoadingMonth] = useState(false)
  const [monthError, setMonthError] = useState<string | null>(null)
  const [monthTruncado, setMonthTruncado] = useState(false)
  const [hourlyByDow, setHourlyByDow] = useState<{ dow: number; hour: number; total: number; tickets: number }[]>([])
  const [dowSelection, setDowSelection] = useState<number[]>([])
  const [hourFrom, setHourFrom] = useState<number | null>(null)
  const [hourTo, setHourTo] = useState<number | null>(null)
  const [aiResult, setAiResult] = useState<AiResult | null>(null)
  const [loadingAi, setLoadingAi] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const fetchMonth = useCallback(async () => {
    setLoadingMonth(true)
    setMonthError(null)
    try {
      const monthStr = format(selectedDate, 'yyyy-MM')
      const res = await fetch(`/api/fudo/monthly-summary?month=${monthStr}`, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status} al cargar el mes`)
      if (json.dailyData) {
        setMonthData(json.dailyData)
        setMonthTruncado(Boolean(json.truncado))
        setHourlyByDow(json.hourlyByDow ?? [])
        setMonthSummary({
          totalFacturado: json.totalFacturado ?? 0,
          totalTickets:   json.totalTickets ?? 0,
          activeDays:     json.activeDays ?? 0,
          avgPerDay:      json.avgPerDay ?? 0,
          avgTicket:      json.avgTicket ?? 0,
          topProducts:    json.topProducts ?? [],
          topByRevenue:   json.topByRevenue ?? [],
        })
      } else {
        throw new Error(json.error ?? 'Sin datos del mes')
      }
    } catch (e) {
      setMonthError(e instanceof Error ? e.message : 'Error al cargar el mes')
    }
    setLoadingMonth(false)
  }, [selectedDate])

  useEffect(() => { void fetchMonth() }, [fetchMonth])

  if (loadingMonth) return (
    <FadeIn>
      <div className="space-y-2">
        <div className="h-8 animate-pulse rounded-lg bg-[#f3efe9]" />
        <div className="h-48 animate-pulse rounded-xl bg-[#f3efe9]" />
        <div className="h-32 animate-pulse rounded-xl bg-[#f3efe9]" />
      </div>
    </FadeIn>
  )

  if (monthError) return (
    <FadeIn>
      <div className="rounded-xl bg-red-50 px-4 py-3 text-[12px] text-[#ea504c]">
        <p className="font-semibold">No se pudo cargar el mes</p>
        <p className="mt-0.5 opacity-80">{monthError}</p>
      </div>
    </FadeIn>
  )

  if (!monthSummary) return (
    <EmptyState icon={CalendarDays} title="Sin datos del mes" description="No hay ventas registradas para este período." />
  )

  // Horarios por día de semana
  const dowCounts = [0, 0, 0, 0, 0, 0, 0]
  for (const d of monthData) dowCounts[new Date(d.date + 'T12:00:00').getDay()]++
  const activeDays = monthData.filter(d => d.total > 0).length || 1
  const hoursWithSales = [...new Set(hourlyByDow.filter(r => r.tickets > 0).map(r => r.hour))].sort((a, b) => a - b)
  const minH = hoursWithSales[0] ?? 0
  const maxH = hoursWithSales[hoursWithSales.length - 1] ?? 23
  const from = Math.max(minH, Math.min(hourFrom ?? minH, maxH))
  const to = Math.max(from, Math.min(hourTo ?? maxH, maxH))
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const seriesKeys = dowSelection.length === 0 ? ['todos'] : dowSelection.map(d => `d${d}`)
  const seriesLabels = dowSelection.length === 0 ? ['Promedio general'] : dowSelection.map(d => DOW_LABELS[d])
  const rows = hours.map(h => {
    const row: Record<string, number | string> = { hour: `${h}` }
    if (dowSelection.length === 0) {
      const total = hourlyByDow.filter(r => r.hour === h).reduce((s, r) => s + r.total, 0)
      row.todos = Math.round(total / activeDays)
    } else {
      for (const dow of dowSelection) {
        const total = hourlyByDow.filter(r => r.dow === dow && r.hour === h).reduce((s, r) => s + r.total, 0)
        row[`d${dow}`] = dowCounts[dow] > 0 ? Math.round(total / dowCounts[dow]) : 0
      }
    }
    return row
  })
  const stats = seriesKeys.map((key, i) => {
    const vals = rows.map(r => ({ hour: String(r.hour), v: Number(r[key] ?? 0) }))
    const pico = vals.reduce((m, x) => (x.v > m.v ? x : m), vals[0] ?? { hour: '0', v: 0 })
    const valle = vals.reduce((m, x) => (x.v < m.v ? x : m), vals[0] ?? { hour: '0', v: 0 })
    return { label: seriesLabels[i], color: SERIES_COLORS[i] ?? '#006d5a', pico, valle }
  })

  const toggleDow = (dow: number) => {
    setDowSelection(prev => {
      if (prev.includes(dow)) return prev.filter(d => d !== dow)
      const next = [...prev, dow]
      return next.length > 3 ? next.slice(1) : next
    })
  }
  const labelFor = (key: string) =>
    key === 'todos' ? 'Promedio general' : DOW_LABELS[Number(key.slice(1))]

  const handleAnalyzeAi = async () => {
    setLoadingAi(true)
    setAiError(null)
    try {
      const res = await fetch('/api/ai/sales-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ month: format(selectedDate, 'yyyy-MM'), dows: dowSelection, hourFrom: from, hourTo: to }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo generar el análisis')
      setAiResult(json)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Error al analizar')
    } finally {
      setLoadingAi(false)
    }
  }

  return (
    <FadeIn>
      <div className="space-y-4">
        {/* Aviso: Fudo devolvió el mes cortado (tope de páginas o una página falló) */}
        {monthTruncado && (
          <div className="rounded-xl bg-[#fdf6ec] px-3 py-2 text-[11px] text-[#8b5e34]">
            Mes incompleto: Fudo no devolvió todas las ventas del período, los totales pueden quedar cortos.
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-[#e8f5f1] p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#006d5a' }}>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#006d5a]">Total mes</p>
            <p className="mt-1 font-display text-xl font-bold text-[#006d5a]">{formatPrice(monthSummary.totalFacturado)}</p>
          </div>
          <div className="rounded-xl bg-[#faf0e4] p-3" style={{ borderLeftWidth: 3, borderLeftColor: '#8b5e34' }}>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#8b5e34]">Tickets</p>
            <p className="mt-1 font-display text-xl font-bold text-[#8b5e34]">{monthSummary.totalTickets}</p>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-xl bg-[#f8f5f0] px-4 py-2.5">
          <div className="flex items-center gap-4 text-xs text-[#3d2c24]">
            <span>Prom/día <strong className="tabular-nums">{formatPrice(monthSummary.avgPerDay)}</strong></span>
            <span className="text-[#ebe6df]">|</span>
            <span>Ticket prom <strong className="tabular-nums">{formatPrice(monthSummary.avgTicket)}</strong></span>
            <span className="text-[#ebe6df]">|</span>
            <span>{monthSummary.activeDays} días activos</span>
          </div>
        </div>

        {/* Daily chart */}
        <ChartCard title="Facturado por día" subtitle={format(selectedDate, 'MMMM yyyy', { locale: es })}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthData.map(d => ({ ...d, label: format(new Date(d.date + 'T12:00:00'), 'd', { locale: es }) }))}>
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 11 }}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(v: any) => [formatPrice(v), 'Facturado']}
                labelFormatter={(l) => `Día ${l}`}
              />
              <Bar dataKey="total" fill="#006d5a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Horarios por día de semana */}
        {hoursWithSales.length > 0 && (
          <ChartCard
            title="Horarios de venta"
            subtitle="Promedio por día en cada hora — elegí días para comparar y una franja"
          >
            {/* Chips de días */}
            <div className="-mx-1 mb-2 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-none">
              <button
                onClick={() => setDowSelection([])}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all ${
                  dowSelection.length === 0 ? 'bg-[#3d2c24] text-white' : 'bg-[#f3efe9] text-[#a39e97]'
                }`}
              >
                Todos
              </button>
              {[1, 2, 3, 4, 5, 6, 0].map(dow => {
                const idx = dowSelection.indexOf(dow)
                return (
                  <button
                    key={dow}
                    onClick={() => toggleDow(dow)}
                    className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all"
                    style={idx >= 0
                      ? { backgroundColor: SERIES_COLORS[idx], color: 'white' }
                      : { backgroundColor: '#f3efe9', color: '#a39e97' }}
                  >
                    {DOW_LABELS[dow]}
                  </button>
                )
              })}
            </div>

            {/* Franja horaria */}
            <div className="mb-3 flex items-center gap-2 text-xs text-[#7d6c64]">
              <span>Franja:</span>
              <select
                value={from}
                onChange={(e) => setHourFrom(Number(e.target.value))}
                className="rounded-lg border border-[#ebe6df] bg-white px-2 py-1 text-xs focus:border-[#006d5a] focus:outline-none"
              >
                {hoursWithSales.map(h => <option key={h} value={h}>{h}:00</option>)}
              </select>
              <span>a</span>
              <select
                value={to}
                onChange={(e) => setHourTo(Number(e.target.value))}
                className="rounded-lg border border-[#ebe6df] bg-white px-2 py-1 text-xs focus:border-[#006d5a] focus:outline-none"
              >
                {hoursWithSales.filter(h => h >= from).map(h => <option key={h} value={h}>{h}:59</option>)}
              </select>
              {(hourFrom !== null || hourTo !== null) && (
                <button
                  onClick={() => { setHourFrom(null); setHourTo(null) }}
                  className="rounded-lg bg-[#f3efe9] px-2 py-1 text-[11px] font-semibold text-[#7d6c64]"
                >
                  Todo el día
                </button>
              )}
            </div>

            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={rows} margin={{ left: -15, right: 8 }}>
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any, name: any) => [formatPrice(v), labelFor(String(name))]}
                  labelFormatter={(l) => `${l}:00 a ${l}:59 hs`}
                />
                {seriesKeys.map((key, i) => (
                  <Bar key={key} dataKey={key} fill={SERIES_COLORS[i] ?? '#006d5a'} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>

            <div className="mt-2 space-y-1">
              {stats.map((s) => (
                <div key={s.label} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                  <span className="flex items-center gap-1.5 font-semibold text-[#3d2c24]">
                    <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                  <span className="text-[#006d5a]">▲ pico {s.pico.hour}hs · {formatPrice(s.pico.v)}</span>
                  <span className="text-[#ea504c]">▼ valle {s.valle.hour}hs · {formatPrice(s.valle.v)}</span>
                </div>
              ))}
            </div>

            {/* Análisis IA */}
            <div className="mt-4 border-t border-[#ebe6df] pt-4">
              <button
                onClick={handleAnalyzeAi}
                disabled={loadingAi}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3d2c24] py-2.5 text-xs font-semibold text-white transition-all active:scale-[0.98] disabled:opacity-60"
              >
                {loadingAi ? <Loader2 className="size-3.5 animate-spin" /> : <Star className="size-3.5" />}
                {loadingAi
                  ? 'Analizando…'
                  : dowSelection.length > 0
                    ? `Analizar con IA — ${seriesLabels.join(', ')} · ${from}–${to}hs`
                    : `Analizar con IA — todo el mes · ${from}–${to}hs`
                }
              </button>
              {aiError && <p className="mt-2 text-[11px] text-[#ea504c]">{aiError}</p>}
              {aiResult && !loadingAi && (
                <div className="mt-3 space-y-3 rounded-xl bg-[#faf8f5] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#a39e97]">
                    Análisis — {aiResult.stats.windowLabel}
                  </p>
                  <p className="whitespace-pre-line text-xs leading-relaxed text-[#3d2c24]">{aiResult.analysis}</p>
                  {(aiResult.stats.byMomento?.length ?? 0) > 0 && (
                    <div>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#a39e97]">Por momento del día</p>
                      <div className="space-y-2">
                        {aiResult.stats.byMomento.map((m) => {
                          const isDesayuno = m.momento === 'desayuno_merienda'
                          const color = isDesayuno ? '#d4943a' : '#006d5a'
                          const bg = isDesayuno ? '#fdf6ec' : '#e8f5f1'
                          return (
                            <div key={m.momento} className="rounded-xl p-3" style={{ backgroundColor: bg }}>
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold" style={{ color }}>{m.label}</span>
                                <span className="text-[11px] font-bold tabular-nums" style={{ color }}>{formatPrice(m.revenue)}</span>
                              </div>
                              {m.topProducts.length > 0 && (
                                <p className="mt-1 text-[10px] text-[#7d6c64]">
                                  {m.topProducts.slice(0, 3).map(p => p.name).join(' · ')}
                                </p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {aiResult.stats.byWeek.length > 1 && (
                    <div>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#a39e97]">Semana a semana</p>
                      <div className="space-y-0.5">
                        {aiResult.stats.byWeek.map((w) => (
                          <div key={w.week} className="flex items-center justify-between text-[11px]">
                            <span className="text-[#7d6c64]">{w.week}</span>
                            <span className="font-bold tabular-nums text-[#3d2c24]">{formatPrice(w.total)} · {w.tickets} tickets</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </ChartCard>
        )}

        {/* Top vendidos por cantidad */}
        {monthSummary.topProducts.length > 0 && (
          <div className="rounded-2xl border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Trophy className="size-4 text-[#d4943a]" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#3d2c24]">Más vendidos del mes</span>
            </div>
            <div className="space-y-1.5">
              {monthSummary.topProducts.slice(0, 15).map((p, i) => {
                const maxQty = monthSummary.topProducts[0]?.qty ?? 1
                const pct = Math.round((p.qty / maxQty) * 100)
                return (
                  <div key={i} className="relative overflow-hidden rounded-lg">
                    <div className="absolute inset-y-0 left-0 rounded-lg bg-[#e8f5f1]" style={{ width: `${pct}%` }} />
                    <div className="relative flex items-center justify-between px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-[#a39e97]">{i + 1}</span>
                        <span className="truncate text-sm font-medium text-[#3d2c24]">{p.name}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-bold tabular-nums text-[#006d5a]">{p.qty}</span>
                        <span className="text-[10px] tabular-nums text-[#a39e97]">{formatPrice(p.revenue)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Top por facturación */}
        {monthSummary.topByRevenue.length > 0 && (
          <div className="rounded-2xl border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <DollarSign className="size-4 text-[#006d5a]" />
              <span className="text-xs font-bold uppercase tracking-wider text-[#3d2c24]">Mayor facturación del mes</span>
            </div>
            <div className="space-y-1.5">
              {monthSummary.topByRevenue.slice(0, 10).map((p, i) => {
                const maxRev = monthSummary.topByRevenue[0]?.revenue ?? 1
                const pct = Math.round((p.revenue / maxRev) * 100)
                return (
                  <div key={i} className="relative overflow-hidden rounded-lg">
                    <div className="absolute inset-y-0 left-0 rounded-lg bg-[#fdf6ec]" style={{ width: `${pct}%` }} />
                    <div className="relative flex items-center justify-between px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-xs font-bold tabular-nums text-[#a39e97]">{i + 1}</span>
                        <span className="truncate text-sm font-medium text-[#3d2c24]">{p.name}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="text-sm font-bold tabular-nums text-[#8b5e34]">{formatPrice(p.revenue)}</span>
                        <span className="text-[10px] tabular-nums text-[#a39e97]">{p.qty}u</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Detalle por día */}
        <div className="space-y-1">
          <span className="section-label">Detalle por día</span>
          {[...monthData].reverse().filter(d => d.total > 0).map(d => (
            <button
              key={d.date}
              onClick={() => setSelectedDate(new Date(d.date + 'T12:00:00'))}
              className="flex w-full items-center justify-between rounded-xl border bg-card px-4 py-2.5 text-left transition-colors hover:bg-[#faf8f5]"
            >
              <div>
                <p className="text-xs font-semibold capitalize text-[#3d2c24]">
                  {format(new Date(d.date + 'T12:00:00'), "EEE d 'de' MMM", { locale: es })}
                </p>
                <p className="text-[10px] text-[#a39e97]">{d.tickets} tickets</p>
              </div>
              <p className="font-display text-sm font-bold tabular-nums text-[#006d5a]">{formatPrice(d.total)}</p>
            </button>
          ))}
        </div>
      </div>
    </FadeIn>
  )
}
