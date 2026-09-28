'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { FadeIn } from '@/components/ui/motion'
import { Skeleton } from '@/components/ui/skeleton'
import { isSocio } from '@/lib/roles'
import { useProfileContext } from '@/lib/hooks/use-profile'
import type { MermasPayload, MermaProductRow, MermaDayRow } from '@/app/api/admin/mermas/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmtPrice = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

const fmtQty = (n: number) => `${Math.round(n * 10) / 10}`

function minutesAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1) return 'ahora mismo'
  if (diff === 1) return 'hace 1 min'
  return `hace ${diff} min`
}

function fmtDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number)
    return format(new Date(y, m - 1, d), "dd/MMM", { locale: es })
  } catch {
    return dateStr
  }
}

// ---------------------------------------------------------------------------
// Tabla de días (se muestra al expandir un producto)
// ---------------------------------------------------------------------------

function DayTable({ days, unit }: { days: MermaDayRow[]; unit: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-[#faf8f5] text-[#a39e97]">
            <th className="px-3 py-2 text-left font-medium">Fecha</th>
            <th className="px-3 py-2 text-right font-medium">Antes</th>
            <th className="px-3 py-2 text-right font-medium">Ventas</th>
            <th className="px-3 py-2 text-right font-medium">Después</th>
            <th className="px-3 py-2 text-right font-medium">Faltante</th>
            <th className="px-3 py-2 text-right font-medium">Entrada</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f3efe9]">
          {days.map((d, i) => {
            const hasBigFaltante = d.faltante > 20
            const hasMedFaltante = d.faltante > 5
            const hasEntrada = d.entrada > 30
            const rowClass = hasBigFaltante
              ? 'bg-red-50 text-[#ea504c]'
              : hasMedFaltante
                ? 'bg-orange-50 text-orange-700'
                : hasEntrada
                  ? 'bg-yellow-50 text-yellow-800'
                  : ''

            return (
              <tr key={i} className={rowClass}>
                <td className="px-3 py-2 font-medium">{fmtDate(d.date)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtQty(d.qty_before)} {unit}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtQty(d.sold)} {unit}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtQty(d.qty_after)} {unit}</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold">
                  {d.faltante > 0 ? `−${fmtQty(d.faltante)} ${unit}` : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {d.entrada > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      +{fmtQty(d.entrada)} {unit}
                      {d.entrada > 30 && (
                        <span className="rounded bg-yellow-200 px-1 py-0.5 text-[9px] font-semibold text-yellow-800">
                          sin registrar
                        </span>
                      )}
                    </span>
                  ) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fila de producto (expandible)
// ---------------------------------------------------------------------------

function ProductRow({ product }: { product: MermaProductRow }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-2xl bg-white ring-1 ring-[#ebe6df] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-start justify-between px-4 py-3.5 text-left transition-colors hover:bg-[#faf8f5] active:scale-[0.99]"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[#3d2c24]">{product.name}</span>
            {product.faltante_units > 2 && (
              <span className="inline-flex items-center rounded-full bg-[#ea504c]/10 px-2 py-0.5 text-[10px] font-bold text-[#ea504c]">
                −{fmtQty(product.faltante_units)} {product.unit}
              </span>
            )}
            {product.worst_faltante_qty > 20 && product.worst_faltante_date && (
              <span className="inline-flex items-center rounded-full bg-[#ea504c] px-2 py-0.5 text-[10px] font-bold text-white">
                peor día: {fmtDate(product.worst_faltante_date)} −{fmtQty(product.worst_faltante_qty)} u
              </span>
            )}
          </div>
          {product.faltante_value > 0 && (
            <span className="text-xs font-bold text-[#ea504c]">
              {fmtPrice(product.faltante_value)} a costo real
            </span>
          )}
          {product.faltante_value === 0 && product.faltante_units > 2 && product.costo_confiable === false && (
            <span className="text-[10px] text-[#a39e97]">sin costo real: no se valoriza en $</span>
          )}
        </div>
        <span className="ml-3 mt-0.5 shrink-0 text-[#a39e97]">
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
      </button>

      {open && product.days.length > 0 && (
        <div className="border-t border-[#ebe6df]/60">
          <DayTable days={product.days} unit={product.unit} />
        </div>
      )}
      {open && product.days.length === 0 && (
        <p className="px-4 pb-3 text-xs text-[#a39e97]">Sin días con diferencias significativas.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sección "Entradas sin registrar" (colapsable)
// ---------------------------------------------------------------------------

function EntradasSection({ products }: { products: MermaProductRow[] }) {
  const [open, setOpen] = useState(false)
  const entradas = products.filter(p => p.entrada_units > 30 && p.faltante_units < 5)
  if (entradas.length === 0) return null

  return (
    <FadeIn delay={0.2}>
      <div className="rounded-2xl bg-white ring-1 ring-[#ebe6df] overflow-hidden">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex w-full items-center justify-between px-4 py-3.5 text-left transition-colors hover:bg-[#faf8f5]"
        >
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-[#f59e0b]/10">
              <AlertTriangle className="size-3.5 text-[#f59e0b]" />
            </div>
            <div>
              <p className="text-[13px] font-bold text-[#3d2c24]">Entradas sin registrar</p>
              <p className="text-[10px] text-[#a39e97]">
                {entradas.length} producto{entradas.length !== 1 ? 's' : ''} · stock que subió sin carga
              </p>
            </div>
          </div>
          {open ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
        </button>

        {open && (
          <div className="border-t border-[#ebe6df]/60 px-4 py-3 space-y-2">
            {entradas.map(p => (
              <div key={p.stock_item_id} className="flex items-center justify-between rounded-xl bg-yellow-50 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-yellow-900">{p.name}</p>
                  <p className="text-[10px] text-yellow-700">
                    +{fmtQty(p.entrada_units)} {p.unit} sin carga
                  </p>
                </div>
                {p.entrada_value > 0 && (
                  <span className="text-sm font-bold tabular-nums text-yellow-800">
                    {fmtPrice(p.entrada_value)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </FadeIn>
  )
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

const PERIOD_OPTIONS = [7, 14, 30] as const
type Period = (typeof PERIOD_OPTIONS)[number]

export default function MermasPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const router = useRouter()

  const [period, setPeriod] = useState<Period>(7)
  const [data, setData] = useState<MermasPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Redirect si no es socio
  useEffect(() => {
    if (!profileLoading && !isSocio(profile?.role)) {
      router.replace('/')
    }
  }, [profile, profileLoading, router])

  const load = async (days: Period) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/mermas?days=${days}`, { credentials: 'include' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar')
      setData(json as MermasPayload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (profile && isSocio(profile.role)) {
      load(period)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, profile])

  if (profileLoading) {
    return (
      <div className="space-y-4 pt-2">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    )
  }

  if (!isSocio(profile?.role)) return null

  // Solo faltantes (faltante_units > 2)
  const faltantes = (data?.products ?? []).filter(p => p.faltante_units > 2)

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <FadeIn>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-[#ea504c]/10">
              <AlertTriangle className="size-5 text-[#ea504c]" />
            </div>
            <div>
              <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Control de Mermas</h1>
              <p className="text-[11px] text-[#a39e97]">
                Solo socios
                {data?.generated_at ? ` · actualizado ${minutesAgo(data.generated_at)}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => load(period)}
            disabled={loading}
            className="rounded-xl bg-[#f3efe9] p-2.5 text-[#3d2c24] active:scale-95 disabled:opacity-50"
          >
            {loading
              ? <Loader2 className="size-4 animate-spin" />
              : <RefreshCw className="size-4" />}
          </button>
        </div>
      </FadeIn>

      {/* Selector de período */}
      <FadeIn delay={0.05}>
        <div className="flex rounded-full bg-[#f3efe9] p-0.5 w-fit">
          {PERIOD_OPTIONS.map(d => (
            <button
              key={d}
              onClick={() => setPeriod(d)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                period === d
                  ? 'bg-[#006d5a] text-white shadow-sm'
                  : 'text-[#3d2c24] hover:bg-white/60'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </FadeIn>

      {/* Stats */}
      {!loading && data && (
        <FadeIn delay={0.08}>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-[#ebe6df] shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#ea504c]">Faltantes a costo real</p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[#ea504c]">
                {fmtPrice(data.total_faltante_value)}
              </p>
              <p className="mt-0.5 text-[10px] text-[#a39e97]">
                {data.days_with_data} días con datos
                {data.products_con_precio != null && data.products.length > 0 && (
                  <> · {data.products_con_precio} de {data.products.length} con precio real</>
                )}
              </p>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-[#ebe6df] shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#f59e0b]">Sin registrar</p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-[#f59e0b]">
                {fmtPrice(data.total_entrada_value)}
              </p>
              <p className="mt-0.5 text-[10px] text-[#a39e97]">stock sin carga</p>
            </div>
          </div>
        </FadeIn>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-[#ea504c] ring-1 ring-red-200">
          {error}
        </div>
      )}

      {/* Lista de faltantes */}
      {!loading && !error && faltantes.length > 0 && (
        <FadeIn delay={0.12}>
          <div className="space-y-2">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[#ea504c]">
              Faltantes ({faltantes.length})
            </p>
            {faltantes.map(p => (
              <ProductRow key={p.stock_item_id} product={p} />
            ))}
          </div>
        </FadeIn>
      )}

      {/* Sin datos */}
      {!loading && !error && data && faltantes.length === 0 && (
        <FadeIn delay={0.1}>
          <div className="rounded-2xl bg-white px-4 py-8 text-center ring-1 ring-[#ebe6df]">
            <p className="text-sm font-medium text-[#3d2c24]">Sin faltantes significativos</p>
            <p className="mt-1 text-xs text-[#a39e97]">
              {data.days_with_data === 0
                ? 'Todavía no hay snapshots comparables. Mañana aparecen los primeros datos.'
                : `${data.days_with_data} días analizados — todo dentro del margen.`}
            </p>
          </div>
        </FadeIn>
      )}

      {/* Entradas sin registrar */}
      {!loading && !error && data && (
        <EntradasSection products={data.products} />
      )}
    </div>
  )
}
