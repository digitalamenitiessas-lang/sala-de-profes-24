import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// POST /api/audit — client-side audit trail endpoint
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No auth' }, { status: 401 })

    const body = await request.json()
    const admin = createAdminClient()

    await admin.from('audit_trail').insert({
      user_id: body.userId ?? user.id,
      user_name: body.userName ?? null,
      action: body.action,
      module: body.module,
      entity_type: body.entityType ?? null,
      entity_id: body.entityId ?? null,
      description: body.description,
      metadata: body.metadata ?? null,
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
