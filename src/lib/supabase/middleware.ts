import { createServerClient } from '@supabase/ssr'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/types/database'
import { getSupabaseEnv } from './env'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const { url, anonKey } = getSupabaseEnv()

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        )
        supabaseResponse = NextResponse.next({
          request,
        })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        )
      },
    },
  })

  // IMPORTANT: DO NOT remove auth.getUser(). Refreshing the auth token
  // is necessary here to keep the session alive.
  //
  // La app corre lejos de Supabase (VPS en EE. UU., base en San Pablo): un corte
  // de red de un instante NO es "sin sesión" ni "cuenta desactivada". Antes,
  // si fallaba la consulta del perfil se tomaba como inactivo y el login le
  // cerraba la sesión al empleado.
  let {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (!user && userError && isAuthRetryableFetchError(userError)) {
    ;({ data: { user }, error: userError } = await supabase.auth.getUser())
  }
  // Sigue sin poder verificar por la red y el navegador tiene cookie de sesión:
  // se deja pasar sin mandar al login (las APIs verifican la sesión por su cuenta).
  const authUnavailable = !user && !!userError && isAuthRetryableFetchError(userError)
    && request.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'))
  if (authUnavailable) console.warn('[middleware] no se pudo verificar la sesión (red), se deja pasar:', userError?.message)

  let role: string | null = null
  let isActive = true
  if (user) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .maybeSingle()
    role = profile?.role ?? null
    if (profileError) {
      // No se pudo leer: no se lo saca de la sesión por un error de red
      console.warn('[middleware] no se pudo leer el perfil, se deja pasar:', profileError.message)
    } else {
      // Solo inactivo si la base lo confirma (o si no tiene perfil)
      isActive = profile?.is_active ?? false
    }
  }

  return { supabaseResponse, user, role, isActive, authUnavailable }
}
