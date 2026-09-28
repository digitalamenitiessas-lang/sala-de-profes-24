'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Shield, Clock, User, Package, Coffee, ShoppingCart,
  Bell, FileText, ChevronDown, Loader2, Search,
  LogIn, LogOut, Pencil, Plus, ArrowRightLeft, ArrowLeft,
  Wine, ChefHat, Check, ClipboardCheck, Truck,
  TrendingUp, TrendingDown,
} from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { FadeIn } from '@/components/ui/motion'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AuditEntry = {
  id: number
  user_id: string | null
  user_name: string | null
  action: string
  module: string
  entity_type: string | null
  entity_id: string | null
  description: string
  metadata: Record<string, unknown> | null
  created_at: string
}

const MODULE_CONFIG: Record<string, { label: string; icon: typeof Shield; color: string; bg: string }> = {
  asistencia: { label: 'Asistencia', icon: Clock, color: '#006d5a', bg: '#e8f5f1' },
  stock: { label: 'Stock', icon: Package, color: '#8b5e34', bg: '#faf0e4' },
  barra: { label: 'Barra', icon: Coffee, color: '#2d7d6a', bg: '#e8f5f1' },
  pedidos: { label: 'Pedidos', icon: ShoppingCart, color: '#d4943a', bg: '#fdf6ec' },
  avisos: { label: 'Avisos', icon: Bell, color: '#4a90d9', bg: '#eef4fc' },
  expedientes: { label: 'Expedientes', icon: FileText, color: '#8b5e34', bg: '#faf0e4' },
  vajilla: { label: 'Vajilla', icon: Wine, color: '#a39e97', bg: '#f3efe9' },
  auth: { label: 'Acceso', icon: LogIn, color: '#006d5a', bg: '#e8f5f1' },
  produccion: { label: 'Producción', icon: ChefHat, color: '#006d5a', bg: '#e8f5f1' },
  proveedores: { label: 'Proveedores', icon: Truck, color: '#d4943a', bg: '#fdf6ec' },
}

const ACTION_ICONS: Record<string, typeof Shield> = {
  clock_in: LogIn,
  clock_out: LogOut,
  stock_update: Pencil,
  bar_stock_update: Pencil,
  order_created: Plus,
  order_status: ArrowRightLeft,
  announcement_created: Bell,
  vajilla_update: Pencil,
  vajilla_created: Plus,
  expediente_created: Plus,
  expediente_status: ArrowRightLeft,
  task_created: Plus,
  task_status: ArrowRightLeft,
  create_production_order: Plus,
  complete_production_order: ClipboardCheck,
  physical_count: Check,
  assign_order_supplier: Truck,
}

// ---------------------------------------------------------------------------
// Cambios de cantidad de stock — badge visual "X → Y"
// ---------------------------------------------------------------------------

const QTY_CHANGE_ACTIONS = new Set(['fudo_stock_sync', 'physical_count', 'stock_update'])

type QtyChange = {
  oldQty: number
  newQty: number
  itemName: string | null
  context: string | null
}

/** Detecta entradas de stock con metadata.old_qty/new_qty para render visual */
function getQtyChange(entry: AuditEntry): QtyChange | null {
  if (!QTY_CHANGE_ACTIONS.has(entry.action) || !entry.metadata) return null
  const oldQty = Number(entry.metadata.old_qty)
  const newQty = Number(entry.metadata.new_qty)
  if (!Number.isFinite(oldQty) || !Number.isFinite(newQty)) return null

  // La descripción tiene el formato "Nombre del item: X → Y (contexto)"
  const colonIdx = entry.description.indexOf(':')
  const itemName = colonIdx > 0 ? entry.description.slice(0, colonIdx).trim() : null
  const parens = entry.description.match(/\(([^()]*)\)\s*$/)

  return { oldQty, newQty, itemName, context: parens?.[1] ?? null }
}

