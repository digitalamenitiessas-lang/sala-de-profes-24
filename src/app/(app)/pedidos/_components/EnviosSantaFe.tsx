'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { AlertTriangle, Check, Loader2, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { convertQty } from '@/lib/produccion/units'

// ---------------------------------------------------------------------------
// Envíos de producción de Santa Fe (la 24 no produce). "En camino": lo que
// Santa Fe mandó y falta confirmar; «Llegó» sube el stock en la app y en el
// Fudo de la 24, sin gasto ni deuda. "Recibidos": los últimos 14 días, con
// faltantes. Ver lib/envios/entrantes.
// ---------------------------------------------------------------------------

type Item = { id: string; nombre: string; unidad: string; cantidad: number; stock_item_id: string | null; cantidad_recibida: number | null; error: string | null }
type Envio = { id: string; estado: string; enviado_at: string; enviado_por: string | null; nota: string | null; recibido_at: string | null; recibido_por: string | null; nota_recepcion: string | null; items: Item[] }
type Insumo = { id: string; name: string; unit: string; area: string | null; enFudo: boolean }
type Datos = { enCamino: Envio[]; recibidos: Envio[]; insumos: Insumo[] }
type Linea = { stock_item_id: string; cantidad: string; tocada: boolean }

const num = (n: number) => Number(n.toFixed(3)).toLocaleString('es-AR')
const cuando = (iso: string) => format(new Date(iso), "d 'de' MMM HH:mm", { locale: es })

/** Lo mandado, en la unidad del insumo de la 24 (null si no se puede convertir) */
function enUnidad24(item: Item, insumo: Insumo | undefined): number | null {
  if (!insumo) return null
  const c = convertQty(item.cantidad, item.unidad, insumo.unit)
  return c == null ? null : Math.round(c * 1000) / 1000
}

