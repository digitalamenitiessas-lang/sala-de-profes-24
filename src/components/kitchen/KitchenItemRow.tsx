'use client'

import { X, ChefHat, Package, ScrollText } from 'lucide-react'
import { KITCHEN_UNITS } from '@/lib/constants'
import type { KitchenDailyItem } from '@/types/database'

type KitchenItemRowProps = {
  item: KitchenDailyItem
  index: number
  isAlmuerzoCena: boolean
  canEdit: boolean
  onUpdate: (index: number, updated: Partial<KitchenDailyItem>) => void
  onRemove: (index: number) => void
}

export function KitchenItemRow({
  item,
  index,
  isAlmuerzoCena,
  canEdit,
  onUpdate,
  onRemove,
}: KitchenItemRowProps) {
  function handleNumberChange(field: keyof KitchenDailyItem, raw: string) {
    const value = raw === '' ? 0 : parseFloat(raw)
    if (isNaN(value)) return

    const updates: Partial<KitchenDailyItem> = { [field]: value }

    // Auto-calculate remaining when qty_current or qty_sold changes
    if (field === 'qty_current' || field === 'qty_sold') {
      const current = field === 'qty_current' ? value : item.qty_current
      const sold = field === 'qty_sold' ? value : item.qty_sold
      updates.qty_remaining = Math.max(0, current - sold)
    }

    onUpdate(index, updates)
  }

  return (
    <div className="card-elevated group relative overflow-hidden rounded-xl">
      <div className="flex">
        {/* Accent bar */}
        <div
          className="w-1 shrink-0"
          style={{ backgroundColor: isAlmuerzoCena ? '#006d5a' : '#d4943a' }}
        />

        <div className="flex-1 p-3">
          {/* Header: name + badges + remove */}
          <div className="flex items-center gap-2">
            {canEdit ? (
              <input
                type="text"
                value={item.name}
                onChange={(e) => onUpdate(index, { name: e.target.value })}
                placeholder="Nombre del item..."
                className="flex-1 bg-transparent text-sm font-semibold text-[#3d2c24] outline-none placeholder:text-[#c4bfb8]"
              />
            ) : (
              <span className="flex-1 text-sm font-semibold text-[#3d2c24]">
                {item.name}
              </span>
            )}

            {item.is_from_recipe && (
              <ChefHat className="size-3.5 text-[#d4943a]" />
            )}
            {item.stock_item_id && (
              <Package className="size-3.5 text-[#006d5a]" />
            )}
            {item.is_from_menu && (
              <ScrollText className="size-3.5 text-[#8b5e34]" />
            )}

            {canEdit && (
              <button
                onClick={() => onRemove(index)}
                aria-label={`Eliminar ${item.name || 'item'}`}
                className="flex size-6 items-center justify-center rounded-lg text-[#a39e97] opacity-0 transition-all hover:bg-[#fef2f2] hover:text-[#ea504c] group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Fields */}
          {isAlmuerzoCena ? (
            /* Almuerzo/Cena: full tracking grid */
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <NumberField
                label="Necesario"
                value={item.qty_needed}
                unit={item.unit}
                canEdit={canEdit}
                onChange={(v) => handleNumberChange('qty_needed', v)}
              />
              <NumberField
                label="Disponible"
                value={item.qty_current}
                unit={item.unit}
                canEdit={canEdit}
                onChange={(v) => handleNumberChange('qty_current', v)}
              />
              <NumberField
                label="Vendido"
                value={item.qty_sold}
                unit={item.unit}
                canEdit={canEdit}
                onChange={(v) => handleNumberChange('qty_sold', v)}
              />
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-medium text-[#a39e97]">
                  Restante
                </span>
                <div
                  className={`flex h-8 items-center rounded-lg border px-2 text-sm tabular-nums ${
                    item.qty_remaining <= 0
                      ? 'border-[#ea504c]/30 bg-[#fef2f2] font-semibold text-[#ea504c]'
                      : item.qty_needed > 0 && item.qty_remaining < item.qty_needed * 0.3
                        ? 'border-[#d4943a]/30 bg-[#fdf6ec] font-semibold text-[#d4943a]'
                        : 'border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24]'
                  }`}
                >
                  {item.qty_remaining}
                  <span className="ml-1 text-[10px] text-[#a39e97]">{item.unit}</span>
                </div>
              </div>
            </div>
          ) : (
            /* Desayuno/Merienda: simple row */
            <div className="mt-2 flex items-center gap-2">
              <NumberField
                label="Cantidad"
                value={item.qty_needed}
                unit={item.unit}
                canEdit={canEdit}
                onChange={(v) => handleNumberChange('qty_needed', v)}
              />
              {canEdit && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium text-[#a39e97]">Unidad</span>
                  <select
                    value={item.unit}
                    onChange={(e) => onUpdate(index, { unit: e.target.value })}
                    className="h-8 rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-2 text-xs text-[#3d2c24] outline-none"
                  >
                    {KITCHEN_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Unit selector for almuerzo_cena */}
          {isAlmuerzoCena && canEdit && (
            <div className="mt-2">
              <select
                value={item.unit}
                onChange={(e) => onUpdate(index, { unit: e.target.value })}
                className="h-7 rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-2 text-[11px] text-[#a39e97] outline-none"
              >
                {KITCHEN_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline number input
// ---------------------------------------------------------------------------

function NumberField({
  label,
  value,
  unit,
  canEdit,
  onChange,
}: {
  label: string
  value: number
  unit: string
  canEdit: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-[#a39e97]">{label}</span>
      {canEdit ? (
        <div className="flex h-8 items-center rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-2">
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-transparent text-sm tabular-nums text-[#3d2c24] outline-none"
          />
          <span className="ml-1 shrink-0 text-[10px] text-[#a39e97]">{unit}</span>
        </div>
      ) : (
        <div className="flex h-8 items-center rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-2 text-sm tabular-nums text-[#3d2c24]">
          {value}
          <span className="ml-1 text-[10px] text-[#a39e97]">{unit}</span>
        </div>
      )}
    </div>
  )
}
