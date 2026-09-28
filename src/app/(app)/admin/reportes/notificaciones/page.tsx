'use client'

import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Skeleton } from '@/components/ui/skeleton'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { ChartCard } from '@/components/admin/ChartCard'
import { ANNOUNCEMENT_TYPES, PRIORITIES } from '@/lib/constants'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

export default function NotificacionesReportPage() {
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [active, setActive] = useState(0)
  const [urgent, setUrgent] = useState(0)
  const [byType, setByType] = useState<{ name: string; count: number; color: string }[]>([])
  const [byPriority, setByPriority] = useState<{ name: string; count: number; color: string }[]>([])

  useEffect(() => {
    async function fetch() {
      const supabase = createClient()
      const { data: announcements } = await supabase
        .from('announcements')
        .select('type, priority, is_active, expires_at')

      if (!announcements) { setLoading(false); return }

      const now = new Date()
      const activeOnes = announcements.filter((a) => a.is_active && (!a.expires_at || new Date(a.expires_at) > now))
      const urgentOnes = activeOnes.filter((a) => a.priority === 'critica')

      setTotal(announcements.length)
      setActive(activeOnes.length)
      setUrgent(urgentOnes.length)

      // By type
      const typeMap = new Map<string, number>()
      for (const a of announcements) typeMap.set(a.type, (typeMap.get(a.type) ?? 0) + 1)
      setByType(
        Array.from(typeMap.entries()).map(([type, count]) => ({
          name: ANNOUNCEMENT_TYPES[type as keyof typeof ANNOUNCEMENT_TYPES]?.label ?? type,
          count,
          color: '#006d5a',
        })),
      )

      // By priority
      const prioMap = new Map<string, number>()
      for (const a of announcements) prioMap.set(a.priority, (prioMap.get(a.priority) ?? 0) + 1)
      setByPriority(
        Array.from(prioMap.entries()).map(([prio, count]) => ({
          name: PRIORITIES[prio as keyof typeof PRIORITIES]?.label ?? prio,
          count,
          color: PRIORITIES[prio as keyof typeof PRIORITIES]?.color ?? '#a39e97',
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
        <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Notificaciones</h2>
        <p className="section-label mt-1">Estado actual</p>
      </FadeIn>

      <StaggerList className="grid grid-cols-3 gap-3" staggerDelay={0.04}>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-3 text-center">
            <p className="font-display text-2xl font-bold tabular-nums text-[#3d2c24]"><AnimatedNumber value={total} /></p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[#a39e97]">Total</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="card-elevated rounded-xl p-3 text-center">
            <p className="font-display text-2xl font-bold tabular-nums text-[#006d5a]"><AnimatedNumber value={active} /></p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[#006d5a]">Activas</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="rounded-xl bg-[#fef2f2] p-3 text-center">
            <p className="font-display text-2xl font-bold tabular-nums text-[#ea504c]"><AnimatedNumber value={urgent} /></p>
            <p className="text-[10px] font-medium uppercase tracking-wider text-[#ea504c]">Urgentes</p>
          </div>
        </StaggerItem>
      </StaggerList>

      {byType.length > 0 && (
        <FadeIn delay={0.1}>
          <ChartCard title="Por tipo">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={byType} margin={{ left: -20, right: 8 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }} />
                <Bar dataKey="count" fill="#006d5a" radius={[6, 6, 0, 0]} name="Cantidad" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </FadeIn>
      )}

      {byPriority.length > 0 && (
        <FadeIn delay={0.15}>
          <div className="space-y-2">
            <span className="section-label">Por prioridad</span>
            <div className="flex flex-wrap gap-2">
              {byPriority.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
                  style={{ color: p.color, backgroundColor: `${p.color}15` }}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.name}: {p.count}
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  )
}
