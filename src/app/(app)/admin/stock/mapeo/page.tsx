'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Link2, Unlink, Search, Package, ChevronDown,
  ChevronUp, Check, X, ExternalLink, Loader2, RefreshCw, AlertTriangle, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/input'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Suggestion = {
  fudo_id: string
  fudo_name: string
  fudo_type: 'ingredient' | 'product'
  score: number
  stock: number | null
  cost: number | null
}

type UnlinkedItem = {
  id: string
  name: string
  category: string
  unit: string
  current_qty: number
  fudo_skip: boolean
  suggestions: Suggestion[]
  best_score: number
}

type BrokenLink = {
  id: string
  name: string
  category: string | null
  unit: string
  current_qty: number
  fudo_ingredient_id: string | null
  fudo_product_id: string | null
  broken_type: 'ingredient' | 'product'
  broken_fudo_id: string
}

type MappingData = {
  unlinked: UnlinkedItem[]
  broken_links: BrokenLink[]
  linked_count: number
  unlinked_count: number
  skipped_count: number
  fudo_ingredients_count: number
  fudo_products_count: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreBadge(score: number) {
  if (score >= 80) {
    return (
      <span className="rounded-full bg-[#e8f5e9] px-2 py-0.5 text-[10px] font-bold text-[#006d5a]">
        {score}
      </span>
    )
  }
  if (score >= 50) {
    return (
      <span className="rounded-full bg-[#fdf6ec] px-2 py-0.5 text-[10px] font-bold text-[#d4943a]">
        {score}
      </span>
    )
  }
  return (
    <span className="rounded-full bg-[#f5f0eb] px-2 py-0.5 text-[10px] font-bold text-[#a39e97]">
      {score}
    </span>
  )
}

function typeBadge(type: 'ingredient' | 'product') {
  return type === 'ingredient' ? (
    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-blue-600">
      ing
    </span>
  ) : (
    <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-purple-600">
      prod
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function StockMappingPage() {
  const [data, setData] = useState<MappingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'with_match' | 'no_match' | 'skipped'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [showLinked, setShowLinked] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/stock/mapping')
      if (!res.ok) throw new Error('Error cargando datos')
      const json = await res.json()
      setData(json)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleLink(stockItemId: string, suggestion: Suggestion) {
    setActionLoading(stockItemId)
    try {
      const res = await fetch('/api/admin/stock/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_item_id: stockItemId,
          action: 'link',
          fudo_id: suggestion.fudo_id,
          fudo_type: suggestion.fudo_type,
        }),
      })
      if (!res.ok) throw new Error('Error al vincular')
      toast.success(`Vinculado con "${suggestion.fudo_name}"`)
      // Remove from list
      setData(prev => prev ? {
        ...prev,
        unlinked: prev.unlinked.filter(i => i.id !== stockItemId),
        linked_count: prev.linked_count + 1,
        unlinked_count: prev.unlinked_count - 1,
      } : null)
      setExpandedId(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleSkip(stockItemId: string, skip: boolean) {
    setActionLoading(stockItemId)
    try {
      const res = await fetch('/api/admin/stock/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_item_id: stockItemId,
          action: skip ? 'skip' : 'unskip',
        }),
      })
      if (!res.ok) throw new Error('Error')
      toast.success(skip ? 'Marcado sin equivalente en Fudo' : 'Desmarcado')
      setData(prev => {
        if (!prev) return null
        return {
          ...prev,
          skipped_count: prev.skipped_count + (skip ? 1 : -1),
          unlinked: prev.unlinked.map(i =>
            i.id === stockItemId ? { ...i, fudo_skip: skip } : i,
          ),
        }
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleUnlink(stockItemId: string, name: string) {
    setActionLoading(stockItemId)
    try {
      const res = await fetch('/api/admin/stock/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_item_id: stockItemId, action: 'unlink' }),
      })
      if (!res.ok) throw new Error('Error al desvincular')
      toast.success(`"${name}" desvinculado de Fudo — queda como local`)
      setData(prev => prev ? {
        ...prev,
        broken_links: prev.broken_links.filter(b => b.id !== stockItemId),
      } : null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDeactivate(stockItemId: string, name: string) {
    setActionLoading(stockItemId)
    try {
      const res = await fetch('/api/admin/stock/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_item_id: stockItemId, action: 'deactivate' }),
      })
      if (!res.ok) throw new Error('Error al desactivar')
      toast.success(`"${name}" desactivado y quitado de la app`)
      setData(prev => prev ? {
        ...prev,
        broken_links: prev.broken_links.filter(b => b.id !== stockItemId),
        linked_count: Math.max(0, prev.linked_count - 1),
      } : null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setActionLoading(null)
    }
  }

  // Filter items
  const filtered = (data?.unlinked ?? []).filter(item => {
    if (search) {
      const s = search.toLowerCase()
      if (!item.name.toLowerCase().includes(s)) return false
    }
    if (filter === 'with_match') return item.best_score >= 50 && !item.fudo_skip
    if (filter === 'no_match') return item.best_score < 50 && !item.fudo_skip
    if (filter === 'skipped') return item.fudo_skip
    return true
  })

  if (loading) return <LoadingState text="Cargando mapeo Fudo..." />

  if (!data) {
    return <EmptyState title="Error" description="No se pudo cargar el mapeo" />
  }

  return (
    <FadeIn className="space-y-4 px-4 pt-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin" className="rounded-full p-1.5 hover:bg-[#f5f0eb]">
          <ArrowLeft className="size-5 text-[#3d2c24]" />
        </Link>
        <div>
          <h1 className="font-display text-lg font-bold text-[#3d2c24]">
            Mapeo Stock ↔ Fudo
          </h1>
          <p className="text-xs text-[#a39e97]">
            Vinculá items de stock con ingredientes/productos de Fudo
          </p>
        </div>
        <button
          onClick={fetchData}
          className="ml-auto rounded-full p-2 hover:bg-[#f5f0eb]"
          title="Recargar"
        >
          <RefreshCw className={`size-4 text-[#a39e97] ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Vínculos rotos — productos borrados en Fudo */}
      {(data.broken_links?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-[#f3d0cf] bg-[#fff7f7] p-3">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="size-4 text-[#ea504c]" />
            <div>
              <p className="text-sm font-bold text-[#3d2c24]">
                {data.broken_links.length} vínculo{data.broken_links.length !== 1 ? 's' : ''} roto{data.broken_links.length !== 1 ? 's' : ''}
              </p>
              <p className="text-[10px] text-[#7d6c64]">
                Estos items apuntan a productos/ingredientes que ya no existen en Fudo
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {data.broken_links.map(item => (
              <div key={item.id} className="rounded-lg bg-white border border-[#f3d0cf] p-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#3d2c24] truncate">{item.name}</p>
                    <p className="text-[10px] text-[#7d6c64]">
                      {item.category ?? 'sin categoría'} · {item.current_qty} {item.unit}
                    </p>
                    <p className="text-[9px] text-[#ea504c] mt-0.5">
                      {item.broken_type === 'ingredient' ? 'Ingrediente' : 'Producto'} Fudo #{item.broken_fudo_id} — ya no existe
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUnlink(item.id, item.name)}
                    disabled={actionLoading === item.id}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#f5f0eb] px-3 py-2 text-[11px] font-semibold text-[#3d2c24] hover:bg-[#ebe5de] disabled:opacity-50"
                  >
                    {actionLoading === item.id ? <Loader2 className="size-3 animate-spin" /> : <Unlink className="size-3" />}
                    Usar sin Fudo
                  </button>
                  <button
                    onClick={() => handleDeactivate(item.id, item.name)}
                    disabled={actionLoading === item.id}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#fef2f2] px-3 py-2 text-[11px] font-semibold text-[#ea504c] hover:bg-[#fee2e2] disabled:opacity-50"
                  >
                    {actionLoading === item.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                    Desactivar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-xl bg-[#e8f5e9] p-3 text-center">
          <p className="text-xl font-bold text-[#006d5a]">{data.linked_count}</p>
          <p className="text-[10px] font-medium text-[#006d5a]/70">Vinculados</p>
        </div>
        <div className="rounded-xl bg-[#fdf6ec] p-3 text-center">
          <p className="text-xl font-bold text-[#d4943a]">
            {data.unlinked_count - (data.skipped_count ?? 0)}
          </p>
          <p className="text-[10px] font-medium text-[#d4943a]/70">Pendientes</p>
        </div>
        <div className="rounded-xl bg-[#f5f0eb] p-3 text-center">
          <p className="text-xl font-bold text-[#a39e97]">{data.skipped_count}</p>
          <p className="text-[10px] font-medium text-[#a39e97]/70">Sin Fudo</p>
        </div>
        <div className={`rounded-xl p-3 text-center ${(data.broken_links?.length ?? 0) > 0 ? 'bg-[#fff7f7]' : 'bg-[#f5f0eb]'}`}>
          <p className={`text-xl font-bold ${(data.broken_links?.length ?? 0) > 0 ? 'text-[#ea504c]' : 'text-[#a39e97]'}`}>
            {data.broken_links?.length ?? 0}
          </p>
          <p className={`text-[10px] font-medium ${(data.broken_links?.length ?? 0) > 0 ? 'text-[#ea504c]/70' : 'text-[#a39e97]/70'}`}>
            Rotos
          </p>
        </div>
      </div>

      <p className="text-center text-[10px] text-[#a39e97]">
        Fudo: {data.fudo_ingredients_count} ingredientes + {data.fudo_products_count} productos
      </p>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
        <Input
          placeholder="Buscar item de stock..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Filter pills */}
      <div className="flex gap-1.5 overflow-x-auto">
        {([
          ['all', 'Todos'],
          ['with_match', 'Con match'],
          ['no_match', 'Sin match'],
          ['skipped', 'Sin Fudo'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${
              filter === key
                ? 'bg-[#3d2c24] text-white'
                : 'bg-[#f5f0eb] text-[#3d2c24] hover:bg-[#ebe5de]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Item list */}
      {filtered.length === 0 ? (
        <EmptyState title="Sin resultados" description="No hay items que coincidan" />
      ) : (
        <StaggerList className="space-y-2">
          {filtered.map(item => (
            <StaggerItem key={item.id}>
              <div
                className={`rounded-xl border transition ${
                  item.fudo_skip
                    ? 'border-[#e5dfd8] bg-[#faf8f5] opacity-60'
                    : 'border-[#e5dfd8] bg-white'
                }`}
              >
                {/* Item header */}
                <button
                  className="flex w-full items-center gap-3 p-3 text-left"
                  onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                >
                  <div className="flex size-8 items-center justify-center rounded-lg bg-[#f5f0eb]">
                    {item.fudo_skip ? (
                      <Unlink className="size-4 text-[#a39e97]" />
                    ) : (
                      <Package className="size-4 text-[#3d2c24]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#3d2c24]">
                      {item.name}
                    </p>
                    <p className="text-[10px] text-[#a39e97]">
                      {item.category} · {item.current_qty} {item.unit}
                    </p>
                  </div>
                  {item.best_score > 0 && !item.fudo_skip && scoreBadge(item.best_score)}
                  {item.fudo_skip && (
                    <span className="text-[10px] font-medium text-[#a39e97]">sin Fudo</span>
                  )}
                  {expandedId === item.id ? (
                    <ChevronUp className="size-4 text-[#a39e97]" />
                  ) : (
                    <ChevronDown className="size-4 text-[#a39e97]" />
                  )}
                </button>

                {/* Expanded suggestions */}
                {expandedId === item.id && (
                  <div className="border-t border-[#e5dfd8] px-3 pb-3 pt-2">
                    {item.suggestions.length === 0 ? (
                      <p className="py-2 text-center text-xs text-[#a39e97]">
                        Sin sugerencias de match en Fudo
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-medium text-[#a39e97]">
                          Sugerencias de Fudo:
                        </p>
                        {item.suggestions.map(sug => (
                          <div
                            key={`${sug.fudo_type}-${sug.fudo_id}`}
                            className="flex items-center gap-2 rounded-lg bg-[#faf8f5] p-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                {typeBadge(sug.fudo_type)}
                                <p className="truncate text-xs font-medium text-[#3d2c24]">
                                  {sug.fudo_name}
                                </p>
                              </div>
                              <p className="mt-0.5 text-[10px] text-[#a39e97]">
                                Stock: {sug.stock ?? '?'}
                                {sug.cost ? ` · $${Math.round(sug.cost)}` : ''}
                              </p>
                            </div>
                            {scoreBadge(sug.score)}
                            <button
                              onClick={() => handleLink(item.id, sug)}
                              disabled={actionLoading === item.id}
                              className="flex items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[10px] font-bold text-white transition hover:bg-[#005a4a] disabled:opacity-50"
                            >
                              {actionLoading === item.id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Link2 className="size-3" />
                              )}
                              Vincular
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Skip / Unskip button */}
                    <div className="mt-3 flex justify-end">
                      {item.fudo_skip ? (
                        <button
                          onClick={() => handleSkip(item.id, false)}
                          disabled={actionLoading === item.id}
                          className="flex items-center gap-1.5 rounded-lg border border-[#e5dfd8] px-3 py-1.5 text-xs font-medium text-[#3d2c24] hover:bg-[#f5f0eb]"
                        >
                          <Link2 className="size-3" />
                          Reactivar búsqueda
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSkip(item.id, true)}
                          disabled={actionLoading === item.id}
                          className="flex items-center gap-1.5 rounded-lg border border-[#e5dfd8] px-3 py-1.5 text-xs font-medium text-[#a39e97] hover:bg-[#fef2f2] hover:text-[#ea504c]"
                        >
                          <X className="size-3" />
                          Sin equivalente en Fudo
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </StaggerItem>
          ))}
        </StaggerList>
      )}
    </FadeIn>
  )
}
