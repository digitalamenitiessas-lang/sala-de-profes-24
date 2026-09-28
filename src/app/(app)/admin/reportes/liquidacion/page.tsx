'use client'

import { useState, useCallback } from 'react'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Clock, DollarSign, Download, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Loader2, AlertTriangle, Users,
} from 'lucide-react'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DayDetail = {
  date: string
  hours: number
  clockIn: string
  clockOut: string | null
  status: string
  clockOutType: string
  attendanceId?: string
}

type Employee = {
  id: string
  firstName: string
  lastName: string
  role: string
  hourlyRate: number
  totalHours: number
  totalDays: number
  avgHoursPerDay: number
  missingCheckouts: number
  totalPay: number
  days: DayDetail[]
}

type Summary = {
  totalEmployees: number
  totalHours: number
  totalDays: number
  totalPay: number
  missingCheckouts: number
}

const PERIOD_OPTIONS = [
  { key: '1q', label: '1° Quincena' },
  { key: '2q', label: '2° Quincena' },
  { key: 'mes', label: 'Mes completo' },
] as const

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LiquidacionPage() {
  const [refDate, setRefDate] = useState(new Date())
  const [periodType, setPeriodType] = useState<string>('mes')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const getPeriod = useCallback(() => {
    const monthStart = startOfMonth(refDate)
    const monthEnd = endOfMonth(refDate)
    if (periodType === '1q') {
      return {
        from: format(monthStart, 'yyyy-MM-dd'),
        to: format(new Date(refDate.getFullYear(), refDate.getMonth(), 15), 'yyyy-MM-dd'),
      }
    }
    if (periodType === '2q') {
      return {
        from: format(new Date(refDate.getFullYear(), refDate.getMonth(), 16), 'yyyy-MM-dd'),
        to: format(monthEnd, 'yyyy-MM-dd'),
      }
    }
    return { from: format(monthStart, 'yyyy-MM-dd'), to: format(monthEnd, 'yyyy-MM-dd') }
  }, [refDate, periodType])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { from, to } = getPeriod()
      const res = await fetch(`/api/admin/liquidacion?from=${from}&to=${to}`, { credentials: 'include' })
      const json = await res.json()
      if (json.employees) {
        setEmployees(json.employees)
        setSummary(json.summary)
        setLoaded(true)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [getPeriod])

  const formatMoney = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  // Export CSV with full detail
  const handleExport = () => {
    if (!employees.length) return
    const { from, to } = getPeriod()

    let csv = `LIQUIDACIÓN DE HABERES\n`
    csv += `Período: ${from} a ${to}\n`
    csv += `Generado: ${format(new Date(), "d 'de' MMMM yyyy HH:mm", { locale: es })}\n\n`

    // Summary
    csv += `RESUMEN\n`
    csv += `Total a pagar,${formatMoney(summary?.totalPay ?? 0)}\n`
    csv += `Horas totales,${summary?.totalHours ?? 0}h\n`
    csv += `Empleados,${summary?.totalEmployees ?? 0}\n`
    csv += `Jornadas,${summary?.totalDays ?? 0}\n`
    csv += `Sin egreso,${summary?.missingCheckouts ?? 0}\n\n`

    // Per employee
    csv += `DETALLE POR EMPLEADO\n`
    csv += `Nombre,Rol,Tarifa/h,Días,Horas,Promedio/día,Sin egreso,Total a pagar\n`
    for (const e of employees) {
      csv += `"${e.firstName} ${e.lastName}",${ROLES[e.role as AppRole]?.label ?? e.role},$${e.hourlyRate},${e.totalDays},${e.totalHours},${e.avgHoursPerDay},${e.missingCheckouts},"${formatMoney(e.totalPay)}"\n`
    }

    // Day by day for each employee
    csv += `\nDETALLE DÍA POR DÍA\n`
    csv += `Nombre,Fecha,Día,Ingreso,Egreso,Tipo egreso,Horas\n`
    for (const e of employees) {
      for (const d of e.days) {
        const dayName = format(new Date(d.date + 'T12:00:00'), 'EEEE', { locale: es })
        const typeLabel = d.clockOutType === 'auto' ? 'Automático' : d.clockOutType === 'edited' ? 'Editado' : 'Manual'
        csv += `"${e.firstName} ${e.lastName}",${d.date},"${dayName}",${d.clockIn},${d.clockOut ?? '-'},${typeLabel},${d.hours}\n`
      }
    }

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `liquidacion_${from}_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <FadeIn>
        <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Liquidación</h2>
        <p className="section-label mt-0.5">Cálculo de haberes por período</p>
      </FadeIn>

      {/* Controls */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={() => setRefDate(subMonths(refDate, 1))} className="icon-btn flex items-center justify-center rounded-xl bg-secondary">
            <ChevronLeft className="size-4" />
          </button>
          <p className="text-sm font-semibold capitalize text-[#3d2c24]">
            {format(refDate, 'MMMM yyyy', { locale: es })}
          </p>
          <button onClick={() => setRefDate(prev => { const n = new Date(prev); n.setMonth(n.getMonth() + 1); return n })} className="icon-btn flex items-center justify-center rounded-xl bg-secondary">
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="flex rounded-full bg-secondary p-0.5">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setPeriodType(opt.key)}
              className={`flex-1 rounded-full py-2 text-[11px] font-semibold transition-colors ${periodType === opt.key ? 'bg-[#006d5a] text-white' : 'text-muted-foreground'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] text-sm font-bold text-white transition-all hover:bg-[#005a4a] active:scale-[0.98] disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <DollarSign className="size-4" />}
          {loading ? 'Calculando...' : 'Calcular liquidación'}
        </button>
      </div>

      {/* ================================================================ */}
      {/* RESULTS */}
      {/* ================================================================ */}
      {summary && (
        <>
          {/* Hero: Total a pagar */}
          <FadeIn>
            <div className="rounded-2xl bg-[#006d5a] p-5 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Total a pagar</p>
                  <p className="mt-1 font-display text-3xl font-bold tabular-nums">{formatMoney(summary.totalPay)}</p>
                </div>
                <DollarSign className="size-8 text-white/20" />
              </div>
              <div className="mt-3 flex gap-4 text-xs text-white/60">
                <span>{summary.totalHours}h trabajadas</span>
                <span>·</span>
                <span>{summary.totalEmployees} personas</span>
                <span>·</span>
                <span>{summary.totalDays} jornadas</span>
              </div>
            </div>
          </FadeIn>

          {/* KPIs row */}
          <div className="grid grid-cols-3 gap-2">
            <div className="card-elevated rounded-xl p-3 text-center">
              <Clock className="mx-auto size-4 text-[#006d5a]" />
              <p className="mt-1 font-display text-lg font-bold tabular-nums text-[#3d2c24]">{summary.totalHours}h</p>
              <p className="text-[9px] text-[#a39e97]">Horas</p>
            </div>
            <div className="card-elevated rounded-xl p-3 text-center">
              <Users className="mx-auto size-4 text-[#8b5e34]" />
              <p className="mt-1 font-display text-lg font-bold tabular-nums text-[#3d2c24]">{summary.totalEmployees}</p>
              <p className="text-[9px] text-[#a39e97]">Empleados</p>
            </div>
            <div className={`card-elevated rounded-xl p-3 text-center ${summary.missingCheckouts > 0 ? 'border border-[#ea504c]/20' : ''}`}>
              <AlertTriangle className={`mx-auto size-4 ${summary.missingCheckouts > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]'}`} />
              <p className={`mt-1 font-display text-lg font-bold tabular-nums ${summary.missingCheckouts > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]'}`}>
                {summary.missingCheckouts || '✓'}
              </p>
              <p className="text-[9px] text-[#a39e97]">Sin egreso</p>
            </div>
          </div>

          {/* Chart: hours per employee */}
          {employees.length > 0 && (
            <FadeIn delay={0.1}>
              <div className="card-elevated rounded-2xl p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97] mb-3">Horas por empleado</p>
                <ResponsiveContainer width="100%" height={Math.max(employees.length * 36, 150)}>
                  <BarChart layout="vertical" data={employees.map(e => ({
                    name: `${e.firstName} ${e.lastName.charAt(0)}.`,
                    hours: e.totalHours,
                    pay: e.totalPay,
                    color: ROLES[e.role as AppRole]?.color ?? '#a39e97',
                  }))} margin={{ left: 0, right: 8, top: 0, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                    <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 11, fill: '#3d2c24' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                      formatter={(v: number, _name: string, props: { payload?: { pay?: number } }) => {
                        const pay = props.payload?.pay
                        return [`${v}h — ${pay ? formatMoney(pay) : ''}`, 'Horas']
                      }}
                    />
                    <Bar dataKey="hours" radius={[0, 6, 6, 0]}>
                      {employees.map((e, i) => (
                        <Cell key={i} fill={ROLES[e.role as AppRole]?.color ?? '#a39e97'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </FadeIn>
          )}

          {/* Export button */}
          <button
            onClick={handleExport}
            className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#006d5a] py-3 text-sm font-bold text-[#006d5a] transition-all hover:bg-[#e8f5f1] active:scale-[0.98]"
          >
            <Download className="size-4" />
            Descargar informe CSV
          </button>

          {/* ============================================================= */}
          {/* Employee detail cards */}
          {/* ============================================================= */}
          <div className="space-y-2">
            <span className="section-label">Detalle por empleado</span>
            {employees.map(emp => {
              const roleConfig = ROLES[emp.role as AppRole]
              const isExpanded = expandedId === emp.id

              return (
                <div key={emp.id} className="card-elevated overflow-hidden rounded-xl">
                  {/* Header row */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : emp.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <div
                      className="flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: roleConfig?.color ?? '#a39e97' }}
                    >
                      {emp.firstName[0]}{emp.lastName[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#3d2c24]">
                        {emp.firstName} {emp.lastName}
                      </p>
                      <p className="text-[11px] text-[#a39e97]">
                        {roleConfig?.emoji} {roleConfig?.label} · {formatMoney(emp.hourlyRate)}/h · {emp.totalDays} día{emp.totalDays !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <p className="text-base font-bold tabular-nums text-[#006d5a]">{formatMoney(emp.totalPay)}</p>
                        <p className="text-[10px] tabular-nums text-[#a39e97]">{emp.totalHours}h</p>
                      </div>
                      {isExpanded ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
                    </div>
                  </button>

                  {/* Expanded: daily detail + chart */}
                  {isExpanded && (
                    <div className="border-t bg-[#faf8f5]">
                      {/* Mini chart: hours per day */}
                      {emp.days.length > 1 && (
                        <div className="px-4 pt-3">
                          <ResponsiveContainer width="100%" height={80}>
                            <BarChart data={emp.days.map(d => ({
                              label: format(new Date(d.date + 'T12:00:00'), 'd', { locale: es }),
                              hours: d.hours,
                            }))} margin={{ left: -20, right: 4 }}>
                              <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                              <Bar dataKey="hours" fill={roleConfig?.color ?? '#006d5a'} radius={[3, 3, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {/* Day-by-day table */}
                      <div className="px-4 py-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">
                              <th className="pb-2 text-left">Fecha</th>
                              <th className="pb-2 text-center">Ingreso</th>
                              <th className="pb-2 text-center">Egreso</th>
                              <th className="pb-2 text-right">Horas</th>
                            </tr>
                          </thead>
                          <tbody>
                            {emp.days.map(d => {
                              const typeIcon = d.clockOutType === 'auto' ? ' ⏱' : d.clockOutType === 'edited' ? ' ✏️' : ''
                              return (
                                <tr key={d.date} className="border-t border-[#ebe6df]/50">
                                  <td className="py-1.5 capitalize text-[#3d2c24]">
                                    {format(new Date(d.date + 'T12:00:00'), 'EEE d MMM', { locale: es })}
                                  </td>
                                  <td className="py-1.5 text-center tabular-nums text-[#3d2c24]">{d.clockIn}</td>
                                  <td className={`py-1.5 text-center tabular-nums ${!d.clockOut ? 'text-[#ea504c] font-semibold' : 'text-[#3d2c24]'}`}>
                                    {d.clockOut ?? '—'}{typeIcon}
                                    {!d.clockOut && d.attendanceId && (
                                      <a
                                        href={`/equipo?date=${d.date}`}
                                        className="ml-1 inline-flex items-center text-[9px] text-[#4a90d9] underline"
                                      >
                                        Corregir
                                      </a>
                                    )}
                                  </td>
                                  <td className={`py-1.5 text-right tabular-nums font-semibold ${d.hours > 0 ? 'text-[#3d2c24]' : 'text-[#ea504c]'}`}>
                                    {d.hours > 0 ? `${d.hours}h` : '—'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 border-[#ebe6df]">
                              <td colSpan={3} className="py-2 text-sm font-bold text-[#3d2c24]">
                                {emp.totalHours}h × {formatMoney(emp.hourlyRate)}
                              </td>
                              <td className="py-2 text-right text-sm font-bold text-[#006d5a]">
                                {formatMoney(emp.totalPay)}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
