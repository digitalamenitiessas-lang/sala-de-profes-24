'use client'

import { getSemaphore } from '@/components/stock/StockSemaphoreBadge'
import type { LowStockItem } from './types'

export function LowStockRow({ item }: { item: LowStockItem }) {
  const semaphore = getSemaphore(item.current_qty, item.min_qty)
  const isRed = semaphore === 'red'

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className={`size-1.5 shrink-0 rounded-full ${isRed ? 'bg-[#ea504c]' : 'bg-[#d4943a]'}`} />
        <span className={`truncate text-xs ${isRed ? 'font-semibold text-[#ea504c]' : 'text-[#3d2c24]'}`}>
          {item.name}
        </span>
      </div>
      <span className="shrink-0 text-[10px] font-semibold tabular-nums text-[#a39e97]">
        {item.current_qty} / {item.min_qty} {item.unit}
      </span>
    </div>
  )
}
