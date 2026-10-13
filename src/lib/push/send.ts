import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'
import { idsConRolEnTurno } from '@/lib/turnos/rol-del-turno'

// Configure VAPID
const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? ''

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(
    'mailto:info@laviejaescuelabar.com.ar',
    VAPID_PUBLIC,
    VAPID_PRIVATE,
  )
}

// ---------------------------------------------------------------------------
// Send push to a specific user
// ---------------------------------------------------------------------------
export async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string }) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return

  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq('user_id', userId)

  if (!subs?.length) return

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    url: payload.url ?? '/',
  })

  const results = await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } },
          message,
        )
      } catch (err: unknown) {
        // Remove invalid subscriptions (410 Gone)
        if (err && typeof err === 'object' && 'statusCode' in err && (err as { statusCode: number }).statusCode === 410) {
          await admin.from('push_subscriptions').delete()
            .eq('user_id', userId)
            .eq('endpoint', sub.endpoint)
        }
      }
    }),
  )

  return results
}

// ---------------------------------------------------------------------------
// Send push to all users with a specific role (de perfil, o trabajando ahora
// con ese rol según su turno)
// ---------------------------------------------------------------------------
export async function sendPushToRole(role: string, payload: { title: string; body: string; url?: string }) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return

  const admin = createAdminClient()
  const [{ data: profiles }, enTurno] = await Promise.all([
    admin.from('profiles').select('id').eq('role', role).eq('is_active', true),
    idsConRolEnTurno(admin, [role]),
  ])
  const ids = new Set([...(profiles ?? []).map((p) => p.id), ...enTurno])
  if (ids.size === 0) return

  await Promise.allSettled(
    [...ids].map((id) => sendPushToUser(id, payload)),
  )
}

// ---------------------------------------------------------------------------
// Send push to multiple roles
// ---------------------------------------------------------------------------
export async function sendPushToRoles(roles: string[], payload: { title: string; body: string; url?: string }) {
  await Promise.allSettled(roles.map((r) => sendPushToRole(r, payload)))
}
