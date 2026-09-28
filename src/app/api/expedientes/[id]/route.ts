import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyExpedienteAssignment } from '@/lib/email/send'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// GET    /api/expedientes/[id] — detalle
// PATCH  /api/expedientes/[id] — editar campos
// DELETE /api/expedientes/[id] — eliminar borrador
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
      .from('expedientes')
      .select(`
        *,
        author:profiles!expedientes_author_id_fkey(first_name, last_name, role),
        responsible:profiles!expedientes_responsible_id_fkey(first_name, last_name, role),
        approver:profiles!expedientes_approver_id_fkey(first_name, last_name, role)
      `)
      .eq('id', id)
      .single()

    if (error) throw error
    if (!data) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    // Check access
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role as string
    if (role !== 'socio' && role !== 'encargado') {
      if (data.author_id !== user.id && data.responsible_id !== user.id) {
        return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
      }
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[GET /api/expedientes/[id]]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Body requerido' }, { status: 400 })

    const admin = createAdminClient()

    // Check permissions
    const { data: profile } = await admin
      .from('profiles')
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .single()

    const { data: existing } = await admin
      .from('expedientes')
      .select('author_id, responsible_id, status, code, title')
      .eq('id', id)
      .single()

    if (!existing) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    const role = profile?.role as string
    const closedStatuses = ['cumplido', 'cerrado_sin_implementacion', 'archivado']
    const isClosed = closedStatuses.includes(existing.status)

    // Nobody can edit closed expedientes (except assigning approver via status route)
    if (isClosed) return NextResponse.json({ error: 'No se puede editar un expediente cerrado' }, { status: 403 })

    const canEdit = role === 'socio' || role === 'encargado' ||
      (existing.author_id === user.id && existing.status === 'borrador')

    if (!canEdit) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

    // Build update
    const allowed = ['title', 'description', 'reason', 'type', 'areas', 'urgency',
      'target_date', 'responsible_id', 'priority', 'impact_categories']
    const update: Record<string, unknown> = {}
    const changes: string[] = []

    for (const key of allowed) {
      if (key in body) {
        update[key] = body[key]
        changes.push(key)
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
    }

    const { error } = await admin.from('expedientes').update(update).eq('id', id)
    if (error) throw error

    // Log edit
    const authorName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim()
    await admin.from('expediente_comments').insert({
      expediente_id: id,
      author_id: user.id,
      type: 'edit',
      body: `${authorName} editó: ${changes.join(', ')}`,
      metadata: { changed_fields: changes },
    })

    // Notify if responsible was assigned
    if (body.responsible_id && body.responsible_id !== existing.responsible_id) {
      await admin.from('announcements').insert({
        author_id: user.id,
        type: 'operativo',
        priority: 'media',
        title: `📋 Te asignaron: ${existing.title}`,
        body: `${authorName} te asignó como responsable del expediente ${existing.code}`,
        scope: 'user',
        target_user_id: body.responsible_id,
        is_active: true,
      })

      // Also log assignment change
      await admin.from('expediente_comments').insert({
        expediente_id: id,
        author_id: user.id,
        type: 'assignment_change',
        body: `${authorName} asignó un nuevo responsable`,
        metadata: { responsible_id: body.responsible_id },
      })

      // Email only to the assigned person
      notifyExpedienteAssignment({
        userId: body.responsible_id,
        code: existing.code,
        title: existing.title ?? existing.code,
        assignedBy: authorName,
      }).catch(() => {})
    }

    // Audit trail (non-blocking)
    const patchAuthorName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim()
    logAudit(admin, {
      userId: user.id,
      userName: patchAuthorName,
      action: 'update_expediente',
      module: 'expedientes',
      entityType: 'expediente',
      entityId: id,
      description: `${patchAuthorName} editó expediente: ${changes.join(', ')}`,
      metadata: { changed_fields: changes },
    }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[PATCH /api/expedientes/[id]]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const { data: existing } = await admin
      .from('expedientes')
      .select('author_id, status')
      .eq('id', id)
      .single()

    if (!existing) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

    // Only borradores can be deleted
    if (existing.status !== 'borrador') {
      return NextResponse.json({ error: 'Solo se pueden eliminar borradores' }, { status: 403 })
    }

    // Only author, socio, or encargado can delete
    const role = profile?.role as string
    const canDelete = role === 'socio' || role === 'encargado' || existing.author_id === user.id
    if (!canDelete) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

    // Delete comments first (CASCADE should handle this, but be safe)
    await admin.from('expediente_comments').delete().eq('expediente_id', id)
    const { error } = await admin.from('expedientes').delete().eq('id', id)
    if (error) throw error

    // Audit trail (non-blocking)
    logAudit(admin, {
      userId: user.id,
      userName: null,
      action: 'delete_expediente',
      module: 'expedientes',
      entityType: 'expediente',
      entityId: id,
      description: `Eliminó expediente borrador`,
    }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[DELETE /api/expedientes/[id]]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
