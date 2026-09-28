'use client'

import { useState } from 'react'
import { Search, ScrollText } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MENU_CATEGORIES } from '@/lib/constants'
import type { MenuCategory } from '@/lib/constants'
import type { MenuItem } from '@/types/database'
import { groupBy } from '@/lib/utils/group-by'

type AddFromMenuDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  menuItems: MenuItem[]
  onSelect: (menuItem: MenuItem) => void
}

export function AddFromMenuDialog({
  open,
  onOpenChange,
  menuItems,
  onSelect,
}: AddFromMenuDialogProps) {
  const [search, setSearch] = useState('')

  // Clear search when dialog closes
  function handleOpenChange(open: boolean) {
    if (!open) setSearch('')
    onOpenChange(open)
  }

  const filtered = menuItems.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.description?.toLowerCase().includes(search.toLowerCase()),
  )

  const grouped = groupBy(filtered, 'category')

  // Sort groups by sort_order of their first item
  const sortedGroups = Object.entries(grouped).sort(([, a], [, b]) => {
    return (a[0]?.sort_order ?? 0) - (b[0]?.sort_order ?? 0)
  })

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#3d2c24]">
            <ScrollText className="size-5 text-[#8b5e34]" />
            Agregar desde carta
          </DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
          <input
            type="text"
            placeholder="Buscar en la carta..."
            aria-label="Buscar item de la carta"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] pl-10 pr-4 text-sm text-[#3d2c24] outline-none placeholder:text-[#c4bfb8] focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]/20"
          />
        </div>

        {/* Menu items list */}
        <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
          {sortedGroups.map(([cat, catItems]) => {
            const catConfig =
              MENU_CATEGORIES[cat as MenuCategory] ?? MENU_CATEGORIES.entradas
            return (
              <div key={cat}>
                <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[#a39e97]">
                  {catConfig.icon} {catConfig.label}
                </span>
                <div className="space-y-1.5">
                  {catItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        onSelect(item)
                        setSearch('')
                      }}
                      className="flex w-full items-start gap-3 rounded-xl border border-[#ebe6df] bg-[#fefcf9] p-3 text-left transition-all hover:border-[#8b5e34]/30 hover:bg-[#faf0e4]/40"
                    >
                      <div
                        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-sm"
                        style={{
                          backgroundColor: catConfig.bg,
                          color: catConfig.color,
                        }}
                      >
                        {catConfig.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-[#3d2c24]">
                          {item.name}
                        </span>
                        {item.description && (
                          <p className="mt-0.5 text-xs text-[#a39e97] line-clamp-1">
                            {item.description}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.requires_preparation && (
                            <span className="rounded bg-[#fdf6ec] px-1.5 py-0.5 text-[10px] text-[#d4943a]">
                              Preparacion
                            </span>
                          )}
                          {item.track_stock && (
                            <span className="rounded bg-[#e8f5f1] px-1.5 py-0.5 text-[10px] text-[#006d5a]">
                              Control stock
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-[#a39e97]">
              No se encontraron items en la carta
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
