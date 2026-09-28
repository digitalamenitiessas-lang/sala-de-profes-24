'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Search, X, RefreshCw, Loader2, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle,
  ClipboardList, TrendingUp, History, Activity, ChefHat, ShieldCheck, Package,
} from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { useStockItems, type StockItem } from '@/lib/hooks/use-stock'
import { canCountStock, isManagerOrAbove } from '@/lib/roles'
import { STOCK_CATEGORIES } from '@/lib/constants'
import { LoadingState } from '@/components/ui/LoadingState'
import { FadeIn } from '@/components/ui/motion'
import { BackToHoy } from '@/components/layout/BackToHoy'
import {
  COLORS, getSemaphore, getCriticality, getCriticalityRank, getStockSource, formatQty,
} from '@/lib/stock/helpers'
import {
  STOCK_AREAS, areaFromLveCategory, groupLabel, suggestedCountEveryDays, isStockArea, type StockArea,
} from '@/lib/stock/areas'
import { esCostoConfiable } from '@/lib/costos/confiable'
import { CountSheet } from './_components/CountSheet'
import { AskBar } from '@/components/ai/AskBar'

// ---------------------------------------------------------------------------
// /stock — UNA lista, UN semáforo, por ÁREA.
// ---------------------------------------------------------------------------
// Fudo manda las cantidades (se espejan); acá se ve, se cuenta y se corrige.
// Todo lo que era "radar", anomalías, incidentes y datos por completar vive en
// /control. Esta pantalla es para el que tiene el stock adelante:
//   1. elegís el área (cocina / dulces / barra / descartables)
//   2. ves qué está crítico o sin contar
//   3. tocás un insumo y contás (o registrás merma / configurás)
// ---------------------------------------------------------------------------

type FudoStatus = {
  state: 'ok' | 'warning' | 'error'
  last_sync_at: string | null
  incidents: { open: number; critical: number; high: number }
}

type QuickFilter = 'all' | 'criticos' | 'intermedios' | 'sin_contar' | 'sin_area'

