'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Search, Trash2, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog'
import type { Elaborado } from '@/lib/produccion/elaborados'

// ---------------------------------------------------------------------------
// Qué lleva un elaborado — se carga POR TANDA, como se cocina de verdad:
// "con 5 kg de bondiola, 1,2 kg de cebolla… salen 16". La app lo guarda por
// unidad para escalar cualquier cantidad (Lo hice, compras, costos).
// ---------------------------------------------------------------------------

const UNIDADES = ['kg', 'g', 'l', 'ml', 'unidad'] as const

type Fila = { key: string; stock_item_id: string; name: string; qty: string; unit: string }

function fold(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}
function parse(v: string): number {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const redondeo = (n: number) => String(Math.round(n * 1000) / 1000)

export function RecetaEditorDialog({ elaborado, insumos, onClose, onSaved }: {
  elaborado: Elaborado
  insumos: { id: string; name: string; unit: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const r = elaborado.receta
  const [rinde, setRinde] = useState(r ? redondeo(r.rinde) : '')
  const [filas, setFilas] = useState<Fila[]>(() => (r?.ingredientes ?? []).map((i, n) => ({
    key: `${i.stock_item_id}-${n}`,
    stock_item_id: i.stock_item_id,
    name: i.name,
    qty: redondeo(i.qty_por_unidad * r!.rinde),
    unit: i.unidad_receta ?? i.unit,
  })))
  const [buscando, setBuscando] = useState(filas.length === 0)
  const [q, setQ] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)

  const opciones = useMemo(() => {
    const n = fold(q.trim())
    if (n.length < 2) return []
    const ya = new Set(filas.map((f) => f.stock_item_id))
    return insumos.filter((i) => i.id !== elaborado.id && !ya.has(i.id) && fold(i.name).includes(n)).slice(0, 8)
  }, [q, insumos, filas, elaborado.id])

  const rindeNum = parse(rinde)
  const valido = rindeNum > 0 && filas.length > 0 && filas.every((f) => parse(f.qty) > 0)

  async function guardar() {
    setGuardando(true)
    try {
      const res = await fetch('/api/produccion/elaborados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_item_id: elaborado.id,
          rinde: rindeNum,
          notas: notas.trim() || null,
          ingredientes: filas.map((f) => ({ stock_item_id: f.stock_item_id, qty: parse(f.qty), unit: f.unit })),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar')
      toast.success(`Receta de ${elaborado.name} guardada`)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Qué lleva: {elaborado.name}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-0.5">
          <p className="text-[12px] leading-relaxed text-[#7d6c64]">
            Cargá una tanda como la hacen normalmente. La app calcula el resto para cualquier cantidad.
          </p>

          <label className="flex items-center gap-2 rounded-xl bg-[#e8f5f1] px-3 py-2.5">
            <span className="text-[13px] font-semibold text-[#006d5a]">Una tanda rinde</span>
            <input
              inputMode="decimal"
              value={rinde}
              onChange={(e) => setRinde(e.target.value)}
              placeholder="0"
              className="w-20 rounded-lg border border-[#006d5a]/40 bg-white px-2 py-1 text-center text-[15px] font-bold tabular-nums text-[#006d5a] outline-none"
            />
            <span className="text-[13px] text-[#006d5a]">{elaborado.unit}</span>
          </label>

          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-[#3d2c24]">Ingredientes de esa tanda</p>
            <div className="space-y-1.5">
              {filas.map((f) => (
                <div key={f.key} className="flex items-center gap-1.5 rounded-lg bg-[#faf8f5] px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#3d2c24]">{f.name}</span>
                  <input
                    inputMode="decimal"
                    value={f.qty}
                    onChange={(e) => setFilas((fs) => fs.map((x) => (x.key === f.key ? { ...x, qty: e.target.value } : x)))}
                    className="w-16 rounded-md border border-[#ebe6df] bg-white px-1.5 py-1 text-right text-[12.5px] tabular-nums outline-none focus:border-[#006d5a]"
                  />
                  <select
                    value={f.unit}
                    onChange={(e) => setFilas((fs) => fs.map((x) => (x.key === f.key ? { ...x, unit: e.target.value } : x)))}
                    className="rounded-md border border-[#ebe6df] bg-white px-1 py-1 text-[12px]"
                  >
                    {[...new Set([f.unit, ...UNIDADES])].map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                  <button onClick={() => setFilas((fs) => fs.filter((x) => x.key !== f.key))} aria-label="Quitar" className="p-1 text-[#cfc8bf] hover:text-[#ea504c]">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {buscando ? (
              <div className="mt-2 rounded-xl border border-[#ebe6df] bg-white p-2">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
                    <input
                      autoFocus
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Buscar ingrediente…"
                      className="w-full rounded-lg border border-[#ebe6df] py-1.5 pl-8 pr-2 text-[13px] outline-none focus:border-[#006d5a]"
                    />
                  </div>
                  {filas.length > 0 && (
                    <button onClick={() => { setBuscando(false); setQ('') }} aria-label="Cerrar" className="p-1.5 text-[#a39e97]"><X className="size-4" /></button>
                  )}
                </div>
                {opciones.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      setFilas((fs) => [...fs, { key: `${o.id}-${Date.now()}`, stock_item_id: o.id, name: o.name, qty: '', unit: o.unit }])
                      setQ('')
                      setBuscando(false)
                    }}
                    className="mt-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] text-[#3d2c24] hover:bg-[#faf8f5]"
                  >
                    <span className="truncate">{o.name}</span>
                    <span className="shrink-0 text-[11px] text-[#a39e97]">{o.unit}</span>
                  </button>
                ))}
                {q.trim().length >= 2 && opciones.length === 0 && <p className="py-2 text-center text-[12px] text-[#a39e97]">Sin resultados</p>}
              </div>
            ) : (
              <button onClick={() => setBuscando(true)} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#d9d2c8] py-2 text-[12px] font-medium text-[#7d6c64]">
                <Plus className="size-3.5" /> Agregar ingrediente
              </button>
            )}
          </div>

          <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas (opcional): cocción, orden…" className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[13px]" />
          {rindeNum > 0 && filas.length > 0 && (
            <p className="text-[10.5px] text-[#a39e97]">
              Para 1 {elaborado.unit}: {filas.filter((f) => parse(f.qty) > 0).slice(0, 3).map((f) => `${redondeo(parse(f.qty) / rindeNum)} ${f.unit} de ${f.name}`).join(', ')}{filas.length > 3 ? '…' : ''}
            </p>
          )}
        </div>
        <DialogFooter className="mt-2 gap-2">
          <DialogClose className="rounded-xl px-4 py-2 text-sm font-medium text-[#7d6c64]">Cancelar</DialogClose>
          <button
            onClick={() => void guardar()}
            disabled={guardando || !valido}
            className="flex items-center gap-2 rounded-xl bg-[#006d5a] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {guardando && <Loader2 className="size-4 animate-spin" />} Guardar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
