'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronRight, Loader2, Settings2, Trash2, ClipboardCheck, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import type { StockItem } from '@/lib/hooks/use-stock'
import {
  COLORS,
  WASTE_REASON_OPTIONS,
  getSemaphore,
  getStockSource,
  formatQty,
  needsVarianceNote,
  getVariance,
  type WasteReason,
} from '@/lib/stock/helpers'
import { AREA_LABEL, areaFromLveCategory } from '@/lib/stock/areas'
import { esCostoConfiable } from '@/lib/costos/confiable'
import { MetadataEditor } from './MetadataEditor'

// ---------------------------------------------------------------------------
// CountSheet — la única forma de tocar un insumo desde la lista.
// ---------------------------------------------------------------------------
// Un panel inferior con tres acciones, en orden de frecuencia:
//   1. Contar (todos los roles operativos): lo contado va a Fudo primero.
//   2. Merma (encargado/socio): descuenta por delta en Fudo con motivo.
//   3. Configurar (encargado/socio): mínimo, área, vida útil, unidad, nota.
// Y el acceso a la ficha completa (kardex, precios, recetas, cadena).
// ---------------------------------------------------------------------------

type Props = {
  item: StockItem | null
  open: boolean
  canWaste: boolean
  canConfigure: boolean
  showMoney: boolean
  fudoBlocked: boolean
  onClose: () => void
  onUpdated: () => void
}

type Mode = 'count' | 'waste' | 'config'

