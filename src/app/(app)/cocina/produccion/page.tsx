'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Plus, ChefHat, CheckCircle2, Clock, XCircle, ChevronRight,
  TrendingUp, AlertTriangle, Package, GitBranch, ShieldCheck,
  Sparkles, RefreshCw, ChevronDown, ChevronUp, Check, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProduccionOrders } from '@/lib/hooks/use-produccion'
import { BackToHoy } from '@/components/layout/BackToHoy'
import { LoHiceDialog } from '@/components/produccion/LoHiceDialog'
import type { ElaboradosPayload } from '@/lib/produccion/elaborados'

// ---------------------------------------------------------------------------
// Plan de producción IA — qué producir hoy según ventas × stock × vida útil
// ---------------------------------------------------------------------------

type PlanItem = {
  stock_item_id: string
  name: string
  unit: string
  current_qty: number
  expected_today: number
  pending_production: number
  suggested_qty: number
  reason: string
}

type ProductionPlanResponse = {
  today: string
  items: PlanItem[]
  sellingWithoutStock: { name: string; avg_daily_sales: number; current_qty: number }[]
  analysis: string
}

function PlanIACard() {
  const [plan, setPlan] = useState<ProductionPlanResponse | null>(null)
  const [loadingPlan, setLoadingPlan] = useState(true)
  const [planError, setPlanError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const loadPlan = async () => {
    setLoadingPlan(true)
    setPlanError(null)
    try {
      const res = await fetch('/api/ai/production-plan', { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo generar el plan')
      setPlan(json)
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Error al generar el plan')
    } finally {
      setLoadingPlan(false)
    }
  }

  useEffect(() => { loadPlan() }, [])

  return (
    <div className="rounded-2xl bg-white ring-1 ring-[#ebe6df]">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#3d2c24]">
            <Sparkles className="size-3.5 text-white" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-[#3d2c24]">¿Qué producir hoy?</p>
            <p className="text-[10px] text-[#a39e97]">
              {loadingPlan ? 'Cruzando ventas, stock y vida útil…' : plan ? `Plan del ${plan.today} · según ventas reales de Fudo` : 'Plan IA'}
            </p>
          </div>
        </div>
        <button
          onClick={loadPlan}
          disabled={loadingPlan}
          className="rounded-lg bg-[#f3efe9] p-2 text-[#3d2c24] active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3.5', loadingPlan && 'animate-spin')} />
        </button>
      </div>

      {planError && <p className="px-4 pb-3 text-[11px] text-[#ea504c]">{planError}</p>}

      {plan && !loadingPlan && (
        <div className="border-t border-[#ebe6df]/60 px-4 py-3">
          {/* Urgente: vendiendo sin stock digital */}
          {plan.sellingWithoutStock.length > 0 && (
            <div className="mb-3 rounded-xl bg-[#fff7f7] px-3 py-2 ring-1 ring-[#f3d0cf]">
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#ea504c]">
                <AlertTriangle className="size-3.5" />
                Venden pero figuran sin stock — contar primero
              </p>
              <p className="mt-0.5 text-[11px] text-[#7d6c64]">
                {plan.sellingWithoutStock.map(s => s.name).join(' · ')}
              </p>
            </div>
          )}

          <p className="whitespace-pre-line text-xs leading-relaxed text-[#3d2c24]">{plan.analysis}</p>

          {plan.items.length > 0 && (
            <>
              <button
                onClick={() => setExpanded(e => !e)}
                className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-[#006d5a]"
              >
                {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                {expanded ? 'Ocultar detalle' : `Ver detalle (${plan.items.length} items)`}
              </button>
              {expanded && (
                <div className="mt-2 space-y-1.5">
                  {plan.items.map((item) => (
                    <div key={item.stock_item_id} className="flex items-center justify-between rounded-xl bg-[#faf8f5] px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[#3d2c24]">{item.name}</p>
                        <p className="text-[10px] text-[#a39e97]">{item.reason}</p>
                      </div>
                      <span className="ml-2 shrink-0 rounded-full bg-[#e8f5f1] px-2.5 py-1 text-[11px] font-bold text-[#006d5a]">
                        +{item.suggested_qty} {item.unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sugerencias con datos duros — demanda real por día de semana × stock × tanda
// ---------------------------------------------------------------------------

type Sugerencia = {
  recipe_id: string
  nombre: string
  stock_item_id: string
  stock_item_name: string
  unidad: string
  stock_actual: number
  stock_utilizable: number
  vencido_qty: number
  vence_proximo: string | null
  demanda_hoy: number
  demanda_maniana: number
  demanda_diaria_prom: number
  sugerido: number
  tanda_tipica: number | null
  cobertura_dias: number
  fuente_demanda: 'ventas_fudo' | 'movimientos_stock'
  reason: string
  /** con receta de producción: se puede registrar con "Lo hice" */
  tiene_receta?: boolean
}

type SugerenciasResponse = {
  generated_at: string
  hoy: string
  maniana: string
  ventana_dias: number
  items: Sugerencia[]
  sin_datos: string[]
  /** se usan todos los días pero su stock no se lleva */
  sin_control?: { stock_item_id: string; name: string; unidad: string; demanda_diaria: number }[]
}

function coberturaColor(dias: number) {
  if (dias < 1) return { bar: 'bg-[#ea504c]', text: 'text-[#ea504c]' }
  if (dias < 2) return { bar: 'bg-[#d4943a]', text: 'text-[#d4943a]' }
  return { bar: 'bg-[#006d5a]', text: 'text-[#006d5a]' }
}

function fmtQty(n: number) {
  return n % 1 === 0 ? String(n) : n.toLocaleString('es-AR', { maximumFractionDigits: 1 })
}

function SugerenciasCard() {
  const [data, setData] = useState<SugerenciasResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  // "Lo hice": trae el elaborado con su receta y abre el registro rápido
  const [loHice, setLoHice] = useState<{ payload: ElaboradosPayload; sugerido: number } | null>(null)
  const [abriendo, setAbriendo] = useState<string | null>(null)
  async function abrirLoHice(item: Sugerencia) {
    setAbriendo(item.stock_item_id)
    try {
      const res = await fetch(`/api/produccion/elaborados?item=${item.stock_item_id}`, { credentials: 'include' })
      if (!res.ok) throw new Error()
      setLoHice({ payload: await res.json(), sugerido: item.sugerido })
    } catch {
      toast.error('No se pudo abrir el registro')
    } finally {
      setAbriendo(null)
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/produccion/sugerencias', { credentials: 'include' })
      if (!res.ok) throw new Error()
      setData(await res.json())
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  // Fallback: sin datos duros (o error) → plan IA existente
  if (!loading && (failed || !data || data.items.length === 0)) {
    return <PlanIACard />
  }

  return (
    <div className="rounded-2xl bg-white ring-1 ring-[#ebe6df]">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#3d2c24]">
            <Sparkles className="size-3.5 text-white" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-[#3d2c24]">¿Qué producir hoy?</p>
            <p className="text-[10px] text-[#a39e97]">
              {loading
                ? 'Cruzando ventas por día de semana, stock y tandas…'
                : `Hoy ${data!.hoy} · ventas reales últimos ${data!.ventana_dias} días`}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg bg-[#f3efe9] p-2 text-[#3d2c24] active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {!loading && data && (
        <div className="border-t border-[#ebe6df]/60 px-4 py-3">
          <div className="space-y-2">
            {data.items.map((item) => {
              const color = coberturaColor(item.cobertura_dias)
              // Barra: cobertura sobre un horizonte de 3 días
              const pct = Math.max(4, Math.min(100, (item.cobertura_dias / 3) * 100))
              return (
                <div key={item.recipe_id} className="rounded-xl bg-[#faf8f5] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-[#3d2c24]">{item.nombre}</p>
                      <p className="text-[11px] text-[#7d6c64]">
                        Tenés {fmtQty(item.stock_utilizable)} {item.unidad} · se venden ~{fmtQty(item.demanda_hoy)} hoy
                        {item.demanda_maniana > 0 && ` y ~${fmtQty(item.demanda_maniana)} mañana`}
                      </p>
                    </div>
                    {item.tiene_receta ? (
                      <button
                        onClick={() => void abrirLoHice(item)}
                        disabled={abriendo === item.stock_item_id}
                        className="flex shrink-0 items-center gap-1 rounded-full bg-[#006d5a] px-2.5 py-1.5 text-[11px] font-bold text-white active:scale-95 disabled:opacity-60"
                      >
                        {abriendo === item.stock_item_id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        Lo hice{item.sugerido > 0 ? ` · ${fmtQty(item.sugerido)}` : ''}
                      </button>
                    ) : (
                      <Link
                        href={`/cocina/produccion/nueva?receta=${encodeURIComponent(item.recipe_id)}`}
                        className="flex shrink-0 items-center gap-1 rounded-full bg-[#006d5a] px-2.5 py-1.5 text-[11px] font-bold text-white active:scale-95"
                      >
                        <Plus className="size-3" />
                        {item.sugerido > 0 ? `${fmtQty(item.sugerido)} ${item.unidad}` : 'Producir'}
                      </Link>
                    )}
                  </div>

                  {/* Barra de cobertura (horizonte 3 días) */}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#ebe6df]">
                      <div className={cn('h-full rounded-full transition-all', color.bar)} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={cn('shrink-0 text-[10px] font-bold', color.text)}>
                      {item.cobertura_dias < 1 ? 'menos de 1 día' : `~${fmtQty(item.cobertura_dias)} d`}
                    </span>
                  </div>

                  <p className="mt-1 text-[10px] text-[#a39e97]">
                    {item.reason}
                    {item.tanda_tipica != null && item.sugerido > 0 && ` · tanda típica: ${fmtQty(item.tanda_tipica)} ${item.unidad}`}
                    {item.vence_proximo && ` · vence lote: ${item.vence_proximo.slice(8, 10)}/${item.vence_proximo.slice(5, 7)}`}
                  </p>
                </div>
              )
            })}
          </div>

          {data.sin_datos.length > 0 && (
            <p className="mt-2 text-[10px] text-[#a39e97]">
              Sin datos de venta todavía: {data.sin_datos.join(' · ')}
            </p>
          )}
          {(data.sin_control?.length ?? 0) > 0 && (
            <div className="mt-3 rounded-xl bg-[#fef7ed] px-3 py-2.5 ring-1 ring-[#d4943a]/20">
              <p className="text-[11px] font-semibold text-[#3d2c24]">Se usan todos los días pero su stock no se lleva</p>
              <p className="mt-0.5 text-[10.5px] leading-relaxed text-[#7d6c64]">
                {data.sin_control!.slice(0, 8).map((s) => `${s.name} (~${s.demanda_diaria}/día)`).join(' · ')}
                {data.sin_control!.length > 8 && ` · y ${data.sin_control!.length - 8} más`}
              </p>
              <Link href="/cocina/elaborados" className="mt-1 inline-block text-[10.5px] font-semibold text-[#006d5a] underline">Contarlos o cargar qué llevan →</Link>
            </div>
          )}
        </div>
      )}
      {loHice && (
        <LoHiceDialog
          elaborado={loHice.payload.elaborados[0]}
          puedeCerrar={loHice.payload.permisos.cerrar_produccion}
          sugerido={loHice.sugerido}
          onClose={() => setLoHice(null)}
          onDone={() => { setLoHice(null); void load() }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  draft:       { label: 'Borrador',    icon: Clock,         color: 'text-[#a39e97] bg-[#f5f2ee]' },
  in_progress: { label: 'En progreso', icon: Clock,         color: 'text-[#d4943a] bg-amber-50' },
  pending_review: { label: 'A validar', icon: ShieldCheck, color: 'text-[#d4943a] bg-amber-50' },
  completed:   { label: 'Completado',  icon: CheckCircle2,  color: 'text-[#006d5a] bg-[#e8f5f1]' },
  cancelled:   { label: 'Cancelado',   icon: XCircle,       color: 'text-[#ea504c] bg-red-50' },
}

function efficiencyColor(pct: number | null) {
  if (pct === null) return 'text-muted-foreground'
  if (pct >= 90) return 'text-[#006d5a]'
  if (pct >= 75) return 'text-[#d4943a]'
  return 'text-[#ea504c]'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProduccionPage() {
  const { orders, isLoading: loading } = useProduccionOrders(30)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const filtered = statusFilter === 'all'
    ? orders
    : orders.filter((o) => o.status === statusFilter)

  const counts = {
    all: orders.length,
    draft: orders.filter((o) => o.status === 'draft').length,
    in_progress: orders.filter((o) => o.status === 'in_progress').length,
    pending_review: orders.filter((o) => o.status === 'pending_review').length,
    completed: orders.filter((o) => o.status === 'completed').length,
  }

  const FILTERS = [
    { key: 'all',         label: 'Todas',       count: counts.all },
    { key: 'draft',       label: 'Borrador',    count: counts.draft },
    { key: 'in_progress', label: 'En curso',    count: counts.in_progress },
    { key: 'pending_review', label: 'A validar', count: counts.pending_review },
    { key: 'completed',   label: 'Completadas', count: counts.completed },
  ]

  return (
    <div className="min-h-screen bg-[#faf8f5] pb-28">
      <BackToHoy />
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#ebe6df] bg-[#faf8f5]/95 backdrop-blur-md">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-[#006d5a]/10">
                <ChefHat className="size-4 text-[#006d5a]" strokeWidth={1.75} />
              </div>
              <div>
                <h1 className="text-[15px] font-semibold text-[#3d2c24]">Producción</h1>
                <p className="text-[11px] text-muted-foreground">Despiece y transformación</p>
              </div>
            </div>
            <Link
              href="/cocina/produccion/nueva"
              className="flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm active:scale-95 transition-transform"
            >
              <Plus className="size-4" />
              Nueva
            </Link>
          </div>

          {/* Filters */}
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all',
                  statusFilter === f.key
                    ? 'bg-[#006d5a] text-white shadow-sm'
                    : 'bg-white text-muted-foreground ring-1 ring-[#ebe6df]',
                )}
              >
                {f.label}
                {f.count > 0 && (
                  <span className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                    statusFilter === f.key ? 'bg-white/20 text-white' : 'bg-secondary text-muted-foreground',
                  )}>
                    {f.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4">
        {/* Qué producir hoy: datos duros de demanda × stock; fallback plan IA */}
        <FadeIn>
          <SugerenciasCard />
        </FadeIn>
        <Link
          href="/cocina/elaborados"
          className="flex items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 ring-1 ring-[#ebe6df] transition hover:bg-[#faf8f5]"
        >
          <div className="flex items-center gap-2.5">
            <ChefHat className="size-4 text-[#006d5a]" />
            <div>
              <p className="text-[13px] font-semibold text-[#3d2c24]">Elaborados</p>
              <p className="text-[11px] text-[#a39e97]">Qué lleva cada uno, conteo rápido y cuánto dura</p>
            </div>
          </div>
          <ChevronRight className="size-4 text-[#a39e97]" />
        </Link>

        {loading ? (
          <LoadingState message="Cargando producciones..." />
        ) : filtered.length === 0 ? (
          <FadeIn>
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[#ebe6df] px-6 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-[#006d5a]/10">
                <Package className="size-6 text-[#006d5a]" strokeWidth={1.5} />
              </div>
              <div>
                <p className="font-medium text-[#3d2c24]">Sin producciones</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Registrá el despiece o transformación de un insumo
                </p>
              </div>
              <Link
                href="/cocina/produccion/nueva"
                className="mt-1 rounded-xl bg-[#006d5a] px-5 py-2 text-[13px] font-semibold text-white"
              >
                Empezar
              </Link>
            </div>
          </FadeIn>
        ) : (
          <StaggerList className="space-y-2">
            {filtered.map((order) => {
              const cfg = STATUS_CONFIG[order.status]
              const StatusIcon = cfg.icon
              return (
                <StaggerItem key={order.id}>
                  <Link
                    href={`/cocina/produccion/${order.id}`}
                    className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df] transition-all active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', cfg.color)}>
                            <StatusIcon className="size-3" />
                            {cfg.label}
                          </span>
                          {order.parent_order_id && (
                            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                              <GitBranch className="size-3" />
                              Sub-prod.
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 truncate font-semibold text-[#3d2c24]">{order.name}</p>
                        {order.template_name && (
                          <p className="text-[12px] text-muted-foreground">{order.template_name}</p>
                        )}
                      </div>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    </div>

                    {/* Resumen: qué salió, cuánto costó, merma real */}
                    {(() => {
                      const main = order.outputs.filter((o) => !o.is_waste).sort((a, b) => b.qty - a.qty)[0] ?? null
                      const waste = order.outputs.filter((o) => o.is_waste)
                      const wasteLabel = waste.length > 0
                        ? waste.map((w) => `${w.qty.toLocaleString('es-AR', { maximumFractionDigits: 3 })} ${w.unit}`).join(' + ')
                        : null
                      const cpu = order.summary.cost_per_output_unit
                      return (
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          <div className="rounded-xl bg-[#f5f2ee] px-2 py-1.5 text-center">
                            <p className="text-[10px] text-muted-foreground">Salió</p>
                            <p className="truncate text-[13px] font-bold text-[#3d2c24]">
                              {main ? `${main.qty.toLocaleString('es-AR', { maximumFractionDigits: 2 })} ${main.unit}` : '—'}
                            </p>
                          </div>
                          <div className="rounded-xl bg-[#f5f2ee] px-2 py-1.5 text-center">
                            <p className="text-[10px] text-muted-foreground">Costo/u</p>
                            <p className="text-[13px] font-bold text-[#3d2c24]">
                              {cpu ? `$${Math.round(cpu).toLocaleString('es-AR')}` : '—'}
                            </p>
                          </div>
                          <div className="rounded-xl bg-[#f5f2ee] px-2 py-1.5 text-center">
                            <p className="text-[10px] text-muted-foreground">{wasteLabel ? 'Merma' : 'Eficiencia'}</p>
                            <p className={cn('text-[13px] font-bold', wasteLabel ? 'text-[#ea504c]' : efficiencyColor(order.summary.efficiency_pct))}>
                              {wasteLabel ?? (order.summary.efficiency_pct !== null ? `${order.summary.efficiency_pct}%` : '—')}
                            </p>
                          </div>
                        </div>
                      )
                    })()}

                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {formatDate(order.submitted_at ?? order.created_at)}
                      {order.chef_name && ` · ${order.chef_name}`}
                    </p>
                  </Link>
                </StaggerItem>
              )
            })}
          </StaggerList>
        )}

        {/* Alert: pending orders */}
        {counts.draft + counts.in_progress + counts.pending_review > 0 && statusFilter === 'all' && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-[#d4943a]">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span>
              Hay {counts.draft + counts.in_progress + counts.pending_review} producción{counts.draft + counts.in_progress + counts.pending_review > 1 ? 'es' : ''} sin cerrar.{' '}
              Las que están a validar no actualizan stock ni Fudo hasta aprobación del encargado.
            </span>
          </div>
        )}

        {/* Link to dashboard */}
        <Link
          href="/stock/produccion"
          className="flex items-center justify-center gap-1.5 rounded-xl bg-[#f5f2ee] px-4 py-3 text-[13px] font-medium text-[#3d2c24]"
        >
          <TrendingUp className="size-4 text-[#006d5a]" />
          Ver dashboard de rendimientos
        </Link>
      </div>
    </div>
  )
}
