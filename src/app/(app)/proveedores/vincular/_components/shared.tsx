'use client'

import { useMemo, useState } from 'react'
import { formatDistanceToNowStrict } from 'date-fns'
import { es } from 'date-fns/locale'
import { Search, Sparkles, X, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Vinculo, VinculoSupplier, VinculosPayload } from '@/lib/proveedores/vinculos'

export const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const
/** Orden de semana laboral: lunes primero */
export const WEEK = [1, 2, 3, 4, 5, 6, 0] as const

export function ago(iso: string | null): string | null {
  if (!iso) return null
  return formatDistanceToNowStrict(new Date(iso), { locale: es, addSuffix: true })
}

/** "12 compras en Fudo · última hace 3 días" / "cargado a mano" */
export function evidenceText(link: Pick<Vinculo, 'fudo_purchases' | 'last_purchase_at' | 'source'>): string {
  if (link.fudo_purchases > 0) {
    const n = link.fudo_purchases
    return `${n} compra${n === 1 ? '' : 's'} en Fudo · última ${ago(link.last_purchase_at)}`
  }
  return link.source === 'fudo' ? 'Visto en Fudo' : 'Sin compras en Fudo todavía'
}

export function useIndex(data: VinculosPayload | null) {
  return useMemo(() => {
    const supplier = new Map<string, VinculoSupplier>()
    const item = new Map<string, VinculosPayload['items'][number]>()
    const linksByItem = new Map<string, Vinculo[]>()
    const primaryCountBySupplier = new Map<string, number>()
    if (data) {
      for (const s of data.suppliers) supplier.set(s.id, s)
      for (const i of data.items) item.set(i.id, i)
      for (const l of data.links) {
        const list = linksByItem.get(l.item_id) ?? []
        list.push(l)
        linksByItem.set(l.item_id, list)
        if (l.is_primary) primaryCountBySupplier.set(l.supplier_id, (primaryCountBySupplier.get(l.supplier_id) ?? 0) + 1)
      }
      for (const list of linksByItem.values()) {
        list.sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || b.fudo_purchases - a.fudo_purchases)
      }
    }
    return { supplier, item, linksByItem, primaryCountBySupplier }
  }, [data])
}

function fold(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Buscador de proveedor. Arriba: los destacados (compras en Fudo, sugerencia
 * por nombre); abajo, todos.
 */
export function SupplierPicker({
  suppliers, highlighted = [], exclude = [], onPick, onCancel, busy,
}: {
  suppliers: VinculoSupplier[]
  highlighted?: { id: string; hint: string }[]
  exclude?: string[]
  onPick: (supplierId: string) => void
  onCancel: () => void
  busy?: boolean
}) {
  const [q, setQ] = useState('')
  const excluded = new Set(exclude)
  const top = highlighted.filter((h) => !excluded.has(h.id))
  const topIds = new Set(top.map((h) => h.id))
  const needle = fold(q.trim())
  const list = suppliers.filter((s) => !excluded.has(s.id) && (needle ? fold(s.name).includes(needle) : !topIds.has(s.id)))
  const byId = new Map(suppliers.map((s) => [s.id, s]))

  return (
    <div className="rounded-xl border border-[#ebe6df] bg-[#faf8f5] p-2">
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
          <input
            autoFocus
            placeholder="Buscar proveedor…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-lg border border-[#ebe6df] bg-white py-2 pl-8 pr-2 text-[13px] text-[#3d2c24] outline-none focus:border-[#006d5a]"
          />
        </div>
        <button onClick={onCancel} aria-label="Cerrar" className="rounded-lg p-2 text-[#a39e97] hover:bg-white">
          <X className="size-4" />
        </button>
      </div>
      <div className="max-h-56 space-y-0.5 overflow-y-auto">
        {!needle && top.map((h) => (
          <button
            key={h.id}
            disabled={busy}
            onClick={() => onPick(h.id)}
            className="flex w-full items-center gap-2 rounded-lg bg-[#e8f5f1] px-2.5 py-2 text-left disabled:opacity-50"
          >
            <Sparkles className="size-3.5 shrink-0 text-[#006d5a]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-[#006d5a]">{byId.get(h.id)?.name ?? '—'}</span>
              <span className="block truncate text-[10.5px] text-[#006d5a]/80">{h.hint}</span>
            </span>
            {busy && <Loader2 className="size-3.5 animate-spin text-[#006d5a]" />}
          </button>
        ))}
        {list.map((s) => (
          <button
            key={s.id}
            disabled={busy}
            onClick={() => onPick(s.id)}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[#3d2c24] hover:bg-white disabled:opacity-50"
          >
            <span className="truncate">{s.name}</span>
            {!s.fudo_linked && <span className="shrink-0 text-[10px] text-[#d4943a]">no está en Fudo</span>}
          </button>
        ))}
        {list.length === 0 && (needle || top.length === 0) && (
          <p className="py-3 text-center text-[12px] text-[#a39e97]">Sin resultados</p>
        )}
      </div>
    </div>
  )
}

export function StockDot({ qty, min }: { qty: number; min: number }) {
  const tone = qty <= 0 ? 'bg-[#ea504c]' : min > 0 && qty <= min ? 'bg-[#d4943a]' : null
  if (!tone) return null
  return <span className={cn('inline-block size-1.5 shrink-0 rounded-full', tone)} title={qty <= 0 ? 'Sin stock' : 'Stock bajo'} />
}
