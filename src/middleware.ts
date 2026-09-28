import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/auth']

// Routes that require socio/encargado
const MANAGER_ROUTES = [
  '/encargado',
  '/equipo',
  // /stock, /stock/conteo, /stock/item y /stock/puesta-a-cero son operativas:
  // cocina también cuenta. Lo económico/analítico sigue siendo de managers.
  '/stock/rendimiento',
  '/stock/historial',
  '/stock/consumo',
  '/stock/produccion',
  '/stock/precios',
  '/proveedores',
  '/admin',
  '/auditoria',
]

const MANAGER_ROLES = new Set(['socio', 'encargado'])

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user, role, isActive } = await updateSession(request)
  const { pathname } = request.nextUrl

  // API routes handle their own auth — skip middleware redirect
  if (pathname.startsWith('/api/')) {
    return supabaseResponse
  }

  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/'),
  )

  // Unauthenticated user trying to access a protected route → redirect to login
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Authenticated user trying to access /login → redirect to dashboard
  // (but keep them on /login if middleware just kicked them for being inactive)
  const inactiveFlag = request.nextUrl.searchParams.get('inactive') === '1'
  if (user && isPublicRoute && !inactiveFlag) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Inactive user: force logout by redirecting to login with flag
  if (user && !isActive && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('inactive', '1')
    return NextResponse.redirect(url)
  }

  // Manager-only routes: block non-managers
  if (user && !isPublicRoute) {
    const needsManager = MANAGER_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(route + '/'),
    )
    if (needsManager && !MANAGER_ROLES.has(role ?? '')) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - PWA assets (manifest.json, sw.js, offline.html, icons) — si pasan por
     *   el middleware, la redirección a /login les devuelve HTML y el browser
     *   reporta "Manifest: syntax error" / rompe el service worker
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|offline.html|icons/|Logos/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
