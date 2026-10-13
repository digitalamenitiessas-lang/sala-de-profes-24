'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { toast } from 'sonner'
import { ArrowLeft, Check, Loader2, Minus, Plus, Search, ShoppingBag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'

// ---------------------------------------------------------------------------
// Descartables para llevar: qué vaso/tapa/envase usa cada producto cuando se
// vende PARA LLEVAR. Con eso, cada venta para llevar de Fudo descuenta solo
// los descartables (lib/stock/descartables.ts, cada 10 minutos).
// ---------------------------------------------------------------------------

type Descartable = { id: string; name: string; unit: string; current_qty: number; min_qty: number }
type Producto = { fudo_product_id: string; nombre: string; categoria: string; para_llevar_30d: number }
type Config = { fudo_product_id: string; stock_item_id: string; cantidad: number }
type Datos = { descartables: Descartable[]; productos: Producto[]; config: Config[] }

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'No se pudo cargar')
  return r.json()
}

export default function DescartablesPage() {
  const { profile } = useProfileContext()
  const { data, error, isLoading, mutate } = useSWR<Datos>('/api/stock/descartables', fetcher)
  const [buscar, setBuscar] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<Record<string, number>>({})
  const [guardando, setGuardando] = useState(false)
  const [soloVendidos, setSoloVendidos] = useState(true)

  const configDe = useMemo(() => {
    const m = new Map<string, Config[]>()
    for (const c of data?.config ?? []) m.set(c.fudo_product_id, [...(m.get(c.fudo_product_id) ?? []), c])
    return m
  }, [data])
  const nombreDesc = useMemo(() => new Map((data?.descartables ?? []).map((d) => [d.id, d.name])), [data])

  const productos = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return (data?.productos ?? []).filter((p) =>
      (q ? p.nombre.toLowerCase().includes(q) || p.categoria.toLowerCase().includes(q) : true)
      && (!soloVendidos || q || p.para_llevar_30d > 0 || configDe.has(p.fudo_product_id)))
  }, [data, buscar, soloVendidos, configDe])

  if (profile && !isManagerOrAbove(profile.role)) {
    return <p className="py-20 text-center text-sm text-[#7d6c64]">Solo encargados y socios configuran los descartables.</p>
  }
  if (isLoading && !data) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-[#a39e97]" /></div>
  if (error || !data) return <p className="py-20 text-center text-sm text-[#ea504c]">{error?.message ?? 'No se pudo cargar'}</p>

  function abrir(p: Producto) {
    if (abierto === p.fudo_product_id) { setAbierto(null); return }
    setAbierto(p.fudo_product_id)
    setBorrador(Object.fromEntries((configDe.get(p.fudo_product_id) ?? []).map((c) => [c.stock_item_id, Number(c.cantidad)])))
  }

  async function guardar(p: Producto) {
    setGuardando(true)
    try {
      const items = Object.entries(borrador).filter(([, n]) => n > 0).map(([stock_item_id, cantidad]) => ({ stock_item_id, cantidad }))
      const r = await fetch('/api/stock/descartables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fudo_product_id: p.fudo_product_id, items }) })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw new Error(j?.error ?? 'No se pudo guardar')
      toast.success(items.length ? `${p.nombre}: se descuenta solo desde ahora` : `${p.nombre}: sin descartables`)
      setAbierto(null)
      void mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  const configurados = new Set(data.config.map((c) => c.fudo_product_id)).size

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-28">
      <div className="flex items-center gap-3">
        <Link href="/stock?area=descartables" className="rounded-xl bg-[#f3efe9] p-2 text-[#3d2c24]"><ArrowLeft className="size-4" /></Link>
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight text-[#3d2c24]">Descartables para llevar</h1>
          <p className="text-xs text-[#a39e97]">Qué usa cada producto cuando se vende para llevar. Se descuenta solo.</p>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-3 ring-1 ring-[#ebe6df]">
        <p className="mb-2 text-xs font-semibold text-[#3d2c24]">Stock de descartables</p>
        <div className="grid grid-cols-2 gap-1.5 text-[11.5px]">
          {data.descartables.map((d) => {
            const bajo = d.min_qty > 0 && d.current_qty <= d.min_qty
            return (
              <div key={d.id} className={cn('rounded-lg px-2 py-1.5', bajo ? 'bg-[#fef2f2] text-[#ea504c]' : 'bg-[#faf8f5] text-[#5c4a42]')}>
                <span className="block truncate font-semibold">{d.name}</span>
                {Math.round(d.current_qty)} {d.unit}{d.min_qty > 0 ? ` · mín. ${Math.round(d.min_qty)}` : ''}
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-[11px] text-[#7d6c64]">Cuando uno baja del mínimo, al encargado le llega un aviso. El mínimo se cambia en Stock tocando el insumo.</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-[#ebe6df]">
          <Search className="size-4 text-[#a39e97]" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar producto (latte, licuado…)" className="flex-1 bg-transparent text-sm outline-none" />
        </div>
        <label className="flex items-center gap-2 px-1 text-xs text-[#5c4a42]">
          <input type="checkbox" checked={soloVendidos} onChange={(e) => setSoloVendidos(e.target.checked)} />
          Solo los que se vendieron para llevar en los últimos 30 días · {configurados} configurado{configurados !== 1 ? 's' : ''}
        </label>
      </div>

      <ul className="space-y-1.5">
        {productos.map((p) => {
          const cfg = configDe.get(p.fudo_product_id) ?? []
          const open = abierto === p.fudo_product_id
          return (
            <li key={p.fudo_product_id} className="rounded-xl bg-white ring-1 ring-[#ebe6df]">
              <button onClick={() => abrir(p)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                <ShoppingBag className={cn('size-4 shrink-0', cfg.length ? 'text-[#006d5a]' : 'text-[#d6d0c8]')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[#3d2c24]">{p.nombre}</span>
                  <span className="block truncate text-[11px] text-[#a39e97]">
                    {p.categoria} · {p.para_llevar_30d} para llevar en 30 días
                    {cfg.length > 0 && <> · <span className="text-[#006d5a]">{cfg.map((c) => `${Number(c.cantidad)} ${nombreDesc.get(c.stock_item_id) ?? ''}`).join(' + ')}</span></>}
                  </span>
                </span>
              </button>
              {open && (
                <div className="space-y-1.5 border-t border-[#f0ebe4] px-3 py-2.5">
                  <p className="text-[11.5px] text-[#7d6c64]">Cada vez que se vende <b>un</b> {p.nombre} para llevar, se descuenta:</p>
                  {data.descartables.map((d) => {
                    const n = borrador[d.id] ?? 0
                    return (
                      <div key={d.id} className="flex items-center gap-2">
                        <span className={cn('flex-1 truncate text-[13px]', n > 0 ? 'font-semibold text-[#3d2c24]' : 'text-[#7d6c64]')}>{d.name}</span>
                        <button onClick={() => setBorrador((b) => ({ ...b, [d.id]: Math.max(0, n - 1) }))} className="rounded-lg bg-[#f3efe9] p-1.5" aria-label="Menos"><Minus className="size-3.5" /></button>
                        <span className="w-6 text-center text-sm font-bold tabular-nums">{n}</span>
                        <button onClick={() => setBorrador((b) => ({ ...b, [d.id]: Math.min(20, n + 1) }))} className="rounded-lg bg-[#f3efe9] p-1.5" aria-label="Más"><Plus className="size-3.5" /></button>
                      </div>
                    )
                  })}
                  <button onClick={() => void guardar(p)} disabled={guardando} className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-2.5 text-sm font-bold text-white disabled:opacity-50">
                    {guardando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Guardar
                  </button>
                </div>
              )}
            </li>
          )
        })}
        {productos.length === 0 && <li className="py-6 text-center text-sm text-[#a39e97]">Nada para mostrar.</li>}
      </ul>
    </div>
  )
}
