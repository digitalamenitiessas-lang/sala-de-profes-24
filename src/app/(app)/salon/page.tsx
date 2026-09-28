'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Clock, AlertTriangle, CheckCircle, Bell, BellOff,
  RefreshCw, Loader2, Users, Coffee, UtensilsCrossed,
} from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { FadeIn } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SaleItem = {
  itemId: string
  name: string
  qty: number
  price: number
  createdAt: string
  served: boolean
  servedAt?: string
  minutesPending: number
}

type TableData = {
  saleId: string
  tableNumber: number | null
  saleType: string
  state: string
  total: number
  people: number | null
  createdAt: string
  minutesOpen: number
  minutesPending: number
  semaphore: 'green' | 'yellow' | 'red' | 'critical'
  items: SaleItem[]
  itemsTotal: number
  itemsServed: number
  itemsPending: number
}

type Counts = {
  total: number
  green: number
  yellow: number
  red: number
  critical: number
}

const SEMAPHORE = {
  green: { label: 'Normal', color: '#006d5a', bg: '#e8f5f1', border: '#006d5a', icon: '🟢' },
  yellow: { label: 'Atención', color: '#d4943a', bg: '#fdf6ec', border: '#d4943a', icon: '🟡' },
  red: { label: 'Demora', color: '#ea504c', bg: '#fef2f2', border: '#ea504c', icon: '🔴' },
  critical: { label: 'Urgente', color: '#b91c1c', bg: '#fef2f2', border: '#b91c1c', icon: '🚨' },
}

const REFRESH_INTERVAL = 30_000 // 30 seconds

// ---------------------------------------------------------------------------
// Alarm Sound
// ---------------------------------------------------------------------------

