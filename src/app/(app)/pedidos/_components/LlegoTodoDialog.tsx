'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { PAYMENT_METHODS, esComprable, money, parseQty, type Match, type Order, type PaymentMethod, type StockLite, type Supplier } from './shared'
import { sugerirInsumo } from '@/lib/compras/lista-pegada'
import { DatosGastoFields, useDatosGasto } from './DatosGastoFields'
import { FilaLlegoDeMas, nuevaFilaExtra, pedirPendientesFudo, traerDeFudo, type FilaExtra, type PendienteFudo } from './LlegoDeMas'
import { AgregarProductoDialog } from '@/app/(app)/stock/_components/AgregarProductoDialog'

// ---------------------------------------------------------------------------
// LlegoTodoDialog — recibir todo lo de un proveedor de una vez
// ---------------------------------------------------------------------------
// Todo arranca como "llegó" con la cantidad pedida. Por producto se puede
// cambiar la cantidad, poner el precio, dejar un detalle o vencimiento, o
// destildarlo: por defecto "sigue en camino", o "no vino" (se cierra solo ese
// producto, sin stock ni gasto). El medio de pago va una sola vez.
// El server confirma cada producto con la misma lógica que "Llegó".
// "+ Llegó algo más" suma lo que vino sin estar en el pedido; sin pedidos
// (orders vacío) es una compra sin pedido: se elige el proveedor.
// ---------------------------------------------------------------------------

type FilaLlegada = {
  order: Order
  llego: boolean
  /** solo si !llego: true = no vino (se cierra), false = sigue en camino */
  noVino: boolean
  qty: string
  total: string
  note: string
  expiresAt: string
  abierto: boolean
  /** Insumo: el del pedido, o el que se eligió acá (pedido escrito a mano) */
  stockItemId: string | null
}

