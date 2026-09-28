'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, RefreshCw, ChefHat, Package,
  TrendingDown, AlertTriangle, Clock, Layers,
  Scale, ShoppingCart, ArrowUpDown, Calendar,
} from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn, StaggerList, StaggerItem, AnimatedNumber } from '@/components/ui/motion'
import { LoadingState } from '@/components/ui/LoadingState'
import type {
  StockAvailabilityResult, StockDurationResult, RecipeAtRisk,
  StockReconciliationRow, MenuItemReconciliationRow,
} from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RendimientoData = {
  availability: {
    total_recipes: number
    at_risk_count: number
    ok_count: number
    recipes: StockAvailabilityResult[]
  }
  atRisk: {
    total: number
    sin_stock_count: number
    bajo_count: number
    ok_count: number
    recipes: (RecipeAtRisk & { limiting_ingredient_unit: string | null; limiting_ingredient_current_qty: number | null })[]
  }
  duration: {
    total: number
    semaphore_counts: { critico: number; bajo: number; atencion: number; ok: number; sin_historial: number }
    items: StockDurationResult[]
  }
}

type ReconciliationData = {
  stock: {
    total: number
    with_movement: number
    with_variance: number
    items: StockReconciliationRow[]
  } | null
  menu: {
    total: number
    total_produced: number
    total_sold: number
    sell_through_pct: number
    negative_count: number
    items: MenuItemReconciliationRow[]
  } | null
}

type DatePreset = 'hoy' | 'ayer' | 'semana'

// ---------------------------------------------------------------------------
// Semaphore helpers
// ---------------------------------------------------------------------------

type SemColor = { bg: string; text: string; ring: string; dot: string }

function portionsSemaphore(portions: number): SemColor {
  if (portions <= 0) return { bg: '#fef2f2', text: '#ea504c', ring: '#ea504c', dot: '#ea504c' }
  if (portions < 10)  return { bg: '#fdf6ec', text: '#d4943a', ring: '#d4943a', dot: '#d4943a' }
  return { bg: '#e8f5f1', text: '#006d5a', ring: '#006d5a', dot: '#006d5a' }
}

function durationSemaphore(sem: string): SemColor {
  if (sem === 'critico')      return { bg: '#fef2f2', text: '#ea504c', ring: '#ea504c', dot: '#ea504c' }
  if (sem === 'bajo')         return { bg: '#fdf6ec', text: '#d4943a', ring: '#d4943a', dot: '#d4943a' }
  if (sem === 'atención')     return { bg: '#fdf6ec', text: '#d4943a', ring: '#d4943a', dot: '#d4943a' }
  if (sem === 'sin_historial') return { bg: '#f3efe9', text: '#a39e97', ring: '#a39e97', dot: '#a39e97' }
  return { bg: '#e8f5f1', text: '#006d5a', ring: '#006d5a', dot: '#006d5a' }
}

function semLabel(sem: string): string {
  const map: Record<string, string> = {
    critico: 'Crítico', bajo: 'Bajo', 'atención': 'Atención',
    ok: 'OK', sin_historial: 'Sin datos',
  }
  return map[sem] ?? sem
}

function portionsLabel(portions: number): string {
  if (portions <= 0) return 'Sin stock'
  if (portions < 10) return 'Stock bajo'
  return 'OK'
}

function SemaphoreDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  )
}

// ---------------------------------------------------------------------------
// Recipe availability card
// ---------------------------------------------------------------------------

