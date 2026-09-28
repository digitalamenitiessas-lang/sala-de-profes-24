import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// requireRole — guard compartido para route handlers.
// Devuelve { user } si el usuario está autenticado y tiene uno de los roles
// permitidos; si no, devuelve { response } con el 401/403 listo para retornar.
// ---------------------------------------------------------------------------

export async function requireRole(allowedRoles: readonly string[]): Promise<
  | { user: { id: string; role: string }; response?: undefined }
  | { user?: undefined; response: NextResponse }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { response: NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 }) }
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !allowedRoles.includes(profile.role)) {
    return { response: NextResponse.json({ success: false, error: 'Sin permisos' }, { status: 403 }) }
  }

  return { user: { id: user.id, role: profile.role } }
}
