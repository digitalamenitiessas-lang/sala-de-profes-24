import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'

export function RoleBadge({ role, size = 'sm' }: { role: AppRole; size?: 'sm' | 'md' }) {
  const config = ROLES[role]
  if (!config) return null

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold ${
        size === 'md' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
      }`}
      style={{ backgroundColor: config.bg, color: config.color }}
    >
      <span>{config.emoji}</span>
      {config.label}
    </span>
  )
}
