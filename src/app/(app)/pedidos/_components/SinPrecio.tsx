'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// "Falta el precio": compras en cuenta corriente que llegaron SIN monto.
// Antes no aparecían en Pagos (se filtraban por cost_total) y esa deuda
// quedaba invisible. Acá se listan aparte, sin sumar al saldo en $, con un
// campo para cargar el precio. Usa la misma API de edición de recibos
// (PATCH /api/stock/receipts/[id] con cost_total): al guardar, el recibo
// pasa a la lista normal y suma a la deuda del proveedor.
// Usado en /pedidos (pestaña Pagos) y /pedidos/cuentas.
// ---------------------------------------------------------------------------

export type ReciboSinPrecio = {
  id: number
  supplier_name: string
  note: string | null
  qty: number
  unit: string | null
  received_date: string
}

/**
 * Monto tipeado → número. Acepta "12500", "12.500" (punto de miles),
 * "12.500,50" y "$ 12500". Devuelve NaN si no se entiende.
 */
function parseMonto(raw: string): number {
  let t = raw.replace(/[$\s]/g, '')
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

/** Recibo "a pagar" sin monto cargado (nulo o 0). */
export function faltaPrecio(costTotal: number | null | undefined): boolean {
  return costTotal == null || !(Number(costTotal) > 0)
}

export function SinPrecioSection({ recibos, onSaved }: { recibos: ReciboSinPrecio[]; onSaved: () => void }) {
  const [editId, setEditId] = useState<number | null>(null)
  const [monto, setMonto] = useState('')
  const [saving, setSaving] = useState(false)

  if (recibos.length === 0) return null

  async function guardar(r: ReciboSinPrecio) {
    const valor = parseMonto(monto)
    if (!(valor > 0)) {
      toast.error('Poné un monto mayor a 0')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/stock/receipts/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cost_total: Math.round(valor * 100) / 100 }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar el precio')
      if (json.gastoFudo === 'sin_proveedor') toast.warning(`Precio cargado, pero ${json.gastoFudoTexto}`)
      else toast.success(`Precio cargado — ${r.supplier_name}: ya suma a la deuda${json.gastoFudoTexto ? `. ${json.gastoFudoTexto}` : ''}`)
      if (json.avisoFudo) toast.warning(json.avisoFudo, { duration: 10000 })
      setEditId(null)
      setMonto('')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar el precio')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#d4943a]/40">
      <div className="flex items-start gap-2.5 bg-[#fdf6ec] px-4 py-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#d4943a]" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold uppercase tracking-wider text-[#8b5e34]">
            Falta el precio ({recibos.length})
          </p>
          <p className="text-[11px] text-[#7d6c64]">
            Llegaron en cuenta corriente sin monto. No están sumadas al saldo: cargá el precio para que cuenten como deuda.
          </p>
        </div>
      </div>
      <div className="divide-y divide-[#f5f0ea]">
        {recibos.map((r) => {
          const editando = editId === r.id
          return (
            <div key={r.id} className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[#3d2c24]">{r.supplier_name} — {r.note ?? `${r.qty} ${r.unit ?? ''}`}</p>
                  <p className="text-[10px] text-[#a39e97]">
                    {format(new Date(`${r.received_date}T12:00:00`), 'd MMM', { locale: es })}
                    {' · '}{r.qty} {r.unit ?? 'u'}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[#fdf6ec] px-2 py-0.5 text-[10px] font-bold text-[#d4943a]">Falta el precio</span>
                {!editando ? (
                  <button
                    onClick={() => { setEditId(r.id); setMonto('') }}
                    className="shrink-0 rounded-lg bg-[#d4943a] px-2.5 py-1.5 text-[11px] font-semibold text-white active:scale-95"
                  >
                    Cargar precio
                  </button>
                ) : (
                  <button onClick={() => setEditId(null)} className="flex shrink-0 items-center justify-center rounded-lg bg-[#f3efe9] p-1.5 text-[#a39e97]">
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
              {editando && (
                <div className="mt-2 flex items-center gap-2 border-t border-[#f5f0ea] pt-2">
                  <label className="flex-1">
                    <span className="text-[10px] font-semibold text-[#7d6c64]">Monto total ($)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoFocus
                      value={monto}
                      onChange={(e) => setMonto(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void guardar(r) }}
                      placeholder="Ej: 12500"
                      className="mt-0.5 w-full rounded-lg border border-[#ebe6df] bg-white px-2 py-1.5 text-xs focus:border-[#006d5a] focus:outline-none"
                    />
                  </label>
                  <button
                    onClick={() => void guardar(r)}
                    disabled={saving}
                    className="mt-3.5 flex shrink-0 items-center gap-1 rounded-lg bg-[#006d5a] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60"
                  >
                    {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                    Guardar
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
