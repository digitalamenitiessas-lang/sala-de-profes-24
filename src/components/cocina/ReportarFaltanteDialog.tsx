'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'

type CriticalItem = {
  stock_item_id: string
  name: string
  unit: string
  current_qty: number
  days_of_stock: number | null
}

type StockItem = {
  id: string
  name: string
  unit: string
  current_qty: number
  category: string
}

type ListData = {
  critical: CriticalItem[]
  items: StockItem[]
}

type Props = { onClose: () => void }

export function ReportarFaltanteDialog({ onClose }: Props) {
  const [listData, setListData] = useState<ListData | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null)
  const [nota, setNota] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/cocina/faltante')
      .then((r) => r.json())
      .then((d) => setListData(d as ListData))
      .catch(() => setListData({ critical: [], items: [] }))
  }, [])

  useEffect(() => {
    if (listData && !selected) setTimeout(() => inputRef.current?.focus(), 50)
  }, [listData, selected])

  const criticalIds = new Set((listData?.critical ?? []).map((c) => c.stock_item_id))

  const filteredItems = (listData?.items ?? []).filter((i) => {
    if (!search.trim()) return true
    return i.name.toLowerCase().includes(search.toLowerCase())
  })

  // Critical items always at top (filtered by search too)
  const criticalFiltered = (listData?.critical ?? []).filter(
    (c) => !search.trim() || c.name.toLowerCase().includes(search.toLowerCase()),
  )
  const restFiltered = filteredItems.filter((i) => !criticalIds.has(i.id))

  async function handleReportar() {
    if (!selected) return
    setSaving(true)
    try {
      const res = await fetch('/api/cocina/faltante', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_item_id: selected.id, nota: nota.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Error al reportar')
      setDone(true)
      toast.success(`Avisamos a los encargados que falta ${selected.name}`)
      setTimeout(onClose, 1800)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo enviar el reporte')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 pb-0" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-3xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-[#e0dbd5]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-1">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-xl bg-[#fdecea]">
              <AlertTriangle className="size-4 text-[#ea504c]" />
            </div>
            <h2 className="text-[15px] font-bold text-[#3d2c24]">Reportar faltante</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-black/5">
            <X className="size-4.5 text-[#a39e97]" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-2 py-10 px-5">
            <div className="flex size-14 items-center justify-center rounded-full bg-[#e8f5f1]">
              <Check className="size-7 text-[#006d5a]" />
            </div>
            <p className="text-center text-[14px] font-semibold text-[#3d2c24]">
              Aviso enviado a los encargados
            </p>
            <p className="text-center text-[12px] text-[#a39e97]">
              Ellos van a recibir una notificación ahora mismo
            </p>
          </div>
        ) : selected ? (
          /* Paso 2: nota + confirmar */
          <div className="px-5 pb-6 space-y-4">
            <div className="flex items-center gap-3 rounded-2xl bg-[#fdecea] px-4 py-3">
              <AlertTriangle className="size-4 shrink-0 text-[#ea504c]" />
              <p className="text-[13px] font-semibold text-[#ea504c]">{selected.name}</p>
              <button
                onClick={() => setSelected(null)}
                className="ml-auto text-[11px] font-medium text-[#ea504c]/70 underline"
              >
                Cambiar
              </button>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-[#a39e97]">
                Nota para el encargado <span className="font-normal">(opcional)</span>
              </label>
              <input
                autoFocus
                type="text"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleReportar() }}
                placeholder="Ej: quedan 3, no alcanzan para el turno"
                className="w-full rounded-xl border border-[#ebe6df] px-3.5 py-2.5 text-[13px] text-[#3d2c24] outline-none focus:border-[#ea504c]"
              />
            </div>

            <button
              onClick={() => void handleReportar()}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#ea504c] py-3.5 text-[14px] font-bold text-white disabled:opacity-60"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
              Avisar al encargado
            </button>
          </div>
        ) : (
          /* Paso 1: buscar y seleccionar */
          <div className="px-5 pb-5">
            {/* Buscador */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar insumo…"
                className="w-full rounded-xl border border-[#ebe6df] py-2.5 pl-9 pr-4 text-[13px] text-[#3d2c24] outline-none focus:border-[#ea504c]"
              />
            </div>

            {/* Lista */}
            <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1">
              {!listData && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-[#a39e97]" />
                </div>
              )}

              {/* Críticos primero */}
              {criticalFiltered.length > 0 && (
                <>
                  {!search && (
                    <p className="px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-[#ea504c]">
                      Bajo stock ahora
                    </p>
                  )}
                  {criticalFiltered.map((c) => (
                    <button
                      key={c.stock_item_id}
                      onClick={() => setSelected({ id: c.stock_item_id, name: c.name })}
                      className="flex w-full items-center gap-3 rounded-xl bg-[#fff5f5] px-3 py-2.5 text-left ring-1 ring-[#ea504c]/20 active:bg-[#fdecea]"
                    >
                      <AlertTriangle className="size-3.5 shrink-0 text-[#ea504c]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-[#3d2c24]">{c.name}</p>
                        <p className="text-[10px] text-[#ea504c]">
                          {c.current_qty < 0
                            ? `en negativo (${Number(c.current_qty).toFixed(1)} ${c.unit})`
                            : c.days_of_stock !== null
                              ? `queda para ${c.days_of_stock} días`
                              : `hay ${Number(c.current_qty).toFixed(1)} ${c.unit}`}
                        </p>
                      </div>
                    </button>
                  ))}
                </>
              )}

              {/* Resto */}
              {restFiltered.length > 0 && (
                <>
                  {criticalFiltered.length > 0 && !search && (
                    <p className="px-1 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-[#a39e97]">
                      Todos los insumos
                    </p>
                  )}
                  {restFiltered.slice(0, 40).map((i) => (
                    <button
                      key={i.id}
                      onClick={() => setSelected({ id: i.id, name: i.name })}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[#f9f7f3] active:bg-[#f3efe9]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-[#3d2c24]">{i.name}</p>
                        <p className="text-[10px] text-[#a39e97]">{i.unit}</p>
                      </div>
                    </button>
                  ))}
                  {restFiltered.length > 40 && (
                    <p className="py-2 text-center text-[11px] text-[#a39e97]">
                      Buscá para encontrar el insumo
                    </p>
                  )}
                </>
              )}

              {listData && criticalFiltered.length === 0 && restFiltered.length === 0 && (
                <p className="py-6 text-center text-[13px] text-[#a39e97]">No se encontró ningún insumo</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