function RecipeAvailCard({ recipe }: { recipe: StockAvailabilityResult }) {
  const portions = recipe.available_portions ?? 0
  const sem = portionsSemaphore(portions)
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="overflow-hidden rounded-xl ring-1 transition-all"
      style={{ ringColor: sem.ring + '40', backgroundColor: 'var(--card)' }}
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        {/* Semaphore dot */}
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-center"
          style={{ backgroundColor: sem.bg }}
        >
          <span className="font-display text-base font-bold tabular-nums" style={{ color: sem.text }}>
            {portions <= 999 ? Math.floor(portions) : '∞'}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-[#3d2c24]">{recipe.recipe_name}</p>
            {recipe.warning && (
              <span className="rounded-full bg-[#f3efe9] px-1.5 py-0.5 text-[9px] text-[#a39e97]">
                sin vínculos
              </span>
            )}
          </div>
          <p className="text-[11px]" style={{ color: sem.text }}>
            {portionsLabel(portions)}
            {portions > 0 && <span className="text-[#a39e97]"> · {portions.toFixed(1)} porciones posibles</span>}
          </p>
          {recipe.limiting_ingredient && (
            <p className="text-[10px] text-[#a39e97]">
              Limitante: {recipe.limiting_ingredient}
            </p>
          )}
        </div>

        <SemaphoreDot color={sem.dot} />
      </button>

      {/* Expanded: ingredients breakdown */}
      {expanded && recipe.ingredients && recipe.ingredients.length > 0 && (
        <div className="border-t border-[#ebe6df] bg-[#faf8f5] px-3 py-2 space-y-1">
          {recipe.ingredients.map((ing, i) => {
            const ingSem = portionsSemaphore(ing.available_portions ?? 0)
            return (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <SemaphoreDot color={ing.is_limiting ? ingSem.dot : '#a39e97'} />
                  <span className={ing.is_limiting ? 'font-semibold text-[#3d2c24]' : 'text-[#a39e97]'}>
                    {ing.name}
                  </span>
                  {ing.is_limiting && (
                    <span className="rounded-full bg-[#fdf6ec] px-1.5 py-0.5 text-[9px] font-bold text-[#d4943a]">
                      limitante
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-[#3d2c24]">
                    {ing.current_qty} {ing.unit}
                  </span>
                  <span className="ml-1 text-[#a39e97]">
                    ({ing.available_portions?.toFixed(1) ?? '?'} p.)
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stock duration card
// ---------------------------------------------------------------------------

function DurationCard({ item }: { item: StockDurationResult }) {
  const sem = durationSemaphore(item.semaphore)

  return (
    <div
      className="flex items-center gap-3 rounded-xl p-3 ring-1"
      style={{ backgroundColor: sem.bg + '60', ringColor: sem.ring + '30' }}
    >
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: sem.bg }}
      >
        <Clock className="size-4" style={{ color: sem.text }} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-[#3d2c24]">{item.name}</p>
        <p className="text-[11px]" style={{ color: sem.text }}>
          {item.days_remaining !== null
            ? `${item.days_remaining.toFixed(1)} días restantes`
            : semLabel(item.semaphore)
          }
        </p>
      </div>

      <div className="text-right">
        <p className="text-xs font-semibold text-[#3d2c24]">{item.current_qty} {item.unit}</p>
        {item.daily_avg_consumption > 0 && (
          <p className="text-[10px] text-[#a39e97]">
            {item.daily_avg_consumption.toFixed(2)}/día
          </p>
        )}
      </div>

      <SemaphoreDot color={sem.dot} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Variance helpers
// ---------------------------------------------------------------------------

function varianceSemaphore(variance: number, base: number): SemColor {
  if (base === 0 && variance === 0) return { bg: '#f3efe9', text: '#a39e97', ring: '#a39e97', dot: '#a39e97' }
  const pct = base !== 0 ? Math.abs(variance / base) * 100 : (variance !== 0 ? 100 : 0)
  if (pct <= 2) return { bg: '#e8f5f1', text: '#006d5a', ring: '#006d5a', dot: '#006d5a' }
  if (pct <= 10) return { bg: '#fdf6ec', text: '#d4943a', ring: '#d4943a', dot: '#d4943a' }
  return { bg: '#fef2f2', text: '#ea504c', ring: '#ea504c', dot: '#ea504c' }
}

function menuSemaphore(remaining: number): SemColor {
  if (remaining < 0) return { bg: '#fef2f2', text: '#ea504c', ring: '#ea504c', dot: '#ea504c' }
  if (remaining === 0) return { bg: '#f3efe9', text: '#a39e97', ring: '#a39e97', dot: '#a39e97' }
  return { bg: '#e8f5f1', text: '#006d5a', ring: '#006d5a', dot: '#006d5a' }
}

function formatNum(n: number): string {
  return Math.abs(n) < 0.01 ? '0' : n.toFixed(n % 1 === 0 ? 0 : 1)
}

function getDateRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date()
  if (preset === 'hoy') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return { from: start.toISOString(), to: now.toISOString() }
  }
  if (preset === 'ayer') {
    const start = new Date(now)
    start.setDate(start.getDate() - 1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setHours(23, 59, 59, 999)
    return { from: start.toISOString(), to: end.toISOString() }
  }
  // semana
  const start = new Date(now)
  start.setDate(start.getDate() - 7)
  start.setHours(0, 0, 0, 0)
  return { from: start.toISOString(), to: now.toISOString() }
}

// ---------------------------------------------------------------------------
// Stock reconciliation card
// ---------------------------------------------------------------------------

function StockReconCard({ item }: { item: StockReconciliationRow }) {
  const sem = varianceSemaphore(item.variance, item.opening_qty)
  const [expanded, setExpanded] = useState(false)
  const hasMovement = item.received !== 0 || item.prod_in !== 0 || item.prod_out !== 0 ||
    item.sales !== 0 || item.waste !== 0 || item.manual_adj !== 0

  if (!hasMovement && item.variance === 0) return null

  return (
    <div
      className="overflow-hidden rounded-xl ring-1 transition-all"
      style={{ ringColor: sem.ring + '40', backgroundColor: 'var(--card)' }}
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-center"
          style={{ backgroundColor: sem.bg }}
        >
          <Scale className="size-4" style={{ color: sem.text }} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#3d2c24]">{item.name}</p>
          <p className="text-[11px] text-[#a39e97]">
            {formatNum(item.opening_qty)} → {formatNum(item.actual_closing)} {item.unit}
            {item.variance !== 0 && (
              <span style={{ color: sem.text }}>
                {' '}· varianza: {item.variance > 0 ? '+' : ''}{formatNum(item.variance)}
              </span>
            )}
          </p>
        </div>

        <SemaphoreDot color={sem.dot} />
      </button>

      {expanded && (
        <div className="border-t border-[#ebe6df] bg-[#faf8f5] px-3 py-2 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-[#a39e97]">Apertura</span>
            <span className="font-semibold text-[#3d2c24]">{formatNum(item.opening_qty)} {item.unit}</span>
          </div>
          {item.received !== 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-[#006d5a]">+ Recibido</span>
              <span className="font-semibold text-[#006d5a]">+{formatNum(item.received)}</span>
            </div>
          )}
          {item.prod_in !== 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-[#006d5a]">+ Producción (entrada)</span>
              <span className="font-semibold text-[#006d5a]">+{formatNum(item.prod_in)}</span>
            </div>
          )}
          {item.prod_out !== 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-[#d4943a]">- Producción (consumo)</span>
              <span className="font-semibold text-[#d4943a]">{formatNum(item.prod_out)}</span>
            </div>
          )}
          {item.sales !== 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-[#ea504c]">- Ventas</span>
              <span className="font-semibold text-[#ea504c]">{formatNum(item.sales)}</span>
            </div>
          )}
          {item.waste !== 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-[#ea504c]">- Merma / Vencido</span>
              <span className="font-semibold text-[#ea504c]">{formatNum(item.waste)}</span>
            </div>
          )}
          {item.manual_adj !== 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-[#a39e97]">± Ajuste manual</span>
              <span className="font-semibold text-[#a39e97]">{formatNum(item.manual_adj)}</span>
            </div>
          )}
          <div className="mt-1 border-t border-[#ebe6df] pt-1 flex justify-between text-xs">
            <span className="text-[#a39e97]">Esperado</span>
            <span className="font-semibold text-[#3d2c24]">{formatNum(item.expected_closing)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[#a39e97]">Real</span>
            <span className="font-semibold text-[#3d2c24]">{formatNum(item.actual_closing)}</span>
          </div>
          {item.variance !== 0 && (
            <div className="flex justify-between text-xs font-bold" style={{ color: sem.text }}>
              <span>Varianza</span>
              <span>{item.variance > 0 ? '+' : ''}{formatNum(item.variance)} {item.unit}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Menu item reconciliation card
// ---------------------------------------------------------------------------

function MenuReconCard({ item }: { item: MenuItemReconciliationRow }) {
  const sem = menuSemaphore(item.expected_remaining)

  return (
    <div
      className="flex items-center gap-3 rounded-xl p-3 ring-1"
      style={{ backgroundColor: 'var(--card)', ringColor: sem.ring + '30' }}
    >
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: sem.bg }}
      >
        <ShoppingCart className="size-4" style={{ color: sem.text }} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#3d2c24]">{item.menu_item_name}</p>
        {item.recipe_name && (
          <p className="text-[10px] text-[#a39e97]">Receta: {item.recipe_name}</p>
        )}
      </div>

      <div className="text-right shrink-0 space-y-0.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[#006d5a] font-semibold">{formatNum(item.qty_produced)} prod.</span>
          <span className="text-[#a39e97]">·</span>
          <span className="text-[#ea504c] font-semibold">{formatNum(item.qty_sold)} vend.</span>
        </div>
        <p className="text-[11px] font-bold" style={{ color: sem.text }}>
          {item.expected_remaining >= 0 ? '' : ''}{formatNum(item.expected_remaining)} restantes
        </p>
      </div>

      <SemaphoreDot color={sem.dot} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RendimientoPage() {
  const [data, setData] = useState<RendimientoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activeSection, setActiveSection] = useState<'recetas' | 'insumos' | 'control'>('recetas')
  const [recipeFilter, setRecipeFilter] = useState<'all' | 'sin_stock' | 'bajo' | 'ok'>('all')

  // Control tab state
  const [reconData, setReconData] = useState<ReconciliationData>({ stock: null, menu: null })
  const [reconLoading, setReconLoading] = useState(false)
  const [reconView, setReconView] = useState<'stock' | 'menu'>('stock')
  const [datePreset, setDatePreset] = useState<DatePreset>('hoy')

  const fetchRecon = useCallback(async (preset?: DatePreset) => {
    setReconLoading(true)
    try {
      const range = getDateRange(preset ?? datePreset)
      const [stockRes, menuRes] = await Promise.all([
        fetch(`/api/stock/reconciliation?view=stock&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
        fetch(`/api/stock/reconciliation?view=menu&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
      ])
      const [stockData, menuData] = await Promise.all([stockRes.json(), menuRes.json()])
      setReconData({ stock: stockData, menu: menuData })
    } catch {
      toast.error('Error al cargar reconciliación')
    } finally {
      setReconLoading(false)
    }
  }, [datePreset])

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true)
    else setLoading(true)

    try {
      const [yieldRes, atRiskRes, durationRes] = await Promise.all([
        fetch('/api/recipes/yield'),
        fetch('/api/stock/availability?threshold=10'),
        fetch('/api/stock/duration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ only_at_risk: false, days: 30 }),
        }),
      ])

      const [yieldData, atRisk, duration] = await Promise.all([
        yieldRes.json(),
        atRiskRes.json(),
        durationRes.json(),
      ])

      // Transform stock_yield response to availability format
      type YieldRow = {
        recipe_id: string; recipe_name: string; max_portions: number
        limiting_item: string | null; ingredients: Array<{
          stock_item_id: string; name: string; current_qty: number
          qty_per_portion: number; yield: number
        }>
      }
      const yields = (yieldData?.yields ?? []) as YieldRow[]
      const recipes = yields.map(r => ({
        recipe_id: r.recipe_id,
        recipe_name: r.recipe_name,
        available_portions: r.max_portions,
        limiting_ingredient: r.limiting_item,
        warning: false,
        ingredients: (r.ingredients ?? []).map(ing => ({
          stock_item_id: ing.stock_item_id,
          name: ing.name,
          current_qty: ing.current_qty,
          qty_per_portion: ing.qty_per_portion,
          available_portions: ing.yield,
          unit: '',
          is_limiting: ing.name === r.limiting_item,
        })),
      }))
      const atRiskRecipes = recipes.filter(r => r.available_portions < 10)
      const availability = {
        total_recipes: recipes.length,
        at_risk_count: atRiskRecipes.length,
        ok_count: recipes.length - atRiskRecipes.length,
        recipes,
      }

      setData({ availability, atRisk, duration })
    } catch {
      toast.error('Error al cargar datos de rendimiento')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Fetch reconciliation when tab is activated
  useEffect(() => {
    if (activeSection === 'control' && !reconData.stock && !reconLoading) {
      fetchRecon()
    }
  }, [activeSection, reconData.stock, reconLoading, fetchRecon])

  // Filter recipes
  const filteredRecipes = (data?.availability.recipes ?? []).filter(r => {
    if (recipeFilter === 'all') return true
    const portions = r.available_portions ?? 0
    if (recipeFilter === 'sin_stock') return portions <= 0
    if (recipeFilter === 'bajo') return portions > 0 && portions < 10
    if (recipeFilter === 'ok') return portions >= 10
    return true
  })

  // Duration: sort by urgency, filter relevant
  const criticalItems = (data?.duration.items ?? []).filter(
    i => i.semaphore === 'critico' || i.semaphore === 'bajo'
  )
  const warningItems = (data?.duration.items ?? []).filter(i => i.semaphore === 'atención')
  const okItems = (data?.duration.items ?? []).filter(i => i.semaphore === 'ok')

  if (loading) return <LoadingState message="Calculando rendimiento…" />

  const allRecipes = data?.availability.recipes ?? []
  const atRiskCount = allRecipes.filter(r => (r.available_portions ?? 0) <= 0).length
  const bajoCount = allRecipes.filter(r => (r.available_portions ?? 0) > 0 && (r.available_portions ?? 0) < 10).length
  const totalRecipes = allRecipes.length
  const durCounts = data?.duration.semaphore_counts

  return (
    <FadeIn className="mx-auto max-w-lg space-y-5 pb-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/stock"
            className="flex size-9 items-center justify-center rounded-xl bg-secondary text-[#a39e97] hover:text-[#3d2c24]"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div>
            <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Rendimiento</h1>
            <p className="section-label mt-0.5">Stock · Recetas · Proyección</p>
          </div>
        </div>

        <button
          onClick={async () => {
            setRefreshing(true)
            try {
              // Sync from Fudo first, then refresh data
              const syncRes = await fetch('/api/fudo/sync/stock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ direction: 'fudo_to_app' }),
              })
              const syncData = await syncRes.json()
              if (syncData.success) {
                toast.success(`Fudo sync: ${syncData.synced} items actualizados`)
              } else {
                toast.error('Error al sincronizar con Fudo')
              }
            } catch {
              toast.error('Error de conexión con Fudo')
            }
            fetchData(true)
          }}
          disabled={refreshing}
          className="flex size-9 items-center justify-center rounded-xl bg-secondary text-[#a39e97] hover:text-[#3d2c24] disabled:opacity-50"
          title="Sincronizar con Fudo y refrescar"
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* KPI row */}
      <StaggerList className="grid grid-cols-3 gap-2">
        <StaggerItem>
          <div className="rounded-xl bg-[#fef2f2] p-3 text-center ring-1 ring-[#ea504c]/10">
            <p className="font-display text-2xl font-bold text-[#ea504c]">
              <AnimatedNumber value={atRiskCount} />
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#ea504c]">Sin stock</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="rounded-xl bg-[#fdf6ec] p-3 text-center ring-1 ring-[#d4943a]/10">
            <p className="font-display text-2xl font-bold text-[#d4943a]">
              <AnimatedNumber value={bajoCount} />
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#d4943a]">Stock bajo</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="rounded-xl bg-[#e8f5f1] p-3 text-center ring-1 ring-[#006d5a]/10">
            <p className="font-display text-2xl font-bold text-[#006d5a]">
              <AnimatedNumber value={totalRecipes - atRiskCount - bajoCount} />
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#006d5a]">OK</p>
          </div>
        </StaggerItem>
      </StaggerList>

      {/* Critical alert banner */}
      {atRiskCount > 0 && (
        <FadeIn>
          <div className="flex items-start gap-3 rounded-xl bg-[#fef2f2] p-3 ring-1 ring-[#ea504c]/20">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#ea504c]" />
            <p className="text-xs text-[#ea504c]">
              <strong>{atRiskCount} receta{atRiskCount !== 1 ? 's' : ''} sin stock suficiente.</strong>{' '}
              {allRecipes
                .filter(r => (r.available_portions ?? 0) <= 0)
                .map(r => r.recipe_name)
                .join(', ')}
            </p>
          </div>
        </FadeIn>
      )}

      {/* Section tabs */}
      <div className="flex gap-1.5">
        <button
          onClick={() => setActiveSection('recetas')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all ${
            activeSection === 'recetas'
              ? 'bg-[#006d5a] text-white'
              : 'bg-secondary text-[#a39e97] hover:text-[#3d2c24]'
          }`}
        >
          <ChefHat className="size-3.5" />
          Recetas
        </button>
        <button
          onClick={() => setActiveSection('insumos')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all ${
            activeSection === 'insumos'
              ? 'bg-[#006d5a] text-white'
              : 'bg-secondary text-[#a39e97] hover:text-[#3d2c24]'
          }`}
        >
          <Package className="size-3.5" />
          Insumos
        </button>
        <button
          onClick={() => setActiveSection('control')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all ${
            activeSection === 'control'
              ? 'bg-[#006d5a] text-white'
              : 'bg-secondary text-[#a39e97] hover:text-[#3d2c24]'
          }`}
        >
          <Scale className="size-3.5" />
          Control
        </button>
      </div>

      {/* ── RECETAS section ── */}
      {activeSection === 'recetas' && (
        <div className="space-y-4">
          {/* Filter pills */}
          <div className="flex gap-1.5">
            {[
              { key: 'all' as const, label: 'Todas' },
              { key: 'sin_stock' as const, label: `Sin stock (${atRiskCount})`, color: '#ea504c' },
              { key: 'bajo' as const, label: `Bajo (${bajoCount})`, color: '#d4943a' },
              { key: 'ok' as const, label: `OK (${totalRecipes - atRiskCount - bajoCount})`, color: '#006d5a' },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setRecipeFilter(f.key)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
                  recipeFilter === f.key
                    ? 'bg-[#006d5a] text-white'
                    : 'bg-secondary text-[#a39e97]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {filteredRecipes.length === 0 ? (
            <div className="rounded-xl bg-[#faf8f5] p-6 text-center">
              <p className="text-sm text-[#a39e97]">
                {totalRecipes === 0
                  ? 'No hay recetas con ingredientes vinculados. Ejecutá POST /api/recipes/ingest primero.'
                  : 'No hay recetas en este estado.'}
              </p>
              {totalRecipes === 0 && (
                <Link
                  href="/admin/recetas/pending"
                  className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[#006d5a] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Ver ingredientes pendientes
                </Link>
              )}
            </div>
          ) : (
            <StaggerList className="space-y-2">
              {filteredRecipes
                .sort((a, b) => (a.available_portions ?? 0) - (b.available_portions ?? 0))
                .map(recipe => (
                  <StaggerItem key={recipe.recipe_id}>
                    <RecipeAvailCard recipe={recipe} />
                  </StaggerItem>
                ))}
            </StaggerList>
          )}
        </div>
      )}

      {/* ── INSUMOS section ── */}
      {activeSection === 'insumos' && (
        <div className="space-y-4">
          {/* Duration semaphore summary */}
          {durCounts && (
            <div className="grid grid-cols-4 gap-1.5 text-center">
              {[
                { key: 'critico', label: 'Crítico', count: durCounts.critico, color: '#ea504c', bg: '#fef2f2' },
                { key: 'bajo', label: 'Bajo', count: durCounts.bajo, color: '#d4943a', bg: '#fdf6ec' },
                { key: 'atencion', label: 'Atención', count: durCounts.atencion, color: '#d4943a', bg: '#fdf6ec' },
                { key: 'ok', label: 'OK', count: durCounts.ok, color: '#006d5a', bg: '#e8f5f1' },
              ].map(s => (
                <div key={s.key} className="rounded-xl p-2" style={{ backgroundColor: s.bg }}>
                  <p className="font-display text-lg font-bold" style={{ color: s.color }}>{s.count}</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: s.color }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Critical items */}
          {criticalItems.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <TrendingDown className="size-3.5 text-[#ea504c]" />
                <h3 className="section-label text-[#ea504c]">Crítico / Bajo — acción inmediata</h3>
              </div>
              <div className="space-y-1.5">
                {criticalItems.map(item => (
                  <DurationCard key={item.stock_item_id} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* Warning items */}
          {warningItems.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="size-3.5 text-[#d4943a]" />
                <h3 className="section-label text-[#d4943a]">Atención — esta semana</h3>
              </div>
              <div className="space-y-1.5">
                {warningItems.map(item => (
                  <DurationCard key={item.stock_item_id} item={item} />
                ))}
              </div>
            </div>
          )}

          {/* OK items */}
          {okItems.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Layers className="size-3.5 text-[#006d5a]" />
                <h3 className="section-label">Stock estable</h3>
              </div>
              <div className="space-y-1.5">
                {okItems.map(item => (
                  <DurationCard key={item.stock_item_id} item={item} />
                ))}
              </div>
            </div>
          )}

          {data?.duration.total === 0 && (
            <div className="rounded-xl bg-[#faf8f5] p-6 text-center">
              <p className="text-sm text-[#a39e97]">
                Sin historial de consumo. Los datos aparecerán después de registrar
                ventas o producción en cocina.
              </p>
            </div>
          )}

          {/* Note about lookback */}
          {(data?.duration.total ?? 0) > 0 && (
            <p className="text-center text-[10px] text-[#a39e97]">
              Cálculo basado en consumo promedio de los últimos 30 días
            </p>
          )}
        </div>
      )}

      {/* ── CONTROL section ── */}
      {activeSection === 'control' && (
        <div className="space-y-4">
          {/* Date preset buttons */}
          <div className="flex items-center gap-2">
            <Calendar className="size-3.5 text-[#a39e97]" />
            {([
              { key: 'hoy' as const, label: 'Hoy' },
              { key: 'ayer' as const, label: 'Ayer' },
              { key: 'semana' as const, label: '7 días' },
            ]).map(p => (
              <button
                key={p.key}
                onClick={() => { setDatePreset(p.key); fetchRecon(p.key) }}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
                  datePreset === p.key
                    ? 'bg-[#006d5a] text-white'
                    : 'bg-secondary text-[#a39e97]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Sub-view toggle */}
          <div className="flex gap-1.5">
            <button
              onClick={() => setReconView('stock')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold transition-all ${
                reconView === 'stock'
                  ? 'bg-[#3d2c24] text-white'
                  : 'bg-secondary text-[#a39e97]'
              }`}
            >
              <ArrowUpDown className="size-3" />
              Insumos
            </button>
            <button
              onClick={() => setReconView('menu')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-[11px] font-semibold transition-all ${
                reconView === 'menu'
                  ? 'bg-[#3d2c24] text-white'
                  : 'bg-secondary text-[#a39e97]'
              }`}
            >
              <ShoppingCart className="size-3" />
              Carta
            </button>
          </div>

          {reconLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="size-5 animate-spin text-[#a39e97]" />
            </div>
          ) : reconView === 'stock' && reconData.stock ? (
            <>
              {/* Stock KPIs */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-[#e8f5f1] p-3 text-center ring-1 ring-[#006d5a]/10">
                  <p className="font-display text-2xl font-bold text-[#006d5a]">
                    {reconData.stock.with_movement}
                  </p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#006d5a]">Con movimiento</p>
                </div>
                <div className="rounded-xl bg-[#fdf6ec] p-3 text-center ring-1 ring-[#d4943a]/10">
                  <p className="font-display text-2xl font-bold text-[#d4943a]">
                    {reconData.stock.with_variance}
                  </p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#d4943a]">Con varianza</p>
                </div>
                <div className="rounded-xl bg-[#f3efe9] p-3 text-center ring-1 ring-[#a39e97]/10">
                  <p className="font-display text-2xl font-bold text-[#3d2c24]">
                    {reconData.stock.total}
                  </p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Total items</p>
                </div>
              </div>

              {/* Stock items list */}
              {reconData.stock.items.length === 0 ? (
                <div className="rounded-xl bg-[#faf8f5] p-6 text-center">
                  <p className="text-sm text-[#a39e97]">
                    Sin movimientos de stock en este periodo.
                  </p>
                </div>
              ) : (
                <StaggerList className="space-y-2">
                  {reconData.stock.items.map(item => (
                    <StaggerItem key={item.stock_item_id}>
                      <StockReconCard item={item} />
                    </StaggerItem>
                  ))}
                </StaggerList>
              )}
            </>
          ) : reconView === 'menu' && reconData.menu ? (
            <>
              {/* Menu KPIs */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-[#e8f5f1] p-3 text-center ring-1 ring-[#006d5a]/10">
                  <p className="font-display text-2xl font-bold text-[#006d5a]">
                    {reconData.menu.total_produced}
                  </p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#006d5a]">Producido</p>
                </div>
                <div className="rounded-xl bg-[#fdf6ec] p-3 text-center ring-1 ring-[#d4943a]/10">
                  <p className="font-display text-2xl font-bold text-[#d4943a]">
                    {reconData.menu.total_sold}
                  </p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#d4943a]">Vendido</p>
                </div>
                <div className="rounded-xl p-3 text-center ring-1"
                  style={{
                    backgroundColor: reconData.menu.negative_count > 0 ? '#fef2f2' : '#e8f5f1',
                    ringColor: reconData.menu.negative_count > 0 ? '#ea504c20' : '#006d5a10',
                  }}
                >
                  <p className="font-display text-2xl font-bold"
                    style={{ color: reconData.menu.negative_count > 0 ? '#ea504c' : '#006d5a' }}
                  >
                    {reconData.menu.sell_through_pct}%
                  </p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider"
                    style={{ color: reconData.menu.negative_count > 0 ? '#ea504c' : '#006d5a' }}
                  >
                    Vendido
                  </p>
                </div>
              </div>

              {reconData.menu.negative_count > 0 && (
                <div className="flex items-start gap-3 rounded-xl bg-[#fef2f2] p-3 ring-1 ring-[#ea504c]/20">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#ea504c]" />
                  <p className="text-xs text-[#ea504c]">
                    <strong>{reconData.menu.negative_count} item{reconData.menu.negative_count !== 1 ? 's' : ''} con más ventas que producción.</strong>{' '}
                    Revisar si falta registrar producción.
                  </p>
                </div>
              )}

              {/* Menu items list */}
              {reconData.menu.items.length === 0 ? (
                <div className="rounded-xl bg-[#faf8f5] p-6 text-center">
                  <p className="text-sm text-[#a39e97]">
                    Sin producción ni ventas registradas en este periodo.
                  </p>
                </div>
              ) : (
                <StaggerList className="space-y-2">
                  {reconData.menu.items.map(item => (
                    <StaggerItem key={item.menu_item_id}>
                      <MenuReconCard item={item} />
                    </StaggerItem>
                  ))}
                </StaggerList>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="size-5 animate-spin text-[#a39e97]" />
            </div>
          )}

          <p className="text-center text-[10px] text-[#a39e97]">
            Periodo: {datePreset === 'hoy' ? 'Hoy' : datePreset === 'ayer' ? 'Ayer' : 'Últimos 7 días'}
            {' · '}Datos en tiempo real
          </p>
        </div>
      )}

      {/* Link to pending */}
      <FadeIn>
        <Link
          href="/admin/recetas/pending"
          className="flex items-center justify-between rounded-xl bg-card p-3 ring-1 ring-[#ebe6df] hover:bg-[#faf8f5]"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-[#fdf6ec]">
              <AlertTriangle className="size-4 text-[#d4943a]" />
            </div>
            <div>
              <p className="text-xs font-semibold text-[#3d2c24]">Ingredientes pendientes de revisión</p>
              <p className="text-[10px] text-[#a39e97]">Vincular ingredientes sin match automático</p>
            </div>
          </div>
          <ArrowLeft className="size-4 rotate-180 text-[#a39e97]" />
        </Link>
      </FadeIn>
    </FadeIn>
  )
}
