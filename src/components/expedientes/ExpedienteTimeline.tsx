'use client'

import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { MessageSquare, ArrowRightLeft, UserCheck, Star, Pencil } from 'lucide-react'
import type { CommentWithAuthor, ExpedienteCommentType } from '@/types/expedientes'

const TYPE_CONFIG: Record<ExpedienteCommentType, { icon: typeof MessageSquare; label: string; muted: boolean }> = {
  comment:           { icon: MessageSquare,  label: 'Comentario',   muted: false },
  status_change:     { icon: ArrowRightLeft, label: 'Estado',       muted: true },
  assignment_change: { icon: UserCheck,      label: 'Asignación',   muted: true },
  priority_change:   { icon: Star,           label: 'Prioridad',    muted: true },
  edit:              { icon: Pencil,         label: 'Edición',      muted: true },
}

export function ExpedienteTimeline({ comments }: { comments: CommentWithAuthor[] }) {
  if (!comments.length) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Sin actividad todavía
      </p>
    )
  }

  return (
    <div className="relative space-y-0">
      {/* Vertical line */}
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

      {comments.map((comment) => {
        const config = TYPE_CONFIG[comment.type] ?? TYPE_CONFIG.comment
        const Icon = config.icon
        const authorName = comment.author
          ? `${comment.author.first_name} ${comment.author.last_name}`
          : 'Sistema'

        const timeAgo = formatDistanceToNow(new Date(comment.created_at), {
          addSuffix: true,
          locale: es,
        })

        return (
          <div key={comment.id} className="relative flex gap-3 py-3">
            {/* Icon dot */}
            <div
              className={`relative z-10 flex size-[30px] shrink-0 items-center justify-center rounded-full border ${
                config.muted
                  ? 'border-border bg-muted'
                  : 'border-[#006d5a]/20 bg-[#e8f5f1]'
              }`}
            >
              <Icon className={`size-3.5 ${config.muted ? 'text-muted-foreground' : 'text-[#006d5a]'}`} />
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-[11px]">
                <span className={`font-semibold ${config.muted ? 'text-muted-foreground' : 'text-foreground'}`}>
                  {authorName}
                </span>
                <span className="text-muted-foreground">{timeAgo}</span>
              </div>
              <p className={`mt-0.5 text-sm leading-relaxed ${
                config.muted ? 'text-muted-foreground italic' : 'text-foreground'
              }`}>
                {comment.body}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
