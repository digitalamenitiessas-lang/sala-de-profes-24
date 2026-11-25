'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useProfileContext } from '@/lib/hooks/use-profile'
import {
  Clock,
  MoreHorizontal,
  X,
} from 'lucide-react'
import { mustClockIn, isManagerOrAbove } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { getAllMoreItems, getNavItems } from '@/lib/navegacion'
import { createClient } from '@/lib/supabase/client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, StaggerList, StaggerItem } from '@/components/ui/motion'
import { onNotificationRead } from '@/lib/sounds'

// El menú de cada rol (barra de abajo y "Más") vive en lib/navegacion: lo usa
// también La Vieja de Historia para guiar con las pantallas reales.

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BottomNav() {
  const pathname = usePathname()
  const { profile } = useProfileContext()
  const [moreOpen, setMoreOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [stockAlertCount, setStockAlertCount] = useState(0)

  const nav = getNavItems(profile?.role)
  const more = nav.more
  // Si un socio también ficha, mantenemos 4 accesos máximos para no saturar la barra.
  const items = profile?.role === 'socio' && mustClockIn(profile)
    ? [nav.items[0], { label: 'Mi Turno', href: '/mi-turno', icon: Clock }, ...nav.items.slice(1, 3)]
    : nav.items

  // Fetch unread notification count
  const fetchUnread = useCallback(async () => {
    if (!profile) return
    try {
      const supabase = createClient()
      const [annResult, readsResult] = await Promise.all([
        supabase.rpc('get_my_announcements'),
        supabase
          .from('announcement_reads')
          .select('announcement_id')
          .eq('user_id', profile.id),
      ])
      if (annResult.error || !annResult.data) return
      const readSet = new Set((readsResult.data ?? []).map((r) => r.announcement_id))
      const unread = (annResult.data as { id: string }[]).filter((a) => !readSet.has(a.id)).length
      setUnreadCount(unread)
    } catch {
      // Silently fail — badge will show stale count
    }
  }, [profile])

  useEffect(() => {
    const firstFetch = window.setTimeout(() => {
      void fetchUnread()
    }, 0)
    const interval = setInterval(fetchUnread, 60_000)
    return () => {
      window.clearTimeout(firstFetch)
      clearInterval(interval)
    }
  }, [fetchUnread])

  // Badge de stock crítico — solo encargados/socios
  useEffect(() => {
    if (!profile || !isManagerOrAbove(profile.role)) return
    async function fetchStockAlerts() {
      try {
        const res = await fetch('/api/stock/alertas')
        if (!res.ok) return
        const d = await res.json() as { count?: number }
        setStockAlertCount(d.count ?? 0)
      } catch { /* silencioso */ }
    }
    const t = window.setTimeout(() => { void fetchStockAlerts() }, 500)
    const iv = setInterval(() => { void fetchStockAlerts() }, 60_000)
    return () => { window.clearTimeout(t); clearInterval(iv) }
  }, [profile])

  // Immediately decrement badge when a notification is marked as read
  useEffect(() => {
    return onNotificationRead(() => {
      setUnreadCount((prev) => Math.max(0, prev - 1))
    })
  }, [])

  useEffect(() => {
    if (pathname === '/notificaciones') {
      const timer = setTimeout(fetchUnread, 2000)
      return () => clearTimeout(timer)
    }
  }, [pathname, fetchUnread])

  // Close on Escape
  useEffect(() => {
    if (!moreOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [moreOpen])

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  function isMoreActive() {
    if (!more) return false
    return getAllMoreItems(more).some((child) => isActive(child.href))
  }

  return (
    <>
      {/* "More" overlay panel — animated */}
      <AnimatePresence>
        {moreOpen && more && (
          <motion.div
            className="fixed inset-0 z-40"
            onClick={() => setMoreOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="absolute inset-0 bg-black/20 backdrop-blur-[3px]" />
            <motion.div
              className="absolute bottom-[4.5rem] left-3 right-3 max-h-[72vh] overflow-y-auto rounded-2xl border border-[#ebe6df] bg-[#fefcf9]/95 p-4 shadow-xl backdrop-blur-xl"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <div>
                  <span className="section-label">Más opciones</span>
                  <p className="mt-1 text-xs leading-snug text-muted-foreground">
                    Lo que más usás está fijo abajo. Acá va el resto.
                  </p>
                </div>
                <motion.button
                  onClick={() => setMoreOpen(false)}
                  aria-label="Cerrar"
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary"
                  whileTap={{ scale: 0.85 }}
                >
                  <X className="size-4" />
                </motion.button>
              </div>
              <StaggerList className="space-y-3" staggerDelay={0.03}>
                {more.groups.map((group) => (
                  <StaggerItem key={group.label || 'default'}>
                    {group.label && (
                      <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
                        {group.label}
                      </p>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.items.map((child) => {
                        const Icon = child.icon
                        const active = isActive(child.href)
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            onClick={() => setMoreOpen(false)}
                            className={cn(
                              'flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all active:scale-[0.98]',
                              active
                                ? 'border-[#006d5a] bg-[#006d5a] text-white'
                                : 'border-[#ebe6df] bg-white text-[#3d2c24] hover:border-[#cfe4dd] hover:bg-[#f7fbf9]',
                            )}
                          >
                            <span
                              className={cn(
                                'flex size-10 shrink-0 items-center justify-center rounded-xl',
                                active ? 'bg-white/15' : 'bg-[#f0f7f5] text-[#006d5a]',
                              )}
                            >
                              <Icon className="size-5" strokeWidth={1.75} />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold leading-tight">
                                {child.label}
                              </span>
                              {child.description && (
                                <span
                                  className={cn(
                                    'mt-0.5 block text-[11px] leading-snug',
                                    active ? 'text-white/75' : 'text-muted-foreground',
                                  )}
                                >
                                  {child.description}
                                </span>
                              )}
                            </span>
                          </Link>
                        )
                      })}
                    </div>
                  </StaggerItem>
                ))}
              </StaggerList>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation bar */}
      {/* Capa propia (transform-gpu): en páginas largas y con muchas animaciones
          (Compras) el celular redibujaba la barra con atraso al scrollear y
          parecía que "se levantaba" en medio del scroll. */}
      <nav
        aria-label="Navegacion principal"
        className="fixed bottom-0 left-0 right-0 z-50 transform-gpu border-t border-border/60 bg-[#fefcf9] pb-[env(safe-area-inset-bottom)] [backface-visibility:hidden]"
      >
        <div className="flex h-[4.25rem] items-center justify-around px-1">
          {items.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            const showBadge = item.href === '/notificaciones' && unreadCount > 0
            const showStockBadge = item.href === '/stock' && stockAlertCount > 0
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-all active:scale-90',
                  active
                    ? 'text-[#006d5a]'
                    : 'text-[#a39e97] hover:text-foreground',
                )}
              >
                <div className="relative flex size-11 items-center justify-center rounded-xl transition-all">
                  {/* Animated active background */}
                  {active && (
                    <motion.div
                      layoutId="nav-active-bg"
                      className="absolute inset-0 rounded-xl bg-[#e8f5f1]"
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                  <Icon
                    className="relative size-[22px]"
                    strokeWidth={active ? 2.25 : 1.75}
                  />
                  {showBadge && (
                    <span className="absolute -right-1.5 -top-1 flex size-4.5 items-center justify-center rounded-full bg-[#ea504c] text-[9px] font-bold text-white shadow-sm">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                  {showStockBadge && (
                    <span className="absolute -right-1.5 -top-1 flex size-4.5 items-center justify-center rounded-full bg-[#ea504c] text-[9px] font-bold text-white shadow-sm">
                      {stockAlertCount > 9 ? '9+' : stockAlertCount}
                    </span>
                  )}
                </div>
                <span className="truncate">{item.label}</span>
              </Link>
            )
          })}

          {more && (
            <button
              onClick={() => setMoreOpen(!moreOpen)}
              aria-expanded={moreOpen}
              aria-label="Mas opciones"
              className={cn(
                'relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-all active:scale-90',
                moreOpen || isMoreActive()
                  ? 'text-[#006d5a]'
                  : 'text-[#a39e97] hover:text-foreground',
              )}
            >
              <div className="relative flex size-11 items-center justify-center rounded-xl transition-all">
                {(moreOpen || isMoreActive()) && !items.some((i) => isActive(i.href)) && (
                  <motion.div
                    layoutId="nav-active-bg"
                    className="absolute inset-0 rounded-xl bg-[#e8f5f1]"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
                <MoreHorizontal
                  className="relative size-[22px]"
                  strokeWidth={moreOpen || isMoreActive() ? 2.25 : 1.75}
                />
              </div>
              <span>Más</span>
            </button>
          )}
        </div>
      </nav>
    </>
  )
}
