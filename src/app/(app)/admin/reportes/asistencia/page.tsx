'use client'

import { useEffect, useState, useMemo } from 'react'
import { format, subDays, differenceInMinutes, parseISO } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Users, Clock, LogOut, TrendingUp, AlertTriangle,
  ChevronDown, ChevronUp, CalendarDays, Timer,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/skeleton'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { ChartCard } from '@/components/admin/ChartCard'
import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AttendanceLog = {
  user_id: string
  operative_date: string
  clock_in_at: string
  clock_out_at: string | null
  status: string
}

type Profile = {
  id: string
  first_name: string
  last_name: string
  role: string
}

type Shift = {
  user_id: string
  shift_date: string
  start_time: string
  end_time: string
}

type DailyData = { date: string; label: string; count: number; avgHours: number }

type EmployeeMetrics = {
  profile: Profile
  daysPresent: number
  daysScheduled: number
  totalHours: number
  avgHours: number
  missingCheckouts: number
  punctualityRate: number // % on time (within 15 min of shift start)
  lateArrivals: number
  dailyHours: { date: string; hours: number }[]
}

const PERIOD_OPTIONS = [
  { key: '7', label: '7 días' },
  { key: '14', label: '14 días' },
  { key: '30', label: '30 días' },
] as const

const PIE_COLORS = ['#006d5a', '#d4943a', '#ea504c', '#4a90d9']

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AsistenciaReportPage() {
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<string>('7')
  const [logs, setLogs] = useState<AttendanceLog[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null)

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      const supabase = createClient()
      const days = parseInt(period)
      const from = format(subDays(new Date(), days), 'yyyy-MM-dd')
      const to = format(new Date(), 'yyyy-MM-dd')

      const [logsRes, profilesRes, shiftsRes] = await Promise.all([
        supabase
          .from('attendance_logs')
          .select('user_id, operative_date, clock_in_at, clock_out_at, status')
          .gte('operative_date', from)
          .lte('operative_date', to),
        supabase
          .from('profiles')
          .select('id, first_name, last_name, role')
          .eq('is_active', true),
        supabase
          .from('shifts')
          .select('user_id, shift_date, start_time, end_time')
          .gte('shift_date', from)
          .lte('shift_date', to),
      ])

      setLogs(logsRes.data ?? [])
      setProfiles(profilesRes.data ?? [])
      setShifts(shiftsRes.data ?? [])
      setLoading(false)
    }
    fetchData()
  }, [period])

  // ---- Computed metrics ----

  // Global KPIs
  const globalKpis = useMemo(() => {
    let totalHours = 0
    let withHours = 0
    let missing = 0

    for (const log of logs) {
      if (log.clock_out_at) {
        const h = differenceInMinutes(parseISO(log.clock_out_at), parseISO(log.clock_in_at)) / 60
        totalHours += h
        withHours++
      }
      if ((log.status === 'open' || log.status === 'missing_checkout') && !log.clock_out_at) missing++
    }

    return {
      totalLogs: logs.length,
      uniqueEmployees: new Set(logs.map((l) => l.user_id)).size,
      avgHours: withHours > 0 ? Math.round((totalHours / withHours) * 10) / 10 : 0,
      totalHours: Math.round(totalHours * 10) / 10,
      missingCheckouts: missing,
    }
  }, [logs])

  // Daily chart data
  const dailyData = useMemo<DailyData[]>(() => {
    const map = new Map<string, { count: number; totalH: number; withH: number }>()
    for (const log of logs) {
      const d = log.operative_date
      if (!map.has(d)) map.set(d, { count: 0, totalH: 0, withH: 0 })
      const e = map.get(d)!
      e.count++
      if (log.clock_out_at) {
        e.totalH += differenceInMinutes(parseISO(log.clock_out_at), parseISO(log.clock_in_at)) / 60
        e.withH++
      }
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { count, totalH, withH }]) => ({
        date,
        label: format(new Date(date + 'T12:00:00'), 'EEE d', { locale: es }),
        count,
        avgHours: withH > 0 ? Math.round((totalH / withH) * 10) / 10 : 0,
      }))
  }, [logs])

  // Role distribution pie
  const roleDistribution = useMemo(() => {
    const map = new Map<string, number>()
    for (const log of logs) {
      const profile = profiles.find((p) => p.id === log.user_id)
      const role = profile?.role ?? 'otro'
      map.set(role, (map.get(role) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([role, count]) => ({
        name: ROLES[role as AppRole]?.label ?? role,
        value: count,
        role,
      }))
      .sort((a, b) => b.value - a.value)
  }, [logs, profiles])

  // Per-employee metrics
  const employeeMetrics = useMemo<EmployeeMetrics[]>(() => {
    const empMap = new Map<string, {
      days: Set<string>; totalH: number; missing: number; late: number; onTime: number
      dailyH: Map<string, number>
    }>()

    for (const log of logs) {
      if (!empMap.has(log.user_id)) {
        empMap.set(log.user_id, { days: new Set(), totalH: 0, missing: 0, late: 0, onTime: 0, dailyH: new Map() })
      }
      const e = empMap.get(log.user_id)!
      e.days.add(log.operative_date)

      let dayH = 0
      if (log.clock_out_at) {
        dayH = differenceInMinutes(parseISO(log.clock_out_at), parseISO(log.clock_in_at)) / 60
        e.totalH += dayH
      }
      e.dailyH.set(log.operative_date, (e.dailyH.get(log.operative_date) ?? 0) + dayH)

      if ((log.status === 'open' || log.status === 'missing_checkout') && !log.clock_out_at) e.missing++

      // Punctuality check against scheduled shift
      const shift = shifts.find((s) => s.user_id === log.user_id && s.shift_date === log.operative_date)
      if (shift) {
        const shiftStart = new Date(`${log.operative_date}T${shift.start_time}`)
        const clockIn = parseISO(log.clock_in_at)
        const diffMin = differenceInMinutes(clockIn, shiftStart)
        if (diffMin <= 15) {
          e.onTime++
        } else {
          e.late++
        }
      }
    }

    return profiles
      .filter((p) => empMap.has(p.id))
      .map((p) => {
        const e = empMap.get(p.id)!
        const scheduledDays = shifts.filter((s) => s.user_id === p.id).length
        const totalChecks = e.onTime + e.late
        return {
          profile: p,
          daysPresent: e.days.size,
          daysScheduled: scheduledDays,
          totalHours: Math.round(e.totalH * 10) / 10,
          avgHours: e.days.size > 0 ? Math.round((e.totalH / e.days.size) * 10) / 10 : 0,
          missingCheckouts: e.missing,
          punctualityRate: totalChecks > 0 ? Math.round((e.onTime / totalChecks) * 100) : 100,
          lateArrivals: e.late,
          dailyHours: Array.from(e.dailyH.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, hours]) => ({
              date: format(new Date(date + 'T12:00:00'), 'EEE d', { locale: es }),
              hours: Math.round(hours * 10) / 10,
            })),
        }
      })
      .sort((a, b) => b.totalHours - a.totalHours)
  }, [logs, profiles, shifts])

  if (loading) {
    return (
      <div className="space-y-4 pt-2">
        <Skeleton className="h-12 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /></div>
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Asistencia</h2>
            <p className="section-label mt-0.5">Métricas del equipo</p>
          </div>
          {/* Period selector */}
          <div className="flex rounded-full bg-secondary p-0.5">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setPeriod(opt.key)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                  period === opt.key
                    ? 'bg-[#006d5a] text-white'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </FadeIn>

      {/* KPI grid */}
      <StaggerList className="grid grid-cols-2 gap-3" staggerDelay={0.04}>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-4">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-[#e8f5f1]">
                <Users className="size-3.5 text-[#006d5a]" />
              </div>
              <span className="section-label">Marcaciones</span>
            </div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
              <AnimatedNumber value={globalKpis.totalLogs} />
            </p>
            <p className="text-[11px] text-[#a39e97]">{globalKpis.uniqueEmployees} empleados activos</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-4">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-[#faf0e4]">
                <Clock className="size-3.5 text-[#8b5e34]" />
              </div>
              <span className="section-label">Promedio</span>
            </div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
              {globalKpis.avgHours}h
            </p>
            <p className="text-[11px] text-[#a39e97]">por jornada</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-4">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-[#eef4fc]">
                <Timer className="size-3.5 text-[#4a90d9]" />
              </div>
              <span className="section-label">Horas Totales</span>
            </div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#3d2c24]">
              {globalKpis.totalHours}
            </p>
            <p className="text-[11px] text-[#a39e97]">en {period} días</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-4">
            <div className="flex items-center gap-2">
              <div className={`flex size-7 items-center justify-center rounded-lg ${globalKpis.missingCheckouts > 0 ? 'bg-[#fef2f2]' : 'bg-[#e8f5f1]'}`}>
                <LogOut className={`size-3.5 ${globalKpis.missingCheckouts > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]'}`} />
              </div>
              <span className="section-label">Sin egreso</span>
            </div>
            <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${globalKpis.missingCheckouts > 0 ? 'text-[#ea504c]' : 'text-[#3d2c24]'}`}>
              <AnimatedNumber value={globalKpis.missingCheckouts} />
            </p>
            <p className="text-[11px] text-[#a39e97]">pendientes</p>
          </div>
        </StaggerItem>
      </StaggerList>

      {/* Daily attendance chart */}
      {dailyData.length > 0 && (
        <FadeIn delay={0.1}>
          <ChartCard title="Asistencia diaria" subtitle="Marcaciones y horas promedio por día" isEmpty={dailyData.length === 0}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dailyData} margin={{ left: -20, right: 8 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any, name: any) => [
                    name === 'count' ? `${v} marcaciones` : `${v}h promedio`,
                    name === 'count' ? 'Asistencia' : 'Horas',
                  ]}
                />
                <Bar dataKey="count" fill="#006d5a" radius={[6, 6, 0, 0]} name="count" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </FadeIn>
      )}

      {/* Role distribution pie */}
      {roleDistribution.length > 1 && (
        <FadeIn delay={0.15}>
          <ChartCard title="Distribución por rol" subtitle="Marcaciones por rol en el período">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={roleDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {roleDistribution.map((entry, i) => (
                    <Cell
                      key={entry.role}
                      fill={ROLES[entry.role as AppRole]?.color ?? PIE_COLORS[i % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Legend
                  formatter={(value) => <span className="text-xs text-[#3d2c24]">{value}</span>}
                  iconType="circle"
                  iconSize={8}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [`${v} marcaciones`, '']}
                />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </FadeIn>
      )}

      {/* Employee cards — expandable */}
      {employeeMetrics.length > 0 && (
        <FadeIn delay={0.2}>
          <div className="space-y-2">
            <span className="section-label">Detalle por empleado</span>
            <div className="space-y-2">
              {employeeMetrics.map((emp) => {
                const roleConfig = ROLES[emp.profile.role as AppRole]
                const isExpanded = expandedEmployee === emp.profile.id
                const attendance = emp.daysScheduled > 0
                  ? Math.round((emp.daysPresent / emp.daysScheduled) * 100)
                  : null

                return (
                  <div key={emp.profile.id} className="card-elevated rounded-xl overflow-hidden">
                    {/* Summary row — always visible */}
                    <button
                      onClick={() => setExpandedEmployee(isExpanded ? null : emp.profile.id)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      {/* Avatar */}
                      <div
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: roleConfig?.color ?? '#a39e97' }}
                      >
                        {(emp.profile.first_name?.[0] ?? '')}{(emp.profile.last_name?.[0] ?? '')}
                      </div>

                      {/* Name + role */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[#3d2c24]">
                          {emp.profile.first_name} {emp.profile.last_name}
                        </p>
                        <p className="text-[11px] text-[#a39e97]">
                          {roleConfig?.emoji} {roleConfig?.label} · {emp.daysPresent} día{emp.daysPresent !== 1 ? 's' : ''}
                        </p>
                      </div>

                      {/* Quick stats */}
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-bold tabular-nums text-[#3d2c24]">{emp.totalHours}h</p>
                          <p className="text-[10px] text-[#a39e97]">~{emp.avgHours}h/día</p>
                        </div>

                        {/* Punctuality indicator */}
                        <div className={`flex size-8 items-center justify-center rounded-lg text-[10px] font-bold ${
                          emp.punctualityRate >= 80
                            ? 'bg-[#e8f5f1] text-[#006d5a]'
                            : emp.punctualityRate >= 50
                              ? 'bg-[#fdf6ec] text-[#d4943a]'
                              : 'bg-[#fef2f2] text-[#ea504c]'
                        }`}>
                          {emp.punctualityRate}%
                        </div>

                        {isExpanded ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t px-4 py-3 space-y-3">
                        {/* Stat pills */}
                        <div className="grid grid-cols-3 gap-2">
                          <div className="rounded-lg bg-[#f8f5f0] p-2.5 text-center">
                            <p className="text-[10px] font-medium text-[#a39e97]">Puntualidad</p>
                            <p className={`mt-0.5 text-sm font-bold ${
                              emp.punctualityRate >= 80 ? 'text-[#006d5a]' : emp.punctualityRate >= 50 ? 'text-[#d4943a]' : 'text-[#ea504c]'
                            }`}>
                              {emp.punctualityRate}%
                            </p>
                          </div>
                          <div className="rounded-lg bg-[#f8f5f0] p-2.5 text-center">
                            <p className="text-[10px] font-medium text-[#a39e97]">Llegadas tarde</p>
                            <p className={`mt-0.5 text-sm font-bold ${emp.lateArrivals > 0 ? 'text-[#d4943a]' : 'text-[#006d5a]'}`}>
                              {emp.lateArrivals}
                            </p>
                          </div>
                          <div className="rounded-lg bg-[#f8f5f0] p-2.5 text-center">
                            <p className="text-[10px] font-medium text-[#a39e97]">
                              {attendance !== null ? 'Asistencia' : 'Sin egreso'}
                            </p>
                            <p className={`mt-0.5 text-sm font-bold ${
                              emp.missingCheckouts > 0 ? 'text-[#ea504c]' : 'text-[#006d5a]'
                            }`}>
                              {attendance !== null ? `${attendance}%` : emp.missingCheckouts}
                            </p>
                          </div>
                        </div>

                        {/* Missing checkout warning */}
                        {emp.missingCheckouts > 0 && (
                          <div className="flex items-center gap-2 rounded-lg bg-[#fef2f2] px-3 py-2 text-xs text-[#ea504c]">
                            <AlertTriangle className="size-3.5" />
                            {emp.missingCheckouts} egreso{emp.missingCheckouts > 1 ? 's' : ''} sin marcar
                          </div>
                        )}

                        {/* Mini bar chart — hours per day */}
                        {emp.dailyHours.length > 0 && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97] mb-2">
                              Horas por día
                            </p>
                            <ResponsiveContainer width="100%" height={100}>
                              <BarChart data={emp.dailyHours} margin={{ left: -25, right: 4 }}>
                                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                                <Tooltip
                                  contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', fontSize: 11 }}
                                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [`${v}h`, 'Horas']}
                                />
                                <Bar dataKey="hours" fill={roleConfig?.color ?? '#006d5a'} radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  )
}
