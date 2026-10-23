'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Package, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { coincideBusqueda } from '@/lib/buscar'
import { sugerirInsumo } from '@/lib/compras/lista-pegada'
import { parseQty, type StockLite } from './shared'

// ---------------------------------------------------------------------------
// "+ Llegó algo más": productos que llegaron y no estaban en el pedido. Cada
// renglón busca el insumo; si no existe, lo trae de Fudo (si ya lo cargaron
// allá) o lo crea como producto nuevo, sin salir de Compras.
// ---------------------------------------------------------------------------

export type FilaExtra = {
  key: string
  nombre: string
  stockItemId: string | null
  qty: string
  total: string
  expiresAt: string
}

export const nuevaFilaExtra = (): FilaExtra => ({ key: Math.random().toString(36).slice(2), nombre: '', stockItemId: null, qty: '', total: '', expiresAt: '' })

/** Ingrediente o producto de Fudo que todavía no está en stock */
export type PendienteFudo = { id: string; name: string; unit?: string; tipo: 'ingrediente' | 'producto' }

export function FilaLlegoDeMas({ fila, comprables, stockById, fudo, cargandoFudo, onCargarFudo, onTraer, onCrear, onChange, onQuitar }: {
  fila: FilaExtra
  comprables: StockLite[]
  stockById: Map<string, StockLite>
  /** null = todavía no se pidió la lista a Fudo */
  fudo: PendienteFudo[] | null
  cargandoFudo: boolean
  onCargarFudo: () => void
  onTraer: (p: PendienteFudo) => Promise<void>
  onCrear: (nombre: string) => void
  onChange: (patch: Partial<FilaExtra>) => void
  onQuitar: () => void
}) {
  const [trayendo, setTrayendo] = useState<string | null>(null)
  const si = fila.stockItemId ? stockById.get(fila.stockItemId) ?? null : null
  const q = fila.nombre.trim()
  const locales = !si && q.length >= 2 ? comprables.filter((s) => coincideBusqueda(s.name, q)).slice(0, 6) : []
  // Escrito con cantidad ("1/2 kg de palta"): ofrecer el insumo que corresponde
  const sugerido = !si && locales.length === 0 && q.length > 2 ? sugerirInsumo(q, comprables) : null
  const enFudo = !si && fudo && q.length >= 3 ? fudo.filter((p) => coincideBusqueda(p.name, q)).slice(0, 4) : []
  const sinNada = !si && q.length >= 3 && locales.length === 0 && !sugerido

  async function traer(p: PendienteFudo) {
    setTrayendo(p.id)
    try { await onTraer(p) } finally { setTrayendo(null) }
  }

  return (
    <div className="rounded-xl border border-[#cfe5de] bg-[#f6fbf9] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Plus className="mt-2 size-4 shrink-0 text-[#006d5a]" />
        <div className="min-w-0 flex-1">
          {si ? (
            <div className="flex items-center gap-2 py-1">
              <Package className="size-3.5 shrink-0 text-[#006d5a]" />
              <p className="flex-1 truncate text-[13px] font-semibold text-[#3d2c24]">{si.name}</p>
              <button type="button" onClick={() => onChange({ stockItemId: null })} className="text-[10.5px] font-semibold text-[#7d6c64] underline">cambiar</button>
            </div>
          ) : (
            <input
              value={fila.nombre}
              onChange={(e) => onChange({ nombre: e.target.value, stockItemId: null })}
              onFocus={() => { if (!fudo && !cargandoFudo) onCargarFudo() }}
              placeholder="¿Qué llegó? Buscá el producto…"
              className="w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-1.5 text-[13px] text-[#3d2c24] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:outline-none"
            />
          )}

          {locales.length > 0 && (
            <div className="mt-1 overflow-hidden rounded-lg border border-[#ebe6df] bg-white">
              {locales.map((s) => (
                <button key={s.id} type="button" onClick={() => onChange({ nombre: s.name, stockItemId: s.id })} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[#f8f5f0]">
                  <Package className="size-3 shrink-0 text-[#006d5a]" />
                  <span className="flex-1 truncate text-[12px] font-medium text-[#3d2c24]">{s.name}</span>
                  <span className="shrink-0 text-[9.5px] text-[#a39e97]">{s.current_qty} {s.unit}</span>
                </button>
              ))}
            </div>
          )}
          {sugerido && (
            <button type="button" onClick={() => onChange({ nombre: sugerido.name, stockItemId: sugerido.id })} className="mt-1 flex items-center gap-1 rounded-md bg-[#006d5a] px-2 py-1 text-[11px] font-semibold text-white active:scale-95">
              <Check className="size-3" /> Es «{sugerido.name}»
            </button>
          )}

          {!si && q.length >= 3 && (
            <div className="mt-1.5 space-y-1">
              {enFudo.map((p) => (
                <button key={`${p.tipo}-${p.id}`} type="button" disabled={!!trayendo} onClick={() => void traer(p)} className="flex w-full items-center gap-2 rounded-lg bg-[#eef4fc] px-2.5 py-1.5 text-left text-[11.5px] text-[#2f5f9a] ring-1 ring-[#cfdcf3] disabled:opacity-60">
                  {trayendo === p.id ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Package className="size-3 shrink-0" />}
                  <span className="flex-1 truncate"><b>{p.name}</b> está en Fudo · traer a stock</span>
                </button>
              ))}
              {cargandoFudo && <p className="flex items-center gap-1 text-[10.5px] text-[#a39e97]"><Loader2 className="size-3 animate-spin" /> Buscando en Fudo…</p>}
              {sinNada && (
                <button type="button" onClick={() => onCrear(q)} className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-[#d6d0c8] bg-white px-2.5 py-1.5 text-left text-[11.5px] font-semibold text-[#3d2c24]">
                  <Plus className="size-3 shrink-0 text-[#006d5a]" /> Crear «{q}» como producto nuevo
                </button>
              )}
            </div>
          )}
          {!si && q.length >= 2 && (
            <p className="mt-1 text-[10.5px] font-semibold text-[#ea504c]">Sin insumo elegido: no suma stock (ni acá ni en Fudo)</p>
          )}
        </div>
        <button type="button" onClick={onQuitar} className="mt-1 shrink-0 rounded-lg p-1 text-[#a39e97] hover:bg-[#fef2f2] hover:text-[#ea504c]" aria-label="Quitar"><Trash2 className="size-3.5" /></button>
      </div>

      {q.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
          <label className="block">
            <span className="text-[10px] font-semibold text-[#7d6c64]">Llegó{si ? ` (${si.unit})` : ''}</span>
            <input
              value={fila.qty}
              onChange={(e) => onChange({ qty: e.target.value })}
              placeholder={si ? `0 ${si.unit}` : 'Ej: 2 cajas'}
              className={cn('mt-0.5 w-full rounded-lg border bg-white px-2 py-1.5 text-[13px] focus:outline-none', si && !(parseQty(fila.qty) > 0) ? 'border-[#ea504c]' : 'border-[#ebe6df] focus:border-[#006d5a]')}
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold text-[#7d6c64]">$ total (opcional)</span>
            <input inputMode="decimal" value={fila.total} onChange={(e) => onChange({ total: e.target.value })} placeholder="0" className="mt-0.5 w-full rounded-lg border border-[#ebe6df] bg-white px-2 py-1.5 text-[13px] focus:border-[#006d5a] focus:outline-none" />
          </label>
          {si && (
            <label className="col-span-2 flex items-center gap-2 text-[10.5px] text-[#7d6c64]">
              Vence (opcional)
              <input type="date" value={fila.expiresAt} onChange={(e) => onChange({ expiresAt: e.target.value })} className="flex-1 rounded-lg border border-[#ebe6df] bg-white px-2 py-1 text-[12px]" />
            </label>
          )}
        </div>
      )}
    </div>
  )
}

/** Lista de Fudo de lo que todavía no está en stock (ingredientes y productos con stock) */
export async function pedirPendientesFudo(): Promise<PendienteFudo[]> {
  const r = await fetch('/api/stock/create-from-fudo')
  const j = await r.json().catch(() => null)
  if (!r.ok || !j) throw new Error(j?.error ?? 'No se pudo consultar Fudo')
  return [
    ...((j.unmapped_ingredients ?? []) as { id: string; name: string; unit?: string }[]).map((i) => ({ id: String(i.id), name: i.name, unit: i.unit, tipo: 'ingrediente' as const })),
    ...((j.unmapped_products ?? []) as { id: string; name: string }[]).map((p) => ({ id: String(p.id), name: p.name, tipo: 'producto' as const })),
  ]
}

/** Crea en stock el ingrediente/producto de Fudo y devuelve el insumo */
export async function traerDeFudo(p: PendienteFudo): Promise<StockLite> {
  const r = await fetch('/api/stock/create-from-fudo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p.tipo === 'ingrediente' ? { fudo_ingredient_id: p.id } : { fudo_product_id: p.id }),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok || !j?.item) throw new Error(j?.error ?? j?.errors?.[0] ?? 'No se pudo traer de Fudo')
  toast.success(`«${j.item.name}» quedó en stock`)
  return j.item as StockLite
}
