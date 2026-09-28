'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowRight, Clock, Info } from 'lucide-react'
import type { OperationalAction } from '@/lib/actions/operational'

const PRIORITY_STYLES = {
  alta: {
    border: 'border-[#ea504c]/30',
    bg: 'bg-[#fef2f2]',
    icon: 'text-[#ea504c]',
    title: 'text-[#ea504c]',
    IconComponent: AlertTriangle,
  },
  media: {
    border: 'border-[#d4943a]/30',
    bg: 'bg-[#fdf6ec]',
    icon: 'text-[#d4943a]',
    title: 'text-[#d4943a]',
    IconComponent: Clock,
  },
  baja: {
    border: 'border-[#006d5a]/20',
    bg: 'bg-[#f0f7f5]',
    icon: 'text-[#006d5a]',
    title: 'text-[#006d5a]',
    IconComponent: Info,
  },
} as const

type ActionBannerProps = {
  actions: OperationalAction[]
  max?: number
  compact?: boolean
}

export function ActionBanner({ actions, max = 5, compact = false }: ActionBannerProps) {
  if (actions.length === 0) return null

  const visible = actions.slice(0, max)
  const remaining = actions.length - max

  if (compact) {
    return (
      <div className="space-y-1.5">
        {visible.map((action) => {
          const style = PRIORITY_STYLES[action.priority]
          const Icon = style.IconComponent
          return (
            <Link
              key={action.id}
              href={action.href}
              className={`flex items-center gap-2 rounded-lg border ${style.border} ${style.bg} px-3 py-2 transition-colors hover:opacity-80`}
            >
              <Icon className={`size-3.5 shrink-0 ${style.icon}`} />
              <span className={`flex-1 truncate text-xs font-medium ${style.title}`}>
                {action.title}
              </span>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
            </Link>
          )
        })}
        {remaining > 0 && (
          <p className="text-center text-[10px] text-muted-foreground">
            +{remaining} acción{remaining > 1 ? 'es' : ''} más
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {visible.map((action) => {
        const style = PRIORITY_STYLES[action.priority]
        const Icon = style.IconComponent
        return (
          <Link
            key={action.id}
            href={action.href}
            className={`flex items-center gap-3 rounded-xl border ${style.border} ${style.bg} px-4 py-3 transition-all hover:shadow-sm`}
          >
            <Icon className={`size-4 shrink-0 ${style.icon}`} />
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-semibold ${style.title}`}>{action.title}</p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{action.description}</p>
            </div>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        )
      })}
      {remaining > 0 && (
        <p className="text-center text-[10px] text-muted-foreground">
          +{remaining} acción{remaining > 1 ? 'es' : ''} pendiente{remaining > 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
