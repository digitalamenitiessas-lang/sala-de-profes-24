'use client'

import { useEffect, useState, useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import Link from 'next/link'
import {
  Camera, ArrowUpDown, ArrowLeft, TrendingDown, TrendingUp, Minus,
  Package, Wine, Loader2, Calendar, ChevronDown,
} from 'lucide-react'
import { isManagerOrAbove } from '@/lib/roles'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { toast } from 'sonner'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StockSnapshot = {
  id: number
  snapshot_date: string
  snapshot_type: string
  label: string | null
  total_items: number
  total_qty: number
  critical_count: number
  created_at: string
  items?: { id: number; name: string; category: string; current_qty: number; min_qty: number; unit: string }[]
}

type VajillaSnapshot = {
  id: number
  snapshot_date: string
  label: string | null
  total_pieces: number
  created_at: string
  items?: { id: number; item_name: string; category: string; quantity: number; notes: string | null }[]
}

type CompareItem = {
  name: string
  before: number
  after: number
  diff: number
  unit?: string
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function StockHistorialPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [loading, setLoading] = useState(true)
  const [stockSnapshots, setStockSnapshots] = useState<StockSnapshot[]>([])
  const [vajillaSnapshots, setVajillaSnapshots] = useState<VajillaSnapshot[]>([])
  const [takingSnapshot, setTakingSnapshot] = useState(false)
  const [tab, setTab] = useState<'stock' | 'vajilla'>('stock')
  const [expandedSnapshot, setExpandedSnapshot] = useState<number | null>(null)
  const [expandedItems, setExpandedItems] = useState<Record<string, unknown>[] | null>(null)
  const [loadingExpand, setLoadingExpand] = useState(false)
  const [compareA, setCompareA] = useState<number | null>(null)
  const [compareB, setCompareB] = useState<number | null>(null)
  const [compareData, setCompareData] = useState<CompareItem[] | null>(null)
  const [loadingCompare, setLoadingCompare] = useState(false)

  const canEdit = isManagerOrAbove(profile?.role)

  // Fetch snapshots list
  useEffect(() => {
    if (profileLoading) return
    async function fetch() {
      try {
        const res = await window.fetch('/api/stock/snapshot')
        const data = await res.json()
        setStockSnapshots(data.stock ?? [])
        setVajillaSnapshots(data.vajilla ?? [])
      } catch { /* ignore */ }
      setLoading(false)
    }
    fetch()
  }, [profileLoading])

  // Take snapshot
  const takeSnapshot = async (source: 'stock' | 'vajilla') => {
    setTakingSnapshot(true)
    try {
      const res = await window.fetch('/api/stock/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'audit',
          label: `Auditoría ${format(new Date(), "d 'de' MMM yyyy", { locale: es })}`,
          source,
        }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Snapshot de ${source === 'vajilla' ? 'vajilla' : 'stock'} guardado`)
        // Refresh
        const listRes = await window.fetch('/api/stock/snapshot')
        const listData = await listRes.json()
        setStockSnapshots(listData.stock ?? [])
        setVajillaSnapshots(listData.vajilla ?? [])
      } else {
        toast.error(data.error || 'Error al guardar')
      }
    } catch {
      toast.error('Error de conexión')
    }
    setTakingSnapshot(false)
  }

  // Compare two snapshots
  const runComparison = async () => {
    if (compareA === null || compareB === null) return
    setLoadingCompare(true)

    const table = tab === 'vajilla' ? 'vajilla_snapshots' : 'stock_snapshots'

    const [resA, resB] = await Promise.all([
      window.fetch(`/api/stock/snapshot?table=${table}&id=${compareA}`).then((r) => r.json()),
      window.fetch(`/api/stock/snapshot?table=${table}&id=${compareB}`).then((r) => r.json()),
    ])

    const itemsA = (resA.items ?? []) as Record<string, unknown>[]
    const itemsB = (resB.items ?? []) as Record<string, unknown>[]

    const nameKey = tab === 'vajilla' ? 'item_name' : 'name'
    const qtyKey = tab === 'vajilla' ? 'quantity' : 'current_qty'

    // Build map A
    const mapA = new Map<string, number>()
    for (const item of itemsA) {
      mapA.set(String(item[nameKey] ?? ''), Number(item[qtyKey] ?? 0))
    }

    // Build comparison
    const result: CompareItem[] = []
    const seen = new Set<string>()

    for (const item of itemsB) {
      const name = String(item[nameKey] ?? '')
      const after = Number(item[qtyKey] ?? 0)
      const before = mapA.get(name) ?? 0
      result.push({ name, before, after, diff: after - before, unit: tab === 'stock' ? String(item.unit ?? '') : 'pzas' })
      seen.add(name)
    }

    // Items only in A (removed)
    for (const item of itemsA) {
      const name = String(item[nameKey] ?? '')
      if (!seen.has(name)) {
        result.push({ name, before: Number(item[qtyKey] ?? 0), after: 0, diff: -Number(item[qtyKey] ?? 0), unit: tab === 'stock' ? String(item.unit ?? '') : 'pzas' })
      }
    }

    // Sort by diff (biggest losses first)
    result.sort((a, b) => a.diff - b.diff)
    setCompareData(result)
    setLoadingCompare(false)
  }

  const snapshots = tab === 'stock' ? stockSnapshots : vajillaSnapshots

  // Summary of comparison
  const compareSummary = useMemo(() => {
    if (!compareData) return null
    const gains = compareData.filter((i) => i.diff > 0)
    const losses = compareData.filter((i) => i.diff < 0)
    const unchanged = compareData.filter((i) => i.diff === 0)
    return { gains: gains.length, losses: losses.length, unchanged: unchanged.length }
  }, [compareData])

  if (profileLoading || loading) return <LoadingState />

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-28">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center gap-3">
          <Link href="/stock" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
            <ArrowLeft className="size-4 text-[#3d2c24]" />
          </Link>
          <div>
            <h1 className="font-display text-2xl tracking-tight text-[#3d2c24]">Historial de Stock</h1>
            <p className="section-label mt-0.5">Fotos diarias del stock</p>
          </div>
        </div>

        {/* Para qué sirve esto, dicho en una línea, y el link a la respuesta. */}
        <div className="mt-3 rounded-2xl bg-[#faf8f5] px-4 py-3 ring-1 ring-[#ebe6df]">
          <p className="text-[12px] leading-relaxed text-[#7d6c64]">
            Todas las noches a las 3 se guarda sola una foto del stock. Sirven para una cosa:
            comparar dos días y ver <b className="text-[#3d2c24]">qué desapareció sin venta</b>
            {' '}(stock de ayer + lo que entró − lo vendido − stock de hoy). Eso es la merma no explicada.
          </p>
          {canEdit && (
            <Link
              href="/admin/mermas"
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#ea504c]"
            >
              Ver la merma valorizada en pesos →
            </Link>
          )}
        </div>
      </FadeIn>

      {/* Tab toggle */}
      <div className="flex gap-1 rounded-xl bg-secondary p-1">
        <button
          onClick={() => { setTab('stock'); setCompareA(null); setCompareB(null); setCompareData(null) }}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all ${
            tab === 'stock' ? 'bg-[#006d5a] text-white shadow-sm' : 'text-[#a39e97]'
          }`}
        >
          <Package className="size-4" /> Stock
        </button>
        <button
          onClick={() => { setTab('vajilla'); setCompareA(null); setCompareB(null); setCompareData(null) }}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-all ${
            tab === 'vajilla' ? 'bg-[#006d5a] text-white shadow-sm' : 'text-[#a39e97]'
          }`}
        >
          <Wine className="size-4" /> Vajilla
        </button>
      </div>

      {/* Take snapshot button */}
      {canEdit && (
        <FadeIn delay={0.05}>
          <Button
            onClick={() => takeSnapshot(tab)}
            disabled={takingSnapshot}
            className="w-full gap-2 rounded-xl bg-[#006d5a] py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#005a4a]"
          >
            {takingSnapshot ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
            Tomar snapshot de {tab === 'vajilla' ? 'vajilla' : 'stock'}
          </Button>
        </FadeIn>
      )}

      {/* Snapshots list */}
      {snapshots.length === 0 ? (
        <EmptyState
          icon={Camera}
          title="Sin snapshots"
          description={`Tomá el primer snapshot de ${tab} para empezar a comparar.`}
          {...(canEdit ? { actionLabel: 'Tomar snapshot', actionOnClick: () => takeSnapshot(tab) } : {})}
        />
      ) : (
        <FadeIn delay={0.1}>
          <div className="space-y-3">
            <p className="section-label">{snapshots.length} snapshot{snapshots.length > 1 ? 's' : ''}</p>

            {/* Compare selector */}
            <div className="card-elevated rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ArrowUpDown className="size-4 text-[#006d5a]" />
                <span className="text-sm font-semibold text-[#3d2c24]">Comparar auditorías</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Antes</label>
                  <select
                    value={compareA ?? ''}
                    onChange={(e) => { setCompareA(e.target.value ? Number(e.target.value) : null); setCompareData(null) }}
                    className="mt-1 w-full rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-xs text-[#3d2c24]"
                  >
                    <option value="">Seleccionar...</option>
                    {snapshots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {format(new Date(s.snapshot_date + 'T12:00:00'), "d MMM yyyy", { locale: es })}
                        {s.label ? ` — ${s.label}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Después</label>
                  <select
                    value={compareB ?? ''}
                    onChange={(e) => { setCompareB(e.target.value ? Number(e.target.value) : null); setCompareData(null) }}
                    className="mt-1 w-full rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-xs text-[#3d2c24]"
                  >
                    <option value="">Seleccionar...</option>
                    {snapshots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {format(new Date(s.snapshot_date + 'T12:00:00'), "d MMM yyyy", { locale: es })}
                        {s.label ? ` — ${s.label}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {compareA !== null && compareB !== null && compareA !== compareB && (
                <Button
                  onClick={runComparison}
                  disabled={loadingCompare}
                  className="w-full gap-2 rounded-lg bg-[#3d2c24] py-2 text-xs font-semibold text-white"
                >
                  {loadingCompare ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUpDown className="size-3.5" />}
                  Comparar
                </Button>
              )}
            </div>

            {/* Comparison results */}
            {compareData && compareSummary && (
              <FadeIn>
                <div className="space-y-2">
                  {/* Summary pills */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-lg bg-[#fef2f2] p-2.5 text-center">
                      <TrendingDown className="mx-auto size-4 text-[#ea504c]" />
                      <p className="mt-1 text-sm font-bold text-[#ea504c]">{compareSummary.losses}</p>
                      <p className="text-[10px] text-[#ea504c]">bajaron</p>
                    </div>
                    <div className="rounded-lg bg-[#f3efe9] p-2.5 text-center">
                      <Minus className="mx-auto size-4 text-[#a39e97]" />
                      <p className="mt-1 text-sm font-bold text-[#a39e97]">{compareSummary.unchanged}</p>
                      <p className="text-[10px] text-[#a39e97]">igual</p>
                    </div>
                    <div className="rounded-lg bg-[#e8f5f1] p-2.5 text-center">
                      <TrendingUp className="mx-auto size-4 text-[#006d5a]" />
                      <p className="mt-1 text-sm font-bold text-[#006d5a]">{compareSummary.gains}</p>
                      <p className="text-[10px] text-[#006d5a]">subieron</p>
                    </div>
                  </div>

                  {/* Item-by-item diff */}
                  <div className="space-y-1">
                    {compareData.filter((i) => i.diff !== 0).map((item) => (
                      <div
                        key={item.name}
                        className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 ring-1 ring-[#ebe6df]/60"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#3d2c24]">{item.name}</p>
                          <p className="text-[10px] text-[#a39e97]">{item.before} → {item.after} {item.unit}</p>
                        </div>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                          item.diff < 0
                            ? 'bg-[#fef2f2] text-[#ea504c]'
                            : 'bg-[#e8f5f1] text-[#006d5a]'
                        }`}>
                          {item.diff > 0 ? '+' : ''}{item.diff}
                        </span>
                      </div>
                    ))}
                    {compareData.filter((i) => i.diff !== 0).length === 0 && (
                      <p className="py-4 text-center text-sm text-[#a39e97]">Sin diferencias entre los dos snapshots</p>
                    )}
                  </div>
                </div>
              </FadeIn>
            )}

            {/* Snapshot timeline — expandable */}
            <p className="section-label mt-4">Registro de auditorías</p>
            <StaggerList className="space-y-2" staggerDelay={0.03}>
              {snapshots.map((s) => {
                const isStock = tab === 'stock'
                const ss = s as StockSnapshot & VajillaSnapshot
                const isExpanded = expandedSnapshot === s.id

                const toggleExpand = async () => {
                  if (isExpanded) {
                    setExpandedSnapshot(null)
                    setExpandedItems(null)
                    return
                  }
                  setExpandedSnapshot(s.id)
                  setLoadingExpand(true)
                  try {
                    const table = tab === 'vajilla' ? 'vajilla_snapshots' : 'stock_snapshots'
                    const res = await window.fetch(`/api/stock/snapshot?table=${table}&id=${s.id}`)
                    const json = await res.json()
                    const rawItems = json.items ?? []
                    setExpandedItems(Array.isArray(rawItems) ? rawItems : [])
                  } catch { setExpandedItems([]) }
                  setLoadingExpand(false)
                }

                return (
                  <StaggerItem key={s.id}>
                    <div className="card-elevated overflow-hidden rounded-xl">
                      {/* Header — clickable */}
                      <button
                        onClick={toggleExpand}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left"
                      >
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#f0f7f5]">
                          <Calendar className="size-4 text-[#006d5a]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-[#3d2c24]">
                            {format(new Date(s.snapshot_date + 'T12:00:00'), "d 'de' MMMM yyyy", { locale: es })}
                          </p>
                          <p className="text-[11px] text-[#a39e97]">
                            {s.label ?? (isStock ? `${ss.total_items} items` : `${ss.total_pieces} piezas`)}
                            {isStock && ss.critical_count > 0 && (
                              <span className="ml-1 font-bold text-[#ea504c]">· {ss.critical_count} críticos</span>
                            )}
                          </p>
                        </div>
                        <ChevronDown className={`size-4 shrink-0 text-[#a39e97] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>

                      {/* Expanded items list */}
                      {isExpanded && (
                        <div className="border-t border-[#ebe6df]/60 px-4 py-3">
                          {loadingExpand ? (
                            <div className="flex justify-center py-4"><Loader2 className="size-5 animate-spin text-[#006d5a]" /></div>
                          ) : !expandedItems || expandedItems.length === 0 ? (
                            <p className="py-3 text-center text-xs text-[#a39e97]">Sin datos en este snapshot</p>
                          ) : (
                            <div className="space-y-0.5 max-h-[50vh] overflow-y-auto">
                              {expandedItems.map((item, idx) => {
                                const name = String(tab === 'vajilla' ? item.item_name : item.name) || '—'
                                const qty = Number(tab === 'vajilla' ? item.quantity : item.current_qty) || 0
                                const unit = tab === 'vajilla' ? '' : String(item.unit ?? '')
                                const cat = String(item.category ?? '')
                                const notes = tab === 'vajilla' ? String(item.notes ?? '') : ''
                                const minQty = tab === 'stock' ? Number(item.min_qty ?? 0) : 0
                                const isCritical = tab === 'stock' && qty <= minQty

                                return (
                                  <div
                                    key={idx}
                                    className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                                      isCritical ? 'bg-[#fef2f2]/50' : idx % 2 === 0 ? 'bg-[#faf8f5]' : ''
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className={`truncate text-[13px] ${isCritical ? 'font-semibold text-[#ea504c]' : 'text-[#3d2c24]'}`}>
                                        {name}
                                      </p>
                                      {(cat || notes) && (
                                        <p className="truncate text-[10px] text-[#a39e97]">
                                          {cat}{notes ? ` · ⚠ ${notes}` : ''}
                                        </p>
                                      )}
                                    </div>
                                    <span className={`ml-2 shrink-0 text-sm font-bold tabular-nums ${isCritical ? 'text-[#ea504c]' : 'text-[#3d2c24]'}`}>
                                      {qty}{unit ? ` ${unit}` : ''}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </StaggerItem>
                )
              })}
            </StaggerList>
          </div>
        </FadeIn>
      )}
    </div>
  )
}