function areaOf(item: StockItem): StockArea {
  return isStockArea(item.area) ? item.area : areaFromLveCategory(item.category)
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function isCountDue(item: StockItem): boolean {
  const d = daysSince(item.last_counted_at)
  if (d === null) return true
  return d >= suggestedCountEveryDays(item)
}

function normalize(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export default function StockPage() {
  return (
    <Suspense fallback={<LoadingState message="Cargando stock..." />}>
      <StockPageContent />
    </Suspense>
  )
}

function StockPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { profile, loading: profileLoading } = useProfileContext()
  const { items, isLoading, mutate } = useStockItems(true)

  const isManager = isManagerOrAbove(profile?.role)
  const canOperate = canCountStock(profile?.role)

  const areaParam = searchParams.get('area')
  const [area, setArea] = useState<StockArea | 'all'>(isStockArea(areaParam) ? areaParam : 'all')
  const [search, setSearch] = useState('')
  const [quick, setQuick] = useState<QuickFilter>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<StockItem | null>(null)
  const [fudo, setFudo] = useState<FudoStatus | null>(null)
  const [syncing, setSyncing] = useState(false)

  const loadFudoStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/fudo/status')
      if (!res.ok) return
      setFudo(await res.json() as FudoStatus)
    } catch { /* silencioso */ }
  }, [])

  useEffect(() => { void loadFudoStatus() }, [loadFudoStatus])

  // Sync manual: lee Fudo → LVE (cantidades, costos, unidades, áreas)
  const runSync = useCallback(async () => {
    setSyncing(true)
    try {
      const res = await fetch('/api/stock/sync')
      const data = await res.json()
      if (!res.ok || data.success === false) throw new Error(data.error ?? 'No se pudo sincronizar con Fudo')
      toast.success(`Sincronizado con Fudo — ${data.read?.synced ?? 0} insumos`)
      await Promise.all([mutate(), loadFudoStatus()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error de conexión con Fudo')
      void loadFudoStatus()
    } finally {
      setSyncing(false)
    }
  }, [mutate, loadFudoStatus])

  const selectArea = (value: StockArea | 'all') => {
    setArea(value)
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') params.delete('area')
    else params.set('area', value)
    router.replace(`/stock${params.toString() ? `?${params}` : ''}`, { scroll: false })
  }

  // ── Derivados ──
  const perArea = useMemo(() => {
    const map = new Map<StockArea | 'all', { count: number; critical: number; value: number; due: number; valued: number; withStock: number }>()
    const bump = (key: StockArea | 'all', item: StockItem) => {
      const cur = map.get(key) ?? { count: 0, critical: 0, value: 0, due: 0, valued: 0, withStock: 0 }
      cur.count++
      if (getSemaphore(item) === 'red') cur.critical++
      if (isCountDue(item)) cur.due++
      // Valorización SOLO con costo confiable (compra/manual/producción):
      // sumar costos Fudo/estimados inventaba plata.
      if (item.current_qty > 0) {
        cur.withStock++
        if (esCostoConfiable(item.cost_source, item.cost_per_unit)) {
          cur.value += item.current_qty * (item.cost_per_unit ?? 0)
          cur.valued++
        }
      }
      map.set(key, cur)
    }
    for (const item of items) { bump(areaOf(item), item); bump('all', item) }
    return map
  }, [items])

  const filtered = useMemo(() => {
    let list = items
    if (area !== 'all') list = list.filter((i) => areaOf(i) === area)
    if (search.trim()) {
      const q = normalize(search)
      list = list.filter((i) => normalize(i.name).includes(q) || normalize(i.fudo_category ?? '').includes(q))
    }
    if (quick === 'criticos') list = list.filter((i) => getSemaphore(i) === 'red')
    else if (quick === 'intermedios') list = list.filter((i) => Boolean(i.is_produced))
    else if (quick === 'sin_contar') list = list.filter(isCountDue)
    else if (quick === 'sin_area') list = list.filter((i) => !isStockArea(i.area) && areaFromLveCategory(i.category) === 'otros')
    return list
  }, [items, area, search, quick])

  const counts = useMemo(() => ({
    criticos: filtered.filter((i) => getSemaphore(i) === 'red').length,
    intermedios: filtered.filter((i) => Boolean(i.is_produced)).length,
    sin_contar: filtered.filter(isCountDue).length,
    sin_area: items.filter((i) => !isStockArea(i.area) && areaFromLveCategory(i.category) === 'otros').length,
  }), [filtered, items])

  const groups = useMemo(() => {
    const map = new Map<string, StockItem[]>()
    for (const item of filtered) {
      const label = groupLabel(item, (c) => STOCK_CATEGORIES[c as keyof typeof STOCK_CATEGORIES]?.label ?? c)
      map.set(label, [...(map.get(label) ?? []), item])
    }
    const entries = [...map.entries()].map(([label, list]) => {
      list.sort((a, b) => getCriticalityRank(a) - getCriticalityRank(b) || a.name.localeCompare(b.name))
      const critical = list.filter((i) => getSemaphore(i) === 'red').length
      return { label, list, critical }
    })
    // Grupos con críticos primero, después alfabético
    entries.sort((a, b) => (b.critical > 0 ? 1 : 0) - (a.critical > 0 ? 1 : 0) || a.label.localeCompare(b.label))
    return entries
  }, [filtered])

  const toggleGroup = (label: string) => setCollapsed((prev) => {
    const next = new Set(prev)
    if (next.has(label)) next.delete(label)
    else next.add(label)
    return next
  })

  if (profileLoading || isLoading) return <LoadingState message="Cargando stock..." />

  if (!canOperate) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-[#7d6c64]">
        Esta pantalla es para cocina, barra, encargados y socios.
      </div>
    )
  }

  const total = perArea.get('all') ?? { count: 0, critical: 0, value: 0, due: 0, valued: 0, withStock: 0 }
  const fudoBlocked = fudo?.state === 'error'
  const fudoUi = fudoBlocked
    ? { label: 'Fudo bloqueado', cls: 'bg-[#fff7f7] text-[#ea504c] ring-[#f3d0cf]', Icon: AlertTriangle }
    : fudo?.state === 'warning'
      ? { label: `${fudo.incidents.open} avisos Fudo`, cls: 'bg-[#fffaf2] text-[#d4943a] ring-[#f1dfba]', Icon: AlertTriangle }
      : { label: fudo?.last_sync_at ? `Fudo · sync ${format(new Date(fudo.last_sync_at), 'HH:mm')}` : 'Fudo conectado', cls: 'bg-[#e8f5f1] text-[#006d5a] ring-[#dcefe8]', Icon: CheckCircle2 }
  const FudoIcon = fudoUi.Icon

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-32">
      <BackToHoy />

      {/* Header */}
      <FadeIn>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight text-[#3d2c24]">Stock</h1>
            <p className="mt-0.5 text-[12px] text-[#7d6c64]">
              {total.count} insumos
              {isManager && total.value > 0 && <> · <span className="font-semibold text-[#3d2c24]">${Math.round(total.value).toLocaleString('es-AR')}</span> valor real ({total.valued} de {total.withStock} con precio)</>}
              {total.critical > 0 && <> · <span className="font-semibold text-[#ea504c]">{total.critical} críticos</span></>}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link href="/control" className={`flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold ring-1 ${fudoUi.cls}`}>
              <FudoIcon className={`size-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span className="max-w-[9rem] truncate">{fudoUi.label}</span>
            </Link>
            {isManager && (
              <button
                onClick={() => void runSync()}
                disabled={syncing}
                title="Leer stock actual de Fudo"
                className="flex size-8 items-center justify-center rounded-full bg-white text-[#3d2c24] ring-1 ring-[#ebe6df] active:scale-95 disabled:opacity-50"
              >
                {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              </button>
            )}
          </div>
        </div>
      </FadeIn>

      {/* Áreas */}
      <FadeIn delay={0.04}>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none">
          {([{ value: 'all' as const, label: 'Todo', icon: '🏠' }, ...STOCK_AREAS.filter((a) => a.value !== 'otros' || (perArea.get('otros')?.count ?? 0) > 0)]).map((a) => {
            const stats = perArea.get(a.value) ?? { count: 0, critical: 0, value: 0, due: 0 }
            const active = area === a.value
            return (
              <button
                key={a.value}
                onClick={() => selectArea(a.value)}
                className={`flex min-w-[7.2rem] shrink-0 flex-col items-start rounded-2xl px-3 py-2.5 text-left ring-1 transition-all active:scale-[0.98] ${active ? 'bg-[#3d2c24] text-white ring-[#3d2c24]' : 'bg-white text-[#3d2c24] ring-[#ebe6df]'}`}
              >
                <span className="text-base leading-none">{a.icon}</span>
                <span className="mt-1.5 text-[12px] font-bold">{a.label}</span>
                <span className={`text-[10px] ${active ? 'text-white/70' : 'text-[#a39e97]'}`}>
                  {stats.count} · {stats.critical > 0 ? <span className={active ? 'text-[#ffb4b1]' : 'text-[#ea504c]'}>{stats.critical} crít.</span> : 'ok'}
                </span>
              </button>
            )
          })}
        </div>
      </FadeIn>

      {/* Preguntar en castellano */}
      <FadeIn delay={0.05}>
        <AskBar
          scope="stock"
          placeholder="Preguntá: qué falta, qué está en negativo…"
          examples={['¿qué me falta en cocina?', '¿qué hay en negativo?', '¿qué no cuento hace una semana?', '¿cuánta plata tengo en stock?']}
        />
      </FadeIn>

      {/* Búsqueda + filtros rápidos */}
      <FadeIn delay={0.06}>
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={area === 'all' ? 'Buscar insumo…' : `Buscar en ${STOCK_AREAS.find((a) => a.value === area)?.label.toLowerCase()}…`}
              className="w-full rounded-2xl border border-[#ebe6df] bg-white py-2.5 pl-10 pr-9 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#a39e97] hover:bg-[#f3efe9]">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 scrollbar-none">
            {([
              { key: 'all' as const, label: 'Todos', n: filtered.length, tone: '' },
              { key: 'criticos' as const, label: 'Críticos', n: counts.criticos, tone: 'text-[#ea504c]' },
              { key: 'sin_contar' as const, label: 'Sin contar', n: counts.sin_contar, tone: 'text-[#d4943a]' },
              { key: 'intermedios' as const, label: 'Producidos', n: counts.intermedios, tone: 'text-[#006d5a]' },
              ...(isManager && counts.sin_area > 0 ? [{ key: 'sin_area' as const, label: 'Sin área', n: counts.sin_area, tone: 'text-[#7d6c64]' }] : []),
            ]).map((f) => (
              <button
                key={f.key}
                onClick={() => setQuick(quick === f.key ? 'all' : f.key)}
                className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1 transition-all ${quick === f.key ? 'bg-[#3d2c24] text-white ring-[#3d2c24]' : 'bg-white text-[#3d2c24] ring-[#ebe6df]'}`}
              >
                {f.label}
                <span className={`tabular-nums ${quick === f.key ? 'text-white/70' : f.tone || 'text-[#a39e97]'}`}>{f.n}</span>
              </button>
            ))}
          </div>
        </div>
      </FadeIn>

      {/* Lista */}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl bg-white px-6 py-10 text-center ring-1 ring-[#ebe6df]">
          <Package className="size-8 text-[#ebe6df]" />
          <p className="mt-3 text-sm font-medium text-[#7d6c64]">Nada para mostrar con estos filtros</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(({ label, list, critical }) => {
            const isCollapsed = collapsed.has(label)
            return (
              <section key={label} className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
                <button onClick={() => toggleGroup(label)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
                  <span className="flex-1 text-[12px] font-bold uppercase tracking-wider text-[#3d2c24]">{label}</span>
                  <span className="text-[11px] tabular-nums text-[#a39e97]">{list.length}</span>
                  {critical > 0 && <span className="rounded-full bg-[#fef2f2] px-1.5 py-0.5 text-[10px] font-bold text-[#ea504c]">{critical}</span>}
                  {isCollapsed ? <ChevronRight className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
                </button>
                {!isCollapsed && (
                  <div className="divide-y divide-[#f5f0ea] border-t border-[#f5f0ea]">
                    {list.map((item) => (
                      <StockRow key={item.id} item={item} showMoney={isManager} onClick={() => setSelected(item)} />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      {/* Más (managers): analítica del stock */}
      {isManager && (
        <FadeIn delay={0.1}>
          <div className="grid grid-cols-2 gap-2">
            {[
              { href: '/stock/rendimiento', label: 'Rendimiento', hint: 'Esperado vs real', Icon: TrendingUp },
              { href: '/stock/historial', label: 'Historial', hint: 'Snapshots diarios', Icon: History },
              { href: '/stock/consumo', label: 'Consumo', hint: 'Ventas × recetas', Icon: Activity },
              { href: '/stock/produccion', label: 'Producción', hint: 'Validar y costos', Icon: ChefHat },
              { href: '/control', label: 'Centro de control', hint: 'Vínculos, incidentes, datos', Icon: ShieldCheck },
              { href: '/ventas?m=precios', label: 'Precios de compra', hint: 'Desde gastos de Fudo', Icon: Package },
            ].map(({ href, label, hint, Icon }) => (
              <Link key={href} href={href} className="flex items-center gap-2.5 rounded-2xl bg-white px-3 py-2.5 ring-1 ring-[#ebe6df] active:scale-[0.99]">
                <Icon className="size-4 shrink-0 text-[#006d5a]" />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold text-[#3d2c24]">{label}</span>
                  <span className="block truncate text-[10px] text-[#a39e97]">{hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </FadeIn>
      )}

      {/* CTA fija: conteo guiado del área */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 flex justify-center px-4">
        <Link
          href={`/stock/conteo${area !== 'all' ? `?area=${area}` : ''}`}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-[#006d5a] px-5 py-3 text-sm font-bold text-white shadow-xl active:scale-95"
        >
          <ClipboardList className="size-4" />
          Conteo guiado
          {total.due > 0 && <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] tabular-nums">{(area === 'all' ? total : perArea.get(area))?.due ?? 0}</span>}
        </Link>
      </div>

      <CountSheet
        item={selected}
        open={Boolean(selected)}
        canWaste={isManager}
        canConfigure={isManager}
        showMoney={isManager}
        fudoBlocked={fudoBlocked}
        onClose={() => setSelected(null)}
        onUpdated={() => { void mutate() }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fila compacta: nombre + estado + cantidad. Un toque abre el panel.
// ---------------------------------------------------------------------------

function StockRow({ item, showMoney, onClick }: { item: StockItem; showMoney: boolean; onClick: () => void }) {
  const semaphore = getSemaphore(item)
  const criticality = getCriticality(item)
  const source = getStockSource(item)
  const since = daysSince(item.last_counted_at)
  const due = isCountDue(item)
  // $ por fila SOLO con costo confiable — un número de Fudo acá es fantasía
  const value = showMoney && esCostoConfiable(item.cost_source, item.cost_per_unit) && item.current_qty > 0
    ? Math.round(item.current_qty * (item.cost_per_unit ?? 0))
    : null

  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-[#faf8f5]">
      <span className={`size-2 shrink-0 rounded-full ${COLORS[semaphore].dot}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-[#3d2c24]">{item.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-[#a39e97]">
          {source.kind === 'unmapped' && <span className="font-bold text-[#ea504c]">sin vínculo Fudo</span>}
          {source.kind === 'local' && <span className="font-semibold">local</span>}
          {item.is_produced && <span className="font-semibold text-[#006d5a]">producido</span>}
          {criticality === 'negative' && <span className="font-bold text-[#ea504c]">negativo</span>}
          {criticality === 'critical' && <span className="font-semibold text-[#ea504c]">bajo mínimo ({formatQty(item.min_qty)})</span>}
          {criticality === 'warning' && <span className="font-semibold text-[#d4943a]">cerca del mínimo</span>}
          <span className={due ? 'text-[#d4943a]' : ''}>
            {since === null ? 'nunca contado' : since === 0 ? 'contado hoy' : `contado hace ${since}d`}
          </span>
          {value !== null && <span>· ${value.toLocaleString('es-AR')}</span>}
        </span>
      </span>
      <span className={`shrink-0 text-right font-display text-lg font-bold tabular-nums ${COLORS[semaphore].text}`}>
        {formatQty(item.current_qty)}
        <span className="ml-1 text-[10px] font-medium text-[#a39e97]">{item.unit}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-[#d9d2c9]" />
    </button>
  )
}
