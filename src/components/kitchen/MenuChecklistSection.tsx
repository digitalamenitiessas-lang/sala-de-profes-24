'use client'

import { useMemo } from 'react'
import { Check, AlertTriangle } from 'lucide-react'
import { MENU_CATEGORIES, KITCHEN_UNITS } from '@/lib/constants'
import type { MenuItemCategoryValue } from '@/types/database'
import type { KitchenDailyItem, MenuItem, StockItem } from '@/types/database'
import { groupBy } from '@/lib/utils/group-by'

import { getStockSemaphore, type SemaphoreValue } from '@/lib/contracts/stock'

// ---------------------------------------------------------------------------
// Stock semaphore — imported from central contract
// ---------------------------------------------------------------------------

type Semaphore = SemaphoreValue

function getSemaphore(stock: StockItem): Semaphore {
  return getStockSemaphore(stock.current_qty, stock.min_qty)
}

const SEMAPHORE_STYLES: Record<Semaphore, string> = {
  green: 'bg-[#006d5a]',
  yellow: 'bg-[#d4943a]',
  red: 'bg-[#ea504c]',
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MenuChecklistSectionProps = {
  menuItems: MenuItem[]
  activeItems: KitchenDailyItem[]
  stockMap: Map<string, StockItem>
  isAlmuerzoCena: boolean
  canEdit: boolean
  onToggle: (menuItem: MenuItem) => void
  onUpdateActiveItem: (itemId: string, updates: Partial<KitchenDailyItem>) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MenuChecklistSection({
  menuItems,
  activeItems,
  stockMap,
  isAlmuerzoCena,
  canEdit,
  onToggle,
  onUpdateActiveItem,
}: MenuChecklistSectionProps) {
  // Group menu items by category
  const grouped = useMemo(() => groupBy(menuItems, 'category'), [menuItems])

  // Map of active menu_item_id → KitchenDailyItem for quick lookup
  const activeMap = useMemo(() => {
    const map = new Map<string | number, KitchenDailyItem>()
    for (const item of activeItems) {
      if (item.menu_item_id) map.set(item.menu_item_id, item)
    }
    return map
  }, [activeItems])

  // Stock summary for banner
  const stockSummary = useMemo(() => {
    let critical = 0
    let low = 0
    for (const mi of menuItems) {
      const stock = stockMap.get(mi.name.toLowerCase().trim())
      if (!stock) continue
      const sem = getSemaphore(stock)
      if (sem === 'red') critical++
      else if (sem === 'yellow') low++
    }
    return { critical, low }
  }, [menuItems, stockMap])

  // Order categories by MENU_CATEGORIES key order
  const categoryOrder = Object.keys(MENU_CATEGORIES) as MenuItemCategoryValue[]
  const sortedCategories = categoryOrder.filter((cat) => grouped[cat]?.length > 0)

  return (
    <div className="space-y-4">
      {/* Stock warning banner */}
      {(stockSummary.critical > 0 || stockSummary.low > 0) && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium ${
            stockSummary.critical > 0
              ? 'border-[#ea504c]/30 bg-[#fef2f2] text-[#ea504c]'
              : 'border-[#d4943a]/30 bg-[#fdf6ec] text-[#d4943a]'
          }`}
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            {stockSummary.critical > 0 && (
              <>{stockSummary.critical} item{stockSummary.critical > 1 ? 's' : ''} con stock critico</>
            )}
            {stockSummary.critical > 0 && stockSummary.low > 0 && ' · '}
            {stockSummary.low > 0 && (
              <>{stockSummary.low} item{stockSummary.low > 1 ? 's' : ''} con stock bajo</>
            )}
          </span>
        </div>
      )}

      {/* Categories */}
      {sortedCategories.map((cat) => {
        const catConfig = MENU_CATEGORIES[cat]
        const catItems = grouped[cat] || []

        return (
          <div key={cat}>
            {/* Category header */}
            <div className="mb-2 flex items-center gap-1.5">
              <span className="text-sm">{catConfig.icon}</span>
              <span
                className="text-[11px] font-bold uppercase tracking-wide"
                style={{ color: catConfig.color }}
              >
                {catConfig.label}
              </span>
              <span className="text-[10px] text-[#c4bfb8]">({catItems.length})</span>
            </div>

            {/* Items in category */}
            <div className="space-y-1.5">
              {catItems.map((mi) => {
                const activeItem = activeMap.get(mi.id)
                const isActive = !!activeItem
                const stock = stockMap.get(mi.name.toLowerCase().trim())
                const semaphore = stock ? getSemaphore(stock) : null

                return (
                  <MenuChecklistRow
                    key={mi.id}
                    menuItem={mi}
                    activeItem={activeItem}
                    isActive={isActive}
                    semaphore={semaphore}
                    stock={stock}
                    isAlmuerzoCena={isAlmuerzoCena}
                    canEdit={canEdit}
                    onToggle={() => onToggle(mi)}
                    onUpdate={onUpdateActiveItem}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// MenuChecklistRow — Individual checklist item
// ---------------------------------------------------------------------------

function MenuChecklistRow({
  menuItem,
  activeItem,
  isActive,
  semaphore,
  stock,
  isAlmuerzoCena,
  canEdit,
  onToggle,
  onUpdate,
}: {
  menuItem: MenuItem
  activeItem?: KitchenDailyItem
  isActive: boolean
  semaphore: Semaphore | null
  stock?: StockItem
  isAlmuerzoCena: boolean
  canEdit: boolean
  onToggle: () => void
  onUpdate: (itemId: string, updates: Partial<KitchenDailyItem>) => void
}) {
  function handleNumberChange(field: keyof KitchenDailyItem, raw: string) {
    if (!activeItem) return
    const value = raw === '' ? 0 : parseFloat(raw)
    if (isNaN(value)) return

    const updates: Partial<KitchenDailyItem> = { [field]: value }

    if (field === 'qty_current' || field === 'qty_sold') {
      const current = field === 'qty_current' ? value : activeItem.qty_current
      const sold = field === 'qty_sold' ? value : activeItem.qty_sold
      updates.qty_remaining = Math.max(0, current - sold)
    }

    onUpdate(activeItem._id, updates)
  }

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border transition-all ${
        isActive
          ? 'border-[#006d5a]/30 bg-[#fefcf9] shadow-sm'
          : 'border-[#ebe6df] bg-[#faf8f5]/60'
      }`}
    >
      <div className="flex">
        {/* Accent bar */}
        {isActive && (
          <div
            className="w-1 shrink-0"
            style={{ backgroundColor: isAlmuerzoCena ? '#006d5a' : '#d4943a' }}
          />
        )}

        <div className="flex-1 p-2.5">
          {/* Top row: checkbox + name + stock badge */}
          <div className="flex items-center gap-2">
            {/* Checkbox */}
            {canEdit ? (
              <button
                onClick={onToggle}
                aria-label={isActive ? `Desactivar ${menuItem.name}` : `Activar ${menuItem.name}`}
                className={`flex size-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                  isActive
                    ? 'border-[#006d5a] bg-[#006d5a] text-white'
                    : 'border-[#d5d0ca] bg-white hover:border-[#006d5a]/50'
                }`}
              >
                {isActive && <Check className="size-3.5" strokeWidth={3} />}
              </button>
            ) : (
              <div
                className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${
                  isActive
                    ? 'border-[#006d5a] bg-[#006d5a] text-white'
                    : 'border-[#d5d0ca] bg-white'
                }`}
              >
                {isActive && <Check className="size-3.5" strokeWidth={3} />}
              </div>
            )}

            {/* Name + description */}
            <div className="flex-1 min-w-0">
              <span
                className={`text-sm font-semibold ${
                  isActive ? 'text-[#3d2c24]' : 'text-[#a39e97]'
                }`}
              >
                {menuItem.name}
              </span>
              {menuItem.description && !isActive && (
                <p className="truncate text-[11px] text-[#c4bfb8]">
                  {menuItem.description}
                </p>
              )}
            </div>

            {/* Stock semaphore */}
            {semaphore && (
              <div className="flex items-center gap-1.5">
                {stock && semaphore !== 'green' && (
                  <span className="text-[10px] tabular-nums text-[#a39e97]">
                    {stock.current_qty}{stock.unit}
                  </span>
                )}
                <div
                  className={`size-2.5 rounded-full ${SEMAPHORE_STYLES[semaphore]}`}
                  title={
                    stock
                      ? `Stock: ${stock.current_qty} ${stock.unit} (min: ${stock.min_qty})`
                      : undefined
                  }
                />
              </div>
            )}
          </div>

          {/* Expanded details (only when active) */}
          {isActive && activeItem && (
            <>
              {menuItem.description && (
                <p className="mt-1 ml-7 text-[11px] text-[#a39e97] line-clamp-1">
                  {menuItem.description}
                </p>
              )}

              {isAlmuerzoCena && (
                /* Almuerzo/Cena: full tracking grid */
                <>
                  <div className="mt-2 ml-7 grid grid-cols-2 gap-2">
                    <CompactNumberField
                      label="Necesario"
                      value={activeItem.qty_needed}
                      unit={activeItem.unit}
                      canEdit={canEdit}
                      onChange={(v) => handleNumberChange('qty_needed', v)}
                    />
                    <CompactNumberField
                      label="Disponible"
                      value={activeItem.qty_current}
                      unit={activeItem.unit}
                      canEdit={canEdit}
                      onChange={(v) => handleNumberChange('qty_current', v)}
                    />
                    <CompactNumberField
                      label="Vendido"
                      value={activeItem.qty_sold}
                      unit={activeItem.unit}
                      canEdit={canEdit}
                      onChange={(v) => handleNumberChange('qty_sold', v)}
                    />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-medium text-[#a39e97]">Restante</span>
                      <div
                        className={`flex h-7 items-center rounded-lg border px-2 text-xs tabular-nums ${
                          activeItem.qty_remaining <= 0
                            ? 'border-[#ea504c]/30 bg-[#fef2f2] font-semibold text-[#ea504c]'
                            : activeItem.qty_needed > 0 &&
                                activeItem.qty_remaining < activeItem.qty_needed * 0.3
                              ? 'border-[#d4943a]/30 bg-[#fdf6ec] font-semibold text-[#d4943a]'
                              : 'border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24]'
                        }`}
                      >
                        {activeItem.qty_remaining}
                        <span className="ml-1 text-[10px] text-[#a39e97]">{activeItem.unit}</span>
                      </div>
                    </div>
                  </div>

                  {/* Unit selector */}
                  {canEdit && (
                    <div className="mt-1.5 ml-7">
                      <select
                        value={activeItem.unit}
                        onChange={(e) => onUpdate(activeItem._id, { unit: e.target.value })}
                        className="h-6 rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-2 text-[10px] text-[#a39e97] outline-none"
                      >
                        {KITCHEN_UNITS.map((u) => (
                          <option key={u.value} value={u.value}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </>
              )}

              {/* Desayuno/Merienda: no qty fields — just checklist */}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compact number input (smaller than KitchenItemRow version)
// ---------------------------------------------------------------------------

function CompactNumberField({
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
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-[#a39e97]">{label}</span>
      {canEdit ? (
        <div className="flex h-7 items-center rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-2">
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-transparent text-xs tabular-nums text-[#3d2c24] outline-none"
          />
          <span className="ml-1 shrink-0 text-[10px] text-[#a39e97]">{unit}</span>
        </div>
      ) : (
        <div className="flex h-7 items-center rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-2 text-xs tabular-nums text-[#3d2c24]">
          {value}
          <span className="ml-1 text-[10px] text-[#a39e97]">{unit}</span>
        </div>
      )}
    </div>
  )
}
