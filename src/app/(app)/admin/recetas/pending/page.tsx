'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Check, X, Pencil, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, XCircle, Package, Search,
  ArrowRight, ShieldCheck, Link2,
} from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import type { RecipeIngredientPendingLink } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PendingData = {
  items: RecipeIngredientPendingLink[]
  total: number
  counts: { pending: number; approved: number; rejected: number; manual: number }
}

type StockItemOption = { id: string; name: string; unit: string }

type StatusTab = 'pending' | 'approved' | 'rejected' | 'manual'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceBadge(conf: string, score: number) {
  if (conf === 'ambiguo') {
    return (
      <span className="rounded-full bg-[#fdf6ec] px-2 py-0.5 text-[10px] font-semibold text-[#d4943a]">
        revisar sugerencia · {score}
      </span>
    )
  }
  return (
    <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[10px] font-semibold text-[#ea504c]">
      elegir insumo Fudo · {score}
    </span>
  )
}

function sameId(a: string | number | null, b: string | number | null) {
  if (a === null || b === null) return false
  return String(a) === String(b)
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'approved' || status === 'manual') {
    return <CheckCircle2 className="size-4 text-[#006d5a]" />
  }
  if (status === 'rejected') {
    return <XCircle className="size-4 text-[#a39e97]" />
  }
  return <AlertTriangle className="size-4 text-[#d4943a]" />
}

// ---------------------------------------------------------------------------
// Manual assign dialog (inline, no library needed)
// ---------------------------------------------------------------------------

