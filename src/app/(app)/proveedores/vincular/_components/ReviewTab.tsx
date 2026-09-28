'use client'

import { useState } from 'react'
import { ArrowRight, Check, CheckCheck, Search, Sparkles, Loader2 } from 'lucide-react'
import { AnimatePresence, motion } from '@/components/ui/motion'
import type { VinculosPayload } from '@/lib/proveedores/vinculos'
import type { LinkChange } from '@/lib/hooks/use-vinculos'
import { SupplierPicker, StockDot, evidenceText, useIndex } from './shared'

type Props = {
  data: VinculosPayload
  apply: (changes: LinkChange[], msg?: string) => Promise<boolean>
}

const cardMotion = {
  layout: true,
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: 40, transition: { duration: 0.2 } },
} as const

export function ReviewTab({ data, apply }: Props) {
  const idx = useIndex(data)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [bulk, setBulk] = useState(false)
  const { conflicts, unlinked } = data.review

  const name = (id: string) => idx.supplier.get(id)?.name ?? '—'
  const link = (item: string, sup: string) => idx.linksByItem.get(item)?.find((l) => l.supplier_id === sup)

  async function acceptAllFudo() {
    setBulk(true)
    await apply(
      conflicts.map((c) => ({ item_id: c.item_id, supplier_id: c.suggested_supplier_id, op: 'primary' as const })),
      `${conflicts.length} insumo${conflicts.length === 1 ? '' : 's'} alineado${conflicts.length === 1 ? '' : 's'} con Fudo`,
    )
    setBulk(false)
  }

  if (conflicts.length === 0 && unlinked.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-[#ebe6df]">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-[#e8f5f1]">
          <CheckCheck className="size-6 text-[#006d5a]" />
        </div>
        <p className="text-[15px] font-semibold text-[#3d2c24]">Todo en orden</p>
        <p className="mt-1 text-[12.5px] text-[#a39e97]">
          Cada insumo tiene proveedor y coincide con lo que se compra en Fudo.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {conflicts.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-bold text-[#3d2c24]">Fudo dice otra cosa ({conflicts.length})</h2>
              <p className="text-[11.5px] text-[#a39e97]">Las compras reales van a otro proveedor que el cargado en LVE.</p>
            </div>
            {conflicts.length > 1 && (
              <button
                onClick={acceptAllFudo}
                disabled={bulk}
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#006d5a] px-3 py-2 text-[12px] font-semibold text-white transition active:scale-95 disabled:opacity-50"
              >
                {bulk ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
                Aceptar todas
              </button>
            )}
          </div>
          <AnimatePresence initial={false}>
            {conflicts.map((c) => {
              const item = idx.item.get(c.item_id)
              const cur = link(c.item_id, c.current_supplier_id)
              const sug = link(c.item_id, c.suggested_supplier_id)
              if (!item) return null
              return (
                <motion.div key={c.item_id} {...cardMotion} className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-[#ebe6df]">
                  <div className="flex items-center gap-2">
                    <StockDot qty={item.current_qty} min={item.min_qty} />
                    <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[#3d2c24]">{item.name}</p>
                    <span className="shrink-0 text-[10.5px] capitalize text-[#a39e97]">{item.area ?? item.category}</span>
                  </div>
                  <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
                    <div className="min-w-0 rounded-xl bg-[#faf8f5] px-2.5 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#a39e97]">Hoy en LVE</p>
                      <p className="truncate text-[12.5px] font-semibold text-[#3d2c24]">{name(c.current_supplier_id)}</p>
                      <p className="text-[10.5px] text-[#a39e97]">{cur ? evidenceText(cur) : ''}</p>
                    </div>
                    <ArrowRight className="size-4 self-center text-[#a39e97]" />
                    <div className="min-w-0 rounded-xl bg-[#e8f5f1] px-2.5 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#006d5a]/70">Según Fudo</p>
                      <p className="truncate text-[12.5px] font-semibold text-[#006d5a]">{name(c.suggested_supplier_id)}</p>
                      <p className="text-[10.5px] text-[#006d5a]/80">{sug ? evidenceText(sug) : ''}</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      onClick={() => apply([{ item_id: c.item_id, supplier_id: c.suggested_supplier_id, op: 'primary' }], `${item.name} → ${name(c.suggested_supplier_id)}`)}
                      className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] px-3 py-2 text-[12px] font-semibold text-white transition active:scale-[0.98]"
                    >
                      <Check className="size-3.5 shrink-0" /> <span className="truncate">Pasar a {name(c.suggested_supplier_id).split(' (')[0]}</span>
                    </button>
                    <button
                      onClick={() => apply([{ item_id: c.item_id, supplier_id: c.current_supplier_id, op: 'confirm' }])}
                      className="shrink-0 rounded-xl px-3 py-2 text-[12px] font-medium text-[#3d2c24] ring-1 ring-[#ebe6df] transition hover:bg-[#faf8f5] active:scale-[0.98]"
                    >
                      Mantener
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </section>
      )}

      {unlinked.length > 0 && (
        <section className="space-y-2">
          <div>
            <h2 className="text-[13px] font-bold text-[#3d2c24]">Sin proveedor ({unlinked.length})</h2>
            <p className="text-[11.5px] text-[#a39e97]">No entran en las sugerencias de pedido hasta tener uno.</p>
          </div>
          <AnimatePresence initial={false}>
            {unlinked.map((u) => {
              const item = idx.item.get(u.item_id)
              if (!item) return null
              const open = pickerFor === u.item_id
              return (
                <motion.div key={u.item_id} {...cardMotion} className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-[#ebe6df]">
                  <div className="flex items-center gap-2">
                    <StockDot qty={item.current_qty} min={item.min_qty} />
                    <p className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[#3d2c24]">{item.name}</p>
                    <span className="shrink-0 text-[10.5px] capitalize text-[#a39e97]">{item.area ?? item.category}</span>
                  </div>
                  {!item.in_fudo && <p className="mt-0.5 text-[10.5px] text-[#d4943a]">No está vinculado a Fudo</p>}

                  {!open && u.suggestion && (
                    <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl bg-[#e8f5f1] px-3 py-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-[12.5px] font-semibold text-[#006d5a]">
                          <Sparkles className="size-3.5 shrink-0" /> {name(u.suggestion.supplier_id)}
                        </p>
                        <p className="text-[10.5px] text-[#006d5a]/80">{u.suggestion.reason}</p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => apply([{ item_id: u.item_id, supplier_id: u.suggestion!.supplier_id, op: 'primary' }], `${item.name} → ${name(u.suggestion!.supplier_id)}`)}
                          className="flex items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[11.5px] font-semibold text-white active:scale-95"
                        >
                          <Check className="size-3" /> Confirmar
                        </button>
                        <button onClick={() => setPickerFor(u.item_id)} className="rounded-lg bg-white px-2.5 py-1.5 text-[11.5px] font-medium text-[#3d2c24] ring-1 ring-[#dcefe8]">
                          Otro
                        </button>
                      </div>
                    </div>
                  )}
                  {!open && !u.suggestion && (
                    <button
                      onClick={() => setPickerFor(u.item_id)}
                      className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#ebe6df] py-2 text-[12px] font-medium text-[#7d6c64] hover:bg-[#faf8f5]"
                    >
                      <Search className="size-3.5" /> Elegir proveedor
                    </button>
                  )}
                  {open && (
                    <div className="mt-2.5">
                      <SupplierPicker
                        suppliers={data.suppliers}
                        highlighted={u.suggestion ? [{ id: u.suggestion.supplier_id, hint: u.suggestion.reason }] : []}
                        onCancel={() => setPickerFor(null)}
                        onPick={(sid) => {
                          setPickerFor(null)
                          void apply([{ item_id: u.item_id, supplier_id: sid, op: 'primary' }], `${item.name} → ${name(sid)}`)
                        }}
                      />
                    </div>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </section>
      )}
    </div>
  )
}
