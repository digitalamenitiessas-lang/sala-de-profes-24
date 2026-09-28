import Link from 'next/link'
import { formatDistanceToNow, isPast } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { Clock, User, Calendar, ChevronRight, UserCheck, AlertTriangle } from 'lucide-react'
import { ExpedienteStatusBadge } from './ExpedienteStatusBadge'
import { ExpedienteTypeBadge } from './ExpedienteTypeBadge'
import { ExpedienteAreaTags } from './ExpedienteAreaTags'
import { EXPEDIENTE_URGENCIES } from '@/lib/constants/expedientes'
import type { ExpedienteWithPeople } from '@/types/expedientes'

export function ExpedienteCard({ expediente }: { expediente: ExpedienteWithPeople }) {
  const urgencyConfig = EXPEDIENTE_URGENCIES[expediente.urgency]
  const borderColor = urgencyConfig?.color ?? '#a39e97'

  const timeAgo = formatDistanceToNow(new Date(expediente.created_at), {
    addSuffix: true,
    locale: es,
  })

  const authorName = expediente.author
    ? `${expediente.author.first_name ?? ''} ${expediente.author.last_name ?? ''}`.trim() || 'Sin nombre'
    : 'Desconocido'

  const responsibleName = expediente.responsible
    ? `${expediente.responsible.first_name ?? ''} ${expediente.responsible.last_name ?? ''}`.trim() || 'Sin nombre'
    : null

  const isClosed = ['cumplido', 'cerrado_sin_implementacion', 'archivado'].includes(expediente.status)
  const isOverdue = expediente.target_date && !isClosed && isPast(new Date(expediente.target_date))

  return (
    <Link
      href={`/expedientes/${expediente.id}`}
      className={`group block rounded-2xl border bg-card transition-all duration-200 hover:shadow-lg active:scale-[0.98] ${
        isClosed ? 'opacity-60' : ''
      }`}
      style={{ borderLeftWidth: '4px', borderLeftColor: borderColor }}
    >
      <div className="p-4 sm:p-5">
        {/* Top row: code + badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-[#1a1a2e]/8 px-2 py-0.5 font-mono text-[11px] font-bold text-[#1a1a2e]">
            {expediente.code}
          </span>
          <ExpedienteStatusBadge status={expediente.status} />
          <ExpedienteTypeBadge type={expediente.type} />
        </div>

        {/* Title */}
        <h3 className="mt-2.5 text-[15px] font-semibold leading-snug text-foreground line-clamp-2">
          {expediente.title}
        </h3>

        {/* Description preview */}
        {expediente.description && (
          <p className="mt-1 text-[13px] text-muted-foreground line-clamp-1">
            {expediente.description}
          </p>
        )}

        {/* Areas */}
        {expediente.areas.length > 0 && (
          <div className="mt-2.5">
            <ExpedienteAreaTags areas={expediente.areas} />
          </div>
        )}

        {/* Overdue warning */}
        {isOverdue && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-[#ea504c]">
            <AlertTriangle className="size-3" />
            Vencido
          </div>
        )}

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/50 pt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <User className="size-3.5" />
              {authorName}
            </span>
            {responsibleName && (
              <span className="flex items-center gap-1 font-medium text-[#006d5a]">
                <UserCheck className="size-3.5" />
                {responsibleName}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              {timeAgo}
            </span>
            {expediente.target_date && (
              <span className={`flex items-center gap-1 ${isOverdue ? 'font-semibold text-[#ea504c]' : ''}`}>
                <Calendar className="size-3.5" />
                {new Date(expediente.target_date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
              </span>
            )}
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  )
}