function ManualAssignPanel({
  link,
  stockItems,
  onSave,
  onCancel,
}: {
  link: RecipeIngredientPendingLink
  stockItems: StockItemOption[]
  onSave: (stockItemId: string, qty: number, unit: string) => Promise<void>
  onCancel: () => void
}) {
  const [search, setSearch] = useState('')
  const [selectedItem, setSelectedItem] = useState<StockItemOption | null>(null)
  const [qty, setQty] = useState(String(link.cantidad ?? ''))
  const [unit, setUnit] = useState(link.unidad ?? 'kg')
  const [saving, setSaving] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)

  const filtered = stockItems.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 20)

  async function handleSave() {
    if (!selectedItem) { toast.error('Seleccioná un insumo'); return }
    if (!qty || isNaN(Number(qty)) || Number(qty) <= 0) { toast.error('Cantidad inválida'); return }
    if (!unit.trim()) { toast.error('Indicá la unidad'); return }

    setSaving(true)
    try {
      await onSave(selectedItem.id, Number(qty), unit.trim())
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-xl bg-[#faf8f5] p-3 ring-1 ring-[#ebe6df]">
      <div>
        <p className="text-xs font-semibold text-[#3d2c24]">
          Elegir item real de stock para &quot;{link.ingredient_name}&quot;
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-[#7f776f]">
          Esto no crea ni modifica Fudo. Solo define qué item debe descontar esta receta.
        </p>
      </div>

      {/* Stock item search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
        <input
          value={selectedItem ? selectedItem.name : search}
          onChange={e => { setSearch(e.target.value); setSelectedItem(null); setShowDropdown(true) }}
          onFocus={() => setShowDropdown(true)}
          placeholder="Buscar item de Fudo/stock..."
          className="h-9 w-full rounded-lg border border-[#ebe6df] bg-white pl-8 pr-3 text-xs text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none"
        />
        {selectedItem && (
          <button
            onClick={() => { setSelectedItem(null); setSearch(''); setShowDropdown(false) }}
            className="absolute right-2 top-1/2 -translate-y-1/2"
          >
            <X className="size-3.5 text-[#a39e97]" />
          </button>
        )}
        {showDropdown && !selectedItem && filtered.length > 0 && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-[#ebe6df] bg-white shadow-lg">
            {filtered.map(item => (
              <button
                key={item.id}
                onClick={() => { setSelectedItem(item); setUnit(item.unit); setSearch(''); setShowDropdown(false) }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-[#f0f7f5]"
              >
                <span className="text-[#3d2c24]">{item.name}</span>
                <span className="text-[#a39e97]">{item.unit}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Qty + Unit */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[#a39e97]">
            Cantidad que descuenta por porción
          </label>
          <input
            type="number"
            min="0"
            step="0.001"
            value={qty}
            onChange={e => setQty(e.target.value)}
            placeholder="0.18"
            className="h-9 w-full rounded-lg border border-[#ebe6df] bg-white px-3 text-xs text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
          />
        </div>
        <div className="w-24">
          <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[#a39e97]">
            Unidad
          </label>
          <input
            value={unit}
            onChange={e => setUnit(e.target.value)}
            placeholder="kg"
            className="h-9 w-full rounded-lg border border-[#ebe6df] bg-white px-3 text-xs text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
          />
        </div>
      </div>

      {/* Corpus original hint */}
      {link.cantidad !== null && (
        <p className="text-[10px] text-[#a39e97]">
          Texto original: {link.cantidad} {link.unidad} · Unidad del item: {selectedItem?.unit ?? '—'}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving || !selectedItem}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#006d5a] py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          <Check className="size-3.5" />
          {saving ? 'Guardando…' : 'Vincular al stock'}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center justify-center rounded-lg bg-[#f3efe9] px-3 py-2 text-xs font-semibold text-[#3d2c24]"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single pending link row
// ---------------------------------------------------------------------------

function PendingLinkRow({
  link,
  stockItems,
  onResolved,
}: {
  link: RecipeIngredientPendingLink
  stockItems: StockItemOption[]
  onResolved: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)

  async function resolve(action: 'approve' | 'reject') {
    setLoading(action)
    try {
      const res = await fetch(`/api/recipes/pending-links/${link.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error')
      toast.success(json.message)
      onResolved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(null)
    }
  }

  async function resolveManual(stockItemId: string, qty: number, unit: string) {
    const res = await fetch(`/api/recipes/pending-links/${link.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'manual', stock_item_id: stockItemId, qty_per_portion: qty, unit }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Error')
    toast.success(json.message)
    setShowManual(false)
    onResolved()
  }

  const isPending = link.status === 'pending'

  return (
    <div className={`overflow-hidden rounded-xl border bg-card transition-all ${
      link.status !== 'pending' ? 'opacity-60' : ''
    }`}>
      {/* Main row */}
      <div className="flex items-start gap-3 p-3">
        <StatusIcon status={link.status} />

        <div className="min-w-0 flex-1">
          {/* Ingredient name */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-[#3d2c24]">{link.ingredient_name}</span>
            {confidenceBadge(link.match_confidence, link.match_score ?? 0)}
          </div>

          {/* Recipe */}
          <p className="mt-0.5 text-[11px] text-[#a39e97]">
            Receta: <span className="font-medium text-[#3d2c24]">{link.recipe_name}</span>
            {link.cantidad !== null && (
              <span> · Texto original: {link.cantidad} {link.unidad}</span>
            )}
          </p>

          {/* Suggested match */}
          {link.suggested_stock_item_name && (
            <p className="mt-1 text-[11px] text-[#3d2c24]">
              Sugerencia de LVE:{' '}
              <span className="font-medium text-[#d4943a]">{link.suggested_stock_item_name}</span>
            </p>
          )}

          {/* Resolved info */}
          {link.status !== 'pending' && link.resolved_stock_item_id && (
            <p className="mt-1 text-[11px] text-[#006d5a]">
              Vinculado a stock: {
                stockItems.find(s => sameId(s.id, link.resolved_stock_item_id))?.name ?? `item #${link.resolved_stock_item_id}`
              }
              {link.resolved_qty_per_portion !== null && ` · ${link.resolved_qty_per_portion} ${link.resolved_unit ?? ''}/porción`}
            </p>
          )}
          {link.status === 'rejected' && (
            <p className="mt-1 text-[11px] text-[#a39e97]">Descartado sin vincular</p>
          )}
        </div>

        {/* Expand reasons */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 rounded-lg p-1.5 text-[#a39e97] hover:bg-[#f3efe9] hover:text-[#3d2c24]"
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>

      {/* Reasons expanded */}
      {expanded && (
        <div className="border-t border-[#ebe6df] bg-[#faf8f5] px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#a39e97]">
            Por qué LVE lo marcó
          </p>
          {link.match_reasons && link.match_reasons.length > 0 ? (
            <ul className="space-y-0.5">
              {link.match_reasons.map((r, i) => (
                <li key={i} className="text-[11px] text-[#a39e97]">· {r}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-[#a39e97]">Sin explicación automática.</p>
          )}
        </div>
      )}

      {/* Actions (only for pending) */}
      {isPending && !showManual && (
        <div className="flex gap-2 border-t border-[#ebe6df] px-3 py-2">
          {/* Approve (only if there's a suggestion) */}
          {link.suggested_stock_item_id && (
            <button
              onClick={() => resolve('approve')}
              disabled={loading !== null}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#e8f5f1] py-1.5 text-xs font-semibold text-[#006d5a] disabled:opacity-50 hover:bg-[#006d5a] hover:text-white transition-colors"
            >
              <Check className="size-3.5" />
              {loading === 'approve' ? 'Vinculando…' : `Usar sugerido: ${link.suggested_stock_item_name ?? ''}`}
            </button>
          )}

          {/* Manual assign */}
          <button
            onClick={() => setShowManual(true)}
            disabled={loading !== null}
            className="flex items-center justify-center gap-1 rounded-lg bg-[#fdf6ec] px-3 py-1.5 text-xs font-semibold text-[#d4943a] hover:bg-[#d4943a] hover:text-white transition-colors"
          >
            <Pencil className="size-3.5" />
            Elegir otro
          </button>

          {/* Reject */}
          <button
            onClick={() => resolve('reject')}
            disabled={loading !== null}
            className="flex items-center justify-center rounded-lg bg-[#fef2f2] px-2.5 py-1.5 text-[#ea504c] hover:bg-[#ea504c] hover:text-white transition-colors"
            title="Descartar: esta receta no descuenta stock por este ingrediente"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Manual assign panel */}
      {isPending && showManual && (
        <div className="border-t border-[#ebe6df] px-3 py-2">
          <ManualAssignPanel
            link={link}
            stockItems={stockItems}
            onSave={resolveManual}
            onCancel={() => setShowManual(false)}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ExplainerCard() {
  return (
    <div className="space-y-3 rounded-2xl bg-[#fffaf2] p-4 ring-1 ring-[#eadfce]">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#e8f5f1] text-[#006d5a]">
          <Link2 className="size-5" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-[#3d2c24]">Qué se resuelve acá</h2>
          <p className="mt-1 text-xs leading-relaxed text-[#7f776f]">
            Cada fila es un ingrediente escrito en una receta. Antes de usar esa receta para
            producción, ventas o alertas, LVE necesita saber qué item de Fudo/stock descuenta
            y cuánto descuenta por porción.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-center">
        <div className="rounded-xl bg-white px-2 py-2 ring-1 ring-[#ebe6df]">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">1. Receta</p>
          <p className="mt-0.5 text-[11px] font-semibold text-[#3d2c24]">Ingrediente escrito</p>
        </div>
        <ArrowRight className="size-4 text-[#c8bfb6]" />
        <div className="rounded-xl bg-white px-2 py-2 ring-1 ring-[#ebe6df]">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">2. Stock</p>
          <p className="mt-0.5 text-[11px] font-semibold text-[#3d2c24]">Item Fudo real</p>
        </div>
        <ArrowRight className="size-4 text-[#c8bfb6]" />
        <div className="rounded-xl bg-white px-2 py-2 ring-1 ring-[#ebe6df]">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">3. Control</p>
          <p className="mt-0.5 text-[11px] font-semibold text-[#3d2c24]">Descuento correcto</p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-white p-3 ring-1 ring-[#ebe6df]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#006d5a]" />
        <p className="text-[11px] leading-relaxed text-[#6f665f]">
          Esta pantalla no cambia cantidades ni pisa Fudo. Solo corrige el vínculo receta → stock.
          Si el item no existe en Fudo/stock, primero hay que resolverlo desde la matriz de stock.
        </p>
      </div>
    </div>
  )
}

export default function PendingLinksPage() {
  const [data, setData] = useState<PendingData | null>(null)
  const [stockItems, setStockItems] = useState<StockItemOption[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<StatusTab>('pending')
  const [search, setSearch] = useState('')
  const [groupByRecipe, setGroupByRecipe] = useState(true)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [pendingRes, stockRes] = await Promise.all([
        fetch(`/api/recipes/pending-links?status=${activeTab}`),
        createClient().from('stock_items').select('id, name, unit').eq('is_active', true).order('name'),
      ])

      const pendingJson = await pendingRes.json()
      if (pendingJson.error) {
        toast.error(pendingJson.error)
        return
      }
      setData(pendingJson)

      const { data: items } = await stockRes
      setStockItems((items ?? []).map(item => ({
        id: String(item.id),
        name: item.name,
        unit: item.unit,
      })))
    } catch {
      toast.error('Error al cargar datos')
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = (data?.items ?? []).filter(item =>
    search.trim() === '' ||
    item.ingredient_name.toLowerCase().includes(search.toLowerCase()) ||
    item.recipe_name.toLowerCase().includes(search.toLowerCase()) ||
    (item.suggested_stock_item_name ?? '').toLowerCase().includes(search.toLowerCase())
  )

  // Group by recipe
  const grouped = new Map<string, RecipeIngredientPendingLink[]>()
  for (const item of filtered) {
    const key = item.recipe_name
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(item)
  }

  function toggleGroup(recipeName: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(recipeName)) next.delete(recipeName)
      else next.add(recipeName)
      return next
    })
  }

  const tabs: { key: StatusTab; label: string; color: string }[] = [
    { key: 'pending', label: 'A revisar', color: '#d4943a' },
    { key: 'approved', label: 'Sugeridos OK', color: '#006d5a' },
    { key: 'manual', label: 'Manual OK', color: '#006d5a' },
    { key: 'rejected', label: 'No descuenta', color: '#a39e97' },
  ]

  return (
    <FadeIn className="mx-auto max-w-lg space-y-5 pb-28">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin"
          className="flex size-9 items-center justify-center rounded-xl bg-secondary text-[#a39e97] hover:text-[#3d2c24]"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">
            Vincular recetas al stock Fudo
          </h1>
          <p className="section-label mt-0.5">Qué descuenta cada receta del stock real</p>
        </div>
      </div>

      {/* Aviso: pantalla obsoleta para el flujo normal */}
      <div className="flex items-start gap-3 rounded-2xl bg-[#fdf6ec] p-4 ring-1 ring-[#f0dfc0]">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#d4943a]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#8a5a19]">
            Esta pantalla quedó para casos raros
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-[#8a5a19]/80">
            Las recetas ahora se vinculan solas con el importador de Fudo.
          </p>
          <Link
            href="/admin/fudo/importar"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#8b5e34] underline underline-offset-2 hover:text-[#3d2c24]"
          >
            Ir al importador de Fudo
            <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </div>

      <ExplainerCard />

      {/* Status counts */}
      {data && (
        <div className="grid grid-cols-4 gap-2">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`rounded-xl p-2.5 text-center transition-all ${
                activeTab === t.key
                  ? 'bg-[#006d5a] text-white shadow-sm'
                  : 'bg-card ring-1 ring-[#ebe6df]'
              }`}
            >
              <p className={`font-display text-xl font-bold tabular-nums ${activeTab === t.key ? 'text-white' : ''}`}
                 style={{ color: activeTab === t.key ? undefined : t.color }}>
                {data.counts?.[t.key] ?? 0}
              </p>
              <p className={`text-[9px] font-semibold uppercase tracking-wider ${
                activeTab === t.key ? 'text-white/80' : 'text-[#a39e97]'
              }`}>
                {t.label}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Search + group toggle */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
          <Input
            placeholder="Buscar ingrediente, receta o insumo Fudo…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="rounded-xl border-[#ebe6df] bg-[#faf8f5] pl-10"
          />
        </div>
        <button
          onClick={() => setGroupByRecipe(g => !g)}
          className={`rounded-xl px-3 text-xs font-semibold transition-colors ${
            groupByRecipe
              ? 'bg-[#006d5a] text-white'
              : 'bg-secondary text-[#a39e97]'
          }`}
        >
          {groupByRecipe ? 'Por receta' : 'Lista'}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <LoadingState message="Cargando pendientes…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={activeTab === 'pending' ? CheckCircle2 : Package}
          title={activeTab === 'pending' ? '¡Todo resuelto!' : 'Sin resultados'}
          description={
            activeTab === 'pending'
              ? 'No quedan ingredientes por asociar con stock/Fudo.'
              : 'No hay ítems en esta categoría.'
          }
        />
      ) : groupByRecipe ? (
        <StaggerList className="space-y-4">
          {[...grouped.entries()].map(([recipeName, items]) => {
            const isCollapsed = collapsedGroups.has(recipeName)
            return (
              <StaggerItem key={recipeName}>
                <div className="overflow-hidden rounded-2xl ring-1 ring-[#ebe6df]">
                  <button
                    onClick={() => toggleGroup(recipeName)}
                    className="flex w-full items-center justify-between bg-card px-4 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[#3d2c24]">{recipeName}</span>
                      <span className="rounded-full bg-[#fdf6ec] px-2 py-0.5 text-[10px] font-bold text-[#d4943a]">
                        {items.length} vínculos
                      </span>
                    </div>
                    {isCollapsed
                      ? <ChevronDown className="size-4 text-[#a39e97]" />
                      : <ChevronUp className="size-4 text-[#a39e97]" />
                    }
                  </button>

                  {!isCollapsed && (
                    <div className="space-y-px border-t border-[#ebe6df] bg-[#faf8f5] p-2">
                      {items.map(link => (
                        <PendingLinkRow
                          key={link.id}
                          link={link}
                          stockItems={stockItems}
                          onResolved={fetchData}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </StaggerItem>
            )
          })}
        </StaggerList>
      ) : (
        <StaggerList className="space-y-2">
          {filtered.map(link => (
            <StaggerItem key={link.id}>
              <PendingLinkRow
                link={link}
                stockItems={stockItems}
                onResolved={fetchData}
              />
            </StaggerItem>
          ))}
        </StaggerList>
      )}

      {/* Contextual help */}
      {activeTab === 'pending' && (data?.counts.pending ?? 0) > 0 && !loading && (
        <div className="rounded-xl bg-[#fdf6ec] p-3 ring-1 ring-[#d4943a]/20">
          <p className="text-xs text-[#d4943a]">
            <strong>Regla de trabajo:</strong> si la receta usa mercadería real, vinculala a un
            item de Fudo/stock. Descartá solo ingredientes que no querés controlar como stock
            separado, por ejemplo condimentos sin medida exacta.
          </p>
        </div>
      )}
    </FadeIn>
  )
}
