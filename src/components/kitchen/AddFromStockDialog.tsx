'use client'

import { useState } from 'react'
import { Search, Package } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { STOCK_CATEGORIES } from '@/lib/constants'
import type { StockCategory } from '@/lib/constants'
import type { StockItem } from '@/types/database'
import { groupBy } from '@/lib/utils/group-by'

type AddFromStockDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  stockItems: StockItem[]
  onSelect: (item: StockItem) => void
}

export function AddFromStockDialog({
  open,
  onOpenChange,
  stockItems,
  onSelect,
}: AddFromStockDialogProps) {
  const [search, setSearch] = useState('')

  // Clear search when dialog closes
  function handleOpenChange(open: boolean) {
    if (!open) setSearch('')
    onOpenChange(open)
  }

  const filtered = stockItems.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()),
  )

  const grouped = groupBy(filtered, 'category')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#3d2c24]">
            <Package className="size-5 text-[#006d5a]" />
            Agregar desde stock
          </DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
          <input
            type="text"
            placeholder="Buscar item de stock..."
            aria-label="Buscar item de stock"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] pl-10 pr-4 text-sm text-[#3d2c24] outline-none placeholder:text-[#c4bfb8] focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]/20"
          />
        </div>

        {/* Stock items list */}
        <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
          {Object.entries(grouped).map(([cat, catItems]) => {
            const catConfig =
              STOCK_CATEGORIES[cat as StockCategory] ?? STOCK_CATEGORIES.otros
            return (
              <div key={cat}>
                <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#a39e97]">
                  {catConfig.icon} {catConfig.label}
                </span>
                <div className="space-y-1.5">
                  {catItems.map((item) => {
                    const isLow = item.current_qty <= item.min_qty
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          onSelect(item)
                          setSearch('')
                        }}
                        className="flex w-full items-center gap-3 rounded-xl border border-[#ebe6df] bg-[#fefcf9] p-3 text-left transition-all hover:border-[#006d5a]/30 hover:bg-[#e8f5f1]/40"
                      >
                        <div className="flex-1">
                          <span className="text-sm font-semibold text-[#3d2c24]">
                            {item.name}
                          </span>
                          <div className="mt-0.5 text-xs text-[#a39e97]">
                            Stock: {item.current_qty} {item.unit}
                          </div>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            isLow
                              ? 'bg-[#fef2f2] text-[#ea504c]'
                              : 'bg-[#e8f5f1] text-[#006d5a]'
                          }`}
                        >
                          {isLow ? 'Bajo' : 'OK'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-[#a39e97]">
              No se encontraron items de stock
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
