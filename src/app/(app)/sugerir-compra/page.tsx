'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { toast } from 'sonner'
import { ArrowLeft, Check, ClipboardPaste, Loader2, Plus, Search, Send, ShoppingCart, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isManagerOrAbove } from '@/lib/roles'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { detalleDe, leerListaPegada, sugerirInsumo, type InsumoPedible } from '@/lib/compras/lista-pegada'

// ---------------------------------------------------------------------------
// Sugerir compra — cualquier empleado avisa lo que se está acabando
// ---------------------------------------------------------------------------
// Es solo una SUGERENCIA: no se emite ningún pedido. Se pega la lista como
// en WhatsApp ("5k de molida", "Aceite — 10 lts") o se agrega de a uno; la app
// reconoce cada insumo y queda en Compras → "Sugerencias del equipo",
// agrupado por proveedor. Les llega a los encargados, que deciden y piden.
// Abajo: mis sugerencias y en qué quedaron.
// ---------------------------------------------------------------------------

type Renglon = { key: string; nombre: string; cantidad: string; insumo: InsumoPedible | null }
type Mio = { id: number; product_name: string; quantity: string; status: string; note: string | null; proveedor: string | null; created_at: string; urgency: string }
type Datos = { insumos: InsumoPedible[]; mios: Mio[] }

const nuevaKey = () => Math.random().toString(36).slice(2)
const ESTADO: Record<string, { txt: string; cls: string }> = {
  pending: { txt: 'Para revisar', cls: 'bg-[#fdf6ec] text-[#b0762a]' },
  ordered: { txt: 'Pedido', cls: 'bg-[#eef4fc] text-[#4a90d9]' },
  received: { txt: 'Llegó', cls: 'bg-[#e8f5f1] text-[#006d5a]' },
  cancelled: { txt: 'Cancelado', cls: 'bg-[#f3efe9] text-[#a39e97]' },
}
const URGENCIAS = [['normal', 'Normal'], ['alta', 'Para hoy'], ['urgente', 'Urgente']] as const

