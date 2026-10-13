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
  /** Rol del turno de ese día ('mixto' si hizo dos turnos con roles distintos) */
  role: string
  pay: number
  /** Horas según el fichaje, antes de recortar al turno */
  hoursFichadas: number
  /** Nombre del feriado si ese día lo era (se paga 50% más) */
  feriado: string | null
  revisar?: boolean
  motivoRevisar?: string | null
}

type RolePay = { role: string; hours: number; hourlyRate: number; pay: number }

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
  byRole: RolePay[]
  horasFeriado: number
  /** Días con turno sin fichar y el motivo que anotó el encargado */
  ausencias: { fecha: string; motivo: string; etiqueta: string; nota: string | null }[]
  days: DayDetail[]
}

const rolLabel = (r: string) => (r === 'mixto' ? 'Mixto' : ROLES[r as AppRole]?.label ?? r)

type Summary = {
  totalEmployees: number
  totalHours: number
  totalDays: number
  totalPay: number
  missingCheckouts: number
  diasRevisar?: number
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
  const [feriados, setFeriados] = useState<{ fecha: string; nombre: string }[]>([])
  const [nuevoFeriado, setNuevoFeriado] = useState({ fecha: '', nombre: '' })
  const [guardandoFeriado, setGuardandoFeriado] = useState(false)
  const [bajandoPdf, setBajandoPdf] = useState(false)

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
        setFeriados(json.feriados ?? [])
        setLoaded(true)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [getPeriod])

  // PDF con el diseño de LVE (lo arma el servidor con la misma cuenta)
  const descargarPdf = useCallback(async () => {
    const { from, to } = getPeriod()
    setBajandoPdf(true)
    try {
      const res = await fetch(`/api/admin/liquidacion/pdf?from=${from}&to=${to}`, { credentials: 'include' })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'No se pudo generar el PDF')
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `Liquidacion LVE 24 y Maipu ${from} a ${to}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'No se pudo generar el PDF')
    } finally {
      setBajandoPdf(false)
    }
  }, [getPeriod])

  // Agrega o quita un feriado y recalcula la liquidación
  const cambiarFeriado = useCallback(async (accion: 'agregar' | 'quitar', fecha: string, nombre = '') => {
    setGuardandoFeriado(true)
    try {
      const res = await fetch('/api/admin/feriados', {
        method: accion === 'agregar' ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accion === 'agregar' ? { fecha, nombre } : { fecha }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? 'No se pudo guardar')
      setNuevoFeriado({ fecha: '', nombre: '' })
      await fetchData()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardandoFeriado(false)
    }
  }, [fetchData])

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
    csv += `Nombre,Rol del turno,Tarifa/h,Horas,Subtotal\n`
    for (const e of employees) {
      for (const r of e.byRole) {
        csv += `"${e.firstName} ${e.lastName}",${rolLabel(r.role)},$${r.hourlyRate},${r.hours},"${formatMoney(r.pay)}"\n`
      }
      csv += `"${e.firstName} ${e.lastName}",TOTAL (${e.totalDays} días; sin egreso: ${e.missingCheckouts}),,${e.totalHours},"${formatMoney(e.totalPay)}"\n`
    }

    // Ausencias con motivo
    if (employees.some(e => e.ausencias.length > 0)) {
      csv += `\nSIN FICHAR (MOTIVO)\n`
      csv += `Nombre,Fecha,Motivo,Detalle\n`
      for (const e of employees) {
        for (const a of e.ausencias) {
          csv += `"${e.firstName} ${e.lastName}",${a.fecha},${a.etiqueta},"${(a.nota ?? '').replace(/"/g, "'")}"\n`
        }
      }
    }

    // Day by day for each employee
    csv += `\nDETALLE DÍA POR DÍA\n`
    csv += `Nombre,Fecha,Día,Feriado,Rol del turno,Ingreso,Egreso,Tipo egreso,Horas fichadas,Horas pagas,A pagar\n`
    for (const e of employees) {
      for (const d of e.days) {
        const dayName = format(new Date(d.date + 'T12:00:00'), 'EEEE', { locale: es })
        const typeLabel = d.clockOutType === 'auto' ? 'Automático' : d.clockOutType === 'edited' ? 'Editado' : 'Manual'
        csv += `"${e.firstName} ${e.lastName}",${d.date},"${dayName}","${d.feriado ? `Sí (+50%): ${d.feriado}` : ''}",${rolLabel(d.role)},${d.clockIn},${d.clockOut ?? '-'},${typeLabel},${d.hoursFichadas},${d.hours},"${formatMoney(d.pay)}"\n`
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

          {(summary.diasRevisar ?? 0) > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-[#fef2f2] p-3 text-xs text-[#a3302d]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                <b>{summary.diasRevisar} día{summary.diasRevisar !== 1 ? 's' : ''} para revisar</b> (marcados en rojo en cada persona).
                Casi siempre es un turno mal cargado: se paga lo fichado, pero conviene corregir el turno en Turnos para que quede bien.
              </p>
            </div>
          )}

          {/* Reglas y feriados del período */}
          <div className="card-elevated space-y-2 rounded-xl p-3 text-xs text-[#5c4a42]">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Cómo se calcula</p>
            <p>
              Se paga desde el inicio del turno (llegar antes no suma) y hasta la salida, sin pasar el fin del turno
              salvo que el encargado haya corregido la salida (✏️ = horas extra autorizadas). Si el turno estaba mal
              cargado (trabajó en otro horario), se paga lo fichado. Licencias y ausencias no suman. Feriados: 50% más.
            </p>
            <div>
              <p className="mb-1 font-semibold text-[#3d2c24]">Feriados del período</p>
              {feriados.length === 0 && <p className="text-[#a39e97]">Ninguno.</p>}
              <ul className="space-y-0.5">
                {feriados.map(f => (
                  <li key={f.fecha} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 capitalize">{format(new Date(f.fecha + 'T12:00:00'), 'EEE d MMM', { locale: es })}</span>
                    <span className="flex-1 truncate">{f.nombre}</span>
                    <button
                      disabled={guardandoFeriado}
                      onClick={() => { if (window.confirm(`¿Quitar el feriado del ${f.fecha}?`)) void cambiarFeriado('quitar', f.fecha) }}
                      className="text-[10px] font-semibold text-[#ea504c] disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-1.5">
                <input
                  type="date"
                  value={nuevoFeriado.fecha}
                  onChange={e => setNuevoFeriado(v => ({ ...v, fecha: e.target.value }))}
                  className="rounded-lg border border-[#ebe6df] bg-white px-2 py-1 text-xs"
                />
                <input
                  value={nuevoFeriado.nombre}
                  onChange={e => setNuevoFeriado(v => ({ ...v, nombre: e.target.value }))}
                  placeholder="Ej: Batalla de Tucumán"
                  maxLength={120}
                  className="min-w-0 flex-1 rounded-lg border border-[#ebe6df] bg-white px-2 py-1 text-xs"
                />
                <button
                  disabled={guardandoFeriado || !nuevoFeriado.fecha || !nuevoFeriado.nombre.trim()}
                  onClick={() => void cambiarFeriado('agregar', nuevoFeriado.fecha, nuevoFeriado.nombre)}
                  className="rounded-lg bg-[#3d2c24] px-2.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  Agregar
                </button>
              </div>
            </div>
          </div>

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

          {/* Export buttons */}
          <button
            onClick={descargarPdf}
            disabled={bajandoPdf}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-3 text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {bajandoPdf ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {bajandoPdf ? 'Armando el PDF…' : 'Descargar PDF'}
          </button>
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
                        {emp.byRole.length > 1
                          ? emp.byRole.map((r) => `${rolLabel(r.role)} ${r.hours}h`).join(' · ')
                          : <>{roleConfig?.emoji} {rolLabel(emp.byRole[0]?.role ?? emp.role)} · {formatMoney(emp.byRole[0]?.hourlyRate ?? emp.hourlyRate)}/h</>}
                        {' · '}{emp.totalDays} día{emp.totalDays !== 1 ? 's' : ''}
                        {emp.ausencias.length > 0 && ` · ${emp.ausencias.length} ausencia${emp.ausencias.length !== 1 ? 's' : ''}`}
                        {emp.horasFeriado > 0 && ` · ${emp.horasFeriado}h en feriado`}
                        {emp.days.some(d => d.revisar) && <span className="font-semibold text-[#ea504c]">{` · ⚠️ ${emp.days.filter(d => d.revisar).length} a revisar`}</span>}
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

                      {/* Ausencias con motivo */}
                      {emp.ausencias.length > 0 && (
                        <div className="px-4 pt-3">
                          <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Sin fichar (motivo)</p>
                          <ul className="space-y-0.5 text-xs text-[#3d2c24]">
                            {emp.ausencias.map(a => (
                              <li key={a.fecha} className="flex gap-2">
                                <span className="w-20 shrink-0 capitalize text-[#7d6c64]">{format(new Date(a.fecha + 'T12:00:00'), 'EEE d MMM', { locale: es })}</span>
                                <span className="font-semibold text-[#3b6ab5]">{a.etiqueta}</span>
                                {a.nota && <span className="truncate italic text-[#7d6c64]">“{a.nota}”</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Day-by-day table */}
                      <div className="px-4 py-3">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">
                              <th className="pb-2 text-left">Fecha</th>
                              <th className="pb-2 text-left">Rol</th>
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
                                    {d.feriado && <span className="ml-1 rounded bg-[#fdf6ec] px-1 text-[9px] font-bold normal-case text-[#b0762a]" title={d.feriado}>Feriado +50%</span>}
                                    {d.revisar && <span className="block text-[9px] font-semibold normal-case text-[#ea504c]">⚠️ {d.motivoRevisar ?? 'Revisar'}</span>}
                                  </td>
                                  <td className={`py-1.5 ${d.role !== emp.role ? 'font-semibold text-[#b0762a]' : 'text-[#7d6c64]'}`}>{rolLabel(d.role)}</td>
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
                                    {Math.abs(d.hoursFichadas - d.hours) >= 0.1 && (
                                      <span className="block text-[9px] font-normal text-[#a39e97]" title="Se paga desde el inicio del turno y hasta su fin (salvo salida autorizada)">
                                        fichó {d.hoursFichadas}h
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                          <tfoot>
                            {emp.byRole.map((r, i) => (
                              <tr key={r.role} className={i === 0 ? 'border-t-2 border-[#ebe6df]' : ''}>
                                <td colSpan={4} className="pt-2 text-[12px] text-[#5c4a42]">
                                  {rolLabel(r.role)}: {r.hours}h × {formatMoney(r.hourlyRate)}
                                </td>
                                <td className="pt-2 text-right text-[12px] tabular-nums text-[#5c4a42]">{formatMoney(r.pay)}</td>
                              </tr>
                            ))}
                            <tr>
                              <td colSpan={4} className="py-2 text-sm font-bold text-[#3d2c24]">Total</td>
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
