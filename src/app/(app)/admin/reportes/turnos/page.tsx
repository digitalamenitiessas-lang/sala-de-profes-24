'use client'

import { useEffect, useState } from 'react'
import { format, subDays } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { CalendarDays } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/skeleton'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { ChartCard } from '@/components/admin/ChartCard'
import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

const ROLE_COLORS: Record<string, string> = {
  encargado: '#006d5a',
  chef: '#8b5e34',
  cocina: '#a85d32',
  barista: '#2d7d6a',
  runner: '#c67b4b',
}

export default function TurnosReportPage() {
  const [loading, setLoading] = useState(true)
  const [totalShifts, setTotalShifts] = useState(0)
  const [uniqueEmps, setUniqueEmps] = useState(0)
  const [byRole, setByRole] = useState<{ name: string; value: number; color: string }[]>([])
  const [daily, setDaily] = useState<{ date: string; count: number }[]>([])

  useEffect(() => {
    async function fetch() {
      const supabase = createClient()
      const from = format(subDays(new Date(), 7), 'yyyy-MM-dd')
      const to = format(new Date(), 'yyyy-MM-dd')

      const { data: shifts } = await supabase
        .from('shifts')
        .select('shift_date, shift_role, user_id')
        .gte('shift_date', from)
        .lte('shift_date', to)

      if (!shifts) { setLoading(false); return }

      setTotalShifts(shifts.length)
      setUniqueEmps(new Set(shifts.map((s) => s.user_id)).size)

      // By role
      const roleMap = new Map<string, number>()
      for (const s of shifts) {
        roleMap.set(s.shift_role, (roleMap.get(s.shift_role) ?? 0) + 1)
      }
      setByRole(
        Array.from(roleMap.entries()).map(([role, count]) => ({
          name: ROLES[role as AppRole]?.label ?? role,
          value: count,
          color: ROLE_COLORS[role] ?? '#a39e97',
        })),
      )

      // Daily
      const dayMap = new Map<string, number>()
      for (const s of shifts) {
        dayMap.set(s.shift_date, (dayMap.get(s.shift_date) ?? 0) + 1)
      }
      setDaily(
        Array.from(dayMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, count]) => ({
            date: format(new Date(date + 'T12:00:00'), 'EEE d', { locale: es }),
            count,
          })),
      )
      setLoading(false)
    }
    fetch()
  }, [])

  if (loading) {
    return <div className="space-y-4 pt-2"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /></div>
  }

  return (
    <div className="space-y-5">
      <FadeIn>
        <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Turnos</h2>
        <p className="section-label mt-1">Últimos 7 días</p>
      </FadeIn>

      <StaggerList className="grid grid-cols-2 gap-3" staggerDelay={0.04}>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-4">
            <div className="flex items-center gap-2"><CalendarDays className="size-3.5 text-[#8b5e34]" /><span className="section-label">Total turnos</span></div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#3d2c24]"><AnimatedNumber value={totalShifts} /></p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-4">
            <div className="flex items-center gap-2"><CalendarDays className="size-3.5 text-[#006d5a]" /><span className="section-label">Empleados</span></div>
            <p className="mt-2 font-display text-2xl font-bold tabular-nums text-[#3d2c24]"><AnimatedNumber value={uniqueEmps} /></p>
          </div>
        </StaggerItem>
      </StaggerList>

      {/* Daily chart */}
      {daily.length > 0 && (
        <FadeIn delay={0.1}>
          <ChartCard title="Turnos por día">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={daily} margin={{ left: -20, right: 8 }}>
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                <Bar dataKey="count" fill="#8b5e34" radius={[6, 6, 0, 0]} name="Turnos" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </FadeIn>
      )}

      {/* Role distribution */}
      {byRole.length > 0 && (
        <FadeIn delay={0.15}>
          <ChartCard title="Distribución por rol">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={byRole} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" stroke="none">
                  {byRole.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-3 text-xs">
              {byRole.map((r) => (
                <span key={r.name} className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                  {r.name} ({r.value})
                </span>
              ))}
            </div>
          </ChartCard>
        </FadeIn>
      )}
    </div>
  )
}