export default function SugerirCompra() {
  const { profile, loading: cargandoPerfil } = useProfileContext()
  const puede = !!profile
  const esEncargado = isManagerOrAbove(profile?.role)
  const [datos, setDatos] = useState<Datos | null>(null)
  const [renglones, setRenglones] = useState<Renglon[]>([])
  const [pegado, setPegado] = useState('')
  const [verPegar, setVerPegar] = useState(true)
  const [buscar, setBuscar] = useState('')
  const [urgencia, setUrgencia] = useState<(typeof URGENCIAS)[number][0]>('normal')
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const ultimaCantidad = useRef<HTMLInputElement | null>(null)

  const cargar = useCallback(async () => {
    const r = await fetch('/api/compras/sugerir', { cache: 'no-store' })
    if (r.ok) setDatos(await r.json())
  }, [])
  useEffect(() => { if (puede) void cargar() }, [puede, cargar])

  const insumos = useMemo(() => datos?.insumos ?? [], [datos])
  const sugeridos = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    if (q.length < 2) return []
    return insumos.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 6)
  }, [buscar, insumos])

  function ordenarLista() {
    const leidos = leerListaPegada(pegado, insumos)
    if (leidos.length === 0) { toast.error('No encontré productos en el texto'); return }
    setRenglones((r) => [...r, ...leidos.map((l) => ({ key: nuevaKey(), nombre: l.nombre, cantidad: l.cantidad, insumo: l.insumo }))])
    setPegado('')
    setVerPegar(false)
    const reconocidos = leidos.filter((l) => l.insumo).length
    toast.success(`${leidos.length} producto${leidos.length !== 1 ? 's' : ''} · ${reconocidos} reconocido${reconocidos !== 1 ? 's' : ''} en la app`)
  }

  function agregar(nombre: string, insumo: InsumoPedible | null) {
    setRenglones((r) => [...r, { key: nuevaKey(), nombre, cantidad: '', insumo }])
    setBuscar('')
    setTimeout(() => ultimaCantidad.current?.focus(), 50)
  }

  const cambiar = (key: string, patch: Partial<Renglon>) => setRenglones((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)))

  async function mandar() {
    if (renglones.length === 0 || enviando) return
    setEnviando(true)
    try {
      const res = await fetch('/api/kitchen/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_order',
          items: renglones.map((r) => ({
            product_name: r.insumo?.name ?? r.nombre,
            quantity: r.cantidad.trim() || 'a definir',
            stock_item_id: r.insumo?.id ?? null,
            // Lo que escribió, si dice algo más que el nombre del insumo ("un solo pedazo")
            detalle: r.insumo ? detalleDe(r.nombre, r.insumo.name) : null,
          })),
          urgency: urgencia,
          note: nota.trim() || undefined,
          initial_status: 'pending',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) throw new Error(json.error ?? 'No se pudo mandar')
      toast.success('¡Gracias! Les llegó a los encargados. Abajo ves en qué queda.')
      setRenglones([])
      setNota('')
      setUrgencia('normal')
      setVerPegar(true)
      void cargar()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo mandar')
    } finally {
      setEnviando(false)
    }
  }

  if (cargandoPerfil) return <Centro><Loader2 className="size-6 animate-spin text-[#006d5a]" /></Centro>
  if (!puede) return <Centro><p className="text-sm text-[#3d2c24]">Iniciá sesión para sugerir</p></Centro>

  const sinCantidad = renglones.filter((r) => !r.cantidad.trim()).length
  const porDia = agruparPorDia(datos?.mios ?? [])

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-28 pt-4">
      <div className="flex items-center gap-2">
        <Link href="/" aria-label="Volver" className="-ml-1.5 rounded-full p-1.5 hover:bg-black/5"><ArrowLeft className="size-5 text-[#3d2c24]" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold tracking-tight text-[#3d2c24]">Sugerir compra</h1>
          <p className="text-[11.5px] text-[#a39e97]">¿Se está acabando algo? Avisá acá. El encargado lo revisa y hace el pedido.</p>
        </div>
      </div>

      {esEncargado && (
        <p className="rounded-xl bg-[#eef4fc] px-3 py-2 text-[11.5px] text-[#2f5f9a]">Esto queda como sugerencia. Para pedir al proveedor, usá <Link href="/pedidos" className="font-bold underline">Compras</Link>.</p>
      )}

      {/* Pegar la lista */}
      {verPegar ? (
        <section className="rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#3d2c24]"><ClipboardPaste className="size-4 text-[#d4943a]" /> Pegá o escribí la lista</p>
          <p className="mt-0.5 text-[11.5px] text-[#7d6c64]">Como la mandarías por WhatsApp, un producto por renglón.</p>
          <textarea
            value={pegado}
            onChange={(e) => setPegado(e.target.value)}
            rows={6}
            placeholder={'5k de molida\n10k de primo\nAceite gastronómico — 10 lts\nHarina 0000 — (falta cantidad)'}
            className="mt-2 w-full rounded-xl border border-[#ebe6df] px-3 py-2 text-[13px] outline-none placeholder:text-[#c4bdb7] focus:border-[#d4943a]"
          />
          <button onClick={ordenarLista} disabled={!pegado.trim() || !datos} className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-[#3d2c24] py-2.5 text-[13px] font-bold text-white disabled:opacity-40">
            {!datos ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Ordenar la lista
          </button>
        </section>
      ) : (
        <button onClick={() => setVerPegar(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#f3efe9] py-2 text-[12.5px] font-semibold text-[#3d2c24]">
          <ClipboardPaste className="size-3.5" /> Pegar más productos
        </button>
      )}

      {/* El pedido */}
      <section className="rounded-2xl bg-white ring-1 ring-[#ebe6df]">
        <div className="flex items-center gap-2 border-b border-[#f5f0ea] px-3.5 py-2.5">
          <ShoppingCart className="size-4 text-[#d4943a]" />
          <p className="flex-1 text-[13px] font-semibold text-[#3d2c24]">Lo que se está acabando {renglones.length > 0 && <span className="text-[#a39e97]">· {renglones.length}</span>}</p>
        </div>
        {renglones.length === 0 && <p className="px-3.5 py-4 text-center text-[12px] text-[#a39e97]">Pegá la lista arriba o buscá abajo para agregar.</p>}
        <ul className="divide-y divide-[#f5f0ea]">
          {renglones.map((r, idx) => (
            <li key={r.key} className="flex items-center gap-2 px-3.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-[#3d2c24]">{r.insumo?.name ?? r.nombre}</p>
                {r.insumo
                  ? (detalleDe(r.nombre, r.insumo.name) && <p className="truncate text-[10.5px] text-[#a39e97]">escribiste: {r.nombre}</p>)
                  : (() => {
                      // Escrito a mano: si se parece a un insumo, ofrecerlo (si no, no suma stock al llegar)
                      const s = sugerirInsumo(r.nombre, insumos)
                      return s
                        ? <button onClick={() => cambiar(r.key, { insumo: s })} className="mt-0.5 rounded-md bg-[#006d5a] px-2 py-0.5 text-[10.5px] font-semibold text-white">¿Es «{s.name}»? Tocá para elegirlo</button>
                        : <p className="text-[10.5px] text-[#b0762a]">No está en la app: va como texto (no va a sumar stock)</p>
                    })()}
              </div>
              <input
                ref={idx === renglones.length - 1 ? ultimaCantidad : undefined}
                value={r.cantidad}
                onChange={(e) => cambiar(r.key, { cantidad: e.target.value })}
                placeholder="¿cuánto?"
                className={cn('w-24 rounded-lg border px-2 py-1.5 text-right text-[13px] outline-none focus:border-[#d4943a]', r.cantidad.trim() ? 'border-[#ebe6df]' : 'border-[#f0c98a] bg-[#fffaf2]')}
              />
              <button onClick={() => setRenglones((x) => x.filter((y) => y.key !== r.key))} aria-label="Quitar" className="rounded-lg p-1.5 text-[#a39e97] hover:bg-[#f3efe9]"><X className="size-4" /></button>
            </li>
          ))}
        </ul>
        {/* Agregar de a uno */}
        <div className="relative border-t border-[#f5f0ea] p-2.5">
          <div className="flex items-center gap-2 rounded-xl bg-[#faf8f5] px-3 py-2">
            <Search className="size-4 text-[#a39e97]" />
            <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Agregar insumo (leche, vasos, harina…)" className="flex-1 bg-transparent text-[13px] outline-none" />
          </div>
          {buscar.trim().length >= 2 && (
            <div className="absolute inset-x-2.5 z-10 mt-1 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-[#ebe6df]">
              {sugeridos.map((i) => (
                <button key={i.id} onClick={() => agregar(i.name, i)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-[#f8f5f0]">
                  <Plus className="size-3.5 text-[#006d5a]" /><span className="flex-1 truncate">{i.name}</span><span className="text-[10.5px] text-[#a39e97]">{i.unit}</span>
                </button>
              ))}
              <button onClick={() => agregar(buscar.trim(), null)} className="flex w-full items-center gap-2 border-t border-[#f5f0ea] px-3 py-2 text-left text-[12.5px] text-[#7d6c64] hover:bg-[#f8f5f0]">
                <Plus className="size-3.5" /> Agregar &quot;{buscar.trim()}&quot; como texto
              </button>
            </div>
          )}
        </div>
      </section>

      {renglones.length > 0 && (
        <section className="space-y-2.5 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#f3efe9] p-1">
            {URGENCIAS.map(([k, label]) => (
              <button key={k} onClick={() => setUrgencia(k)} className={cn('rounded-lg py-1.5 text-[12px] font-semibold', urgencia === k ? (k === 'normal' ? 'bg-white text-[#3d2c24] shadow-sm' : 'bg-[#ea504c] text-white') : 'text-[#7d6c64]')}>{label}</button>
            ))}
          </div>
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} maxLength={300} placeholder="Nota (opcional): para el evento del sábado, queda para hoy…" className="w-full rounded-xl border border-[#ebe6df] px-3 py-2 text-[13px] outline-none placeholder:text-[#c4bdb7] focus:border-[#d4943a]" />
          {sinCantidad > 0 && <p className="text-[11.5px] text-[#b0762a]">{sinCantidad === 1 ? '1 producto va' : `${sinCantidad} productos van`} sin cantidad (&quot;a definir&quot;).</p>}
          <button onClick={() => void mandar()} disabled={enviando} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-3 text-[14px] font-bold text-white disabled:opacity-50">
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Sugerir a los encargados ({renglones.length})
          </button>
        </section>
      )}

      {/* Mis pedidos */}
      {porDia.length > 0 && (
        <section className="space-y-2">
          <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-[#a39e97]">Mis sugerencias</p>
          {porDia.map(([dia, items]) => (
            <div key={dia} className="rounded-2xl bg-white ring-1 ring-[#ebe6df]">
              <p className="border-b border-[#f5f0ea] px-3.5 py-2 text-[12px] font-semibold capitalize text-[#7d6c64]">{dia}</p>
              <ul className="divide-y divide-[#f5f0ea]">
                {items.map((o) => {
                  const e = ESTADO[o.status] ?? ESTADO.pending
                  return (
                    <li key={o.id} className="flex items-center gap-2 px-3.5 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] text-[#3d2c24]"><b>{o.product_name}</b> · {o.quantity}</p>
                        {o.proveedor && <p className="truncate text-[10.5px] text-[#a39e97]">{o.proveedor}</p>}
                      </div>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold', e.cls)}>{e.txt}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function agruparPorDia(mios: Mio[]): [string, Mio[]][] {
  const m = new Map<string, Mio[]>()
  for (const o of mios) {
    const dia = format(new Date(o.created_at), "EEEE d 'de' MMMM", { locale: es })
    m.set(dia, [...(m.get(dia) ?? []), o])
  }
  return [...m.entries()]
}

function Centro({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center">{children}</div>
}
