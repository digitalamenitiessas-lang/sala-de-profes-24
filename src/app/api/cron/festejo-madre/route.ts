import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push/send'

// GET /api/cron/festejo-madre — 19/10 a las 8:00 AR (11:00 UTC)
// Push a todos los que tienen notificaciones activadas.

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production' && (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hoyAR = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  if (hoyAR !== '2026-10-19') {
    return NextResponse.json({ skipped: true, hoy: hoyAR })
  }

  const admin = createAdminClient()

  // Todos los user_ids únicos con push activo
  const { data: subs } = await admin.from('push_subscriptions').select('user_id')
  const userIds = [...new Set((subs ?? []).map((s: { user_id: string }) => s.user_id))]

  if (userIds.length === 0) return NextResponse.json({ enviados: 0 })

  const results = await Promise.allSettled(
    userIds.map((id) =>
      sendPushToUser(id, {
        title: '💐 ¡Feliz día de la madre!',
        body: 'Para todo el equipo de La Vieja Escuela — especialmente para esas súper trabajadoras que hacen de todo, pero sobre todo: ser mamá. ❤️',
        url: '/hoy',
      }),
    ),
  )

  const enviados = results.filter((r) => r.status === 'fulfilled').length
  return NextResponse.json({ enviados, total: userIds.length })
}