export function CountSheet({ item, open, canWaste, canConfigure, showMoney, fudoBlocked, onClose, onUpdated }: Props) {
  const [mode, setMode] = useState<Mode>('count')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [wasteQty, setWasteQty] = useState('')
  const [wasteReason, setWasteReason] = useState<WasteReason>('vencido')
  const [wasteNote, setWasteNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!item) return
    setMode('count')
    setQty('')
    setNote('')
    setWasteQty('')
    setWasteReason('vencido')
    setWasteNote('')
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const source = item ? getStockSource(item) : null
  const semaphore = item ? getSemaphore(item) : 'green'
  const parsed = qty.trim() === '' ? null : Number(qty.replace(',', '.'))
  const variance = item && parsed !== null && Number.isFinite(parsed) ? getVariance(item, parsed) : null
  const noteRequired = Boolean(item && parsed !== null && Number.isFinite(parsed) && needsVarianceNote(item, parsed))
  const countBlocked = Boolean(item && source && (!source.actionable || (source.kind === 'fudo' && fudoBlocked)))

  const lastCount = useMemo(() => {
    if (!item?.last_counted_at) return null
    const days = Math.floor((Date.now() - new Date(item.last_counted_at).getTime()) / 86_400_000)
    return { days, label: format(new Date(item.last_counted_at), "d MMM HH:mm", { locale: es }) }
  }, [item?.last_counted_at])

  async function saveCount() {
    if (!item || parsed === null || !Number.isFinite(parsed)) { toast.error('Ingresá la cantidad contada'); return }
    if (parsed < 0) { toast.error('No se permiten cantidades negativas'); return }
    if (noteRequired && !note.trim()) { toast.error('La diferencia es grande: agregá una nota para auditoría'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/stock/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockItemId: item.id, newQty: parsed, reason: 'physical_count', note: note.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.success === false) throw new Error(data.error ?? data.message ?? 'Fudo no confirmó la actualización')
      toast.success(`${item.name}: ${formatQty(parsed)} ${item.unit}${data.fudoSynced ? ' → Fudo ✓' : ''}`)
      onUpdated()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar el conteo')
    } finally {
      setSaving(false)
    }
  }

  async function saveWaste() {
    if (!item) return
    const w = Number(wasteQty.replace(',', '.'))
    if (!Number.isFinite(w) || w <= 0) { toast.error('Ingresá la cantidad de merma'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/stock/waste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockItemId: item.id, qty: w, wasteReason, note: wasteNote.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.success === false) throw new Error(data.error ?? 'No se pudo registrar la merma')
      toast.success(`Merma registrada: −${formatQty(w)} ${item.unit}${data.fudoSynced ? ' → Fudo ✓' : ''}`)
      onUpdated()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al registrar merma')
    } finally {
      setSaving(false)
    }
  }

  // Valor y "se tiran $" SOLO con costo confiable (compra/manual/producción)
  const costoConfiable = Boolean(item && esCostoConfiable(item.cost_source, item.cost_per_unit))
  const value = item && showMoney && costoConfiable ? Math.round(Math.max(item.current_qty, 0) * (item.cost_per_unit ?? 0)) : null

  return (
    <Sheet open={open && Boolean(item)} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-[1.6rem] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {item && source && (
          <>
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[#e6dfd7]" />
            <SheetHeader className="p-0 text-left">
              <SheetTitle className="font-display text-lg leading-tight text-[#3d2c24]">{item.name}</SheetTitle>
              <SheetDescription className="text-[11px] text-[#a39e97]">
                {AREA_LABEL[item.area ?? areaFromLveCategory(item.category)]}
                {item.fudo_category ? ` · ${item.fudo_category}` : ''}
                {' · '}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${source.tone}`}>{source.label}</span>
                {item.is_produced && <span className="ml-1 rounded-full bg-[#e8f5f1] px-1.5 py-0.5 text-[10px] font-bold text-[#006d5a]">Producido</span>}
              </SheetDescription>
            </SheetHeader>

            {/* Estado actual */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className={`rounded-2xl px-3 py-2.5 ${COLORS[semaphore].bg}`}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">En sistema</p>
                <p className={`font-display text-xl font-bold tabular-nums ${COLORS[semaphore].text}`}>
                  {formatQty(item.current_qty)} <span className="text-xs font-medium">{item.unit}</span>
                </p>
              </div>
              <div className="rounded-2xl bg-[#faf8f5] px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Mínimo</p>
                <p className="font-display text-xl font-bold tabular-nums text-[#3d2c24]">
                  {item.min_qty > 0 ? formatQty(item.min_qty) : '—'}
                </p>
              </div>
              <div className="rounded-2xl bg-[#faf8f5] px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">{value !== null ? 'Valor' : 'Contado'}</p>
                <p className="font-display text-xl font-bold tabular-nums text-[#3d2c24]">
                  {value !== null ? `$${value.toLocaleString('es-AR')}` : lastCount ? `${lastCount.days}d` : 'nunca'}
                </p>
              </div>
            </div>
            {lastCount && (
              <p className="mt-1.5 text-[11px] text-[#a39e97]">Último conteo: {lastCount.label} ({lastCount.days === 0 ? 'hoy' : `hace ${lastCount.days}d`})</p>
            )}

            {/* Selector de acción */}
            <div className="mt-3 grid gap-1.5 rounded-2xl bg-[#faf8f5] p-1 ring-1 ring-[#ebe6df]" style={{ gridTemplateColumns: `repeat(${1 + Number(canWaste) + Number(canConfigure)}, minmax(0, 1fr))` }}>
              {([
                { key: 'count' as const, label: 'Contar', Icon: ClipboardCheck, show: true },
                { key: 'waste' as const, label: 'Merma', Icon: Trash2, show: canWaste },
                { key: 'config' as const, label: 'Configurar', Icon: Settings2, show: canConfigure },
              ]).filter((t) => t.show).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  onClick={() => setMode(key)}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-semibold transition-all ${mode === key ? 'bg-white text-[#3d2c24] shadow-sm' : 'text-[#7d6c64]'}`}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {mode === 'count' && (
              <div className="mt-3 space-y-2.5">
                {countBlocked ? (
                  <div className="flex items-start gap-2 rounded-xl bg-[#fff7f7] px-3 py-2.5 text-[12px] text-[#ea504c]">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {!source.actionable
                        ? 'Este insumo no está vinculado a Fudo ni marcado como local. Vinculalo desde el Centro de control antes de contar.'
                        : 'Fudo está bloqueado por un incidente crítico. Revisá el Centro de control y reintentá.'}
                    </span>
                  </div>
                ) : (
                  <>
                    <label className="block">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Cantidad contada ({item.unit})</span>
                      <input
                        autoFocus
                        inputMode="decimal"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void saveCount() }}
                        placeholder={formatQty(item.current_qty)}
                        className="mt-1 w-full rounded-2xl border-2 border-[#ebe6df] bg-white px-4 py-3 font-display text-2xl font-bold tabular-nums text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
                      />
                    </label>
                    {variance && variance.diff !== 0 && (
                      <p className={`text-[12px] font-semibold ${variance.diff > 0 ? 'text-[#006d5a]' : 'text-[#ea504c]'}`}>
                        {variance.diff > 0 ? '+' : ''}{formatQty(variance.diff)} {item.unit} respecto del sistema
                        {noteRequired && <span className="ml-1 font-normal text-[#d4943a]">· diferencia grande, dejá una nota</span>}
                      </p>
                    )}
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder={noteRequired ? 'Nota obligatoria: por qué difiere (obligatoria para auditoría)' : 'Nota (opcional)'}
                      className={`w-full rounded-xl border bg-white px-3 py-2 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:outline-none ${noteRequired && !note.trim() ? 'border-[#d4943a]' : 'border-[#ebe6df] focus:border-[#006d5a]'}`}
                    />
                    <button
                      onClick={() => void saveCount()}
                      disabled={saving || parsed === null}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#006d5a] py-3 text-sm font-bold text-white shadow-sm active:scale-[0.98] disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      {source.kind === 'fudo' ? 'Guardar conteo en Fudo' : 'Guardar conteo'}
                    </button>
                  </>
                )}
              </div>
            )}

            {mode === 'waste' && canWaste && (
              <div className="mt-3 space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Cantidad ({item.unit})</span>
                    <input
                      autoFocus
                      inputMode="decimal"
                      value={wasteQty}
                      onChange={(e) => setWasteQty(e.target.value)}
                      placeholder="0"
                      className="mt-1 w-full rounded-2xl border-2 border-[#ebe6df] bg-white px-4 py-3 font-display text-2xl font-bold tabular-nums text-[#3d2c24] focus:border-[#ea504c] focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Motivo</span>
                    <select
                      value={wasteReason}
                      onChange={(e) => setWasteReason(e.target.value as WasteReason)}
                      className="mt-1 w-full rounded-2xl border-2 border-[#ebe6df] bg-white px-3 py-3 text-sm text-[#3d2c24] focus:border-[#ea504c] focus:outline-none"
                    >
                      {WASTE_REASON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                </div>
                {showMoney && costoConfiable && Number(wasteQty.replace(',', '.')) > 0 && (
                  <p className="text-[12px] font-semibold text-[#ea504c]">
                    Se tiran ${Math.round(Number(wasteQty.replace(',', '.')) * (item.cost_per_unit ?? 0)).toLocaleString('es-AR')} (precio real)
                  </p>
                )}
                {showMoney && !costoConfiable && Number(wasteQty.replace(',', '.')) > 0 && (
                  <p className="text-[11px] text-[#a39e97]">
                    Sin costo real de este insumo: la merma no se valoriza en $.
                  </p>
                )}
                <textarea
                  value={wasteNote}
                  onChange={(e) => setWasteNote(e.target.value)}
                  rows={2}
                  placeholder="Detalle (opcional)"
                  className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm text-[#3d2c24] placeholder:text-[#a39e97] focus:border-[#ea504c] focus:outline-none"
                />
                <button
                  onClick={() => void saveWaste()}
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#ea504c] py-3 text-sm font-bold text-white shadow-sm active:scale-[0.98] disabled:opacity-50"
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Registrar merma
                </button>
              </div>
            )}

            {mode === 'config' && canConfigure && (
              <div className="mt-3">
                <MetadataEditor item={item} onSaved={() => { onUpdated(); onClose() }} onCancel={() => setMode('count')} />
              </div>
            )}

            <Link
              href={`/stock/item/${item.id}`}
              className="mt-3 flex items-center justify-between rounded-2xl bg-[#faf8f5] px-4 py-3 text-sm font-semibold text-[#3d2c24] ring-1 ring-[#ebe6df] active:scale-[0.99]"
            >
              <span>Ficha completa</span>
              <span className="flex items-center gap-1 text-[11px] font-medium text-[#a39e97]">
                Kardex · precios · recetas <ChevronRight className="size-4" />
              </span>
            </Link>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