export function LlegoTodoDialog({ supplier: proveedorDelPedido, suppliers = [], orders, stockItems: stockDelPadre, matchByOrder, onClose, onDone }: {
  supplier: Supplier | null
  /** Para elegir el proveedor en una compra sin pedido */
  suppliers?: Supplier[]
  orders: Order[]
  stockItems: StockLite[]
  matchByOrder: Map<string, Match>
  onClose: () => void
  onDone: () => void
}) {
  const [filas, setFilas] = useState<FilaLlegada[]>(() => orders.map((o) => ({
    order: o, llego: true, noVino: false, qty: o.quantity, total: '', note: '', expiresAt: '', abierto: false,
    stockItemId: o.stock_item_id ?? null,
  })))
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null)
  const [factura, setFactura] = useState('')
  const sinPedido = orders.length === 0
  const [proveedorId, setProveedorId] = useState(proveedorDelPedido?.id ?? '')
  const supplier = proveedorDelPedido ?? suppliers.find((s) => s.id === proveedorId) ?? null
  // Lo que llegó y no estaba en el pedido (en una compra sin pedido, es todo)
  const [extras, setExtras] = useState<FilaExtra[]>(() => (sinPedido ? [nuevaFilaExtra()] : []))
  // Insumos creados o traídos de Fudo acá mismo
  const [nuevos, setNuevos] = useState<StockLite[]>([])
  const stockItems = nuevos.length ? [...stockDelPadre, ...nuevos] : stockDelPadre
  const [fudo, setFudo] = useState<PendienteFudo[] | null>(null)
  const [cargandoFudo, setCargandoFudo] = useState(false)
  const [crear, setCrear] = useState<{ key: string; nombre: string } | null>(null)
  const setExtra = (key: string, patch: Partial<FilaExtra>) => setExtras((x) => x.map((e) => (e.key === key ? { ...e, ...patch } : e)))
  const usarInsumo = (key: string, item: StockLite) => {
    setNuevos((n) => [...n.filter((x) => x.id !== item.id), item])
    setExtra(key, { nombre: item.name, stockItemId: item.id })
  }
  function cargarFudo() {
    setCargandoFudo(true)
    pedirPendientesFudo()
      .then(setFudo)
      .catch(() => setFudo([]))
      .finally(() => setCargandoFudo(false))
  }

  // Pre-seleccionar el medio de pago del último recibo de este proveedor
  useEffect(() => {
    if (!supplier?.id) return
    const supabase = createClient()
    void supabase.from('stock_receipts')
      .select('payment_method')
      .eq('supplier_id', supplier.id)
      .not('payment_method', 'is', null)
      .order('received_date', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.payment_method) setPaymentMethod(data.payment_method as PaymentMethod)
      })
  }, [supplier?.id])
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [errores, setErrores] = useState<Record<number, string>>({})

  const stockById = new Map(stockItems.map((s) => [s.id, s]))
  const comprables = stockItems.filter(esComprable)
  const set = (i: number, patch: Partial<FilaLlegada>) => setFilas((f) => f.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const llegan = filas.filter((f) => f.llego)
  const noVienen = filas.filter((f) => !f.llego && f.noVino)
  const extrasOk = extras.filter((e) => e.nombre.trim())
  const cuantosLlegan = llegan.length + extrasOk.length
  const sumaProductos = [...llegan, ...extrasOk].reduce((a, f) => { const n = parseQty(f.total); return a + (Number.isFinite(n) && n > 0 ? n : 0) }, 0)
  const facturaNum = parseQty(factura)
  const faltaCantidad = [...llegan, ...extrasOk].some((f) => f.stockItemId && !(parseQty(f.qty) > 0))
  // Categoría del gasto: obligatoria cuando la compra tiene monto
  const datosGasto = useDatosGasto(supplier?.id)
  // Misma factura que una carga anterior de hoy: el total ya está en ese gasto
  const facturaYaCargada = !!datosGasto.campos.numeroAnterior && datosGasto.campos.numero.trim() === datosGasto.campos.numeroAnterior
  const hayMonto = sumaProductos > 0 || (Number.isFinite(facturaNum) && facturaNum > 0)
  // Si nada llegó pero hay productos que no vinieron, se puede cerrar sin medio de pago
  const puede = !enviando && (cuantosLlegan > 0
    ? !!paymentMethod && !faltaCantidad && !(hayMonto && datosGasto.falta) && (extrasOk.length === 0 || !!supplier)
    : noVienen.length > 0)

  async function confirmar() {
    if (cuantosLlegan > 0 && !paymentMethod) return
    setEnviando(true)
    setErrores({})
    try {
      const res = await fetch('/api/kitchen/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_arrival_batch',
          paymentMethod,
          invoiceTotal: !facturaYaCargada && Number.isFinite(facturaNum) && facturaNum > 0 ? facturaNum : null,
          note: nota.trim() || null,
          gasto: datosGasto.datos,
          supplierId: supplier?.id ?? null,
          extras: extrasOk.map((e) => {
            const t = parseQty(e.total)
            return {
              productName: e.nombre.trim(),
              receivedQty: e.qty.trim() || null,
              stockItemId: e.stockItemId,
              totalCost: Number.isFinite(t) && t > 0 ? t : null,
              expiresAt: e.expiresAt || null,
            }
          }),
          items: filas.map((f) => {
            const t = parseQty(f.total)
            return {
              orderId: f.order.id,
              source: f.order.source,
              llego: f.llego,
              noVino: !f.llego && f.noVino,
              receivedQty: f.qty,
              stockItemId: f.stockItemId,
              totalCost: Number.isFinite(t) && t > 0 ? t : null,
              expiresAt: f.expiresAt || null,
              note: f.note.trim() || null,
            }
          }),
        }),
      })
      const json = await res.json().catch(() => ({}))
      const resultados = (json.resultados ?? []) as { orderId: number; ok: boolean; error?: string }[]
      const fallidos = resultados.filter((r) => !r.ok)
      if (json.noVinieron > 0) {
        toast.success(json.noVinieron === 1 ? 'Marcaste 1 producto que no vino: no suma stock ni gasto' : `Marcaste ${json.noVinieron} productos que no vinieron: no suman stock ni gasto`)
      }
      if (json.recibidos > 0) {
        const quedan = filas.length - llegan.length - noVienen.length
        if (json.agregados > 0) toast.success(json.agregados === 1 ? 'Lo que llegó de más quedó registrado' : `Los ${json.agregados} que llegaron de más quedaron registrados`)
        toast.success(`Llegaron ${json.recibidos} producto${json.recibidos === 1 ? '' : 's'} de ${supplier?.name ?? 'el proveedor'}${quedan ? ` · ${quedan} ${quedan === 1 ? 'sigue' : 'siguen'} en camino` : ''}`)
        if (json.resto) toast.info(`Resto de la factura sin detallar: ${money(json.resto)} (queda en Pagos)`)
        if (paymentMethod === 'cuenta_corriente') toast.info('Quedó en Pagos pendiente de saldar')
      }
      if (fallidos.length > 0) {
        // Quedan en pantalla solo los que fallaron, con el motivo, para reintentar
        setErrores(Object.fromEntries(fallidos.map((r) => [r.orderId, r.error ?? 'Error'])))
        setFilas((f) => f.filter((x) => fallidos.some((r) => r.orderId === x.order.id)))
        // Lo agregado de más que falló ya quedó como pedido "en camino": se reintenta con "Llegó"
        const fallaronExtras = fallidos.filter((r) => !filas.some((x) => x.order.id === r.orderId)).length
        setExtras([])
        toast.error(`${fallidos.length} no se pudo${fallidos.length === 1 ? '' : 'eron'} confirmar: revisalos${fallaronExtras ? ` (lo agregado de más quedó En camino: tocá Llegó)` : ''}`)
        if (json.recibidos > 0 || fallaronExtras > 0) onDone()
        return
      }
      if (!res.ok || !json.success) throw new Error(json.error ?? 'No se pudo confirmar')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al confirmar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">{sinPedido ? 'Llegó una compra sin pedido' : `Llegó el pedido de ${supplier?.name ?? 'proveedor'}`}</DialogTitle>
          <div className="mt-1 flex items-center gap-2">
            {!proveedorDelPedido && (sinPedido || extrasOk.length > 0) ? (
              <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)} className={cn('w-full rounded-xl border bg-white px-3 py-2 text-sm text-[#3d2c24] focus:outline-none', proveedorId ? 'border-[#ebe6df]' : 'border-[#d4943a]')}>
                <option value="">¿De qué proveedor? *</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.fudo_provider_id ? '' : ' (sin Fudo)'}</option>)}
              </select>
            ) : supplier ? (
              <>
                <span className="text-[12px] text-[#7d6c64]">Proveedor: <span className="font-bold text-[#3d2c24]">{supplier.name}</span></span>
                {supplier.fudo_provider_id && (
                  <span className="rounded-full bg-[#e8f5f1] px-1.5 py-0.5 text-[10px] font-bold text-[#006d5a]">Fudo ✓</span>
                )}
              </>
            ) : (
              <span className="rounded-full bg-[#fdf6ec] px-2 py-0.5 text-[10px] font-semibold text-[#d4943a]">Sin proveedor asignado</span>
            )}
          </div>
        </DialogHeader>
        <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-0.5">
          {/* Medio de pago — una sola vez para todo */}
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-[#3d2c24]">¿Cómo se paga? <span className="text-[#ea504c]">*</span></p>
            <div className="grid grid-cols-2 gap-1.5">
              {PAYMENT_METHODS.map((pm) => (
                <button
                  key={pm.key}
                  type="button"
                  onClick={() => setPaymentMethod(paymentMethod === pm.key ? null : pm.key)}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-left transition-all',
                    paymentMethod === pm.key
                      ? pm.key === 'cuenta_corriente' ? 'border-[#d4943a] bg-[#fdf6ec]' : 'border-[#006d5a] bg-[#e8f5f1]'
                      : 'border-[#ebe6df] bg-white',
                  )}
                >
                  <span className={cn('block text-[13px] font-bold', paymentMethod === pm.key ? (pm.key === 'cuenta_corriente' ? 'text-[#d4943a]' : 'text-[#006d5a]') : 'text-[#3d2c24]')}>{pm.label}</span>
                  <span className="block text-[10px] text-[#7d6c64]">{pm.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Productos */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[12px] font-semibold text-[#3d2c24]">{sinPedido ? 'Qué llegó' : `Productos (${llegan.length} de ${filas.length} llegaron)`}</p>
              {filas.length > 0 && <button
                type="button"
                onClick={() => setFilas((f) => { const todos = f.every((x) => x.llego); return f.map((x) => ({ ...x, llego: !todos })) })}
                className="text-[11px] font-semibold text-[#006d5a]"
              >
                {filas.every((f) => f.llego) ? 'Desmarcar todos' : 'Marcar todos'}
              </button>}
            </div>
            <div className="space-y-1.5">
              {filas.map((f, i) => {
                const si = f.stockItemId ? stockById.get(f.stockItemId) : null
                // Pedido escrito a mano ("1/2 kg de palta"): el insumo que corresponde
                const sugerido = !si ? sugerirInsumo(f.order.product_name, comprables) : null
                const match = matchByOrder.get(`${f.order.source}-${f.order.id}`)
                const err = errores[f.order.id]
                return (
                  <div key={`${f.order.source}-${f.order.id}`} className={cn('rounded-xl border px-3 py-2.5 transition-colors', f.llego ? 'border-[#ebe6df] bg-white' : 'border-dashed border-[#ebe6df] bg-[#faf8f5]', err && 'border-[#ea504c]')}>
                    <div className="flex items-start gap-2.5">
                      <button
                        type="button"
                        onClick={() => set(i, { llego: !f.llego })}
                        aria-label={f.llego ? 'Marcar que no llegó' : 'Marcar que llegó'}
                        className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors', f.llego ? 'border-[#006d5a] bg-[#006d5a] text-white' : 'border-[#d9d2c8] bg-white')}
                      >
                        {f.llego && <Check className="size-3.5" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={cn('truncate text-[13px] font-semibold', f.llego ? 'text-[#3d2c24]' : 'text-[#a39e97] line-through')}>{f.order.product_name}</p>
                        <p className="text-[10.5px] text-[#a39e97]">
                          Pedido: {f.order.quantity}
                          {!f.llego && !f.noVino && <span className="font-semibold text-[#d4943a]"> · no llegó: sigue en camino</span>}
                          {!f.llego && f.noVino && <span className="font-semibold text-[#ea504c]"> · no vino: se cierra sin stock ni gasto</span>}
                        </p>
                        {f.llego && !si && (
                          <div className="mt-1 rounded-lg bg-[#fef2f2] px-2 py-1.5">
                            <p className="text-[10.5px] font-semibold text-[#ea504c]">Sin insumo: no suma stock (ni acá ni en Fudo)</p>
                            {sugerido && (
                              <button type="button" onClick={() => set(i, { stockItemId: sugerido.id })} className="mt-1 flex items-center gap-1 rounded-md bg-[#006d5a] px-2 py-1 text-[11px] font-semibold text-white active:scale-95">
                                <Check className="size-3" /> Es «{sugerido.name}»
                              </button>
                            )}
                          </div>
                        )}
                        {f.llego && si && f.stockItemId !== (f.order.stock_item_id ?? null) && (
                          <p className="mt-0.5 text-[10.5px] text-[#006d5a]">
                            Insumo: <b>{si.name}</b> · <button type="button" onClick={() => set(i, { stockItemId: f.order.stock_item_id ?? null })} className="underline">quitar</button>
                          </p>
                        )}
                        {match && f.llego && (
                          <p className="mt-0.5 text-[10px] font-semibold text-[#4a90d9]">Fudo ya registró {money(match.expense.amount)} de este proveedor</p>
                        )}
                        {err && <p className="mt-0.5 text-[10.5px] font-semibold text-[#ea504c]">{err}</p>}
                        {!f.llego && (
                          <div className="mt-1.5 flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => set(i, { noVino: false })}
                              className={cn('rounded-lg px-2 py-1 text-[10.5px] font-semibold ring-1', !f.noVino ? 'bg-[#fdf6ec] text-[#d4943a] ring-[#d4943a]/40' : 'bg-white text-[#a39e97] ring-[#ebe6df]')}
                            >
                              Sigue en camino
                            </button>
                            <button
                              type="button"
                              onClick={() => set(i, { noVino: true })}
                              className={cn('rounded-lg px-2 py-1 text-[10.5px] font-semibold ring-1', f.noVino ? 'bg-[#fef2f2] text-[#ea504c] ring-[#ea504c]/40' : 'bg-white text-[#a39e97] ring-[#ebe6df]')}
                            >
                              No vino
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {f.llego && (
                      <div className="mt-2 grid grid-cols-2 gap-2 pl-8">
                        <label className="block">
                          <span className="text-[10px] font-semibold text-[#7d6c64]">Llegó{si ? ` (${si.unit})` : ''}</span>
                          <input
                            value={f.qty}
                            onChange={(e) => set(i, { qty: e.target.value })}
                            className={cn('mt-0.5 w-full rounded-lg border bg-white px-2 py-1.5 text-[13px] focus:outline-none', si && !(parseQty(f.qty) > 0) ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')}
                          />
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-semibold text-[#7d6c64]">$ total (opcional)</span>
                          <input
                            inputMode="decimal"
                            value={f.total}
                            onChange={(e) => set(i, { total: e.target.value })}
                            placeholder="0"
                            className="mt-0.5 w-full rounded-lg border border-[#ebe6df] bg-white px-2 py-1.5 text-[13px] focus:border-[#006d5a] focus:outline-none"
                          />
                          {(() => {
                            const costoRef = si?.cost_per_unit
                            const totalN = parseQty(f.total)
                            const qtyN = parseQty(f.qty)
                            const totalEsperado = costoRef && costoRef > 0 && qtyN > 0 ? costoRef * qtyN : null
                            const sospechoso = totalEsperado != null && totalN > 0 && totalN > totalEsperado * 5
                            return (
                              <>
                                {costoRef && costoRef > 0 && (
                                  <div className="mt-0.5 flex items-center gap-1.5">
                                    <span className="text-[10px] text-[#a39e97]">Últ. compra: {money(costoRef)}/{si?.unit}</span>
                                    {totalEsperado != null && !(totalN > 0) && (
                                      <button
                                        type="button"
                                        onClick={() => set(i, { total: String(Math.round(totalEsperado * 100) / 100) })}
                                        className="text-[10px] font-semibold text-[#4a90d9] underline decoration-dotted underline-offset-2"
                                      >
                                        Usar
                                      </button>
                                    )}
                                  </div>
                                )}
                                {sospechoso && (
                                  <span className="mt-0.5 block text-[10.5px] font-semibold text-[#ea504c]">⚠ Parece alto (esperado ~{money(totalEsperado!)})</span>
                                )}
                              </>
                            )
                          })()}
                        </label>
                        {!f.abierto ? (
                          <button type="button" onClick={() => set(i, { abierto: true })} className="col-span-2 text-left text-[11px] font-medium text-[#7d6c64] underline decoration-dotted">
                            {f.note || f.expiresAt ? 'Ver detalle' : '+ Detalle o vencimiento'}
                          </button>
                        ) : (
                          <>
                            <input
                              value={f.note}
                              onChange={(e) => set(i, { note: e.target.value })}
                              placeholder="Detalle: vino distinto, faltó una parte…"
                              className="col-span-2 w-full rounded-lg border border-[#ebe6df] bg-white px-2 py-1.5 text-[12px] focus:border-[#006d5a] focus:outline-none"
                            />
                            {si && (
                              <label className="col-span-2 flex items-center gap-2 text-[10.5px] text-[#7d6c64]">
                                Vence
                                <input type="date" value={f.expiresAt} onChange={(e) => set(i, { expiresAt: e.target.value })} className="flex-1 rounded-lg border border-[#ebe6df] bg-white px-2 py-1 text-[12px]" />
                              </label>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {extras.map((e) => (
                <FilaLlegoDeMas
                  key={e.key}
                  fila={e}
                  comprables={comprables}
                  stockById={stockById}
                  fudo={fudo}
                  cargandoFudo={cargandoFudo}
                  onCargarFudo={cargarFudo}
                  onTraer={async (p) => {
                    try {
                      usarInsumo(e.key, await traerDeFudo(p))
                      setFudo((f) => f?.filter((x) => !(x.id === p.id && x.tipo === p.tipo)) ?? f)
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'No se pudo traer de Fudo')
                    }
                  }}
                  onCrear={(nombre) => setCrear({ key: e.key, nombre })}
                  onChange={(patch) => setExtra(e.key, patch)}
                  onQuitar={() => setExtras((x) => x.filter((y) => y.key !== e.key))}
                />
              ))}
              <button type="button" onClick={() => setExtras((x) => [...x, nuevaFilaExtra()])} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#bfdcd3] py-2 text-[12px] font-semibold text-[#006d5a] hover:bg-[#f6fbf9]">
                <Plus className="size-3.5" /> {sinPedido && extras.length === 0 ? 'Agregar lo que llegó' : 'Llegó algo más (no estaba en el pedido)'}
              </button>
            </div>
          </div>

          <DatosGastoFields campos={datosGasto.campos} />

          {/* Factura y nota general */}
          <div className="space-y-2 rounded-xl bg-[#faf8f5] p-3">
            <label className="block">
              <span className="text-[11px] font-semibold text-[#3d2c24]">Total de la factura <span className="font-normal text-[#a39e97]">(opcional)</span></span>
              {facturaYaCargada && (
                <span className="mt-1 block rounded-lg bg-[#fdf6ec] px-2.5 py-1.5 text-[11px] text-[#8b5e34]">
                  Esta factura ya se cargó hoy: <b>no pongas el total otra vez</b>. Estos productos se suman al mismo gasto en Fudo.
                </span>
              )}
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#a39e97]">$</span>
                <input inputMode="decimal" value={facturaYaCargada ? '' : factura} disabled={facturaYaCargada} onChange={(e) => setFactura(e.target.value)} placeholder="0" className="w-full rounded-xl border border-[#ebe6df] bg-white py-2 pl-7 pr-3 text-sm focus:border-[#006d5a] focus:outline-none disabled:bg-[#f3efe9]" />
              </div>
              <span className="mt-1 block text-[10px] text-[#a39e97]">
                {sumaProductos > 0 ? `Cargado por producto: ${money(sumaProductos)}. ` : ''}
                {Number.isFinite(facturaNum) && facturaNum > sumaProductos
                  ? `La diferencia (${money(facturaNum - sumaProductos)}) queda en Pagos como gasto del proveedor.`
                  : 'Si no sabés el precio de cada producto, poné solo el total: queda en Pagos.'}
              </span>
            </label>
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota para todo el pedido (opcional)" className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm focus:border-[#006d5a] focus:outline-none" />
          </div>
        </div>
        <DialogFooter className="mt-2 gap-2">
          <DialogClose className="rounded-xl px-4 py-2 text-sm font-medium text-[#7d6c64]">Cancelar</DialogClose>
          <button
            onClick={() => void confirmar()}
            disabled={!puede}
            className="flex items-center gap-2 rounded-xl bg-[#006d5a] px-5 py-2 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-60"
          >
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {cuantosLlegan > 0
              ? `Confirmar ${cuantosLlegan} producto${cuantosLlegan === 1 ? '' : 's'}`
              : (noVienen.length === 1 ? 'Marcar 1 que no vino' : `Marcar ${noVienen.length} que no vinieron`)}
          </button>
        </DialogFooter>
      </DialogContent>
      {crear && (
        <AgregarProductoDialog
          existentes={stockItems}
          nombreInicial={crear.nombre}
          ayuda={<>Para productos que <b>no están en Fudo</b> (vasos, tapas, limpieza…). Si va en recetas, cargalo primero en Fudo y buscalo acá: aparece como «está en Fudo · traer».</>}
          onClose={() => setCrear(null)}
          onCreado={(item) => {
            usarInsumo(crear.key, { id: item.id, name: item.name, unit: item.unit, current_qty: item.current_qty, fudo_skip: true })
            setCrear(null)
          }}
        />
      )}
    </Dialog>
  )
}