function playTableAlarm() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const playTone = (start: number, freq: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.2, start)
      gain.gain.exponentialRampToValueAtTime(0.01, start + dur)
      osc.start(start)
      osc.stop(start + dur)
    }
    // Two-tone alert: ding-dong
    playTone(ctx.currentTime, 660, 0.2)
    playTone(ctx.currentTime + 0.25, 880, 0.3)
  } catch { /* silent */ }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SalonPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [tables, setTables] = useState<TableData[]>([])
  const [counts, setCounts] = useState<Counts>({ total: 0, green: 0, yellow: 0, red: 0, critical: 0 })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [alarmsEnabled, setAlarmsEnabled] = useState(true)
  const [expandedSale, setExpandedSale] = useState<string | null>(null)
  const [markingServed, setMarkingServed] = useState(false)
  const prevRedCountRef = useRef(0)

  const canView = ['runner', 'encargado', 'socio'].includes(profile?.role ?? '')

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setSyncing(true)
    try {
      const res = await fetch('/api/salon')
      const data = await res.json()
      if (data.tables) {
        setTables(data.tables)
        setCounts(data.counts)
        setLastUpdate(data.timestamp)

        // Play alarm if new red/critical tables appeared
        if (alarmsEnabled) {
          const redTables = (data.tables as TableData[]).filter(
            t => (t.semaphore === 'red' || t.semaphore === 'critical') && !dismissed.has(t.saleId)
          )
          if (redTables.length > prevRedCountRef.current) {
            playTableAlarm()
          }
          prevRedCountRef.current = redTables.length
        }
      }
    } catch { /* silent */ }
    setLoading(false)
    setSyncing(false)
  }, [alarmsEnabled, dismissed])

  // Poll every 30 seconds
  useEffect(() => {
    if (!canView || profileLoading) return
    fetchData()
    const interval = setInterval(() => fetchData(), REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [canView, profileLoading, fetchData])

  const handleDismiss = (saleId: string) => {
    setDismissed(prev => new Set(prev).add(saleId))
  }

  // Mark specific item as served
  const handleMarkItem = async (saleId: string, itemId: string) => {
    setMarkingServed(true)
    try {
      await fetch('/api/salon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId, itemIds: [itemId] }),
      })
      fetchData()
    } catch { /* silent */ }
    setMarkingServed(false)
  }

  // Mark ALL items as served for a sale
  const handleMarkAllServed = async (saleId: string) => {
    setMarkingServed(true)
    try {
      await fetch('/api/salon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId, allServed: true }),
      })
      fetchData()
    } catch { /* silent */ }
    setMarkingServed(false)
  }

  if (profileLoading || loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-[#a39e97]" /></div>
  }

  if (!canView) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <UtensilsCrossed className="size-10 text-[#ebe6df]" />
        <p className="mt-4 text-sm font-medium text-[#a39e97]">Vista no disponible para tu rol</p>
      </div>
    )
  }

  const formatPrice = (n: number) => n > 0 ? `$${(n / 1000).toFixed(0)}k` : '$0'

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-28">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Salón</h1>
            <p className="section-label mt-0.5">
              {counts.total} mesa{counts.total !== 1 ? 's' : ''} activa{counts.total !== 1 ? 's' : ''}
              {lastUpdate && ` · ${format(new Date(lastUpdate), 'HH:mm')}`}
            </p>
          </div>
          <div className="flex gap-1.5">
            {/* Toggle alarms */}
            <button
              onClick={() => setAlarmsEnabled(!alarmsEnabled)}
              className={`flex size-10 items-center justify-center rounded-xl transition-colors ${
                alarmsEnabled ? 'bg-[#fef2f2] text-[#ea504c]' : 'bg-[#f3efe9] text-[#a39e97]'
              }`}
              title={alarmsEnabled ? 'Alarmas activadas' : 'Alarmas silenciadas'}
            >
              {alarmsEnabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
            </button>
            {/* Refresh */}
            <button
              onClick={() => fetchData(true)}
              disabled={syncing}
              className="flex size-10 items-center justify-center rounded-xl bg-[#e8f5f1] text-[#006d5a] disabled:opacity-50"
            >
              {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </button>
          </div>
        </div>
      </FadeIn>

      {/* Semaphore summary */}
      <FadeIn delay={0.05}>
        <div className="flex gap-2">
          {(['critical', 'red', 'yellow', 'green'] as const).map(level => {
            const s = SEMAPHORE[level]
            const count = counts[level]
            return (
              <div
                key={level}
                className="flex flex-1 flex-col items-center justify-center rounded-xl py-2.5"
                style={{ backgroundColor: count > 0 ? s.bg : '#f8f5f0' }}
              >
                <span className="text-sm">{s.icon}</span>
                <span
                  className="mt-0.5 text-lg font-bold tabular-nums"
                  style={{ color: count > 0 ? s.color : '#a39e97' }}
                >
                  {count}
                </span>
                <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: count > 0 ? s.color : '#a39e97' }}>
                  {s.label}
                </span>
              </div>
            )
          })}
        </div>
      </FadeIn>

      {/* Table cards */}
      {tables.length === 0 ? (
        <FadeIn delay={0.1}>
          <div className="flex flex-col items-center py-12 text-center">
            <Coffee className="size-10 text-[#ebe6df]" />
            <p className="mt-4 text-sm font-medium text-[#a39e97]">Sin mesas abiertas</p>
            <p className="mt-1 text-xs text-[#a39e97]/70">Las mesas activas de Fudo aparecerán acá</p>
          </div>
        </FadeIn>
      ) : (
        <div className="space-y-2">
          {tables.map(table => {
            const s = SEMAPHORE[table.semaphore]
            const isDismissed = dismissed.has(table.saleId)
            const isAlert = (table.semaphore === 'red' || table.semaphore === 'critical') && !isDismissed
            const isTakeaway = table.saleType === 'TAKEAWAY'
            const isExpanded = expandedSale === table.saleId
            const allServed = table.itemsPending === 0

            return (
              <FadeIn key={table.saleId}>
                <div
                  className={`rounded-xl border overflow-hidden transition-all ${
                    isAlert ? 'ring-2 shadow-md' : ''
                  } ${isDismissed || allServed ? 'opacity-60' : ''}`}
                  style={{
                    borderLeftWidth: 4,
                    borderLeftColor: allServed ? '#006d5a' : s.border,
                  }}
                >
                  {/* Header — tap to expand */}
                  <button
                    onClick={() => setExpandedSale(isExpanded ? null : table.saleId)}
                    className="flex w-full items-center gap-3 bg-card px-4 py-3 text-left"
                  >
                    {/* Table number */}
                    <div
                      className="flex size-12 shrink-0 flex-col items-center justify-center rounded-xl text-white"
                      style={{ backgroundColor: allServed ? '#006d5a' : s.color }}
                    >
                      {isTakeaway ? (
                        <>
                          <Coffee className="size-4" />
                          <span className="text-[7px] font-bold mt-0.5">TAKE</span>
                        </>
                      ) : (
                        <>
                          <span className="text-lg font-bold tabular-nums leading-none">
                            {table.tableNumber ?? '?'}
                          </span>
                          <span className="text-[7px] font-semibold mt-0.5">MESA</span>
                        </>
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {allServed ? (
                          <span className="text-sm font-bold text-[#006d5a]">✓ Servida</span>
                        ) : (
                          <span className="text-sm font-bold text-[#3d2c24]">
                            {table.minutesPending} min
                          </span>
                        )}
                        {!allServed && (
                          <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ color: s.color, backgroundColor: s.bg }}>
                            {s.label}
                          </span>
                        )}
                        {table.state === 'PAYMENT-PROCESS' && (
                          <span className="rounded-full bg-[#eef4fc] px-2 py-0.5 text-[9px] font-bold text-[#4a90d9]">Por cobrar</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#a39e97]">
                        <span>{formatPrice(table.total)}</span>
                        <span>· {table.itemsServed}/{table.itemsTotal} servidos</span>
                        <span>· {format(new Date(table.createdAt), 'HH:mm')}</span>
                      </div>
                    </div>

                    {/* Alert action */}
                    {isAlert && !allServed && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDismiss(table.saleId) }}
                        className="flex shrink-0 items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[10px] font-bold text-white active:scale-95"
                      >
                        <CheckCircle className="size-3" />
                        Avisé
                      </button>
                    )}
                  </button>

                  {/* Critical warning */}
                  {table.semaphore === 'critical' && !isDismissed && !allServed && (
                    <div className="flex items-center gap-2 bg-[#b91c1c] px-4 py-1.5 text-[10px] font-bold text-white animate-pulse">
                      <AlertTriangle className="size-3" />
                      Demora crítica — intervención necesaria
                    </div>
                  )}

                  {/* Expanded: items list */}
                  {isExpanded && (
                    <div className="border-t bg-[#faf8f5]">
                      <div className="divide-y divide-[#ebe6df]/50">
                        {table.items.map(item => (
                          <div
                            key={item.itemId}
                            className={`flex items-center gap-2.5 px-4 py-2 ${item.served ? 'opacity-50' : ''}`}
                          >
                            {/* Serve toggle */}
                            <button
                              onClick={() => !item.served && !markingServed && handleMarkItem(table.saleId, item.itemId)}
                              disabled={item.served || markingServed}
                              className={`size-6 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors ${
                                item.served ? 'border-[#006d5a] bg-[#006d5a] text-white' : 'border-[#ebe6df] bg-white hover:border-[#006d5a]'
                              }`}
                            >
                              {item.served && <CheckCircle className="size-3.5" />}
                            </button>

                            {/* Item info */}
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm ${item.served ? 'line-through text-[#a39e97]' : 'font-medium text-[#3d2c24]'}`}>
                                {item.name} {item.qty > 1 ? `x${item.qty}` : ''}
                              </p>
                            </div>

                            {/* Time */}
                            <div className="shrink-0 text-right">
                              {item.served ? (
                                <span className="text-[10px] text-[#006d5a] font-semibold">Servido</span>
                              ) : (
                                <span className={`text-[10px] font-bold tabular-nums ${
                                  item.minutesPending > 25 ? 'text-[#ea504c]' : item.minutesPending > 15 ? 'text-[#d4943a]' : 'text-[#a39e97]'
                                }`}>
                                  {item.minutesPending} min
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Mark all served button */}
                      {table.itemsPending > 0 && (
                        <div className="p-3">
                          <button
                            onClick={() => handleMarkAllServed(table.saleId)}
                            disabled={markingServed}
                            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-2.5 text-xs font-bold text-white active:scale-[0.98] disabled:opacity-50"
                          >
                            <CheckCircle className="size-3.5" />
                            Todo listo
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </FadeIn>
            )
          })}
        </div>
      )}
    </div>
  )
}
