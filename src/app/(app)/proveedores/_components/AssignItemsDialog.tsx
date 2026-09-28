'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search, Loader2, Plus, Star, X, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { useVinculos } from '@/lib/hooks/use-vinculos'
import { evidenceText, useIndex, StockDot } from '../vincular/_components/shared'
import type { Supplier } from './types'

// ---------------------------------------------------------------------------
// Productos de un proveedor. Cada toque se guarda al instante (optimista) por
// /api/proveedores/vinculos → set_supplier_links (rol validado en la base).
// ---------------------------------------------------------------------------

type Props = {
  open: boolean
  onClose: (open: boolean) => void
  supplier: Supplier | null
}

function fold(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function AssignItemsDialog({ open, onClose, supplier }: Props) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[85vh] flex-col rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg text-[#3d2c24]">Productos de {supplier?.name}</DialogTitle>
          <DialogDescription className="text-[#a39e97]">
            <Star className="inline size-3 fill-[#006d5a] text-[#006d5a]" /> = se le pide por defecto. Los cambios se guardan solos.
          </DialogDescription>
        </DialogHeader>
        {open && supplier && <Body supplierId={supplier.id} />}
      </DialogContent>
    </Dialog>
  )
}

function Body({ supplierId }: { supplierId: string }) {
  const { data, loading, apply } = useVinculos()
  const idx = useIndex(data)
  const [q, setQ] = useState('')

  const mine = useMemo(() => {
    if (!data) return []
    return data.links
      .filter((l) => l.supplier_id === supplierId)
      .map((l) => ({ link: l, item: idx.item.get(l.item_id)! }))
      .filter((r) => r.item)
      .sort((a, b) => Number(b.link.is_primary) - Number(a.link.is_primary) || b.link.fudo_purchases - a.link.fudo_purchases || a.item.name.localeCompare(b.item.name))
  }, [data, idx, supplierId])

  const candidates = useMemo(() => {
    const needle = fold(q.trim())
    if (!data || !needle) return []
    const linked = new Set(mine.map((m) => m.item.id))
    return data.items.filter((i) => !linked.has(i.id) && fold(i.name).includes(needle)).slice(0, 30)
  }, [data, q, mine])

  if (loading || !data) {
    return <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-[#006d5a]" /></div>
  }

  const supplierName = idx.supplier.get(supplierId)?.name ?? ''

  return (
    <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 px-1">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
        <input
          placeholder="Agregar insumo…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-10 w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] pl-9 pr-3 text-[13px] text-[#3d2c24] outline-none placeholder:text-[#a39e97] focus:border-[#006d5a]"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {q.trim() ? (
          <>
            {candidates.map((item) => {
              const primary = idx.linksByItem.get(item.id)?.find((l) => l.is_primary)
              const current = primary ? idx.supplier.get(primary.supplier_id)?.name : null
              return (
                <div key={item.id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-[#ebe6df]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-[#3d2c24]">{item.name}</p>
                    <p className="truncate text-[10.5px] text-[#a39e97]">{current ? `Hoy: ${current}` : 'Sin proveedor'}</p>
                  </div>
                  {current ? (
                    <>
                      <button
                        onClick={() => apply([{ item_id: item.id, supplier_id: supplierId, op: 'add' }], `${item.name}: ${supplierName} como alternativa`)}
                        className="shrink-0 rounded-lg px-2 py-1.5 text-[11px] font-medium text-[#3d2c24] ring-1 ring-[#ebe6df]"
                      >
                        Alternativa
                      </button>
                      <button
                        onClick={() => apply([{ item_id: item.id, supplier_id: supplierId, op: 'primary' }], `${item.name} pasa a ${supplierName}`)}
                        className="flex shrink-0 items-center gap-1 rounded-lg bg-[#006d5a] px-2 py-1.5 text-[11px] font-semibold text-white"
                      >
                        <ArrowRight className="size-3" /> Mover
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => apply([{ item_id: item.id, supplier_id: supplierId, op: 'primary' }], `${item.name} → ${supplierName}`)}
                      className="flex shrink-0 items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[11px] font-semibold text-white"
                    >
                      <Plus className="size-3" /> Agregar
                    </button>
                  )}
                </div>
              )
            })}
            {candidates.length === 0 && <p className="py-6 text-center text-[12px] text-[#a39e97]">Sin insumos con ese nombre</p>}
          </>
        ) : (
          <>
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[#a39e97]">
              {mine.length} insumo{mine.length === 1 ? '' : 's'}
            </p>
            {mine.map(({ link, item }) => (
              <div key={item.id} className={cn('flex items-center gap-2 rounded-xl px-2.5 py-2 ring-1', link.is_primary ? 'bg-white ring-[#ebe6df]' : 'bg-[#faf8f5] ring-transparent')}>
                <button
                  onClick={() => !link.is_primary && apply([{ item_id: item.id, supplier_id: supplierId, op: 'primary' }], `${supplierName} es el principal de ${item.name}`)}
                  aria-label={link.is_primary ? 'Principal' : 'Hacer principal'}
                  className="shrink-0 rounded-md p-1"
                >
                  <Star className={cn('size-4', link.is_primary ? 'fill-[#006d5a] text-[#006d5a]' : 'text-[#cfc8bf] hover:text-[#006d5a]')} />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[12.5px] font-medium text-[#3d2c24]">
                    <StockDot qty={item.current_qty} min={item.min_qty} />
                    <span className="truncate">{item.name}</span>
                  </p>
                  <p className="truncate text-[10.5px] text-[#a39e97]">{link.is_primary ? '' : 'Alternativa · '}{evidenceText(link)}</p>
                </div>
                <button
                  onClick={() => apply([{ item_id: item.id, supplier_id: supplierId, op: 'remove' }], `${item.name} quitado de ${supplierName}`)}
                  aria-label="Quitar"
                  className="shrink-0 rounded-md p-1 text-[#cfc8bf] hover:bg-[#fef2f2] hover:text-[#ea504c]"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
            {mine.length === 0 && <p className="py-6 text-center text-[12px] text-[#a39e97]">Todavía sin insumos. Buscá arriba para agregar.</p>}
          </>
        )}
      </div>

      <Link href="/proveedores/vincular" className="border-t border-[#ebe6df] pt-3 text-center text-[12px] font-semibold text-[#006d5a]">
        Ver todos los vínculos →
      </Link>
    </div>
  )
}
