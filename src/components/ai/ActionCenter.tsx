'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  Zap, ArrowRight, ChevronDown, ChevronUp,
  AlertTriangle, Clock, Info, Package, Truck,
  FolderOpen, Users, ShoppingCart, RefreshCw,
} from 'lucide-react'
import type { OperationalEvent, EventDomain, EventPriority } from '@/lib/events/operational-events'

type ActionCenterData = {
  events: OperationalEvent[]
  summary: { total: number; alta: number; media: number; baja: number }
}

const DOMAIN_ICONS: Record<EventDomain, typeof Package> = {
  stock: Package,
  proveedores: Truck,
  compras: ShoppingCart,
  expedientes: FolderOpen,
  turnos: Users,
  cocina: Package,
  avisos: Info,
}

const PRIORITY_CONFIG: Record<EventPriority, { dot: string; bg: string; text: string; Icon: typeof AlertTriangle }> = {
  alta: { dot: 'bg-[#ea504c]', bg: 'bg-[#fef2f2]', text: 'text-[#ea504c]', Icon: AlertTriangle },
  media: { dot: 'bg-[#d4943a]', bg: 'bg-[#fdf6ec]', text: 'text-[#d4943a]', Icon: Clock },
  baja: { dot: 'bg-[#006d5a]', bg: 'bg-[#e8f5f1]', text: 'text-[#006d5a]', Icon: Info },
}

type Props = {
  compact?: boolean // compact mode for Home
  maxItems?: number
}

export function ActionCenter({ compact = false, maxItems = 5 }: Props) {
  const [data, setData] = useState<ActionCenterData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const fetchEvents = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ai/action-center')
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  if (loading) {
    return (
      <div className="rounded-xl border border-[#d4943a]/10 bg-[#fdf6ec]/50 p-4">
        <div className="flex items-center gap-2">
          <Zap className="size-3.5 text-[#d4943a] animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#d4943a]">Cargando acciones...</span>
        </div>
        <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-[#d4943a]/10" />
      </div>
    )
  }

  if (!data || data.events.length === 0) return null

  const visible = data.events.slice(0, expanded ? maxItems * 2 : maxItems)
  const hasMore = data.events.length > visible.length

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="size-3.5 text-[#d4943a]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#3d2c24]">
            Acciones pendientes
          </span>
          {data.summary.alta > 0 && (
            <span className="rounded-full bg-[#ea504c] px-1.5 py-0.5 text-[9px] font-bold text-white">
              {data.summary.alta} urgente{data.summary.alta > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button onClick={fetchEvents} className="rounded-lg p-1.5 hover:bg-[#f3efe9]">
          <RefreshCw className="size-3 text-[#a39e97]" />
        </button>
      </div>

      {/* Events */}
      <div className="space-y-1.5">
        {visible.map((event) => {
          const pConfig = PRIORITY_CONFIG[event.priority]
          const DomainIcon = DOMAIN_ICONS[event.domain] ?? Info

          return (
            <Link
              key={event.id}
              href={event.href}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all hover:shadow-sm ${
                event.priority === 'alta'
                  ? 'border-[#ea504c]/20 bg-[#fef2f2]/50'
                  : event.priority === 'media'
                    ? 'border-[#d4943a]/15 bg-[#fdf6ec]/30'
                    : 'border-border/50 bg-card'
              }`}
            >
              {/* Priority dot */}
              <div className={`size-2 shrink-0 rounded-full ${pConfig.dot}`} />

              {/* Domain icon */}
              <div className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${pConfig.bg}`}>
                <DomainIcon className={`size-3.5 ${pConfig.text}`} />
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[#3d2c24] truncate">{event.title}</p>
                {!compact && event.suggested_action && (
                  <p className="text-[10px] text-[#a39e97] truncate">{event.suggested_action}</p>
                )}
              </div>

              <ArrowRight className="size-3 shrink-0 text-[#d1cdc7]" />
            </Link>
          )
        })}
      </div>

      {/* Expand / collapse */}
      {(hasMore || expanded) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 py-1 text-[10px] font-semibold text-[#006d5a] hover:underline"
        >
          {expanded ? (
            <><ChevronUp className="size-3" /> Menos</>
          ) : (
            <><ChevronDown className="size-3" /> {data.events.length - visible.length} más</>
          )}
        </button>
      )}
    </div>
  )
}
