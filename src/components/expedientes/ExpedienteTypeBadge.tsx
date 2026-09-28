import { EXPEDIENTE_TYPES } from '@/lib/constants/expedientes'
import type { ExpedienteType } from '@/types/expedientes'

export function ExpedienteTypeBadge({ type }: { type: ExpedienteType }) {
  const config = EXPEDIENTE_TYPES[type]
  if (!config) return null

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap"
      style={{ color: config.color, backgroundColor: config.bg }}
    >
      {config.icon} {config.label}
    </span>
  )
}
