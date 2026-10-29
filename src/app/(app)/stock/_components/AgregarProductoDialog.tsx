'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog'
import { STOCK_AREAS, type StockArea } from '@/lib/stock/areas'
import { coincideBusqueda } from '@/lib/buscar'

// ---------------------------------------------------------------------------
// Alta de un producto que NO está en Fudo (descartables, limpieza…). Antes de
// crear muestra los parecidos que ya existen, para no duplicar.
// ---------------------------------------------------------------------------

const UNIDADES = [
  { value: 'unidad', label: 'Unidad' },
  { value: 'paquete', label: 'Paquete' },
  { value: 'caja', label: 'Caja' },
  { value: 'kg', label: 'Kg' },
  { value: 'g', label: 'Gramos' },
  { value: 'l', label: 'Litros' },
  { value: 'ml', label: 'Ml' },
]

const inputCls = 'w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm text-[#3d2c24] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:outline-none'

export type ProductoCreado = { id: string; name: string; unit: string; area: string; current_qty: number; min_qty: number; fudo_skip?: boolean }

export function AgregarProductoDialog({ existentes, nombreInicial, areaInicial, ayuda, onClose, onCreado }: {
  existentes: { id: string; name: string }[]
  nombreInicial?: string
  areaInicial?: StockArea | null
  /** Reemplaza la aclaración de arriba (ej. desde Compras) */
  ayuda?: ReactNode
  onClose: () => void
  onCreado: (item: ProductoCreado) => void
}) {
  const [nombre, setNombre] = useState(nombreInicial ?? '')
  const [unidad, setUnidad] = useState('unidad')
  const [area, setArea] = useState<StockArea | ''>(areaInicial && areaInicial !== 'otros' ? areaInicial : '')
  const [minimo, setMinimo] = useState('')
  const [actual, setActual] = useState('')
  const [igual, setIgual] = useState(false)
  const [guardando, setGuardando] = useState(false)

  // Parecidos: comparten todas las palabras del nombre (ej. "vaso 6oz")
  const parecidos = useMemo(() => {
    const n = nombre.trim()
    if (n.length < 3) return []
    return existentes.filter((e) => coincideBusqueda(e.name, n) || coincideBusqueda(n, e.name)).slice(0, 5)
  }, [nombre, existentes])

  const puede = nombre.trim().length >= 2 && !!area && (parecidos.length === 0 || igual) && !guardando

  async function guardar() {
    if (!puede) return
    setGuardando(true)
    try {
      const res = await fetch('/api/stock/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nombre.trim(), unit: unidad, area, min_qty: minimo || 0, current_qty: actual || 0 }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo agregar')
      toast.success(json.vinculadoAFudo
        ? `"${json.vinculadoAFudo}" ya estaba en Fudo: quedó vinculado (suma al gasto y al stock de Fudo)`
        : `"${json.item?.name ?? nombre.trim()}" agregado al stock`)
      onCreado(json.item as ProductoCreado)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo agregar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader><DialogTitle className="text-base">Agregar producto</DialogTitle></DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-0.5">
          <p className="rounded-xl bg-[#fdf6ec] px-3 py-2 text-[11.5px] text-[#8b5e34]">
            {ayuda ?? <>Para productos que <b>no están en Fudo</b> (vasos, tapas, servilletas, limpieza…). Si es un insumo que se usa en recetas, cargalo en Fudo: aparece solo al día siguiente.</>}
          </p>

          <label className="block">
            <span className="text-[12px] font-semibold text-[#3d2c24]">Nombre</span>
            <input value={nombre} onChange={(e) => { setNombre(e.target.value); setIgual(false) }} maxLength={80} placeholder="Ej: Vaso polipapel 4oz" className={cn(inputCls, 'mt-1')} />
          </label>

          {parecidos.length > 0 && (
            <div className="rounded-xl bg-[#fef2f2] px-3 py-2 text-[11.5px] text-[#3d2c24]">
              <p className="font-semibold text-[#ea504c]">Ya hay productos parecidos:</p>
              <ul className="mt-0.5 list-disc pl-4">{parecidos.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
              <label className="mt-1.5 flex items-center gap-2">
                <input type="checkbox" checked={igual} onChange={(e) => setIgual(e.target.checked)} className="size-4 accent-[#006d5a]" />
                Es otro producto, agregarlo igual
              </label>
            </div>
          )}

          <div>
            <span className="text-[12px] font-semibold text-[#3d2c24]">Área</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {STOCK_AREAS.filter((a) => a.value !== 'otros').map((a) => (
                <button key={a.value} type="button" onClick={() => setArea(a.value)}
                  className={cn('rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1', area === a.value ? 'bg-[#3d2c24] text-white ring-[#3d2c24]' : 'bg-white text-[#3d2c24] ring-[#ebe6df]')}>
                  {a.icon} {a.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-[12px] font-semibold text-[#3d2c24]">Unidad</span>
            <select value={unidad} onChange={(e) => setUnidad(e.target.value)} className={cn(inputCls, 'mt-1')}>
              {UNIDADES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[12px] font-semibold text-[#3d2c24]">Hay ahora</span>
              <input inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="0" className={cn(inputCls, 'mt-1')} />
            </label>
            <label className="block">
              <span className="text-[12px] font-semibold text-[#3d2c24]">Mínimo</span>
              <input inputMode="decimal" value={minimo} onChange={(e) => setMinimo(e.target.value)} placeholder="0" className={cn(inputCls, 'mt-1')} />
            </label>
          </div>
          <p className="text-[10.5px] text-[#a39e97]">El mínimo sirve para que avise cuando hay poco. Si no sabés, dejalo en 0.</p>
        </div>
        <DialogFooter className="mt-2 gap-2">
          <DialogClose className="rounded-xl px-4 py-2 text-sm font-medium text-[#7d6c64]">Cancelar</DialogClose>
          <button onClick={() => void guardar()} disabled={!puede} className="flex items-center gap-2 rounded-xl bg-[#006d5a] px-5 py-2 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-50">
            {guardando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Agregar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
