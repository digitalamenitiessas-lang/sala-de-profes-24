import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSocio } from '@/lib/roles'
import { getNotificationSettings, saveNotificationSetting, DEFAULT_NOTIFICATION_EVENTS } from '@/lib/push/notify-event'

// ---------------------------------------------------------------------------
// GET  /api/notification-settings — qué eventos disparan push y a quién
// PATCH /api/notification-settings — { eventKey, enabled?, target_roles?, target_user_ids? }
// Solo socio (dueño) puede ver y editar.
// ---------------------------------------------------------------------------

async function authorize(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!isSocio(profile?.role)) {
    return { error: NextResponse.json({ error: 'Solo socio puede configurar notificaciones' }, { status: 403 }) }
  }
  return { user, error: null }
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { error: authErr } = await authorize(supabase)
    if (authErr) return authErr

    const admin = createAdminClient()
    const settings = await getNotificationSettings(admin)
    return NextResponse.json({ settings })
  } catch (error) {
    console.error('[GET /api/notification-settings]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { user, error: authErr } = await authorize(supabase)
    if (authErr || !user) return authErr!

    const body = await request.json().catch(() => null)
    if (!body?.eventKey || typeof body.eventKey !== 'string' || !(body.eventKey in DEFAULT_NOTIFICATION_EVENTS)) {
      return NextResponse.json({ error: 'eventKey inválido' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (Array.isArray(body.target_roles)) patch.target_roles = body.target_roles
    if (Array.isArray(body.target_user_ids)) patch.target_user_ids = body.target_user_ids

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nada para guardar' }, { status: 400 })
    }

    const admin = createAdminClient()
    const settings = await saveNotificationSetting(admin, body.eventKey, patch, user.id)
    return NextResponse.json({ success: true, settings })
  } catch (error) {
    console.error('[PATCH /api/notification-settings]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
