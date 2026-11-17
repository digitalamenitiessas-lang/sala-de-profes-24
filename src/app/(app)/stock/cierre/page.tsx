'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Check, Link2, Loader2, Minus, Plus, Scale, Truck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ConteoDelDia } from '@/lib/stock/conteo-diario'
import { OpcionesFudo, useFudoPendientes } from '../../pedidos/_components/FudoPendientes'

// ---------------------------------------------------------------------------
// Stock → Conteo de cierre (la 24)
// ---------------------------------------------------------------------------
// Al cerrar, alguien de la 24 cuenta lo que manda Santa Fe (la lista la manda
// Santa Fe, con el mínimo de la 24). Reemplaza el conteo que se mandaba por
// WhatsApp: se guarda como conteo físico (app + Fudo de la 24) y Santa Fe lo
// lee para saber qué mandar. Pensado para el celular: un número por producto.
// Ver lib/envios/catalogo y /api/envios/cierre.
// ---------------------------------------------------------------------------

type Producto = { stock_item_id: string; nombre: string; unidad: string; current_qty: number; contado_hoy: boolean; minimo: number | null; de_santa_fe: string[] }
type Payload = {
  productos: Producto[]
  sin_vincular: { item_id: string; nombre: string; unidad: string }[]
  lista_de_santa_fe: boolean
  puede_vincular: boolean
  insumos: { id: string; name: string; unit: string; enFudo: boolean }[]
  estado: { contados: number; total: number; ultimo: string | null }
  conteos: ConteoDelDia[]
}

const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
const horaAR = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })
const esUnidad = (u: string) => !/kg|kilo|^g$|gr|^l$|lt|litro|ml/i.test(u.trim())
const leer = (v: string) => parseFloat(v.replace(',', '.'))

// Misma regla que el servidor (lib/fudo/stock-sync): diferencias grandes piden nota
function necesitaNota(actual: number, nuevo: number, unit: string) {
  const abs = Math.abs(nuevo - actual)
  const pct = actual > 0 ? abs / actual : abs > 0 ? 1 : 0
  const u = unit.toLowerCase()
  const kg = u.includes('kg') || u.includes('kilo')
  return abs >= (kg ? Math.max(0.5, actual * 0.12) : Math.max(2, actual * 0.15)) || pct >= 0.25
}

