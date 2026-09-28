'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { Check, Clock, User, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { PriorityBadge } from '@/components/ui/PriorityBadge'
import { ANNOUNCEMENT_TYPES, PRIORITIES, type AnnouncementType } from '@/lib/constants'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, AnnouncementTypeValue, PriorityValue } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationCardData = {
  id: string
  title: string
  body: string
  type: AnnouncementTypeValue
  priority: PriorityValue
  author_id: string
  scope: 'all' | 'role' | 'user'
  target_role: string | null
  expires_at: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  author?: {
    first_name: string
    last_name: string
  } | null
  is_read?: boolean
}

type NotificationCardProps = {
  notification: NotificationCardData
  currentUserId: string
  supabaseClient: SupabaseClient<Database>
  onMarkedRead?: (id: string) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NotificationCard({
  notification,
  currentUserId,
  supabaseClient,
  onMarkedRead,
}: NotificationCardProps) {
  const [markingRead, setMarkingRead] = useState(false)

  const isRead = notification.is_read ?? false

  const typeConfig =
    ANNOUNCEMENT_TYPES[notification.type as AnnouncementType] ?? null

  const timeAgo = formatDistanceToNow(new Date(notification.created_at), {
    addSuffix: true,
    locale: es,
  })

  const isExpired =
    notification.expires_at && new Date(notification.expires_at) < new Date()

  const expiresLabel = notification.expires_at
    ? isExpired
      ? 'Expirado'
      : `Expira ${formatDistanceToNow(new Date(notification.expires_at), {
          addSuffix: true,
          locale: es,
        })}`
    : null

  const borderColor = PRIORITIES[notification.priority]?.color ?? '#006d5a'

  // Detect actionable notifications and provide direct link
  const actionLink = (() => {
    const t = notification.title.toLowerCase()
    const b = notification.body.toLowerCase()
    if (t.includes('expediente') || t.includes('tarea asignada') || t.includes('tarea completada')) {
      const codeMatch = notification.title.match(/LVE-\d{4}-\d{4}/i)
      const searchParam = codeMatch ? `?search=${codeMatch[0]}` : ''
      return { href: `/expedientes${searchParam}`, label: 'Ver expediente' }
    }
    if (t.includes('comentario en lve')) {
      const codeMatch = notification.title.match(/LVE-\d{4}-\d{4}/i)
      const searchParam = codeMatch ? `?search=${codeMatch[0]}` : ''
      return { href: `/expedientes${searchParam}`, label: 'Ver expediente' }
    }
    if (t.includes('pedido de cocina') || t.includes('pedido de barra') || b.includes('pedido fue enviado') || b.includes('ya llegó')) return { href: '/pedidos', label: 'Ver pedidos' }
    if (t.includes('stock') || t.includes('faltante')) return { href: '/stock', label: 'Ver stock' }
    if (t.includes('alerta')) return { href: '/alertas', label: 'Ver alertas' }
    return null
  })()

  // ------------------------------------------
  // Mark as read
  // ------------------------------------------
  const handleMarkRead = async () => {
    if (markingRead || isRead) return
    setMarkingRead(true)
    try {
      const { error } = await supabaseClient.from('announcement_reads').upsert(
        {
          announcement_id: notification.id,
          user_id: currentUserId,
        },
        { onConflict: 'announcement_id,user_id' },
      )

      if (error) throw error

      onMarkedRead?.(notification.id)
      toast.success('Marcado como leído')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al marcar como leído'
      toast.error('Error', { description: message })
    } finally {
      setMarkingRead(false)
    }
  }

  return (
    <div
      className={`rounded-2xl border bg-card transition-all duration-200 ${
        isRead ? 'opacity-50' : 'shadow-sm hover:shadow-md'
      } ${isExpired ? 'opacity-40' : ''}`}
      style={{ borderLeftWidth: '4px', borderLeftColor: borderColor }}
    >
      <div className="p-4 sm:p-5">
        {/* Badges row */}
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityBadge priority={notification.priority} />
          {typeConfig && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-secondary-foreground">
              {typeConfig.icon} {typeConfig.label}
            </span>
          )}
          {isExpired && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              Expirado
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="mt-2.5 text-[15px] font-semibold leading-snug text-foreground">
          {notification.title}
        </h3>

        {/* Body */}
        <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
          {notification.body}
        </p>

        {/* Action button */}
        {actionLink && (
          <Link
            href={actionLink.href}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-4 py-2 text-xs font-semibold text-white transition-all duration-150 hover:bg-[#005a4a] active:scale-95"
          >
            {actionLink.label}
            <ArrowRight size={14} />
          </Link>
        )}

        {/* Footer */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {notification.author && (
              <span className="flex items-center gap-1">
                <User className="size-3.5" />
                {notification.author.first_name} {notification.author.last_name}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" />
              {timeAgo}
            </span>
            {expiresLabel && !isExpired && (
              <span className="font-medium text-[#d4943a]">{expiresLabel}</span>
            )}
          </div>

          {!isRead && (
            <button
              disabled={markingRead}
              onClick={handleMarkRead}
              className="flex items-center gap-1.5 rounded-full bg-[#e8f5f1] px-3.5 py-1.5 text-xs font-semibold text-[#006d5a] transition-all duration-150 hover:bg-[#c0e4da] active:scale-95 disabled:opacity-50"
            >
              <Check className="size-3.5" />
              Leído
            </button>
          )}
          {isRead && (
            <span className="flex items-center gap-1 text-xs font-medium text-[#006d5a]">
              <Check className="size-3.5" />
              Leído
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
