'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Loader2, RefreshCw, Truck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isManagerOrAbove } from '@/lib/roles'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { useVinculos } from '@/lib/hooks/use-vinculos'
import { AnimatedNumber } from '@/components/ui/motion'
import { ReviewTab } from './_components/ReviewTab'
import { ProductsTab } from './_components/ProductsTab'
import { CalendarTab } from './_components/CalendarTab'
import { ago } from './_components/shared'

// ---------------------------------------------------------------------------
// Vínculos con proveedores
// ---------------------------------------------------------------------------
// Qué insumo se le compra a quién. La evidencia sale de las compras reales en
// Fudo (módulo de gastos); encargados y socios confirman, corrigen o agregan.
// El proveedor principal de cada insumo es el que usan Pedidos y las
// sugerencias de "qué pedir hoy".
// ---------------------------------------------------------------------------

type Tab = 'revisar' | 'productos' | 'calendario'

export default function VinculosPage() {
  return (
    <Suspense fallback={<Centered><Loader2 className="size-6 animate-spin text-[#006d5a]" /></Centered>}>
      <Vinculos />
    </Suspense>
  )
}

function Vinculos() {
  const { profile, loading: profileLoading } = useProfileContext()
  const canManage = isManagerOrAbove(profile?.role)
  const params = useSearchParams()
  const { data, loading, error, syncing, syncFudo, apply, saveCalendar } = useVinculos(canManage)
  // Pestaña: la que eligió la persona, o la del link, o Revisar si hay algo
  // pendiente (si no, Productos).
  const [picked, setTab] = useState<Tab | null>((params.get('tab') as Tab) || null)
  const nothingToReview = !!data && data.review.conflicts.length + data.review.unlinked.length === 0
  const tab: Tab = picked ?? (nothingToReview ? 'productos' : 'revisar')

  if (profileLoading) return <Centered><Loader2 className="size-6 animate-spin text-[#006d5a]" /></Centered>
  if (!canManage) {
    return (
      <Centered>
        <Truck className="size-9 text-[#a39e97]" />
        <p className="mt-3 text-sm font-medium text-[#3d2c24]">Solo para encargados y socios</p>
      </Centered>
    )
  }

  const total = data?.items.length ?? 0
  const linked = data ? new Set(data.links.filter((l) => l.is_primary).map((l) => l.item_id)).size : 0
  const toReview = data ? data.review.conflicts.length + data.review.unlinked.length : 0
  const pct = total ? Math.round((linked / total) * 100) : 0

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'revisar', label: 'Revisar', count: toReview },
    { key: 'productos', label: 'Productos' },
    { key: 'calendario', label: 'Calendario', count: data?.review.calendar.length },
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-28 pt-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link href="/proveedores" aria-label="Volver" className="-ml-1.5 rounded-full p-1.5 hover:bg-black/5">
          <ArrowLeft className="size-5 text-[#3d2c24]" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold tracking-tight text-[#3d2c24]">Vínculos con proveedores</h1>
          <p className="text-[11.5px] text-[#a39e97]">Qué insumo se le compra a quién</p>
        </div>
        <button
          onClick={() => syncFudo({ force: true })}
          disabled={syncing}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11.5px] font-medium text-[#3d2c24] shadow-sm ring-1 ring-[#ebe6df] transition active:scale-95 disabled:opacity-70"
          title="Leer de nuevo las compras en Fudo"
        >
          {syncing
            ? <><Loader2 className="size-3.5 animate-spin text-[#006d5a]" /> Leyendo Fudo…</>
            : <>
                <span className={cn('size-1.5 rounded-full', data?.fudo.ok === false ? 'bg-[#d4943a]' : 'bg-[#006d5a]')} />
                {data?.fudo.last_sync_at ? `Fudo ${ago(data.fudo.last_sync_at)}` : 'Sync Fudo'}
                <RefreshCw className="size-3 text-[#a39e97]" />
              </>}
        </button>
      </div>

      {error && !data && (
        <div className="rounded-2xl bg-[#fef2f2] p-4 text-[13px] text-[#ea504c] ring-1 ring-[#ea504c]/20">{error}</div>
      )}

      {loading && !data ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-[#f3efe9]" />)}
        </div>
      ) : data && (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Con proveedor" tone="green">
              <AnimatedNumber value={pct} />%
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#e8f5f1]">
                <div className="h-1 rounded-full bg-[#006d5a] transition-all duration-700" style={{ width: `${pct}%` }} />
              </div>
            </Stat>
            <Stat label="A revisar" tone={toReview ? 'amber' : 'muted'}><AnimatedNumber value={toReview} /></Stat>
            <Stat label="Con varios" tone="muted">
              <AnimatedNumber value={new Set(data.links.filter((l) => !l.is_primary).map((l) => l.item_id)).size} />
            </Stat>
          </div>
          {data.fudo.ok === false && (
            <p className="rounded-xl bg-[#fef7ed] px-3 py-2 text-[11.5px] text-[#7d6c64]">
              Fudo no respondió a tiempo: se muestran los vínculos guardados, sin el ritmo de compra.
            </p>
          )}

          {/* Tabs */}
          <div className="sticky top-0 z-10 -mx-4 bg-[#fefcf9]/90 px-4 py-2 backdrop-blur">
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-[#f3efe9] p-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-xl py-2 text-[12.5px] font-semibold transition',
                    tab === t.key ? 'bg-white text-[#3d2c24] shadow-sm' : 'text-[#7d6c64]',
                  )}
                >
                  {t.label}
                  {!!t.count && (
                    <span className={cn('rounded-full px-1.5 text-[10px] font-bold', t.key === 'revisar' ? 'bg-[#d4943a] text-white' : 'bg-[#006d5a] text-white')}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {tab === 'revisar' && <ReviewTab data={data} apply={apply} />}
          {tab === 'productos' && <ProductsTab data={data} apply={apply} />}
          {tab === 'calendario' && <CalendarTab data={data} saveCalendar={saveCalendar} />}
        </>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center">{children}</div>
}

function Stat({ label, tone, children }: { label: string; tone: 'green' | 'amber' | 'muted'; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-[#ebe6df]">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#a39e97]">{label}</p>
      <div className={cn('mt-0.5 text-[20px] font-bold tabular-nums', tone === 'green' ? 'text-[#006d5a]' : tone === 'amber' ? 'text-[#d4943a]' : 'text-[#3d2c24]')}>
        {children}
      </div>
    </div>
  )
}
