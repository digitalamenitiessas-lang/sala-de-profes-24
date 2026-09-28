'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isSocio } from '@/lib/roles'
import { FadeIn } from '@/components/ui/motion'
import { BackToHoy } from '@/components/layout/BackToHoy'
import { Loader2, RefreshCw, TrendingDown, AlertTriangle, CheckCircle2, Package, Info } from 'lucide-react'
import type { ProductoControlRow, ProductosControlPayload } from '@/app/api/admin/productos-control/route'

const fmt = (n: number) =>
  '$' + Math.round(n).toLocaleString('es-AR')

const fmtQty = (n: number, unit: string) => {
  const rounded = Math.round(n * 10) / 10
  return `${rounded} ${unit}`
}

function RowBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[11px] text-[#a39e97]">Sin datos</span>
  if (value > 10) return (
    <span className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[11px] font-bold text-[#ea504c]">
      −{Math.round(value * 10) / 10}
    </span>
  )
  if (value > 2) return (
    <span className="rounded-full bg-[#fff8eb] px-2 py-0.5 text-[11px] font-bold text-[#d4943a]">
      −{Math.round(value * 10) / 10}
    </span>
  )
  if (value < -2) return (
    <span className="rounded-full bg-[#e8f5f1] px-2 py-0.5 text-[11px] font-semibold text-[#006d5a]">
      +{Math.round(-value * 10) / 10}
    </span>
  )
  return <span className="text-[11px] text-[#a39e97]">OK</span>
}

function ProductRow({ row }: { row: ProductoControlRow }) {
  const [open, setOpen] = useState(false)
  const merma = row.merma_implicita
  const isRed = merma !== null && merma > 10
  const isOrange = merma !== null && merma > 2 && merma <= 10

  return (
    <div className={`rounded-xl border ${isRed ? 'border-[#f3d0cf] bg-[#fff7f7]' : isOrange ? 'border-[#f1dfba] bg-[#fffaf2]' : 'border-[#ebe6df] bg-white'}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[#3d2c24]">{row.name}</p>
          <p className="text-[10px] text-[#a39e97]">
            Fudo: {row.fudo_stock !== null ? fmtQty(row.fudo_stock, row.unit) : '—'} ·
            Vendido: {fmtQty(row.sold_since_baseline, row.unit)} ·
            Esperado: {row.expected !== null ? fmtQty(row.expected, row.unit) : '—'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {row.merma_lve_units > 0 && (
            <span className="rounded-full bg-[#faf8f5] px-1.5 py-0.5 text-[9px] font-bold text-[#7d6c64]">
              LVE: {Math.round(row.merma_lve_units * 10) / 10}
            </span>
          )}
          <RowBadge value={merma} />
        </div>
      </button>

      {open && (
        <div className="border-t border-[#ebe6df] px-3 pb-3 pt-2 text-[11px] text-[#7d6c64]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <span>Baseline (snapshot {row.baseline_date ?? '—'})</span>
            <span className="text-right font-semibold text-[#3d2c24]">
              {row.baseline !== null ? fmtQty(row.baseline, row.unit) : '—'}
            </span>
            <span>Vendido desde snapshot</span>
            <span className="text-right font-semibold text-[#ea504c]">
              −{fmtQty(row.sold_since_baseline, row.unit)}
            </span>
            <span>Esperado ahora</span>
            <span className="text-right font-semibold text-[#3d2c24]">
              {row.expected !== null ? fmtQty(row.expected, row.unit) : '—'}
            </span>
            <span>Stock Fudo ahora</span>
            <span className="text-right font-semibold text-[#3d2c24]">
              {row.fudo_stock !== null ? fmtQty(row.fudo_stock, row.unit) : 'sin control'}
            </span>
            <span className="font-bold text-[#3d2c24]">Merma implícita</span>
            <span className={`text-right font-bold ${(merma ?? 0) > 2 ? 'text-[#ea504c]' : (merma ?? 0) < -2 ? 'text-[#006d5a]' : 'text-[#3d2c24]'}`}>
              {merma !== null ? fmtQty(merma, row.unit) : '—'}
              {row.merma_implicita_value != null && row.merma_implicita_value > 0
                ? ` (${fmt(row.merma_implicita_value)})`
                : ''}
            </span>
            {/* cost_per_unit ya viene gateado del server: número SOLO con
                fuente confiable (compra/manual/produccion); si no, null acá. */}
            {row.cost_per_unit != null && (
              <>
                <span>Costo unitario</span>
                <span className="text-right">{fmt(row.cost_per_unit)}/{row.unit}</span>
              </>
            )}
            {row.merma_lve_units > 0 && (
              <>
                <span>Mermas registradas LVE (30d)</span>
                <span className="text-right font-semibold text-[#7d6c64]">
                  {fmtQty(row.merma_lve_units, row.unit)}
                </span>
              </>
            )}
          </div>
          {row.merma_lve_notes.length > 0 && (
            <div className="mt-2 space-y-0.5">
              <p className="font-semibold text-[#3d2c24]">Notas de merma LVE:</p>
              {row.merma_lve_notes.map((note, i) => (
                <p key={i} className="text-[10px]">· {note}</p>
              ))}
            </div>
          )}
          {row.fudo_stock === null && (
            <p className="mt-2 rounded bg-[#faf8f5] px-2 py-1 text-[10px] font-semibold text-[#a39e97]">
              Este producto no tiene control de stock activo en Fudo — no se puede calcular merma implícita.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function ProductosControlPage() {
  const router = useRouter()
  const { profile, loading: profileLoading } = useProfileContext()
  const [data, setData] = useState<ProductosControlPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState<'all' | 'con-merma' | 'ok' | 'sin-datos'>('all')

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/productos-control', { cache: 'no-store' })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error ?? `HTTP ${res.status}`)
      }
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!profileLoading && profile && !isSocio(profile.role)) {
      router.replace('/')
    }
  }, [profile, profileLoading, router])

  if (profileLoading || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[#a39e97]" />
      </div>
    )
  }

  if (!isSocio(profile?.role)) return null

  const rows = data?.rows ?? []
  const filtered = rows.filter(r => {
    if (filter === 'con-merma') return r.merma_implicita !== null && r.merma_implicita > 2
    if (filter === 'ok') return r.merma_implicita !== null && r.merma_implicita <= 2
    if (filter === 'sin-datos') return r.merma_implicita === null
    return true
  })

  const conMerma = rows.filter(r => r.merma_implicita !== null && r.merma_implicita > 2).length

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-28">
      <BackToHoy />

      <FadeIn>
        <div className="overflow-hidden rounded-[2rem] border border-[#ebe6df] bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#a39e97]">
                Solo socios · Tiempo real
              </p>
              <h1 className="mt-1 text-xl font-bold text-[#3d2c24]">Control de Productos</h1>
              <p className="mt-1 text-[12px] leading-relaxed text-[#7d6c64]">
                Stock real de Fudo vs. lo esperado (snapshot − ventas).
                La diferencia es la merma implícita: lo que bajó más allá de las ventas.
              </p>
            </div>
            <button
              onClick={() => void load(true)}
              disabled={refreshing}
              className="shrink-0 rounded-xl border border-[#ebe6df] bg-[#faf8f5] p-2.5 text-[#7d6c64] transition-colors hover:bg-[#f3efe9]"
            >
              <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {data?.baseline_snapshot_date && (
            <p className="mt-2 text-[10px] text-[#a39e97]">
              Base: snapshot del {data.baseline_snapshot_date} (3 AM) · Actualizado: {data.generated_at ? new Date(data.generated_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—'}
            </p>
          )}
        </div>
      </FadeIn>

      {error && (
        <FadeIn>
          <div className="rounded-2xl border border-[#f3d0cf] bg-[#fff7f7] px-4 py-3">
            <p className="text-sm font-semibold text-[#ea504c]">Error: {error}</p>
          </div>
        </FadeIn>
      )}

      {data && (
        <FadeIn>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-[#f3d0cf] bg-[#fff7f7] px-3 py-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#ea504c]">Merma implícita hoy</p>
              <p className="mt-1 text-xl font-bold text-[#3d2c24]">
                {Math.round(data.total_merma_implicita * 10) / 10}
              </p>
              {data.total_merma_implicita_value > 0 && (
                <p className="text-[10px] font-semibold text-[#ea504c]">{fmt(data.total_merma_implicita_value)}</p>
              )}
            </div>
            <div className="rounded-2xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#7d6c64]">Con control Fudo</p>
              <p className="mt-1 text-xl font-bold text-[#3d2c24]">{data.with_stock_control}</p>
              <p className="text-[10px] text-[#a39e97]">de {data.total_products} productos</p>
            </div>
            <div className="rounded-2xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#7d6c64]">Merma LVE (30d)</p>
              <p className="mt-1 text-xl font-bold text-[#3d2c24]">{Math.round(data.total_merma_lve * 10) / 10}</p>
              <p className="text-[10px] text-[#a39e97]">registradas en sistema</p>
            </div>
          </div>
        </FadeIn>
      )}

      {data && (
        <FadeIn>
          <div className="rounded-2xl border border-[#e8f3fa] bg-[#f0f8ff] px-4 py-3">
            <div className="flex gap-2">
              <Info className="mt-0.5 size-4 shrink-0 text-[#3b82f6]" />
              <div className="text-[11px] leading-relaxed text-[#3d2c24]">
                <p><span className="font-bold">Merma implícita:</span> lo que Fudo tiene menos de lo esperado según las ventas. Puede ser merma cargada en Fudo, ajuste manual, o un error de conteo.</p>
                <p className="mt-1"><span className="font-bold">Merma LVE:</span> lo que alguien registró explícitamente como merma en esta app. Son los únicos casos donde sabemos el motivo.</p>
                <p className="mt-1 text-[#7d6c64]">Si Fudo tiene más stock del esperado (verde), probablemente hay producción o recepción de mercadería que no fue registrada en el sistema.</p>
              </div>
            </div>
          </div>
        </FadeIn>
      )}

      {data && rows.length > 0 && (
        <FadeIn>
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1">
            {([
              { key: 'all', label: `Todos (${rows.length})` },
              { key: 'con-merma', label: `Con merma (${conMerma})` },
              { key: 'ok', label: 'Sin diferencia' },
              { key: 'sin-datos', label: 'Sin datos Fudo' },
            ] as const).map(opt => (
              <button
                key={opt.key}
                onClick={() => setFilter(opt.key)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all ${
                  filter === opt.key ? 'bg-[#3d2c24] text-white' : 'bg-[#f3efe9] text-[#a39e97]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </FadeIn>
      )}

      {data && filtered.length === 0 && (
        <FadeIn>
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="size-8 text-[#006d5a]" />
            <p className="text-sm font-semibold text-[#3d2c24]">
              {filter === 'con-merma' ? 'No hay mermas implícitas hoy' : 'Sin resultados para este filtro'}
            </p>
          </div>
        </FadeIn>
      )}

      {data && filtered.length > 0 && (
        <FadeIn>
          <div className="space-y-1.5">
            {filtered.map(row => (
              <ProductRow key={row.stock_item_id} row={row} />
            ))}
          </div>
        </FadeIn>
      )}

      {!data && !loading && !error && (
        <FadeIn>
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Package className="size-8 text-[#a39e97]" />
            <p className="text-sm text-[#7d6c64]">No hay datos disponibles</p>
          </div>
        </FadeIn>
      )}

      {data && data.with_stock_control < data.total_products && (
        <FadeIn>
          <div className="rounded-2xl border border-[#f1dfba] bg-[#fffaf2] px-4 py-3">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#d4943a]" />
              <div>
                <p className="text-[12px] font-bold text-[#3d2c24]">
                  {data.total_products - data.with_stock_control} productos sin control de stock en Fudo
                </p>
                <p className="mt-0.5 text-[11px] text-[#7d6c64]">
                  Estos productos figuran en nuestro sistema pero Fudo no les lleva stock.
                  Activar el control de stock en Fudo para cada uno para poder detectar mermas.
                </p>
              </div>
            </div>
          </div>
        </FadeIn>
      )}

      {data && data.total_merma_lve === 0 && (
        <FadeIn>
          <div className="rounded-2xl border border-[#ebe6df] bg-[#faf8f5] px-4 py-3">
            <div className="flex gap-2">
              <TrendingDown className="mt-0.5 size-4 shrink-0 text-[#a39e97]" />
              <div>
                <p className="text-[12px] font-bold text-[#3d2c24]">Sin mermas registradas en LVE (30 días)</p>
                <p className="mt-0.5 text-[11px] text-[#7d6c64]">
                  Nadie registró mermas en esta app en el último mes. Si se descarta o rompe algo,
                  registrarlo en Stock → item → Registrar merma para tener el motivo documentado.
                </p>
              </div>
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  )
}
