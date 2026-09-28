'use client'

import { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ShieldAlert, MapPin, Smartphone, Clock, Check,
  AlertTriangle, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SuspiciousItem = {
  id: string
  user_id: string
  employee_name: string
  role: string
  operative_date: string
  clock_in_at: string
  clock_out_at: string | null
  status: string
  reasons: string[]
  lat: number | null
  lng: number | null
  device: string | null
  ip: string | null
}

// ---------------------------------------------------------------------------
// Reason badge
// ---------------------------------------------------------------------------

const REASON_LABELS: Record<string, { label: string; color: string; icon: typeof MapPin }> = {
  geo_fuera_rango: { label: 'Fuera de rango', color: 'bg-red-50 text-[#ea504c]', icon: MapPin },
  geo_fuera_rango_egreso: { label: 'Egreso fuera de rango', color: 'bg-red-50 text-[#ea504c]', icon: MapPin },
  sin_geolocalizacion_ingreso: { label: 'Sin GPS', color: 'bg-amber-50 text-[#d4943a]', icon: MapPin },
  dispositivo_nuevo: { label: 'Dispositivo nuevo', color: 'bg-amber-50 text-[#d4943a]', icon: Smartphone },
  jornada_excedida: { label: 'Jornada excedida', color: 'bg-red-50 text-[#ea504c]', icon: Clock },
}

function ReasonBadge({ reason }: { reason: string }) {
  const key = reason.split(':')[0]
  const detail = reason.split(':')[1]
  const meta = REASON_LABELS[key] ?? { label: key, color: 'bg-[#f5f2ee] text-[#3d2c24]', icon: AlertTriangle }
  const Icon = meta.icon

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', meta.color)}>
      <Icon className="size-3" />
      {meta.label}{detail ? ` (${detail})` : ''}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function FichajesSospechososPage() {
  const [items, setItems] = useState<SuspiciousItem[]>([])
  const [reasonSummary, setReasonSummary] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(7)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/attendance/suspicious?days=${days}`)
      if (res.ok) {
        const data = await res.json()
        setItems(data.items ?? [])
        setReasonSummary(data.reason_summary ?? {})
      }
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { load() }, [load])

  const handleDismiss = async (logId: string) => {
    const res = await fetch('/api/attendance/suspicious', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId }),
    })
    if (res.ok) {
      toast.success('Alerta descartada')
      setItems(prev => prev.filter(i => i.id !== logId))
    } else {
      toast.error('Error al descartar')
    }
  }

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  if (loading) return <LoadingState message="Cargando fichajes sospechosos..." />

  return (
    <div className="min-h-screen bg-[#faf8f5] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#ebe6df] bg-[#faf8f5]/95 backdrop-blur-md">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-red-50">
                <ShieldAlert className="size-4 text-[#ea504c]" strokeWidth={1.75} />
              </div>
              <h1 className="font-display text-lg font-bold text-[#3d2c24]">Fichajes Sospechosos</h1>
            </div>
            <button onClick={load} className="rounded-lg p-2 hover:bg-[#f5f2ee]">
              <RefreshCw className="size-4 text-[#a39e97]" />
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-4 space-y-4">
        {/* Period selector */}
        <div className="flex gap-2">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn(
                'rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors',
                days === d ? 'bg-[#006d5a] text-white' : 'bg-[#f5f2ee] text-[#3d2c24]',
              )}
            >
              {d} días
            </button>
          ))}
        </div>

        {/* KPI Summary */}
        <FadeIn>
          <div className="flex gap-2">
            <div className="flex-1 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-[#ebe6df]">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Alertas</p>
              <p className="mt-1 text-[22px] font-bold text-[#ea504c]">
                <AnimatedNumber value={items.length} decimals={0} />
              </p>
            </div>
            {Object.entries(reasonSummary).slice(0, 3).map(([key, count]) => (
              <div key={key} className="flex-1 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-[#ebe6df]">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                  {REASON_LABELS[key]?.label ?? key}
                </p>
                <p className="mt-1 text-[22px] font-bold text-[#d4943a]">
                  <AnimatedNumber value={count} decimals={0} />
                </p>
              </div>
            ))}
          </div>
        </FadeIn>

        {/* List */}
        {items.length === 0 ? (
          <EmptyState icon={Check} title="Todo limpio" description="No hay fichajes sospechosos en este período." />
        ) : (
          <StaggerList className="space-y-2.5">
            {items.map(item => (
              <StaggerItem key={item.id}>
                <div className="rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df] overflow-hidden">
                  <button
                    onClick={() => toggleExpand(item.id)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <div className="flex size-10 items-center justify-center rounded-lg bg-red-50">
                        <ShieldAlert className="size-4 text-[#ea504c]" />
                      </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#3d2c24]">{item.employee_name}</p>
                      <p className="text-xs text-[#a39e97]">
                        {format(new Date(item.operative_date + 'T12:00:00'), 'EEE d MMM', { locale: es })} — {format(new Date(item.clock_in_at), 'HH:mm')}
                        {item.clock_out_at ? ` / ${format(new Date(item.clock_out_at), 'HH:mm')}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-[#ea504c]">
                        {item.reasons.length}
                      </span>
                      {expanded.has(item.id) ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
                    </div>
                  </button>

                  {expanded.has(item.id) && (
                    <div className="border-t border-[#ebe6df] px-4 py-3 space-y-3">
                      {/* Reasons */}
                      <div className="flex flex-wrap gap-1.5">
                        {item.reasons.map((r, i) => <ReasonBadge key={i} reason={r} />)}
                      </div>

                      {/* Details grid */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><span className="text-[#a39e97]">Rol:</span> <span className="font-medium text-[#3d2c24]">{item.role}</span></div>
                        <div><span className="text-[#a39e97]">IP:</span> <span className="font-medium text-[#3d2c24]">{item.ip ?? 'N/A'}</span></div>
                        <div><span className="text-[#a39e97]">Dispositivo:</span> <span className="font-medium text-[#3d2c24]">{item.device?.slice(0, 12) ?? 'N/A'}</span></div>
                        <div><span className="text-[#a39e97]">GPS:</span> <span className="font-medium text-[#3d2c24]">{item.lat ? `${item.lat.toFixed(4)}, ${item.lng?.toFixed(4)}` : 'N/A'}</span></div>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => handleDismiss(item.id)}
                          className="flex-1 rounded-xl bg-[#f5f2ee] px-3 py-2 text-xs font-semibold text-[#3d2c24] transition-colors hover:bg-[#ebe6df]"
                        >
                          Descartar alerta
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </StaggerItem>
            ))}
          </StaggerList>
        )}
      </div>
    </div>
  )
}
