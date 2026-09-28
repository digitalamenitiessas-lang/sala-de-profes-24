import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// POST /api/push/subscribe — Save push subscription
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const body = await request.json()
    const { endpoint, keys } = body

    if (!endpoint || !keys) {
      return NextResponse.json({ error: 'Datos de suscripción incompletos' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin.from('push_subscriptions').upsert(
      { user_id: user.id, endpoint, keys },
      { onConflict: 'user_id,endpoint' },
    )

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[push/subscribe]', error)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}

// DELETE /api/push/subscribe — Remove push subscription
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const body = await request.json()
    const { endpoint } = body

    if (!endpoint) {
      return NextResponse.json({ error: 'Endpoint requerido' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin.from('push_subscriptions').delete()
      .eq('user_id', user.id)
      .eq('endpoint', endpoint)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}
