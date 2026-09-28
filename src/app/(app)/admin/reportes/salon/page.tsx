'use client'

import { useEffect, useState } from 'react'
import { format, subDays } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { Clock, TrendingDown, TrendingUp, Users, Award, AlertTriangle, Loader2 } from 'lucide-react'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { ChartCard } from '@/components/admin/ChartCard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

type Summary = {
  totalDispatches: number
  avgMinutes: number
  medianMinutes: number
  p90Minutes: number
  underTarget20min: number
  underTargetPct: number
  overTarget25min: number
  overTargetPct: number
}

type ByProduct = { name: string; avg: number; count: number; max: number }
type ByHour = { hour: string; avg: number; count: number }
type ByDay = { date: string; label: string; avg: number; count: number }
type ByRunner = { name: string; avg: number; count: number }
type ByDayOfWeek = { day: string; avg: number; count: number }

export default function SalonReportPage() {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [byProduct, setByProduct] = useState<ByProduct[]>([])
  const [byHour, setByHour] = useState<ByHour[]>([])
  const [byDay, setByDay] = useState<ByDay[]>([])
  const [byRunner, setByRunner] = useState<ByRunner[]>([])
  const [byDayOfWeek, setByDayOfWeek] = useState<ByDayOfWeek[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [period, setPeriod] = useState<'7' | '14' | '30'>('7')

  useEffect(() => {
    async function fetch_data() {
      setLoading(true)
      const days = parseInt(period)
      const from = format(subDays(new Date(), days), 'yyyy-MM-dd')
      const to = format(new Date(), 'yyyy-MM-dd')

      try {
        const res = await fetch(`/api/salon/analytics?from=${from}&to=${to}`)
        const data = await res.json()
        setSummary(data.summary)
        setByProduct(data.byProduct ?? [])
        setByHour(data.byHour ?? [])
        setByDay(data.byDay ?? [])
        setByRunner(data.byRunner ?? [])
        setByDayOfWeek(data.byDayOfWeek ?? [])
        setMessage(data.message ?? null)
      } catch { setMessage('Error al cargar datos') }
      setLoading(false)
    }
    fetch_data()
  }, [period])

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-[#a39e97]" /></div>
  }

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Tiempos de Servicio</h2>
            <p className="section-label mt-0.5">Análisis de despacho del salón</p>
          </div>
          <div className="flex rounded-full bg-secondary p-0.5">
            {(['7', '14', '30'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                  period === p ? 'bg-[#006d5a] text-white' : 'text-muted-foreground'
                }`}
              >
                {p}d
              </button>
            ))}
          </div>
        </div>
      </FadeIn>

      {message && !summary ? (
        <FadeIn>
          <div className="flex flex-col items-center py-12 text-center">
            <Clock className="size-10 text-[#ebe6df]" />
            <p className="mt-4 text-sm font-medium text-[#a39e97]">{message}</p>
            <p className="mt-1 text-xs text-[#a39e97]/70">Los datos aparecerán cuando los runners marquen platos como servidos</p>
          </div>
        </FadeIn>
      ) : summary && (
        <>
          {/* KPIs */}
          <StaggerList className="grid grid-cols-2 gap-2.5" staggerDelay={0.04}>
            <StaggerItem>
              <div className="card-elevated rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <Clock className="size-3.5 text-[#006d5a]" />
                  <span className="section-label">Promedio</span>
                </div>
                <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#006d5a]">
                  <AnimatedNumber value={summary.avgMinutes} /> min
                </p>
                <p className="text-[10px] text-[#a39e97]">Mediana: {summary.medianMinutes} min</p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="card-elevated rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="size-3.5 text-[#006d5a]" />
                  <span className="section-label">En tiempo</span>
                </div>
                <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#006d5a]">
                  {summary.underTargetPct}%
                </p>
                <p className="text-[10px] text-[#a39e97]">{summary.underTarget20min} de {summary.totalDispatches} en ≤20 min</p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="card-elevated rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className={`size-3.5 ${summary.overTargetPct > 20 ? 'text-[#ea504c]' : 'text-[#d4943a]'}`} />
                  <span className="section-label">Con demora</span>
                </div>
                <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${summary.overTargetPct > 20 ? 'text-[#ea504c]' : 'text-[#d4943a]'}`}>
                  {summary.overTargetPct}%
                </p>
                <p className="text-[10px] text-[#a39e97]">{summary.overTarget25min} platos &gt;25 min</p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="card-elevated rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <Users className="size-3.5 text-[#8b5e34]" />
                  <span className="section-label">Despachos</span>
                </div>
                <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
                  <AnimatedNumber value={summary.totalDispatches} />
                </p>
                <p className="text-[10px] text-[#a39e97]">P90: {summary.p90Minutes} min</p>
              </div>
            </StaggerItem>
          </StaggerList>

          {/* Trend by day */}
          {byDay.length > 1 && (
            <FadeIn delay={0.1}>
              <ChartCard title="Demora promedio por día" subtitle="Minutos de despacho">
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={byDay} margin={{ left: -20, right: 8 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', fontSize: 11 }}
                      formatter={(v: number) => [`${v} min`, 'Promedio']}
                    />
                    <Bar dataKey="avg" fill="#006d5a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </FadeIn>
          )}

          {/* By hour */}
          {byHour.length > 1 && (
            <FadeIn delay={0.15}>
              <ChartCard title="Demora por hora" subtitle="¿Cuándo se demoran más?">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={byHour} margin={{ left: -20, right: 8 }}>
                    <XAxis dataKey="hour" tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', fontSize: 11 }}
                      formatter={(v: number) => [`${v} min`, 'Promedio']}
                    />
                    <Bar dataKey="avg" fill="#d4943a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </FadeIn>
          )}

          {/* Top slowest products */}
          {byProduct.length > 0 && (
            <FadeIn delay={0.2}>
              <div className="space-y-2">
                <span className="section-label">Platos más demorados</span>
                {byProduct.slice(0, 8).map((p, i) => (
                  <div key={p.name} className="flex items-center gap-3 rounded-xl bg-card border px-4 py-2.5">
                    <span className={`text-sm font-bold tabular-nums ${i < 3 ? 'text-[#ea504c]' : 'text-[#3d2c24]'}`}>
                      {p.avg} min
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#3d2c24] truncate">{p.name}</p>
                      <p className="text-[10px] text-[#a39e97]">{p.count} despachos · máx {p.max} min</p>
                    </div>
                    {i < 3 && <TrendingDown className="size-4 text-[#ea504c]" />}
                  </div>
                ))}
              </div>
            </FadeIn>
          )}

          {/* Runners ranking */}
          {byRunner.length > 0 && (
            <FadeIn delay={0.25}>
              <div className="space-y-2">
                <span className="section-label">Ranking runners</span>
                {byRunner.map((r, i) => (
                  <div key={r.name} className="flex items-center gap-3 rounded-xl bg-card border px-4 py-2.5">
                    <span className={`flex size-8 items-center justify-center rounded-full text-xs font-bold text-white ${
                      i === 0 ? 'bg-[#006d5a]' : i === 1 ? 'bg-[#8b5e34]' : 'bg-[#a39e97]'
                    }`}>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#3d2c24]">{r.name}</p>
                      <p className="text-[10px] text-[#a39e97]">{r.count} despachos</p>
                    </div>
                    <span className="text-sm font-bold tabular-nums text-[#3d2c24]">{r.avg} min</span>
                    {i === 0 && <Award className="size-4 text-[#006d5a]" />}
                  </div>
                ))}
              </div>
            </FadeIn>
          )}

          {/* By day of week */}
          {byDayOfWeek.length > 0 && (
            <FadeIn delay={0.3}>
              <div className="space-y-2">
                <span className="section-label">Por día de la semana</span>
                <div className="flex gap-1.5">
                  {byDayOfWeek.map(d => (
                    <div key={d.day} className="flex flex-1 flex-col items-center rounded-xl bg-card border py-2.5">
                      <span className="text-[9px] font-semibold text-[#a39e97]">{d.day}</span>
                      <span className={`mt-1 text-sm font-bold tabular-nums ${
                        d.avg > 25 ? 'text-[#ea504c]' : d.avg > 18 ? 'text-[#d4943a]' : 'text-[#006d5a]'
                      }`}>
                        {d.avg}
                      </span>
                      <span className="text-[8px] text-[#a39e97]">{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          )}
        </>
      )}
    </div>
  )
}