function formatAuditQty(value: number): string {
  return Number(value.toFixed(2)).toLocaleString('es-AR')
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AuditoriaPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)

  // Filters
  const [moduleFilter, setModuleFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<string>('')

  const PAGE_SIZE = 50

  const fetchEntries = useCallback(async (pageNum: number, append = false) => {
    if (pageNum === 0) setLoading(true)
    else setLoadingMore(true)

    try {
      const supabase = createClient()
      let query = supabase
        .from('audit_trail')
        .select('*')
        // El espejo de Fudo generaba una fila anónima por cada cantidad que
        // cambiaba (3.522 en 30 días). Ya no se escriben más (migración
        // 20260907), pero las históricas se ocultan acá: la auditoría muestra
        // lo que hicieron personas.
        .or('action.neq.stock_update,user_id.not.is.null')
        .order('created_at', { ascending: false })
        .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)

      if (moduleFilter !== 'all') {
        query = query.eq('module', moduleFilter)
      }
      if (dateFilter) {
        query = query.gte('created_at', dateFilter + 'T00:00:00')
          .lte('created_at', dateFilter + 'T23:59:59')
      }
      if (searchQuery.trim()) {
        query = query.or(`description.ilike.%${searchQuery.trim()}%,user_name.ilike.%${searchQuery.trim()}%`)
      }

      const { data } = await query
      const newEntries = data ?? []

      if (append) {
        setEntries(prev => [...prev, ...newEntries])
      } else {
        setEntries(newEntries)
      }
      setHasMore(newEntries.length === PAGE_SIZE)
    } catch (err) {
      console.error('Error fetching audit:', err)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [moduleFilter, dateFilter, searchQuery])

  useEffect(() => {
    if (profileLoading) return
    setPage(0)
    fetchEntries(0)
  }, [profileLoading, fetchEntries])

  const loadMore = () => {
    const nextPage = page + 1
    setPage(nextPage)
    fetchEntries(nextPage, true)
  }

  // Access check: socios + Ricardo Marquez
  const RICARDO_ID = 'd058c880-9ec3-4205-be49-84476da0b2d6'
  const canAccess = profile?.role === 'socio' || profile?.id === RICARDO_ID

  if (profileLoading) return <LoadingState />

  if (!canAccess) {
    return <EmptyState icon={Shield} title="Sin acceso" description="Solo socios y auditores pueden ver esta sección." />
  }

  // Group entries by date
  const groupedByDate = entries.reduce<Record<string, AuditEntry[]>>((acc, entry) => {
    const dateKey = entry.created_at.slice(0, 10)
    if (!acc[dateKey]) acc[dateKey] = []
    acc[dateKey].push(entry)
    return acc
  }, {})

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-28">
      {/* Header */}
      <FadeIn>
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex size-10 items-center justify-center rounded-xl bg-[#f3efe9] transition-colors hover:bg-[#ebe6df]"
            aria-label="Volver al inicio"
          >
            <ArrowLeft className="size-5 text-[#3d2c24]" />
          </Link>
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#1a1a2e]">
            <Shield className="size-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Auditoría</h1>
            <p className="text-[11px] text-[#a39e97]">Registro de actividad del sistema</p>
          </div>
        </div>
      </FadeIn>

      {/* Filters */}
      <div className="space-y-2">
        {/* Search */}
        <div className="relative">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por descripción o persona..."
            className="w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] py-2.5 pl-10 pr-3 text-sm placeholder:text-[#a39e97] focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
          />
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
        </div>

        {/* Module filter + date */}
        <div className="flex gap-2">
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="flex-1 rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
          >
            <option value="all">Todos los módulos</option>
            {Object.entries(MODULE_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
          />
        </div>

        {/* Stats bar */}
        <div className="flex items-center justify-between rounded-xl bg-[#f8f5f0] px-4 py-2">
          <span className="text-xs text-[#a39e97]">{entries.length} registros</span>
          <div className="flex gap-3">
            {Object.entries(
              entries.reduce<Record<string, number>>((acc, e) => {
                acc[e.module] = (acc[e.module] ?? 0) + 1
                return acc
              }, {})
            ).slice(0, 4).map(([mod, count]) => {
              const cfg = MODULE_CONFIG[mod]
              return (
                <span key={mod} className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: cfg?.color ?? '#a39e97' }}>
                  {cfg?.label ?? mod}: {count}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-[#a39e97]" />
        </div>
      ) : entries.length === 0 ? (
        <EmptyState icon={Shield} title="Sin registros" description="No hay movimientos que coincidan con los filtros." />
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedByDate).map(([dateKey, dayEntries]) => (
            <div key={dateKey}>
              {/* Date header */}
              <div className="sticky top-[3.75rem] z-10 mb-2 flex items-center gap-2 bg-[#fefcf9] py-1">
                <div className="h-px flex-1 bg-[#ebe6df]" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#a39e97]">
                  {format(new Date(dateKey + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })}
                </span>
                <span className="rounded-full bg-[#f3efe9] px-2 py-0.5 text-[10px] font-bold text-[#a39e97]">
                  {dayEntries.length}
                </span>
                <div className="h-px flex-1 bg-[#ebe6df]" />
              </div>

              {/* Entries */}
              <div className="space-y-1">
                {dayEntries.map((entry) => {
                  const modCfg = MODULE_CONFIG[entry.module] ?? { label: entry.module, icon: Shield, color: '#a39e97', bg: '#f3efe9' }
                  const ActionIcon = ACTION_ICONS[entry.action] ?? modCfg.icon
                  const qtyChange = getQtyChange(entry)

                  return (
                    <div
                      key={entry.id}
                      className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[#faf8f5]"
                    >
                      {/* Icon */}
                      <div
                        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: modCfg.bg }}
                      >
                        <ActionIcon className="size-3.5" style={{ color: modCfg.color }} />
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        {qtyChange ? (
                          <div>
                            <p className="truncate text-sm font-semibold text-[#3d2c24]">
                              {qtyChange.itemName ?? entry.description}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {(() => {
                                const delta = qtyChange.newQty - qtyChange.oldQty
                                const down = delta < 0
                                const up = delta > 0
                                return (
                                  <>
                                    <span
                                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                                        down
                                          ? 'bg-[#fdecea] text-[#ea504c]'
                                          : up
                                            ? 'bg-[#e8f5f1] text-[#006d5a]'
                                            : 'bg-[#f3efe9] text-[#a39e97]'
                                      }`}
                                    >
                                      {formatAuditQty(qtyChange.oldQty)} → {formatAuditQty(qtyChange.newQty)}
                                      {up && <TrendingUp className="size-3" />}
                                      {down && <TrendingDown className="size-3" />}
                                    </span>
                                    {delta !== 0 && (
                                      <span
                                        className={`text-[10px] font-semibold tabular-nums ${down ? 'text-[#ea504c]' : 'text-[#006d5a]'}`}
                                      >
                                        {up ? '+' : ''}{formatAuditQty(delta)}
                                      </span>
                                    )}
                                    {qtyChange.context && (
                                      <span className="text-[10px] text-[#a39e97]">{qtyChange.context}</span>
                                    )}
                                  </>
                                )
                              })()}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-[#3d2c24]">{entry.description}</p>
                        )}
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          {entry.user_name && (
                            <span className="flex items-center gap-1 text-[10px] text-[#a39e97]">
                              <User className="size-2.5" />
                              {entry.user_name}
                            </span>
                          )}
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                            style={{ color: modCfg.color, backgroundColor: modCfg.bg }}
                          >
                            {modCfg.label}
                          </span>
                        </div>
                      </div>

                      {/* Time */}
                      <span className="shrink-0 text-[10px] tabular-nums text-[#a39e97]">
                        {format(new Date(entry.created_at), 'HH:mm')}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Load more */}
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#ebe6df] py-3 text-sm font-semibold text-[#a39e97] transition-colors hover:bg-[#faf8f5] disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="size-4 animate-spin" /> : <ChevronDown className="size-4" />}
              Cargar más
            </button>
          )}
        </div>
      )}
    </div>
  )
}
