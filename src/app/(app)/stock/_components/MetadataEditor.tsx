'use client'

import { useState, useEffect } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { StockItem } from '@/lib/hooks/use-stock'
import { STOCK_CATEGORY_OPTIONS, STOCK_UNITS } from '@/lib/constants'
import { STOCK_AREAS, areaFromLveCategory, type StockArea } from '@/lib/stock/areas'
import { esCostoConfiable, etiquetaFuenteCosto } from '@/lib/costos/confiable'
import type { StockCategoryValue } from '@/types/database'

type Props = {
  item: StockItem
  initialShelfLife?: number | null
  initialCategory?: StockCategoryValue | null
  onSaved: () => void
  onCancel: () => void
}

// ---------------------------------------------------------------------------
// Configuración de un insumo: lo que Fudo NO tiene (mínimo operativo, área,
// vida útil, nota) más la unidad/categoría por si hay que corregirlas.
// ---------------------------------------------------------------------------

export function MetadataEditor({ item, initialShelfLife, initialCategory, onSaved, onCancel }: Props) {
  const [metaShelfLife, setMetaShelfLife] = useState(String(initialShelfLife ?? item.shelf_life_days ?? ''))
  const [metaCategory, setMetaCategory] = useState<StockCategoryValue | ''>(initialCategory ?? item.category)
  const [metaNotes, setMetaNotes] = useState(item.notes ?? '')
  const [metaUnit, setMetaUnit] = useState(item.unit ?? 'kg')
  const [metaMin, setMetaMin] = useState(String(item.min_qty ?? 0))
  const [metaArea, setMetaArea] = useState<StockArea>(item.area ?? areaFromLveCategory(item.category))
  // Costo real: se muestra el vigente solo si su fuente es confiable; el costo
  // de Fudo NO se precarga (sería consagrar un número no real con un Enter).
  const costConfiable = esCostoConfiable(item.cost_source, item.cost_per_unit)
  const initialCost = costConfiable && item.cost_per_unit != null ? String(item.cost_per_unit) : ''
  const [metaCost, setMetaCost] = useState(initialCost)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMetaShelfLife(String(initialShelfLife ?? item.shelf_life_days ?? ''))
    setMetaCategory(initialCategory ?? item.category)
    setMetaNotes(item.notes ?? '')
    setMetaUnit(item.unit ?? 'kg')
    setMetaMin(String(item.min_qty ?? 0))
    setMetaArea(item.area ?? areaFromLveCategory(item.category))
    setMetaCost(esCostoConfiable(item.cost_source, item.cost_per_unit) && item.cost_per_unit != null ? String(item.cost_per_unit) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const handleSave = async () => {
    setSaving(true)
    try {
      const shelfLife = metaShelfLife.trim()
      const minValue = Number(metaMin.replace(',', '.'))
      const payload: Record<string, unknown> = {
        shelf_life_days: shelfLife ? Number(shelfLife) : null,
        category: metaCategory || undefined,
        notes: metaNotes.trim() || null,
        unit: metaUnit,
        min_qty: Number.isFinite(minValue) && minValue >= 0 ? minValue : 0,
      }
      if (metaArea !== (item.area ?? areaFromLveCategory(item.category))) payload.area = metaArea

      // Costo real: mandar SOLO si lo tocaron (así no se re-sella 'manual'
      // sobre un costo de compra vigente sin querer)
      const costTrimmed = metaCost.trim().replace(',', '.')
      if (costTrimmed !== initialCost) {
        if (costTrimmed === '') {
          payload.cost_per_unit = null
        } else {
          const costValue = Number(costTrimmed)
          if (!Number.isFinite(costValue) || costValue <= 0) {
            throw new Error('El costo real debe ser un número mayor a 0')
          }
          payload.cost_per_unit = costValue
        }
      }

      const res = await fetch(`/api/stock/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar la configuración')

      if (data.aviso) toast.warning(data.aviso)
      toast.success('Configuración guardada')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar configuración')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-lg border border-[#e6dfd7] bg-white px-2.5 py-2 text-sm text-[#3d2c24] focus:border-[#006d5a] focus:outline-none'
  const labelCls = 'text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]'

  return (
    <div className="space-y-3 rounded-2xl bg-[#faf8f5] px-3 py-3 ring-1 ring-[#ebe6df]">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className={labelCls}>Mínimo operativo</span>
          <div className="flex items-center gap-1.5">
            <input
              value={metaMin}
              onChange={(e) => setMetaMin(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className={inputCls}
            />
            <span className="shrink-0 text-[11px] text-[#7d6c64]">{metaUnit}</span>
          </div>
        </label>

        <label className="space-y-1">
          <span className={labelCls}>Área</span>
          <select value={metaArea} onChange={(e) => setMetaArea(e.target.value as StockArea)} className={inputCls}>
            {STOCK_AREAS.map((a) => (
              <option key={a.value} value={a.value}>{a.icon} {a.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className={labelCls}>Unidad</span>
          <select value={metaUnit} onChange={(e) => setMetaUnit(e.target.value)} className={inputCls}>
            {STOCK_UNITS.map((u) => (
              <option key={u.value} value={u.value}>{u.value}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className={labelCls}>Vida útil (días)</span>
          <input
            value={metaShelfLife}
            onChange={(e) => setMetaShelfLife(e.target.value)}
            inputMode="numeric"
            placeholder="Ej. 7"
            className={inputCls}
          />
        </label>

        <label className="space-y-1">
          <span className={labelCls}>Categoría</span>
          <select
            value={metaCategory}
            onChange={(e) => setMetaCategory(e.target.value as StockCategoryValue)}
            className={inputCls}
          >
            <option value="" disabled>Elegir</option>
            {STOCK_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1">
        <span className={labelCls}>Costo real por {metaUnit}</span>
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-[11px] text-[#7d6c64]">$</span>
          <input
            value={metaCost}
            onChange={(e) => setMetaCost(e.target.value)}
            inputMode="decimal"
            placeholder={costConfiable ? '' : 'sin costo real'}
            className={`${inputCls} placeholder:text-[#a39e97]`}
          />
        </div>
        <span className="block text-[10px] leading-snug text-[#a39e97]">
          {costConfiable
            ? `Fuente actual: ${etiquetaFuenteCosto(item.cost_source)}. Si lo cambiás acá queda como cargado a mano.`
            : item.cost_per_unit != null && item.cost_per_unit > 0
              ? `Hay un costo según Fudo (${`$${Math.round(item.cost_per_unit).toLocaleString('es-AR')}`}) que no se usa por no ser real. Cargá el precio de verdad si lo sabés.`
              : 'Se completa solo al recibir una compra con precio, o cargalo acá si lo sabés.'}
        </span>
      </label>

      <label className="block space-y-1">
        <span className={labelCls}>Nota operativa</span>
        <textarea
          value={metaNotes}
          onChange={(e) => setMetaNotes(e.target.value)}
          rows={2}
          placeholder="Ej. se pide los lunes, marca preferida, dónde se guarda"
          className={`${inputCls} placeholder:text-[#a39e97]`}
        />
      </label>

      {(item.fudo_ingredient_id || item.fudo_product_id) && (
        <p className="text-[11px] leading-relaxed text-[#a39e97]">
          Cantidad y unidad vienen de Fudo. Acá se define lo que Fudo no sabe: mínimo, área, vida útil y el costo real.
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg px-2.5 py-2 text-[11px] font-semibold text-[#7d6c64] hover:bg-[#f3efe9]">
          Cancelar
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center gap-1 rounded-lg bg-[#3d2c24] px-3 py-2 text-[11px] font-semibold text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Guardar
        </button>
      </div>
    </div>
  )
}
