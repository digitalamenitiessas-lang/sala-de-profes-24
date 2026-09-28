'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Plus, Search, Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STOCK_AREAS } from '@/lib/stock/areas'
import type { VinculosPayload } from '@/lib/proveedores/vinculos'
import type { LinkChange } from '@/lib/hooks/use-vinculos'
import { SupplierPicker, StockDot, evidenceText, useIndex } from './shared'

type Props = {
  data: VinculosPayload
  apply: (changes: LinkChange[], msg?: string) => Promise<boolean>
}

type Filter = 'todos' | 'sin' | 'varios' | 'bajo'

function fold(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function ProductsTab({ data, apply }: Props) {
  const idx = useIndex(data)
  const [q, setQ] = useState('')
  const [area, setArea] = useState<string>('todas')
  const [filter, setFilter] = useState<Filter>('todos')
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  const areas = useMemo(() => {
    const present = new Set(data.items.map((i) => i.area ?? 'otros'))
    return STOCK_AREAS.filter((a) => present.has(a.value))
  }, [data.items])

  const rows = useMemo(() => {
    const needle = fold(q.trim())
    return data.items.filter((i) => {
      const links = idx.linksByItem.get(i.id) ?? []
      if (area !== 'todas' && (i.area ?? 'otros') !== area) return false
      if (filter === 'sin' && links.some((l) => l.is_primary)) return false
      if (filter === 'varios' && links.length < 2) return false
      if (filter === 'bajo' && !(i.current_qty <= 0 || (i.min_qty > 0 && i.current_qty <= i.min_qty))) return false
      if (!needle) return true
      return fold(i.name).includes(needle) || links.some((l) => fold(idx.supplier.get(l.supplier_id)?.name ?? '').includes(needle))
    })
  }, [data.items, idx, q, area, filter])

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'todos', label: 'Todos' },
    { key: 'sin', label: 'Sin proveedor' },
    { key: 'varios', label: 'Varios proveedores' },
    { key: 'bajo', label: 'Stock bajo' },
  ]

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
        <input
          placeholder="Buscar insumo o proveedor…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-11 w-full rounded-xl border border-[#ebe6df] bg-white pl-10 pr-3 text-[14px] text-[#3d2c24] outline-none placeholder:text-[#a39e97] focus:border-[#006d5a]"
        />
      </div>

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
        {[{ value: 'todas', short: 'Todas', icon: '' }, ...areas].map((a) => (
          <button
            key={a.value}
            onClick={() => setArea(a.value)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition',
              area === a.value ? 'bg-[#3d2c24] text-white' : 'bg-white text-[#7d6c64] ring-1 ring-[#ebe6df]',
            )}
          >
            {a.icon ? `${a.icon} ` : ''}{a.short}
          </button>
        ))}
      </div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-[11.5px] font-medium transition',
              filter === f.key ? 'bg-[#e8f5f1] text-[#006d5a] ring-1 ring-[#006d5a]/30' : 'text-[#a39e97]',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-[#a39e97]">{rows.length} insumo{rows.length === 1 ? '' : 's'}</p>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
        {rows.length === 0 && <p className="py-10 text-center text-[13px] text-[#a39e97]">Nada con ese filtro</p>}
        <ul className="divide-y divide-[#f5f0ea]">
          {rows.map((item) => {
            const links = idx.linksByItem.get(item.id) ?? []
            const primary = links.find((l) => l.is_primary)
            const isOpen = open === item.id
            return (
              <li key={item.id}>
                <button
                  onClick={() => { setOpen(isOpen ? null : item.id); setAdding(null) }}
                  className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-[#faf8f5]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-[13.5px] font-medium text-[#3d2c24]">
                      <StockDot qty={item.current_qty} min={item.min_qty} />
                      <span className="truncate">{item.name}</span>
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-[11.5px]">
                      {primary ? (
                        <span className="truncate text-[#006d5a]">{idx.supplier.get(primary.supplier_id)?.name}</span>
                      ) : (
                        <span className="font-medium text-[#ea504c]">Sin proveedor</span>
                      )}
                      {links.length > 1 && <span className="shrink-0 text-[#a39e97]">· +{links.length - 1}</span>}
                    </p>
                  </div>
                  <ChevronDown className={cn('size-4 shrink-0 text-[#a39e97] transition-transform', isOpen && 'rotate-180')} />
                </button>

                {isOpen && (
                  <div className="space-y-1.5 bg-[#fcfbf9] px-3.5 pb-3.5 pt-1">
                    {links.map((l) => {
                      const s = idx.supplier.get(l.supplier_id)
                      return (
                        <div key={l.supplier_id} className={cn('flex items-center gap-2 rounded-xl px-2.5 py-2 ring-1', l.is_primary ? 'bg-[#e8f5f1] ring-[#006d5a]/20' : 'bg-white ring-[#ebe6df]')}>
                          <button
                            onClick={() => !l.is_primary && apply([{ item_id: item.id, supplier_id: l.supplier_id, op: 'primary' }], `${s?.name} es el principal de ${item.name}`)}
                            aria-label={l.is_primary ? 'Proveedor principal' : 'Hacer principal'}
                            title={l.is_primary ? 'Proveedor principal: se le pide por defecto' : 'Hacer principal'}
                            className="shrink-0 rounded-md p-1 transition active:scale-90"
                          >
                            <Star className={cn('size-4', l.is_primary ? 'fill-[#006d5a] text-[#006d5a]' : 'text-[#cfc8bf] hover:text-[#006d5a]')} />
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className={cn('truncate text-[12.5px] font-semibold', l.is_primary ? 'text-[#006d5a]' : 'text-[#3d2c24]')}>{s?.name ?? '—'}</p>
                            <p className="truncate text-[10.5px] text-[#a39e97]">
                              {l.is_primary ? 'Principal · ' : ''}{evidenceText(l)}
                            </p>
                          </div>
                          <button
                            onClick={() => apply([{ item_id: item.id, supplier_id: l.supplier_id, op: 'remove' }], `${s?.name} quitado de ${item.name}`)}
                            aria-label="Quitar proveedor"
                            className="shrink-0 rounded-md p-1 text-[#cfc8bf] transition hover:bg-[#fef2f2] hover:text-[#ea504c]"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      )
                    })}
                    {adding === item.id ? (
                      <SupplierPicker
                        suppliers={data.suppliers}
                        exclude={links.map((l) => l.supplier_id)}
                        onCancel={() => setAdding(null)}
                        onPick={(sid) => {
                          setAdding(null)
                          void apply([{ item_id: item.id, supplier_id: sid, op: 'add' }], `${idx.supplier.get(sid)?.name} agregado a ${item.name}`)
                        }}
                      />
                    ) : (
                      <button
                        onClick={() => setAdding(item.id)}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#d9d2c8] py-2 text-[12px] font-medium text-[#7d6c64] transition hover:bg-white"
                      >
                        <Plus className="size-3.5" /> {links.length ? 'Agregar otro proveedor' : 'Elegir proveedor'}
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
