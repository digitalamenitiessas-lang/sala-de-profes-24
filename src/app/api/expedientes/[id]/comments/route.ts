import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// GET  /api/expedientes/[id]/comments — listar historial
// POST /api/expedientes/[id]/comments — agregar comentario
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    const { data, error } = await admin
      .from('expediente_comments')
      .select(`
        *,
        author:profiles!expediente_comments_author_id_fkey(first_name, last_name, role)
      `)
      .eq('expediente_id', id)
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ data: data ?? [] })
  } catch (error) {
    console.error('[GET /api/expedientes/[id]/comments]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body?.body?.trim()) {
      return NextResponse.json({ error: 'Comentario requerido' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Verify expediente exists
    const { data: expediente } = await admin
      .from('expedientes')
      .select('id, code, author_id, responsible_id, urgency')
      .eq('id', id)
      .single()

    if (!expediente) return NextResponse.json({ error: 'Expediente no encontrado' }, { status: 404 })

    const { error } = await admin.from('expediente_comments').insert({
      expediente_id: id,
      author_id: user.id,
      type: 'comment',
      body: body.body.trim(),
    })

    if (error) throw error

    // Notify relevant people
    const { data: profile } = await admin
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', user.id)
      .single()

    const authorName = profile
      ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
      : 'Alguien'

    // Notify responsible if commenter is not the responsible
    const notifyId = expediente.responsible_id && expediente.responsible_id !== user.id
      ? expediente.responsible_id
      : expediente.author_id !== user.id
        ? expediente.author_id
        : null

    if (notifyId) {
      await admin.from('announcements').insert({
        author_id: user.id,
        type: 'operativo',
        priority: 'baja',
        title: `💬 Comentario en: ${expediente.title}`,
        body: `${authorName}: ${body.body.trim().slice(0, 100)}`,
        scope: 'user',
        target_user_id: notifyId,
        is_active: true,
      })
    }

    // Audit trail (non-blocking)
    logAudit(admin, {
      userId: user.id,
      userName: authorName,
      action: 'create_expediente_comment',
      module: 'expedientes',
      entityType: 'expediente_comment',
      entityId: id,
      description: `${authorName} comentó en expediente ${expediente.code}`,
    }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[POST /api/expedientes/[id]/comments]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
