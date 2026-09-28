import { EXPEDIENTE_STATUSES } from '@/lib/constants/expedientes'
import type { ExpedienteStatus } from '@/types/expedientes'

export function ExpedienteStatusBadge({ status }: { status: ExpedienteStatus }) {
  const config = EXPEDIENTE_STATUSES[status]
  if (!config) return null

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={{ color: config.color, backgroundColor: config.bg }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: config.color }} />
      {config.label}
    </span>
  )
}
