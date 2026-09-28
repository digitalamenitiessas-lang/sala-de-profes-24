import type { PriorityValue } from '@/types/database'

const PRIORITY_STYLES: Record<PriorityValue, { dot: string; text: string; bg: string; label: string }> = {
  baja:    { dot: 'bg-[#006d5a]', text: 'text-[#006d5a]', bg: 'bg-[#e8f5f1]', label: 'Baja' },
  media:   { dot: 'bg-[#d4943a]', text: 'text-[#9a6d28]', bg: 'bg-[#fdf6ec]', label: 'Media' },
  alta:    { dot: 'bg-[#ea504c]', text: 'text-[#c42b28]', bg: 'bg-[#fef2f2]', label: 'Alta' },
  critica: { dot: 'bg-[#c42b28]', text: 'text-[#c42b28]', bg: 'bg-[#fce8e8]', label: 'Crítica' },
}

export function PriorityBadge({ priority }: { priority: PriorityValue }) {
  const style = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.baja

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${style.text} ${style.bg}`}
    >
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  )
}
