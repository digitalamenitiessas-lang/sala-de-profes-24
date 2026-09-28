'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChefHat, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { escalarReceta } from '@/lib/produccion/recetas'
import type { Elaborado } from '@/lib/produccion/elaborados'

// ---------------------------------------------------------------------------
// "Lo hice" — registrar una producción en segundos
// ---------------------------------------------------------------------------
// Con la receta de producción cargada: se pone cuánto salió y la app arma lo
// que se usó (se puede corregir). Encargado/socio: queda registrado al toque
// (suma el elaborado, descuenta los crudos, impacta Fudo). Chef/cocina: va a
// Validar. Si no se puede cerrar, también queda en Validar con el motivo.
// ---------------------------------------------------------------------------

const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 })

function parse(v: string): number {
  const n = parseFloat(v.replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

function hoyMasDias(dias: number): string {
  const d = new Date(Date.now() - 3 * 3_600_000 + dias * 86_400_000)
  return d.toISOString().slice(0, 10)
}

export function LoHiceDialog({ elaborado, puedeCerrar, sugerido, onClose, onDone, onCargarReceta }: {
  elaborado: Elaborado
  puedeCerrar: boolean
  sugerido?: number | null
  onClose: () => void
  onDone: () => void
  onCargarReceta?: () => void
}) {
  const receta = elaborado.receta
  const inicial = sugerido && sugerido > 0 ? sugerido : receta?.rinde ?? 1
  const [cantidad, setCantidad] = useState(String(inicial))
  const [ajustes, setAjustes] = useState<Record<string, string>>({})
  const [vence, setVence] = useState(elaborado.shelf_life_days ? hoyMasDias(elaborado.shelf_life_days) : '')
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)

  const qty = parse(cantidad)
  const usados = useMemo(() => (receta && qty > 0 ? escalarReceta(receta, qty) : []), [receta, qty])
  const tandas = receta && qty > 0 ? qty / receta.rinde : 0

  async function registrar() {
    if (!receta || !(qty > 0)) return
    setEnviando(true)
    try {
      const inputs = usados.map((u) => {
        const ajuste = ajustes[u.stock_item_id]
        const q = ajuste !== undefined ? parse(ajuste) : u.qty
        return { stock_item_id: u.stock_item_id, qty_used: q, unit: u.unit }
      }).filter((i) => i.qty_used > 0)
      const res = await fetch('/api/produccion/orders/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: receta.name || elaborado.name,
          notes: ['Registrada con "Lo hice"', nota.trim()].filter(Boolean).join(' — '),
          auto_complete: puedeCerrar,
          inputs,
          outputs: [{
            stock_item_id: elaborado.id,
            output_name: elaborado.name,
            qty_produced: qty,
            unit: elaborado.unit,
            expires_at: vence || null,
          }],
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Si quedó en Validar, no se perdió: avisar el motivo
        if (json.status === 'pending_review') {
          toast.warning(json.error ?? 'Quedó en Validar')
          onDone()
          return
        }
        throw new Error(json.error ?? 'No se pudo registrar')
      }
      toast.success(json.status === 'pending_review'
        ? `${num(qty)} ${elaborado.unit} de ${elaborado.name}: enviado a validar`
        : `${num(qty)} ${elaborado.unit} de ${elaborado.name} registrados`)
      for (const w of (json?.warnings ?? []) as string[]) if (w.includes('Fudo')) toast.info(w)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo registrar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ChefHat className="size-4 text-[#006d5a]" /> Lo hice: {elaborado.name}
          </DialogTitle>
        </DialogHeader>

        {!receta ? (
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-[#3d2c24]">Todavía no está cargado qué lleva {elaborado.name}.</p>
            <p className="text-[12px] text-[#7d6c64]">Con la receta cargada, registrar una tanda es un toque y la app descuenta los ingredientes sola.</p>
            {onCargarReceta && (
              <button onClick={onCargarReceta} className="w-full rounded-xl bg-[#006d5a] py-2.5 text-sm font-semibold text-white">Cargar qué lleva</button>
            )}
          </div>
        ) : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-0.5">
            <div>
              <p className="mb-1.5 text-[12px] font-semibold text-[#3d2c24]">¿Cuánto salió?</p>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  inputMode="decimal"
                  value={cantidad}
                  onChange={(e) => { setCantidad(e.target.value); setAjustes({}) }}
                  className="w-24 rounded-xl border border-[#006d5a] bg-white px-3 py-2 text-center text-lg font-bold tabular-nums text-[#006d5a] outline-none"
                />
                <span className="text-[13px] text-[#3d2c24]">{elaborado.unit}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[1, 2, 3].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setCantidad(String(Math.round(receta.rinde * t * 100) / 100)); setAjustes({}) }}
                    className={cn('rounded-full px-3 py-1 text-[11.5px] font-medium ring-1', Math.abs(tandas - t) < 0.01 ? 'bg-[#e8f5f1] text-[#006d5a] ring-[#006d5a]/30' : 'bg-white text-[#7d6c64] ring-[#ebe6df]')}
                  >
                    {t} tanda{t > 1 ? 's' : ''} ({num(receta.rinde * t)})
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-[12px] font-semibold text-[#3d2c24]">Se usó <span className="font-normal text-[#a39e97]">(corregí si fue distinto)</span></p>
              <div className="space-y-1">
                {usados.map((u) => (
                  <div key={u.stock_item_id} className="flex items-center gap-2 rounded-lg bg-[#faf8f5] px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#3d2c24]">{u.name}</span>
                    <input
                      inputMode="decimal"
                      value={ajustes[u.stock_item_id] ?? String(u.qty)}
                      onChange={(e) => setAjustes((a) => ({ ...a, [u.stock_item_id]: e.target.value }))}
                      className="w-20 rounded-md border border-[#ebe6df] bg-white px-2 py-1 text-right text-[12.5px] tabular-nums outline-none focus:border-[#006d5a]"
                    />
                    <span className="w-10 text-[11px] text-[#a39e97]">{u.unit}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] font-semibold text-[#3d2c24]">Vence</span>
                <input type="date" value={vence} onChange={(e) => setVence(e.target.value)} className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-2 py-1.5 text-[12.5px]" />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-[#3d2c24]">Nota</span>
                <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="opcional" className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-2 py-1.5 text-[12.5px]" />
              </label>
            </div>
            <p className="text-[10.5px] text-[#a39e97]">
              {puedeCerrar
                ? 'Se suma al stock, se descuentan los ingredientes y se actualiza Fudo.'
                : 'Va a Validar: un encargado lo confirma y ahí se actualiza el stock y Fudo.'}
            </p>
          </div>
        )}

        {receta && (
          <DialogFooter className="mt-2 gap-2">
            <DialogClose className="rounded-xl px-4 py-2 text-sm font-medium text-[#7d6c64]">Cancelar</DialogClose>
            <button
              onClick={() => void registrar()}
              disabled={enviando || !(qty > 0)}
              className="flex items-center gap-2 rounded-xl bg-[#006d5a] px-5 py-2 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-60"
            >
              {enviando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {puedeCerrar ? 'Registrar' : 'Enviar a validar'}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
