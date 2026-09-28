'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useProfileContext } from '@/lib/hooks/use-profile'
import {
  Home,
  Clock,
  Calendar,
  RefreshCw,
  CalendarDays,
  Coffee,
  Bell,
  Package,
  MoreHorizontal,
  Users,
  Shield,
  ShieldAlert,
  Truck,
  Bot,
  BookOpen,
  ShoppingCart,
  FolderOpen,
  Wine,
  BarChart3,
  X,
  Armchair,
  ClipboardCheck,
  Hammer,
  ScanFace,
  Sparkles,
  Wifi,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AppRole } from '@/types/database'
import { mustClockIn } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence, StaggerList, StaggerItem } from '@/components/ui/motion'
import { onNotificationRead } from '@/lib/sounds'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NavItem = {
  label: string
  href: string
  icon: LucideIcon
  description?: string
}

type NavGroup = {
  label: string
  items: NavItem[]
}

type ExpandableNavItem = {
  label: string
  icon: LucideIcon
  groups: NavGroup[]
}

// ---------------------------------------------------------------------------
// Nav config per role — grouped by section
// ---------------------------------------------------------------------------

const BASE_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Mi Turno', href: '/mi-turno', icon: Clock },
  { label: 'Horarios', href: '/mis-horarios', icon: Calendar },
  { label: 'Avisos', href: '/notificaciones', icon: Bell },
]

// Encargado/Socio: Hoy es el ancla del día (pedir→recibir→producir→contar)
const OPERATIONS_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Hoy', href: '/hoy', icon: CalendarDays },
  { label: 'Stock', href: '/stock', icon: Package },
  { label: 'Compras', href: '/pedidos', icon: ShoppingCart },
]

// Cocina/Chef: Hoy les muestra qué producir
const COCINA_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Hoy', href: '/hoy', icon: CalendarDays },
  { label: 'Mi Turno', href: '/mi-turno', icon: Clock },
  { label: 'Avisos', href: '/notificaciones', icon: Bell },
]

// Barista: la tolva es su herramienta de cada turno
const BARISTA_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Tolva', href: '/tolva', icon: Coffee },
  { label: 'Mi Turno', href: '/mi-turno', icon: Clock },
  { label: 'Avisos', href: '/notificaciones', icon: Bell },
]

// Runners get Salón in main bar instead of Horarios
const RUNNER_NAV: NavItem[] = [
  { label: 'Inicio', href: '/', icon: Home },
  { label: 'Salón', href: '/salon', icon: Armchair },
  { label: 'Mi Turno', href: '/mi-turno', icon: Clock },
  { label: 'Avisos', href: '/notificaciones', icon: Bell },
]

// SOCIO — operaciones críticas fijas abajo; el resto queda agrupado por intención.
const SOCIO_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Equipo',
      items: [
        { label: 'Equipo y turnos', href: '/equipo', icon: Users, description: 'Presentes, roles y planificación semanal' },
        { label: 'Asistencia', href: '/equipo/asistencia', icon: ScanFace, description: 'Fichajes y correcciones de hoy' },
        { label: 'Centro de control', href: '/control', icon: ShieldAlert, description: 'Stock crítico, anomalías y fichajes en un solo lugar' },
      ],
    },
    {
      label: 'Operación',
      items: [
        { label: 'Ventas', href: '/ventas', icon: BarChart3, description: 'Facturación y tickets sincronizados desde Fudo' },
        { label: 'Reportes', href: '/admin/reportes', icon: BookOpen, description: 'Food cost, márgenes y ventas por período' },
        { label: 'Protocolos', href: '/protocolos', icon: Sparkles, description: 'Limpieza del baño: asignar, foto y registro' },
        { label: 'Salón', href: '/salon', icon: Armchair, description: 'Tareas y control del servicio' },
        { label: 'Producción', href: '/cocina/produccion', icon: Hammer, description: 'Órdenes y plan de producción' },
        { label: 'Vajilla', href: '/vajilla', icon: Wine, description: 'Control de roturas, faltantes y reposición' },
      ],
    },
    {
      label: 'Administración',
      items: [
        { label: 'Fudo', href: '/admin/fudo', icon: RefreshCw, description: 'Sincronización y configuración de Fudo' },
        { label: 'Salud de Fudo', href: '/admin/fudo/salud', icon: Wifi, description: 'Conexión, pendientes y vínculos para arreglar' },
        { label: 'Proveedores', href: '/proveedores', icon: Truck, description: 'Datos de proveedores y condiciones' },
        { label: 'Importar recetas', href: '/admin/fudo/importar', icon: ClipboardCheck, description: 'Subir el export de Fudo para sincronizar recetas' },
        { label: 'Expedientes', href: '/expedientes', icon: FolderOpen, description: 'Seguimiento de temas administrativos' },
        { label: 'Auditoría', href: '/auditoria', icon: Shield, description: 'Historial de cambios sensibles' },
      ],
    },
  ],
}

