'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Bell, Plus, CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingState } from '@/components/ui/LoadingState'
import {
  NotificationCard,
  type NotificationCardData,
} from '@/components/notifications/NotificationCard'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import type { PriorityValue } from '@/types/database'
import { dispatchNotificationRead } from '@/lib/sounds'

// ---------------------------------------------------------------------------
// Filter configuration
// ---------------------------------------------------------------------------

const FILTER_TABS = [
  { value: 'todos', label: 'Todos' },
  { value: 'urgente', label: 'Urgente' },
  { value: 'recordatorio', label: 'Recordatorio' },
  { value: 'operativo', label: 'Operativo' },
  { value: 'general', label: 'General' },
] as const

type FilterTab = (typeof FILTER_TABS)[number]['value']

// Priority sort weight — higher = more important = shows first
const PRIORITY_WEIGHT: Record<PriorityValue, number> = {
  critica: 4,
  alta: 3,
  media: 2,
  baja: 1,
}

// ---------------------------------------------------------------------------
// Notifications Page
// ---------------------------------------------------------------------------

export default function NotificacionesPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [supabase] = useState(() => createClient())

  const [notifications, setNotifications] = useState<NotificationCardData[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<FilterTab>('todos')

  const canCreate =
    profile?.role === 'socio' || profile?.role === 'encargado' || profile?.role === 'chef'

  // ------------------------------------------
  // Fetch notifications
  // ------------------------------------------
  const fetchNotifications = useCallback(async () => {
    if (!profile) return
    setLoading(true)

    try {
      // Fetch announcements + read statuses in parallel
      const [annResult, readsResult] = await Promise.all([
        supabase.rpc('get_my_announcements'),
        supabase
          .from('announcement_reads')
          .select('announcement_id')
          .eq('user_id', profile.id),
      ])

      if (annResult.error) {
        console.error('Error al cargar avisos:', annResult.error.message ?? annResult.error)
        return
      }
      if (readsResult.error) {
        console.error('Error al cargar lecturas:', readsResult.error.message ?? readsResult.error)
      }

      const announcements = annResult.data ?? []
      const readSet = new Set((readsResult.data ?? []).map((r) => r.announcement_id))

      // Fetch author names for announcements
      const authorIds = [...new Set(announcements.map((a: any) => a.author_id).filter(Boolean))]
      let authorMap = new Map<string, { first_name: string; last_name: string }>()

      if (authorIds.length > 0) {
        const { data: authors } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', authorIds)

        authorMap = new Map((authors ?? []).map((a: any) => [a.id, a]))
      }

      const mapped: NotificationCardData[] = announcements.map((a: any) => {
        const author = authorMap.get(a.author_id)
        return {
          id: a.id,
          title: a.title,
          body: a.body,
          type: a.type,
          priority: a.priority,
          author_id: a.author_id,
          scope: a.scope,
          target_role: a.target_role,
          expires_at: a.expires_at,
          is_active: a.is_active,
          created_at: a.created_at,
          updated_at: a.updated_at,
          author: author
            ? { first_name: author.first_name, last_name: author.last_name }
            : null,
          is_read: readSet.has(a.id),
        }
      })

      setNotifications(mapped)
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err)
      console.error('Error al cargar notificaciones:', msg)
    } finally {
      setLoading(false)
    }
  }, [profile, supabase])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const [markingAll, setMarkingAll] = useState(false)

  // ------------------------------------------
  // Handle mark as read callback
  // ------------------------------------------
  const handleMarkedRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    )
    dispatchNotificationRead()
  }, [])

  // ------------------------------------------
  // Mark ALL as read
  // ------------------------------------------
  const handleMarkAllRead = useCallback(async () => {
    if (!profile || markingAll) return
    const unread = notifications.filter((n) => !n.is_read)
    if (unread.length === 0) return

    setMarkingAll(true)
    try {
      const rows = unread.map((n) => ({
        announcement_id: n.id,
        user_id: profile.id,
      }))
      const { error } = await supabase
        .from('announcement_reads')
        .upsert(rows, { onConflict: 'announcement_id,user_id' })

      if (error) throw error

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
      // Dispatch multiple times to zero out badge
      for (let i = 0; i < unread.length; i++) dispatchNotificationRead()
      toast.success(`${unread.length} marcadas como leídas`)
    } catch (err) {
      toast.error('Error al marcar como leídas')
    } finally {
      setMarkingAll(false)
    }
  }, [profile, notifications, supabase, markingAll])

  const unreadCount = useMemo(() => notifications.filter((n) => !n.is_read).length, [notifications])

  // ------------------------------------------
  // Filter + sort notifications
  // ------------------------------------------
  const sortedNotifications = useMemo(() => {
    const filtered =
      activeTab === 'todos'
        ? notifications
        : notifications.filter((n) => n.type === activeTab)

    // Sort: unread first, then by priority (critica > alta > media > baja),
    // then by date (newest first). Expired go to the bottom.
    return [...filtered].sort((a, b) => {
      const aExpired = a.expires_at ? new Date(a.expires_at) < new Date() : false
      const bExpired = b.expires_at ? new Date(b.expires_at) < new Date() : false

      // Expired notifications go last
      if (aExpired !== bExpired) return aExpired ? 1 : -1

      // Unread before read
      if (a.is_read !== b.is_read) return a.is_read ? 1 : -1

      // Higher priority first
      const aPrio = PRIORITY_WEIGHT[a.priority] ?? 0
      const bPrio = PRIORITY_WEIGHT[b.priority] ?? 0
      if (aPrio !== bPrio) return bPrio - aPrio

      // Newest first
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [notifications, activeTab])

  // ------------------------------------------
  // Loading
  // ------------------------------------------
  if (profileLoading || loading) {
    return <LoadingState message="Cargando notificaciones..." />
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-[#a39e97]">No se pudo cargar el perfil.</p>
      </div>
    )
  }

  // ------------------------------------------
  // Render
  // ------------------------------------------
  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-28">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#3d2c24]">
            Notificaciones
          </h1>
          <p className="section-label mt-1">
            Avisos y comunicados del equipo
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="flex items-center gap-1.5 rounded-xl bg-[#e8f5f1] px-3 py-2 text-xs font-semibold text-[#006d5a] transition-all hover:bg-[#c0e4da] active:scale-95 disabled:opacity-50"
          >
            <CheckCheck className="size-3.5" />
            {markingAll ? 'Marcando...' : 'Leer todas'}
          </button>
        )}
      </div>

      {/* Filter pill tabs — horizontal scrollable */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setActiveTab(tab.value)}
            className={`pill ${activeTab === tab.value ? 'pill-active' : 'pill-inactive'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Notification feed */}
      {sortedNotifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Sin notificaciones"
          description="¡Todo tranquilo por acá! No hay avisos pendientes."
          actionLabel="Ir al inicio"
          actionHref="/"
        />
      ) : (
        <div className="space-y-3.5">
          {sortedNotifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              currentUserId={profile.id}
              supabaseClient={supabase}
              onMarkedRead={handleMarkedRead}
            />
          ))}
        </div>
      )}

      {/* Floating create button (encargado / chef only) */}
      {canCreate && (
        <Link
          href="/notificaciones/nueva"
          className="fab"
          aria-label="Nueva notificación"
        >
          <Plus className="size-6" />
        </Link>
      )}
    </div>
  )
}
