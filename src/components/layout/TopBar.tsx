'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Settings, LogOut, ChevronDown, ChevronLeft } from 'lucide-react'
import { ROLES } from '@/lib/constants'
import { useState, useEffect } from 'react'
import { signOutBrowserSession } from '@/lib/push/client'

export function TopBar() {
  const pathname = usePathname()
  const router = useRouter()
  const { profile } = useProfileContext()
  const [scrolled, setScrolled] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Page title from pathname
  const PAGE_TITLES: Record<string, string> = {
    '/': '',
    '/admin': 'Control',
    '/fichaje': 'Mi Turno',
    '/mi-turno': 'Mi Turno',
    '/mis-horarios': 'Horarios',
    '/notificaciones': 'Avisos',
    '/equipo': 'Equipo',
    '/salon': 'Salón',
    '/ventas': 'Ventas',
    '/expedientes': 'Expedientes',
    '/configuracion': 'Configuración',
    '/equipo/asistencia': 'Asistencia',
    '/equipo/turnos': 'Turnos',
    '/cocina/produccion': 'Producción',
    '/cocina/stock': 'Stock Cocina',
    '/stock/conteo': 'Conteo',
    '/stock/rendimiento': 'Rendimiento',
    '/admin/stock/mapeo': 'Mapeo Fudo',
    '/admin/recetas/pending': 'Recetas Pendientes',
    '/admin/fudo': 'Fudo',
  }
  const pageTitle = PAGE_TITLES[pathname] ?? ''

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    const handler = () => setScrolled(main.scrollTop > 20)
    main.addEventListener('scroll', handler, { passive: true })
    return () => main.removeEventListener('scroll', handler)
  }, [])

  const fullName = profile ? `${profile.first_name} ${profile.last_name}` : ''
  const initials = profile
    ? `${profile.first_name?.[0] ?? ''}${profile.last_name?.[0] ?? ''}`.toUpperCase()
    : '?'

  function handleLogout() {
    void signOutBrowserSession().finally(() => {
      window.location.href = '/login'
    })
    setTimeout(() => { window.location.href = '/login' }, 1500)
  }

  const roleConfig = profile?.role ? ROLES[profile.role] : null

  // Volver atrás desde cualquier pantalla que no sea el inicio. Si se llegó
  // por link directo (sin historial), vuelve al inicio.
  const showBack = pathname !== '/'
  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back()
    else router.push('/')
  }

  return (
    <header className={`sticky top-0 z-40 shrink-0 bg-[#006d5a] transition-all duration-200 ${scrolled ? 'shadow-md' : ''}`}>
      <div className={`flex items-center justify-between px-5 transition-all duration-200 ${scrolled ? 'h-[2.75rem]' : 'h-[3.75rem]'}`}>
        {/* Volver + Brand */}
        <div className="flex min-w-0 items-center gap-1.5">
          {showBack && (
            <button
              onClick={handleBack}
              aria-label="Volver"
              className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-xl text-white/90 transition-colors hover:bg-white/10 active:scale-95"
            >
              <ChevronLeft className="size-6" />
            </button>
          )}
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <Image
            src="/Logos/logo negativo.png"
            alt="La Vieja Escuela"
            width={36}
            height={36}
            className="size-9 object-contain"
          />
          <div className="flex flex-col">
            <span className="font-display text-[15px] font-semibold leading-tight tracking-tight text-white">
              {pageTitle || 'Sala de Profes'}
            </span>
            <span className={`text-[9px] font-medium tracking-[0.12em] text-white/40 transition-all duration-200 ${scrolled || pageTitle ? 'h-0 overflow-hidden opacity-0' : 'opacity-100'}`}>
              LA VIEJA ESCUELA
            </span>
          </div>
        </Link>
        </div>

        {/* User dropdown — only render after mount to avoid base-ui ID hydration mismatch */}
        {mounted ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/30">
              <Avatar size="sm">
                {profile?.avatar_url && (
                  <AvatarImage src={profile.avatar_url} alt={fullName} />
                )}
                <AvatarFallback className="bg-white/15 text-[10px] font-bold text-white">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="size-3 text-white/40" />
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" sideOffset={8} className="w-56 rounded-xl">
              <div className="px-3 py-2.5">
                <p className="text-sm font-semibold text-foreground">{fullName}</p>
                {roleConfig && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {roleConfig.emoji} {roleConfig.label}
                  </p>
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href="/configuracion" className="flex items-center gap-2">
                  <Settings className="size-4" />
                  Configuración
                </a>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <button onClick={handleLogout} className="flex w-full items-center gap-2 text-[#ea504c]">
                  <LogOut className="size-4" />
                  Cerrar Sesión
                </button>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-2 rounded-xl px-2.5 py-2" suppressHydrationWarning>
            <Avatar size="sm">
              <AvatarFallback className="bg-white/15 text-[10px] font-bold text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            <ChevronDown className="size-3 text-white/40" />
          </div>
        )}
      </div>
    </header>
  )
}
