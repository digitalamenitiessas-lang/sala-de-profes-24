import { EXPEDIENTE_AREAS } from '@/lib/constants/expedientes'
import type { ExpedienteArea } from '@/types/expedientes'

export function ExpedienteAreaTags({ areas }: { areas: ExpedienteArea[] }) {
  if (!areas?.length) return null

  return (
    <div className="flex flex-wrap gap-1">
      {areas.map((area) => {
        const config = EXPEDIENTE_AREAS[area]
        if (!config) return null
        return (
          <span
            key={area}
            className="inline-flex items-center gap-0.5 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
          >
            {config.icon} {config.label}
          </span>
        )
      })}
    </div>
  )
}
