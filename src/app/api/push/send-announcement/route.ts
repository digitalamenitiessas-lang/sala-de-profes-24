import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser, sendPushToRole, sendPushToRoles } from '@/lib/push/send'

// POST /api/push/send-announcement — trigger push for an announcement
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    // Only encargado/socio can broadcast push notifications
    const admin = createAdminClient()
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!callerProfile || (callerProfile.role !== 'encargado' && callerProfile.role !== 'socio')) {
      return NextResponse.json({ error: 'Sin permisos para enviar notificaciones' }, { status: 403 })
    }

    const body = await request.json()
    const { title, message, scope, target_role, target_user_id, url } = body

    if (!title) {
      return NextResponse.json({ error: 'Title required' }, { status: 400 })
    }

    const payload = {
      title,
      body: message || '',
      url: url || '/notificaciones',
    }

    if (scope === 'user' && target_user_id) {
      // Single user
      await sendPushToUser(target_user_id, payload)
    } else if (scope === 'role' && target_role) {
      // Single role
      await sendPushToRole(target_role, payload)
    } else {
      // All active users — get all roles and send
      const admin = createAdminClient()
      const { data: profiles } = await admin
        .from('profiles')
        .select('id')
        .eq('is_active', true)
        .neq('id', user.id) // Don't notify the sender

      if (profiles?.length) {
        await Promise.allSettled(
          profiles.map((p) => sendPushToUser(p.id, payload)),
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[push/send-announcement]', error)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}
