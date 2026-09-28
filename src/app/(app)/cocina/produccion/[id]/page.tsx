'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ChevronLeft, CheckCircle2, Clock, XCircle, ShieldCheck,
  Package, Leaf, AlertTriangle, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/ui/motion'
import { cn } from '@/lib/utils'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OrderDetail = {
  id: number
  name: string
  status: 'draft' | 'in_progress' | 'pending_review' | 'completed' | 'cancelled'
  chef_name: string | null
  template_name: string | null
  notes: string | null
  created_at: string
  submitted_at: string | null
  completed_at: string | null
  reviewed_at: string | null
  inputs: {
    id: number
    stock_item_name: string
    qty_used: number
    unit: string
    line_cost: number
    stock_item_current_qty: number
  }[]
  outputs: {
    id: number
    output_name: string
    stock_item_name: string | null
    qty_produced: number
    unit: string
    is_waste: boolean
    notes: string | null
    lot_code?: string | null
    expires_at?: string | null
    cost_per_unit: number | null
  }[]
  summary: {
    total_input_qty: number
    total_output_qty: number
    total_waste_qty: number
    efficiency_pct: number | null
    total_input_cost: number
    cost_per_output_unit: number | null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG = {
  draft:          { label: 'Borrador',     icon: Clock,        color: 'text-[#a39e97]', bg: 'bg-[#f5f2ee]' },
  in_progress:    { label: 'En progreso',  icon: Clock,        color: 'text-[#d4943a]', bg: 'bg-amber-50' },
  pending_review: { label: 'Esperando validación', icon: ShieldCheck, color: 'text-[#d4943a]', bg: 'bg-amber-50' },
  completed:      { label: 'Validada',     icon: CheckCircle2, color: 'text-[#006d5a]', bg: 'bg-[#e8f5f1]' },
  cancelled:      { label: 'Cancelada',    icon: XCircle,      color: 'text-[#ea504c]', bg: 'bg-red-50' },
}

function effColor(pct: number | null) {
  if (pct === null) return 'text-muted-foreground'
  if (pct >= 90) return 'text-[#006d5a]'
  if (pct >= 75) return 'text-[#d4943a]'
  return 'text-[#ea504c]'
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatQty(n: number, unit: string) {
  const str = n % 1 === 0 ? n.toFixed(0) : n.toFixed(3).replace(/\.?0+$/, '')
  return `${str} ${unit}`
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: n < 100 ? 2 : 0,
  }).format(n)
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProduccionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { profile } = useProfileContext()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [validating, setValidating] = useState(false)

  const canValidate = isManagerOrAbove(profile?.role)

  async function loadOrder() {
    setLoading(true)
    try {
      const res = await fetch(`/api/produccion/orders/${id}`, { credentials: 'include' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'No se pudo cargar la producción')
      }
      const json = await res.json()
      setOrder(json.order)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar la producción')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadOrder() }, [id])

  async function handleValidate() {
    if (!order || !canValidate) return
    const ok = window.confirm(
      `Validar "${order.name}"?\n\nEsto descuenta insumos, suma producción terminada y sincroniza Fudo.`,
    )
    if (!ok) return
    setValidating(true)
    try {
      const res = await fetch(`/api/produccion/orders/${id}/complete`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        throw new Error(json?.error ?? 'No se pudo validar la producción')
      }
      const synced = typeof json.fudo?.synced === 'number' ? json.fudo.synced : null
      toast.success(synced !== null
        ? `Producción validada · Fudo ${synced} item${synced !== 1 ? 's' : ''}`
        : 'Producción validada')
      for (const w of (json?.warnings ?? []) as string[]) if (w.includes('Fudo')) toast.info(w)
      await loadOrder()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al validar producción')
    } finally {
      setValidating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#faf8f5]">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#faf8f5] px-4">
        <Package className="size-10 text-muted-foreground" strokeWidth={1.5} />
        <p className="text-center text-[15px] font-medium text-[#3d2c24]">Producción no encontrada</p>
        <button onClick={() => router.back()} className="rounded-xl bg-[#006d5a] px-5 py-2.5 text-[13px] font-semibold text-white">
          Volver
        </button>
      </div>
    )
  }

  const cfg = STATUS_CONFIG[order.status]
  const StatusIcon = cfg.icon
  const producedItems = order.outputs.filter((o) => !o.is_waste)
  const wasteItems = order.outputs.filter((o) => o.is_waste)

  return (
    <div className="min-h-screen bg-[#faf8f5] pb-28">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#ebe6df] bg-[#faf8f5]/95 backdrop-blur-md">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.back()}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Detalle de producción
              </p>
              <p className="truncate text-[15px] font-bold text-[#3d2c24]">{order.name}</p>
            </div>
            <span className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0', cfg.bg, cfg.color)}>
              <StatusIcon className="size-3" />
              {cfg.label}
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-3 px-4 pt-4">
        <FadeIn>
          {/* Meta */}
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <p className="text-muted-foreground">Chef</p>
                <p className="font-semibold text-[#3d2c24]">{order.chef_name ?? '—'}</p>
              </div>
              {order.template_name && (
                <div>
                  <p className="text-muted-foreground">Plantilla</p>
                  <p className="font-semibold text-[#3d2c24]">{order.template_name}</p>
                </div>
              )}
              <div>
                <p className="text-muted-foreground">Creada</p>
                <p className="font-semibold text-[#3d2c24]">{formatDate(order.created_at)}</p>
              </div>
              {order.submitted_at && (
                <div>
                  <p className="text-muted-foreground">Enviada a validar</p>
                  <p className="font-semibold text-[#3d2c24]">{formatDate(order.submitted_at)}</p>
                </div>
              )}
              {order.completed_at && (
                <div>
                  <p className="text-muted-foreground">Validada</p>
                  <p className="font-semibold text-[#3d2c24]">{formatDate(order.completed_at)}</p>
                </div>
              )}
            </div>
            {order.notes && (
              <p className="mt-3 rounded-xl bg-[#faf8f5] px-3 py-2 text-[12px] text-[#7d6c64]">{order.notes}</p>
            )}
          </div>

          {/* Validation banner */}
          {order.status === 'pending_review' && (
            <div className={cn(
              'rounded-2xl p-4 shadow-sm ring-1',
              canValidate
                ? 'bg-[#2f241f] text-white ring-transparent'
                : 'bg-amber-50 ring-[#f3d0a0] text-[#8b5e34]',
            )}>
              {canValidate ? (
                <>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60">Lista para validar</p>
                  <p className="mt-1 text-[14px] font-semibold">
                    Revisá la producción y aprobá para que el stock se actualice.
                  </p>
                  <button
                    onClick={handleValidate}
                    disabled={validating}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-3 text-[14px] font-semibold text-white disabled:opacity-60 active:scale-[0.99]"
                  >
                    {validating ? (
                      <><Loader2 className="size-4 animate-spin" />Validando y sincronizando Fudo...</>
                    ) : (
                      <><ShieldCheck className="size-4" />Validar y sync Fudo</>
                    )}
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 shrink-0" />
                  <p className="text-[13px] font-medium">Esperando validación del encargado</p>
                </div>
              )}
            </div>
          )}

          {/* Summary KPIs */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-[#ebe6df]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Entrada</p>
              <p className="mt-1 text-[16px] font-bold text-[#3d2c24]">
                {order.summary.total_input_qty > 0
                  ? `${order.summary.total_input_qty.toFixed(2)} kg`
                  : '—'}
              </p>
            </div>
            <div className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-[#ebe6df]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Merma</p>
              <p className={cn('mt-1 text-[16px] font-bold', order.summary.total_waste_qty > 0 ? 'text-[#ea504c]' : 'text-[#3d2c24]')}>
                {order.summary.total_waste_qty > 0
                  ? `${order.summary.total_waste_qty.toFixed(3)} kg`
                  : '—'}
              </p>
            </div>
            <div className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-[#ebe6df]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Eficiencia</p>
              <p className={cn('mt-1 text-[16px] font-bold', effColor(order.summary.efficiency_pct))}>
                {order.summary.efficiency_pct !== null ? `${order.summary.efficiency_pct}%` : '—'}
              </p>
            </div>
          </div>

          {/* Cost */}
          {order.summary.total_input_cost > 0 && (
            <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">Costo de insumos</p>
                  <p className="text-[18px] font-bold text-[#3d2c24]">{formatMoney(order.summary.total_input_cost)}</p>
                </div>
                {order.summary.cost_per_output_unit != null && order.summary.total_output_qty > 0 && (
                  <div className="text-right">
                    <p className="text-[11px] text-muted-foreground">Por unidad producida</p>
                    <p className="text-[20px] font-bold text-[#006d5a]">{formatMoney(order.summary.cost_per_output_unit)}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Inputs */}
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
            <div className="flex items-center gap-2 border-b border-[#ebe6df] px-4 py-3">
              <Package className="size-4 text-[#ea504c]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Materias primas que bajan
              </span>
            </div>
            <div className="divide-y divide-[#f3efe9]">
              {order.inputs.length === 0 ? (
                <p className="px-4 py-3 text-[12px] text-muted-foreground">Sin insumos registrados</p>
              ) : (
                order.inputs.map((inp) => (
                  <div key={inp.id} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <p className="text-[13px] font-semibold text-[#3d2c24]">{inp.stock_item_name}</p>
                      {inp.line_cost > 0 && (
                        <p className="text-[11px] text-muted-foreground">{formatMoney(inp.line_cost)}</p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full bg-[#fff0f0] px-2.5 py-1 text-[12px] font-bold text-[#ea504c]">
                      −{formatQty(inp.qty_used, inp.unit)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Outputs */}
          {producedItems.length > 0 && (
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
              <div className="flex items-center gap-2 border-b border-[#ebe6df] px-4 py-3">
                <Package className="size-4 text-[#006d5a]" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Productos que suben
                </span>
              </div>
              <div className="divide-y divide-[#f3efe9]">
                {producedItems.map((out) => (
                  <div key={out.id} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <p className="text-[13px] font-semibold text-[#3d2c24]">{out.output_name}</p>
                      {out.stock_item_name && out.stock_item_name !== out.output_name && (
                        <p className="text-[11px] text-muted-foreground">{out.stock_item_name}</p>
                      )}
                      {out.lot_code && (
                        <p className="text-[10px] text-muted-foreground">Lote {out.lot_code}</p>
                      )}
                      {out.expires_at && (
                        <p className="text-[10px] text-muted-foreground">
                          Vence {new Date(out.expires_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full bg-[#e8f5f1] px-2.5 py-1 text-[12px] font-bold text-[#006d5a]">
                      +{formatQty(out.qty_produced, out.unit)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Waste */}
          {wasteItems.length > 0 && (
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
              <div className="flex items-center gap-2 border-b border-[#ebe6df] px-4 py-3">
                <Leaf className="size-4 text-[#ea504c]" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Merma / descarte
                </span>
              </div>
              <div className="divide-y divide-[#f3efe9]">
                {wasteItems.map((out) => (
                  <div key={out.id} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <p className="text-[13px] text-[#ea504c]">{out.output_name}</p>
                      {out.stock_item_name && (
                        <p className="text-[11px] text-muted-foreground">de {out.stock_item_name}</p>
                      )}
                      {out.notes && <p className="text-[11px] text-muted-foreground">{out.notes}</p>}
                    </div>
                    <span className="shrink-0 text-[12px] font-bold text-[#ea504c]">
                      {formatQty(out.qty_produced, out.unit)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </FadeIn>
      </div>
    </div>
  )
}
