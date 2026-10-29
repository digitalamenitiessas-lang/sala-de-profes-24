'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { money, type ExpenseLite, type Order, type Supplier } from './shared'

// ---------------------------------------------------------------------------
// "Facturas para cargar en Fudo": lo que llegó con Factura A y todavía no
// tiene la factura en Fudo (received_mode 'factura_pendiente', ver
// lib/compras/factura-en-fudo). Cuando administración la carga, la app la
// vincula sola; si no la reconoce (otro proveedor en Fudo, sin productos),
// acá se elige el gasto a mano.
// ---------------------------------------------------------------------------

type Grupo = { key: string; supplier: Supplier | null; dia: string; pedidos: Order[] }

export function FacturasPendientes({ pedidos, suppliers, gastosFudo, onDone }: {
  pedidos: Order[]
  suppliers: Supplier[]
  /** Gastos de Fudo sin vincular (GET /api/compras/conciliar) */
  gastosFudo: ExpenseLite[]
  onDone: () => void
}) {
  const [abierto, setAbierto] = useState<string | null>(null)
  const [elegido, setElegido] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const grupos: Grupo[] = []
  for (const o of pedidos) {
    const dia = o.received_at ? new Date(o.received_at).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) : ''
    const key = `${o.supplier_id ?? 'sin'}-${dia}`
    const g = grupos.find((x) => x.key === key)
    if (g) g.pedidos.push(o)
    else grupos.push({ key, supplier: suppliers.find((s) => s.id === o.supplier_id) ?? null, dia, pedidos: [o] })
  }
  if (grupos.length === 0) return null

  async function vincular(g: Grupo) {
    if (!elegido) return
    setEnviando(true)
    try {
      const res = await fetch('/api/kitchen/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link_fudo_expense', expenseId: elegido, items: g.pedidos.map((o) => ({ orderId: o.id, source: o.source })) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) throw new Error(json.error ?? json.resultados?.find((r: { ok: boolean; error?: string }) => !r.ok)?.error ?? 'No se pudo vincular')
      toast.success(`Factura vinculada: gasto #${elegido} de Fudo`)
      setAbierto(null)
      setElegido(null)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo vincular')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="mb-3 overflow-hidden rounded-2xl bg-white ring-1 ring-[#4a90d9]/30">
      <div className="flex items-center gap-2 bg-[#eef4fc] px-4 py-2.5">
        <FileText className="size-4 shrink-0 text-[#2f5d8a]" />
        <p className="flex-1 text-[12.5px] font-semibold text-[#2f5d8a]">Facturas para cargar en Fudo</p>
        <span className="rounded-full bg-[#2f5d8a]/10 px-2 py-0.5 text-[11px] font-bold text-[#2f5d8a]">{grupos.length}</span>
      </div>
      <p className="px-4 pt-2 text-[10.5px] text-[#7d6c64]">Llegaron con Factura A. Cuando administración carga la factura en Fudo (con los productos), la app la vincula sola y suma el stock.</p>
      <div className="divide-y divide-[#f5f0ea]">
        {grupos.map((g) => {
          const opciones = gastosFudo.filter((e) => g.supplier?.fudo_provider_id && e.providerId === g.supplier.fudo_provider_id)
          const numero = g.pedidos.map((o) => o.received_note?.match(/N° ([^\s:]+)/)?.[1]).find(Boolean)
          return (
            <div key={g.key} className="px-4 py-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[#3d2c24]">{g.supplier?.name ?? 'Sin proveedor'}{numero ? <span className="font-normal text-[#7d6c64]"> · N° {numero}</span> : null}</p>
                  <p className="text-[11px] text-[#7d6c64]">
                    {g.dia ? `Llegó el ${format(new Date(`${g.dia}T12:00:00`), "d 'de' MMM", { locale: es })}` : 'Llegó'} · {g.pedidos.map((o) => o.product_name).join(', ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setAbierto(abierto === g.key ? null : g.key); setElegido(null) }}
                  className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-[#2f5d8a] ring-1 ring-[#cfdcf3]"
                >
                  Ya está en Fudo
                </button>
              </div>
              {abierto === g.key && (
                <div className="mt-2 space-y-1.5 rounded-xl bg-[#f7faff] p-2.5 text-[12px]">
                  {opciones.length === 0 ? (
                    <p className="text-[#7d6c64]">No hay gastos de {g.supplier?.name ?? 'este proveedor'} en Fudo sin vincular. Si recién la cargaron, esperá unos minutos: la app la toma sola.</p>
                  ) : (
                    <>
                      <p className="text-[#2f5d8a]">Elegí la factura en Fudo:</p>
                      {opciones.map((e) => (
                        <label key={e.id} className={cn('flex cursor-pointer items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 ring-1', elegido === e.id ? 'ring-[#2f5d8a]' : 'ring-[#e3e9f3]')}>
                          <input type="radio" name={`factura-${g.key}`} checked={elegido === e.id} onChange={() => setElegido(e.id)} className="accent-[#2f5d8a]" />
                          <span className="flex-1">#{e.id} · {format(new Date(e.date), 'd MMM HH:mm', { locale: es })}{e.ingredientNames.length ? ` · ${e.ingredientNames.slice(0, 3).join(', ')}` : ''}</span>
                          <span className="font-semibold">{money(e.amount)}</span>
                        </label>
                      ))}
                      <button type="button" onClick={() => void vincular(g)} disabled={!elegido || enviando} className="flex items-center gap-1.5 rounded-lg bg-[#2f5d8a] px-3 py-1.5 font-semibold text-white disabled:opacity-50">
                        {enviando && <Loader2 className="size-3.5 animate-spin" />} Vincular
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
