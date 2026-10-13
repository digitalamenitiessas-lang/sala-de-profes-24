'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { ArrowLeft, Clock, Loader2, Package } from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { FadeIn } from '@/components/ui/motion'
import { lotTone, formatLotCountdown, formatQty } from '@/lib/stock/helpers'

type ExpiryLot = {
  id: number
  stock_item_name: string
  lot_code: string | null
  qty_remaining: number
  unit: string
  expires_at: string
  expires_in_days: number
}

type FilterKey = 'todos' | 'vencidos' | 'semana' | 'mes'

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'vencidos', label: 'Vencidos' },
  { key: 'semana', label: '7 días' },
  { key: 'mes', label: '30 días' },
]

function suggestedAction(expiresInDays: number): string {
  if (expiresInDays < 0) return 'Descartá y registrá la merma'
  if (expiresInDays <= 1) return 'Sacá promo HOY o usalo en producción'
  if (expiresInDays <= 3) return 'Planificá promo'
  return 'Monitoreá y planificá con tiempo'
}

export default function LotesPage() {
  const { profile } = useProfileContext()
  const [loading, setLoading] = useState(true)
  const [lots, setLots] = useState<ExpiryLot[]>([])
  const [filter, setFilter] = useState<FilterKey>('todos')
  const [summary, setSummary] = useState({ expired: 0, expiring_today: 0, expiring_window: 0 })
  const [migrationRequired, setMigrationRequired] = useState(false)

  const canManage = isManagerOrAbove(profile?.role)

  const fetchLots = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/stock/lots?window_days=60&limit=50')
      const data = await res.json()
      if (data.requires_migration) {
        setMigrationRequired(true)
        return
      }
      if (!res.ok) throw new Error(data.error ?? 'Error')
      const activeLots = ((data.lots as ExpiryLot[]) ?? []).filter((l) => l.qty_remaining > 0)
      setLots(activeLots)
      setSummary({
        expired: data.summary?.expired ?? 0,
        expiring_today: data.summary?.expiring_today ?? 0,
        expiring_window: data.summary?.expiring_window ?? 0,
      })
    } catch {
      setLots([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchLots() }, [fetchLots])

  const filtered = useMemo((): ExpiryLot[] => {
    switch (filter) {
      case 'vencidos': return lots.filter((l) => l.expires_in_days < 0)
      case 'semana': return lots.filter((l) => l.expires_in_days >= 0 && l.expires_in_days <= 7)
      case 'mes': return lots.filter((l) => l.expires_in_days >= 0 && l.expires_in_days <= 30)
      default: return lots
    }
  }, [lots, filter])

  if (!canManage) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-sm text-[#a39e97]">Solo encargados pueden ver esta pantalla</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-28">
      <FadeIn>
        <div className="flex items-center gap-3">
          <Link
            href="/stock"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-[#ebe6df] active:scale-95"
          >
            <ArrowLeft className="size-4 text-[#3d2c24]" />
          </Link>
          <div>
            <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Lotes por vencer</h1>
            <p className="section-label mt-0.5">Vida útil de productos elaborados</p>
          </div>
        </div>
      </FadeIn>

      {/* Chips de resumen */}
      {!loading && !migrationRequired && lots.length > 0 && (
        <FadeIn delay={0.02}>
          <div className="flex flex-wrap gap-2">
            {summary.expired > 0 && (
              <span className="rounded-full bg-[#fdecea] px-3 py-1 text-[12px] font-semibold text-[#ea504c]">
                {summary.expired} vencido{summary.expired !== 1 ? 's' : ''}
              </span>
            )}
            {summary.expiring_today > 0 && (
              <span className="rounded-full bg-[#fdf6ec] px-3 py-1 text-[12px] font-semibold text-[#d4943a]">
                {summary.expiring_today} vence hoy
              </span>
            )}
            {summary.expiring_window > 0 && (
              <span className="rounded-full bg-[#e8f5f1] px-3 py-1 text-[12px] font-semibold text-[#006d5a]">
                {summary.expiring_window} en 7 días
              </span>
            )}
          </div>
        </FadeIn>
      )}

      {/* Filtros */}
      <FadeIn delay={0.03}>
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'shrink-0 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-all',
                filter === f.key
                  ? 'bg-[#3d2c24] text-white'
                  : 'bg-white text-[#7d6c64] ring-1 ring-[#ebe6df] active:scale-95',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </FadeIn>

      {/* Contenido */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-[#006d5a]" />
        </div>
      ) : migrationRequired ? (
        <FadeIn>
          <div className="flex flex-col items-center py-12 text-center">
            <Clock className="size-10 text-[#ebe6df]" />
            <p className="mt-4 text-sm font-medium text-[#a39e97]">
              Todavía no hay lotes con fecha de vencimiento registrados
            </p>
            <p className="mt-1 text-xs text-[#a39e97]">
              Los lotes se crean desde producción cuando se indica vida útil
            </p>
          </div>
        </FadeIn>
      ) : filtered.length === 0 ? (
        <FadeIn>
          <div className="flex flex-col items-center py-12 text-center">
            <Clock className="size-10 text-[#ebe6df]" />
            <p className="mt-4 text-sm font-medium text-[#a39e97]">
              {lots.length === 0 ? 'No hay lotes con fecha de vencimiento' : 'Nada en este filtro'}
            </p>
          </div>
        </FadeIn>
      ) : (
        <FadeIn delay={0.05}>
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
            <div className="divide-y divide-[#f3efe9]">
              {filtered.map((lot) => {
                const tone = lotTone(lot.expires_in_days)
                const actionColor =
                  lot.expires_in_days < 0
                    ? '#ea504c'
                    : lot.expires_in_days <= 2
                      ? '#d4943a'
                      : '#7d6c64'
                return (
                  <div key={lot.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f3efe9]">
                      <Package className="size-4 text-[#7d6c64]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-sm font-medium text-[#3d2c24]">
                          {lot.stock_item_name}
                        </p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.pill}`}>
                          {formatLotCountdown(lot.expires_in_days)}
                        </span>
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[#a39e97]">
                        <span>Quedan {formatQty(lot.qty_remaining)} {lot.unit}</span>
                        {lot.lot_code && <span>· {lot.lot_code}</span>}
                        <span>· {format(new Date(lot.expires_at), 'd MMM yyyy', { locale: es })}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold" style={{ color: actionColor }}>
                        {suggestedAction(lot.expires_in_days)}
                      </p>
                    </div>
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