export function EnviosSantaFe({ modo, onCount }: { modo: 'camino' | 'recibido'; onCount?: (n: number) => void }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [lineas, setLineas] = useState<Record<string, Linea>>({})
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState<string | null>(null)
  // En un ref: si el padre pasa una función nueva en cada render, no se recarga en bucle
  const avisarCantidad = useRef(onCount)
  useEffect(() => { avisarCantidad.current = onCount }, [onCount])

  const cargar = useCallback(async () => {
    const res = await fetch('/api/envios', { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) return
    const d = (await res.json()) as Datos
    setDatos(d)
    avisarCantidad.current?.(d.enCamino.length)
    // Arranca con lo sugerido y con lo que dice que mandaron
    setLineas((prev) => {
      const next = { ...prev }
      for (const e of d.enCamino) for (const i of e.items) {
        // Lo que ya eligió la persona no se toca; lo que estaba sin elegir se completa
        if (next[i.id]?.stock_item_id) continue
        const insumo = d.insumos.find((s) => s.id === i.stock_item_id)
        const def = enUnidad24(i, insumo)
        next[i.id] = { stock_item_id: i.stock_item_id ?? '', cantidad: def != null ? String(def) : '', tocada: false }
      }
      return next
    })
  }, [])

  useEffect(() => { void cargar() }, [cargar])
  // Al volver a la pestaña se actualiza: un producto creado o vinculado mientras
  // tanto aparece sin recargar (13/11: la "ternera" se creó con la pantalla abierta)
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === 'visible') void cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [cargar])

  if (!datos) return null
  const insumo = (id: string) => datos.insumos.find((s) => s.id === id)

  function elegir(item: Item, stockItemId: string) {
    setLineas((prev) => {
      const l = prev[item.id]
      const def = enUnidad24(item, insumo(stockItemId))
      return { ...prev, [item.id]: { stock_item_id: stockItemId, cantidad: l?.tocada ? l.cantidad : def != null ? String(def) : '', tocada: l?.tocada ?? false } }
    })
  }

  async function recibir(e: Envio) {
    setEnviando(e.id)
    try {
      const res = await fetch('/api/envios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          envio_id: e.id,
          nota: notas[e.id] ?? '',
          items: e.items.map((i) => ({ id: i.id, stock_item_id: lineas[i.id]?.stock_item_id, cantidad: Number(String(lineas[i.id]?.cantidad ?? '').replace(',', '.')) })),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo recibir')
      if (json.errores?.length) toast.error(`Recibido, pero no se pudo sumar: ${json.errores.join('; ')}`)
      else if (json.faltantes?.length) toast.success(`Recibido con faltantes: ${json.faltantes.join('; ')}`)
      else toast.success('Recibido: el stock ya está sumado en la app y en Fudo')
      await cargar()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo recibir')
    } finally {
      setEnviando(null)
    }
  }

  // ---------------------------------------------------------------- recibidos
  if (modo === 'recibido') {
    if (datos.recibidos.length === 0) return null
    return (
      <div className="mb-3 overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
        <div className="flex items-center gap-2 bg-[#faf8f5] px-4 py-2.5">
          <Truck className="size-4 shrink-0 text-[#006d5a]" />
          <p className="flex-1 text-[12.5px] font-semibold text-[#3d2c24]">Recibidos de Santa Fe <span className="font-normal text-[#a39e97]">· últimos 14 días</span></p>
        </div>
        <div className="divide-y divide-[#f5f0ea]">
          {datos.recibidos.map((e) => (
            <div key={e.id} className="px-4 py-2.5">
              <p className="text-[11px] text-[#7d6c64]">Llegó el {e.recibido_at ? cuando(e.recibido_at) : '—'}{e.recibido_por ? ` · recibió ${e.recibido_por}` : ''}</p>
              <ul className="mt-1 space-y-0.5 text-[12px]">
                {e.items.map((i) => {
                  const s = i.stock_item_id ? insumo(i.stock_item_id) : undefined
                  const mandado = enUnidad24(i, s)
                  const falto = mandado != null && i.cantidad_recibida != null && i.cantidad_recibida < mandado - 0.0005
                  return (
                    <li key={i.id} className={cn('flex justify-between gap-2', (falto || i.error) && 'text-[#b45309]')}>
                      <span className="min-w-0 truncate">{s?.name ?? i.nombre}</span>
                      <span className="shrink-0 tabular-nums">
                        {i.cantidad_recibida != null ? `${num(i.cantidad_recibida)} de ${mandado != null ? num(mandado) : `${num(i.cantidad)} ${i.unidad}`}` : '—'} {s?.unit ?? ''}
                        {i.error ? ' · no se sumó' : ''}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {e.nota_recepcion && <p className="mt-1 text-[11px] italic text-[#7d6c64]">“{e.nota_recepcion}”</p>}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- en camino
  if (datos.enCamino.length === 0) return null
  return (
    <div className="mb-3 overflow-hidden rounded-2xl bg-white ring-1 ring-[#006d5a]/30">
      <div className="flex items-center gap-2 bg-[#eaf6f1] px-4 py-2.5">
        <Truck className="size-4 shrink-0 text-[#006d5a]" />
        <p className="flex-1 text-[12.5px] font-semibold text-[#006d5a]">En camino desde Santa Fe</p>
        <span className="rounded-full bg-[#006d5a]/10 px-2 py-0.5 text-[11px] font-bold text-[#006d5a]">{datos.enCamino.length}</span>
      </div>
      <p className="px-4 pt-2 text-[10.5px] text-[#7d6c64]">Producción que mandó Santa Fe. Cuando llegue, revisá las cantidades y tocá <strong className="text-[#006d5a]">Llegó</strong>: suma el stock en la app y en Fudo (no es una compra, no genera gasto).</p>
      <div className="divide-y divide-[#f5f0ea]">
        {datos.enCamino.map((e) => {
          const listo = e.items.every((i) => {
            const l = lineas[i.id]
            const c = Number(String(l?.cantidad ?? '').replace(',', '.'))
            const s = l?.stock_item_id ? insumo(l.stock_item_id) : undefined
            return s && String(l?.cantidad ?? '').trim() !== '' && Number.isFinite(c) && c >= 0 && (c === 0 || s.enFudo)
          })
          return (
            <div key={e.id} className="px-4 py-3">
              <p className="text-[11px] text-[#7d6c64]">Salió el {cuando(e.enviado_at)}{e.enviado_por ? ` · mandó ${e.enviado_por}` : ''}</p>
              {e.nota && <p className="mt-0.5 text-[11px] italic text-[#7d6c64]">“{e.nota}”</p>}
              <div className="mt-2 space-y-2.5">
                {e.items.map((i) => {
                  const l = lineas[i.id]
                  const s = l?.stock_item_id ? insumo(l.stock_item_id) : undefined
                  const mandado = enUnidad24(i, s)
                  const c = Number(String(l?.cantidad ?? '').replace(',', '.'))
                  const falta = mandado != null && Number.isFinite(c) && String(l?.cantidad ?? '').trim() !== '' && c < mandado - 0.0005
                  return (
                    <div key={i.id} className="rounded-xl bg-[#faf8f5] p-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="min-w-0 truncate text-[13px] font-semibold text-[#3d2c24]">{i.nombre}</p>
                        <p className="shrink-0 text-[11px] text-[#7d6c64]">mandaron <span className="font-semibold tabular-nums text-[#3d2c24]">{num(i.cantidad)} {i.unidad}</span></p>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <select
                          value={l?.stock_item_id ?? ''}
                          onChange={(ev) => elegir(i, ev.target.value)}
                          className={cn('min-w-0 flex-1 rounded-lg bg-white px-2 py-1.5 text-[12px] ring-1', s ? 'ring-[#ebe6df]' : 'ring-[#d4943a]')}
                        >
                          <option value="">Elegí el producto de la 24…</option>
                          {datos.insumos.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit}){x.enFudo ? '' : ' · sin Fudo'}</option>)}
                        </select>
                        <input
                          inputMode="decimal"
                          value={l?.cantidad ?? ''}
                          onChange={(ev) => setLineas((prev) => ({ ...prev, [i.id]: { ...(prev[i.id] ?? { stock_item_id: '' }), cantidad: ev.target.value, tocada: true } }))}
                          placeholder="llegaron"
                          className="w-20 rounded-lg bg-white px-2 py-1.5 text-right text-[12px] tabular-nums ring-1 ring-[#ebe6df]"
                        />
                        <span className="w-10 shrink-0 text-[11px] text-[#7d6c64]">{s?.unit ?? ''}</span>
                      </div>
                      {!l?.stock_item_id && <p className="mt-1 text-[10.5px] text-[#b45309]">La primera vez elegí a qué producto de la 24 corresponde; después queda guardado.</p>}
                      {s && !s.enFudo && <p className="mt-1 text-[10.5px] text-[#b45309]">Este producto no está en el Fudo de la 24: créenlo ahí (con Controlar stock) y toquen Crear todos en LVE.</p>}
                      {s && mandado == null && <p className="mt-1 text-[10.5px] text-[#b45309]">Santa Fe lo manda en {i.unidad} y acá se cuenta en {s.unit}: cargá cuánto llegó en {s.unit}.</p>}
                      {falta && <p className="mt-1 flex items-center gap-1 text-[10.5px] font-semibold text-[#b45309]"><AlertTriangle className="size-3" /> Faltan {num(mandado! - c)} {s?.unit}</p>}
                    </div>
                  )
                })}
              </div>
              <input
                value={notas[e.id] ?? ''}
                onChange={(ev) => setNotas((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                placeholder="¿Algo para avisar? (vino roto, faltó algo…)"
                className="mt-2 w-full rounded-lg bg-white px-2.5 py-1.5 text-[12px] ring-1 ring-[#ebe6df]"
              />
              <button
                type="button"
                onClick={() => void recibir(e)}
                disabled={!listo || enviando === e.id}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {enviando === e.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Llegó
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
