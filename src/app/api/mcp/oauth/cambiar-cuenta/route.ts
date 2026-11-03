import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseEnv } from '@/lib/supabase/env'
import { MCP_BASE } from '@/lib/mcp/oauth'

// POST /api/mcp/oauth/cambiar-cuenta — desde la pantalla de permiso: cierra la
// sesión SOLO en este navegador (no en el resto de los dispositivos de esa
// persona) y vuelve al login, que después regresa al permiso.
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== MCP_BASE) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 })
  const next = String((await request.formData()).get('next') ?? '')
  const destino = new URL('/login', MCP_BASE)
  // Solo se vuelve a la pantalla de permiso, nunca a otra dirección
  if (next.startsWith('/mcp/autorizar?')) destino.searchParams.set('next', next)
  const respuesta = NextResponse.redirect(destino, 303)
  const { url, anonKey } = getSupabaseEnv()
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      // Las cookies borradas viajan en esta misma respuesta
      setAll: (lista) => lista.forEach(({ name, value, options }) => respuesta.cookies.set(name, value, options)),
    },
  })
  await supabase.auth.signOut({ scope: 'local' })
  return respuesta
}
