import { cn } from '@/lib/utils'
import { getStockSemaphore, type SemaphoreValue } from '@/lib/contracts/stock'

// Re-export for backward compatibility
export { getStockSemaphore as getSemaphore, type SemaphoreValue }

const CONFIG: Record<SemaphoreValue, { label: string; dot: string; text: string; bg: string }> = {
  green:  { label: 'Normal',   dot: 'bg-[#006d5a]', text: 'text-[#006d5a]', bg: 'bg-[#f0f7f5]' },
  yellow: { label: 'Atención', dot: 'bg-[#d4943a]', text: 'text-[#9a6d28]', bg: 'bg-[#fdf6ec]' },
  red:    { label: 'Crítico',  dot: 'bg-[#ea504c]', text: 'text-[#c42b28]', bg: 'bg-[#fef2f2]' },
}

export function StockSemaphoreBadge({
  semaphore,
  className,
}: {
  semaphore: SemaphoreValue
  className?: string
}) {
  const c = CONFIG[semaphore]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
        c.bg,
        c.text,
        className,
      )}
    >
      <span className={cn('size-2 rounded-full', c.dot)} />
      {c.label}
    </span>
  )
}