// ENCARGADO — gestiona todo lo operativo
const ENCARGADO_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Equipo',
      items: [
        { label: 'Equipo y turnos', href: '/equipo', icon: Users, description: 'Presentes, roles y planificación semanal' },
        { label: 'Asistencia', href: '/equipo/asistencia', icon: ScanFace, description: 'Fichajes y correcciones de hoy' },
        { label: 'Centro de control', href: '/control', icon: ShieldAlert, description: 'Stock crítico, anomalías y fichajes en un solo lugar' },
      ],
    },
    {
      label: 'Operación',
      items: [
        { label: 'Reportes', href: '/admin/reportes', icon: BookOpen, description: 'Food cost, márgenes y ventas por período' },
        { label: 'Protocolos', href: '/protocolos', icon: Sparkles, description: 'Limpieza del baño: asignar, foto y registro' },
        { label: 'Salón', href: '/salon', icon: Armchair, description: 'Servicio y tareas del salón' },
        { label: 'Producción', href: '/cocina/produccion', icon: Hammer, description: 'Órdenes y plan de producción' },
        { label: 'Vajilla', href: '/vajilla', icon: Wine, description: 'Faltantes, roturas y reposición' },
      ],
    },
    {
      label: 'Inventario',
      items: [
        { label: 'Proveedores', href: '/proveedores', icon: Truck, description: 'Contactos y condiciones de compra' },
        { label: 'Salud de Fudo', href: '/admin/fudo/salud', icon: Wifi, description: 'Conexión, pendientes y vínculos para arreglar' },
      ],
    },
  ],
}

// CHEF — producción, stock y recetario
const CHEF_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Cocina',
      items: [
        { label: 'Producción', href: '/cocina/produccion', icon: Hammer, description: 'Registrar producción hecha' },
        { label: 'Stock cocina', href: '/stock?area=cocina', icon: Package, description: 'Contar y ver faltantes del sector' },
        { label: 'Recetario', href: '/recetas', icon: BookOpen, description: 'Ver recetas e insumos' },
      ],
    },
    {
      label: 'Herramientas',
      items: [
        { label: 'Horarios', href: '/mis-horarios', icon: Calendar, description: 'Mis turnos y con quién trabajo' },
        { label: 'La Vieja', href: '/asistente', icon: Bot, description: 'Consultar por chat' },
      ],
    },
  ],
}

// COCINA — producción y stock del sector
const COCINA_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Cocina',
      items: [
        { label: 'Producción', href: '/cocina/produccion', icon: Hammer, description: 'Registrar producción hecha' },
        { label: 'Stock cocina', href: '/stock?area=cocina', icon: Package, description: 'Contar y ver faltantes del sector' },
        { label: 'Recetario', href: '/recetas', icon: BookOpen, description: 'Ver recetas e insumos' },
      ],
    },
    {
      label: 'Herramientas',
      items: [
        { label: 'Horarios', href: '/mis-horarios', icon: Calendar, description: 'Mis turnos y con quién trabajo' },
        { label: 'La Vieja', href: '/asistente', icon: Bot, description: 'Consultar por chat' },
      ],
    },
  ],
}

// BARISTA — vajilla y herramientas
const BARISTA_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Herramientas',
      items: [
        { label: 'Horarios', href: '/mis-horarios', icon: Calendar, description: 'Mis turnos y con quién trabajo' },
        { label: 'Vajilla', href: '/vajilla', icon: Wine, description: 'Controlar roturas y faltantes' },
        { label: 'La Vieja', href: '/asistente', icon: Bot, description: 'Consultar por chat' },
      ],
    },
  ],
}

// RUNNER — vajilla + chatbot
const RUNNER_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Herramientas',
      items: [
        { label: 'Horarios', href: '/mis-horarios', icon: Calendar, description: 'Mis turnos y con quién trabajo' },
        { label: 'Vajilla', href: '/vajilla', icon: Wine, description: 'Controlar roturas y faltantes' },
        { label: 'La Vieja', href: '/asistente', icon: Bot, description: 'Consultar por chat' },
      ],
    },
  ],
}

// BACHA — mínimo: vajilla + chatbot
const BACHA_MORE: ExpandableNavItem = {
  label: 'Más',
  icon: MoreHorizontal,
  groups: [
    {
      label: 'Herramientas',
      items: [
        { label: 'Vajilla', href: '/vajilla', icon: Wine, description: 'Controlar roturas y faltantes' },
        { label: 'La Vieja', href: '/asistente', icon: Bot, description: 'Consultar por chat' },
      ],
    },
  ],
}

function getAllMoreItems(more?: ExpandableNavItem): NavItem[] {
  if (!more) return []
  return more.groups.flatMap((g) => g.items)
}

function getNavItems(role?: AppRole): { items: NavItem[]; more?: ExpandableNavItem } {
  if (role === 'socio') return { items: OPERATIONS_NAV, more: SOCIO_MORE }
  if (role === 'encargado') return { items: OPERATIONS_NAV, more: ENCARGADO_MORE }
  if (role === 'chef') return { items: COCINA_NAV, more: CHEF_MORE }
  if (role === 'cocina') return { items: COCINA_NAV, more: COCINA_MORE }
  if (role === 'barista') return { items: BARISTA_NAV, more: BARISTA_MORE }
  if (role === 'runner') return { items: RUNNER_NAV, more: RUNNER_MORE }
  if (role === 'bacha') return { items: BASE_NAV, more: BACHA_MORE }
  return { items: BASE_NAV, more: BACHA_MORE }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BottomNav() {
  const pathname = usePathname()
  const { profile } = useProfileContext()
  const [moreOpen, setMoreOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

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
      <nav
        aria-label="Navegacion principal"
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-[#fefcf9] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex h-[4.25rem] items-center justify-around px-1">
          {items.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            const showBadge = item.href === '/notificaciones' && unreadCount > 0
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