export default function ConteoCierrePage() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/envios/cierre', { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'No se pudo cargar')
      setData(j)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar')
    }
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const productos = data?.productos ?? []
  const cargados = productos.filter((p) => (valores[p.stock_item_id] ?? '').trim() !== '')
  const falta = cargados.filter((p) => {
    const n = leer(valores[p.stock_item_id] ?? '')
    return !Number.isFinite(n) || n < 0 || (necesitaNota(p.current_qty, n, p.unidad) && !(notas[p.stock_item_id] ?? '').trim())
  })
  const sinCargar = productos.length - cargados.length

  function sumar(p: Producto, d: number) {
    setValores((x) => {
      const actual = leer(x[p.stock_item_id] ?? '')
      const base = Number.isFinite(actual) ? actual : 0
      return { ...x, [p.stock_item_id]: String(Math.max(0, base + d)) }
    })
  }

  async function guardar() {
    setGuardando(true)
    setErrores({})
    try {
      const res = await fetch('/api/stock/conteo-diario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conteos: cargados.map((p) => ({ stock_item_id: p.stock_item_id, qty: leer(valores[p.stock_item_id] ?? ''), nota: (notas[p.stock_item_id] ?? '').trim() || null })),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok && !json.resultados) throw new Error(json.error ?? 'No se pudo guardar')
      const errs = Object.fromEntries(((json.resultados ?? []) as { stock_item_id: string; ok: boolean; error?: string }[])
        .filter((r) => !r.ok).map((r) => [r.stock_item_id, r.error ?? 'Error']))
      setErrores(errs)
      if (json.guardados > 0) {
        toast.success(`Conteo guardado (${json.guardados}): Santa Fe ya lo ve`)
        setValores((v) => Object.fromEntries(Object.entries(v).filter(([id]) => errs[id])))
        setNotas((v) => Object.fromEntries(Object.entries(v).filter(([id]) => errs[id])))
        void cargar()
      }
      if (Object.keys(errs).length > 0) toast.error(`${Object.keys(errs).length} no se pudo guardar: revisalos`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  const hecho = (data?.estado.contados ?? 0) > 0
  const ultimo = data?.conteos[0]

  return (
    <div className="mx-auto max-w-lg space-y-3 pb-40">
      <div className="flex items-center gap-2">
        <Link href="/stock" aria-label="Volver" className="-ml-1.5 rounded-full p-1.5 hover:bg-black/5">
          <ArrowLeft className="size-5 text-[#3d2c24]" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold tracking-tight text-[#3d2c24]">Conteo de cierre</h1>
          <p className="text-[11.5px] text-[#a39e97]">Lo que manda Santa Fe. Con esto saben qué mandar mañana.</p>
        </div>
      </div>

      {error && !data && <div className="rounded-2xl bg-[#fef2f2] p-4 text-[13px] text-[#ea504c]">{error}</div>}
      {!data && !error && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-[#f3efe9]" />)}</div>}

      {data && !data.lista_de_santa_fe && (
        <div className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-[#ebe6df]">
          <Truck className="mx-auto size-8 text-[#a39e97]" />
          <p className="mt-2 text-[14px] font-semibold text-[#3d2c24]">Santa Fe todavía no mandó la lista</p>
          <p className="mt-1 text-[12px] text-[#7d6c64]">Cuando Santa Fe cargue qué productos tiene la 24 y su mínimo, aparecen acá para contarlos al cierre.</p>
        </div>
      )}

      {data && data.lista_de_santa_fe && (
        <>
          <div className={cn('flex items-center gap-3 rounded-2xl p-3.5 ring-1', hecho ? 'bg-[#e8f5f1] ring-[#006d5a]/20' : 'bg-[#fef7ed] ring-[#d4943a]/25')}>
            <Scale className={cn('size-5 shrink-0', hecho ? 'text-[#006d5a]' : 'text-[#d4943a]')} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-[#3d2c24]">
                {hecho ? `Hoy ya se contaron ${data.estado.contados} de ${data.estado.total}` : 'Todavía no se contó hoy'}
              </p>
              <p className="text-[11px] text-[#7d6c64]">
                {ultimo ? `${ultimo.quien ?? 'Alguien'} · ${horaAR(ultimo.hora)}. Si contás de nuevo, vale el último.` : 'Contá todo lo que hay en la heladera y el freezer al cerrar.'}
              </p>
            </div>
          </div>

          {productos.length > 0 && (
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
              {productos.map((p) => {
                const v = valores[p.stock_item_id] ?? ''
                const n = leer(v)
                const pideNota = v.trim() !== '' && Number.isFinite(n) && necesitaNota(p.current_qty, n, p.unidad)
                const paso = esUnidad(p.unidad) ? 1 : null
                return (
                  <div key={p.stock_item_id} className="border-b border-[#f5f0ea] px-3.5 py-3 last:border-0">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14.5px] font-semibold leading-tight text-[#3d2c24]">
                          {p.nombre}
                          {p.contado_hoy && <Check className="ml-1 inline size-3.5 text-[#006d5a]" aria-label="Contado hoy" />}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#a39e97]">
                          {p.unidad}{p.minimo != null && ` · mínimo ${num(p.minimo)}`} · sistema {num(p.current_qty)}
                        </p>
                      </div>
                      {paso && (
                        <button type="button" onClick={() => sumar(p, -paso)} aria-label={`Restar 1 ${p.nombre}`} className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#f3efe9] text-[#3d2c24] active:scale-95">
                          <Minus className="size-5" />
                        </button>
                      )}
                      <input
                        inputMode="decimal"
                        value={v}
                        onChange={(e) => setValores((x) => ({ ...x, [p.stock_item_id]: e.target.value }))}
                        placeholder="—"
                        aria-label={`Cuánto hay de ${p.nombre}`}
                        className="h-11 w-20 shrink-0 rounded-xl border border-[#ebe6df] px-2 text-center text-[18px] font-bold tabular-nums outline-none focus:border-[#006d5a]"
                      />
                      {paso && (
                        <button type="button" onClick={() => sumar(p, paso)} aria-label={`Sumar 1 ${p.nombre}`} className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#f3efe9] text-[#3d2c24] active:scale-95">
                          <Plus className="size-5" />
                        </button>
                      )}
                    </div>
                    {pideNota && (
                      <input
                        value={notas[p.stock_item_id] ?? ''}
                        onChange={(e) => setNotas((x) => ({ ...x, [p.stock_item_id]: e.target.value }))}
                        placeholder="Diferencia grande con el sistema: ¿qué pasó? (obligatorio)"
                        className="mt-2 w-full rounded-lg border border-[#d4943a]/50 bg-[#fef7ed] px-2.5 py-2 text-[13px] outline-none"
                      />
                    )}
                    {errores[p.stock_item_id] && <p className="mt-1 text-[11.5px] font-semibold text-[#ea504c]">{errores[p.stock_item_id]}</p>}
                  </div>
                )
              })}
            </div>
          )}

          {data.sin_vincular.length > 0 && (
            <SinVincular items={data.sin_vincular} insumos={data.insumos} puede={data.puede_vincular} onListo={cargar} />
          )}
        </>
      )}

      {productos.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 px-4">
          <div className="mx-auto max-w-lg">
            <button
              onClick={() => void guardar()}
              disabled={guardando || cargados.length === 0 || falta.length > 0}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#006d5a] py-4 text-[15px] font-bold text-white shadow-xl active:scale-[0.99] disabled:opacity-50"
            >
              {guardando ? <Loader2 className="size-5 animate-spin" /> : <Check className="size-5" />}
              Guardar conteo{cargados.length > 0 ? ` (${cargados.length})` : ''}
            </button>
            {falta.length > 0
              ? <p className="mt-1 text-center text-[11px] font-semibold text-[#d4943a]">Completá la nota de {falta.length === 1 ? 'la diferencia grande' : `las ${falta.length} diferencias grandes`}</p>
              : cargados.length > 0 && sinCargar > 0 && <p className="mt-1 text-center text-[11px] text-[#7d6c64]">Faltan {sinCargar}: si no hay, poné 0</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// Productos que Santa Fe manda pero la 24 todavía no sabe cuál es: un
// encargado elige el insumo una vez y queda para siempre.
function SinVincular({ items, insumos, puede, onListo }: { items: Payload['sin_vincular']; insumos: Payload['insumos']; puede: boolean; onListo: () => void }) {
  const [elegido, setElegido] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState<string | null>(null)
  // Lo que crearon hoy en Fudo y la app trae recién a la noche: se ofrece al
  // final de la lista y se crea al elegirlo (ver FudoPendientes)
  const fudo = useFudoPendientes(puede && items.length > 0)
  const [traidos, setTraidos] = useState<Payload['insumos']>([])
  const opciones = [...insumos, ...traidos.filter((t) => !insumos.some((s) => s.id === t.id))]

  async function elegir(itemId: string, valor: string) {
    if (!fudo.esDeFudo(valor)) { setElegido((x) => ({ ...x, [itemId]: valor })); return }
    setGuardando(itemId)
    try {
      const nuevo = await fudo.traer(valor)
      if (!nuevo) return
      setTraidos((t) => [...t, { id: nuevo.id, name: nuevo.name, unit: nuevo.unit, enFudo: true }])
      setElegido((x) => ({ ...x, [itemId]: nuevo.id }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo traer de Fudo')
    } finally {
      setGuardando(null)
    }
  }

  async function vincular(itemId: string) {
    const stockItemId = elegido[itemId]
    if (!stockItemId) return
    setGuardando(itemId)
    try {
      const res = await fetch('/api/envios/cierre', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item_id: itemId, stock_item_id: stockItemId }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'No se pudo guardar')
      toast.success('Listo: ya aparece para contar')
      onListo()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setGuardando(null)
    }
  }

  return (
    <div className="rounded-2xl bg-[#fef7ed] p-3.5 ring-1 ring-[#d4943a]/25">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#3d2c24]"><Link2 className="size-4 text-[#d4943a]" /> Falta saber cuál es en la 24</p>
      <p className="mt-0.5 text-[11.5px] text-[#7d6c64]">
        {puede
          ? 'Santa Fe manda estos productos. Elegí cuál es en la 24 (se hace una sola vez). Si no está en la lista, créenlo en el Fudo de la 24 como ingrediente con "Controlar stock": aparece al final, en «Están en Fudo».'
          : 'Santa Fe manda estos productos pero falta elegir cuál es en la 24. Avisale a un encargado.'}
      </p>
      <ul className="mt-2 space-y-2">
        {items.map((i) => (
          <li key={i.item_id} className="rounded-xl bg-white/80 p-2.5">
            <p className="text-[13px] font-medium text-[#3d2c24]">{i.nombre} <span className="text-[11px] text-[#a39e97]">({i.unidad})</span></p>
            {puede && (
              <div className="mt-1.5 flex gap-2">
                <select
                  value={elegido[i.item_id] ?? ''}
                  onChange={(e) => void elegir(i.item_id, e.target.value)}
                  disabled={guardando === i.item_id}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-[#ebe6df] bg-white px-2 text-[13px] outline-none focus:border-[#006d5a]"
                >
                  <option value="">Elegí el producto de la 24…</option>
                  {opciones.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unit}){s.enFudo ? '' : ' · sin Fudo'}</option>)}
                  <OpcionesFudo lista={fudo.lista} />
                </select>
                <button
                  type="button"
                  onClick={() => void vincular(i.item_id)}
                  disabled={!elegido[i.item_id] || guardando === i.item_id}
                  className="h-10 shrink-0 rounded-lg bg-[#006d5a] px-3 text-[13px] font-semibold text-white disabled:opacity-50"
                >
                  {guardando === i.item_id ? <Loader2 className="size-4 animate-spin" /> : 'Guardar'}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
