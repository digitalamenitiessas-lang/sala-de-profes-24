import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Coffee, ArrowRight } from 'lucide-react'

type EmptyStateProps = {
  icon?: LucideIcon
  title: string
  description?: string
  /** Optional CTA button */
  actionLabel?: string
  actionHref?: string
  actionOnClick?: () => void
  /** Optional custom content below description */
  children?: ReactNode
}

export function EmptyState({
  icon: Icon = Coffee,
  title,
  description,
  actionLabel,
  actionHref,
  actionOnClick,
  children,
}: EmptyStateProps) {
  const actionButton = actionLabel ? (
    actionHref ? (
      <Link
        href={actionHref}
        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-95"
      >
        {actionLabel}
        <ArrowRight size={14} />
      </Link>
    ) : actionOnClick ? (
      <button
        onClick={actionOnClick}
        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-95"
      >
        {actionLabel}
        <ArrowRight size={14} />
      </button>
    ) : null
  ) : null

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#f0f7f5]">
        <Icon className="size-6 text-[#006d5a]/40" strokeWidth={1.5} />
      </div>
      <p className="text-[15px] font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {actionButton}
      {children}
    </div>
  )
}
