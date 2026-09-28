import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyExpedienteToResponsible } from '@/lib/email/send'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// GET /api/expedientes/[id]/tasks — list tasks
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('expediente_tasks')
      .select('*, assignee:assigned_to(first_name, last_name, role), creator:created_by(first_name, last_name, role)')
      .eq('expediente_id', id)
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ data })
  } catch (err) {
    console.error('[GET /api/expedientes/[id]/tasks]', err)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/expedientes/[id]/tasks — create task + notify
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    // Only socios can create tasks
    const { data: profile } = await admin
      .from('profiles')
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'socio') {
      return NextResponse.json({ error: 'Solo los socios pueden crear tareas' }, { status: 403 })
    }

    const body = await request.json()
    const { title, description, assigned_to, due_date } = body

    if (!title?.trim()) {
      return NextResponse.json({ error: 'Título requerido' }, { status: 400 })
    }

    // Get expediente code for notification
    const { data: exp } = await admin
      .from('expedientes')
      .select('code, title')
      .eq('id', id)
      .single()

    // Create task
    const { data: task, error } = await admin
      .from('expediente_tasks')
      .insert({
        expediente_id: id,
        title: title.trim(),
        description: description?.trim() || null,
        assigned_to: assigned_to || null,
        due_date: due_date || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) throw error

    // Log as comment on the expediente
    const assigneeName = assigned_to ? await getProfileName(admin, assigned_to) : null
    await admin.from('expediente_comments').insert({
      expediente_id: id,
      author_id: user.id,
      type: 'edit',
      body: `Nueva tarea: "${title.trim()}"${assigneeName ? ` → asignada a ${assigneeName}` : ''}`,
      metadata: { action: 'task_created', task_id: task.id },
    })

    // Notify assignee
    if (assigned_to && assigned_to !== user.id) {
      const authorName = `${profile.first_name} ${profile.last_name}`.trim()
      await admin.from('announcements').insert({
        author_id: user.id,
        type: 'operativo',
        priority: 'media',
        title: `📌 Tarea: ${title.trim()}`,
        body: `${authorName} te asignó esta tarea en "${exp?.title ?? 'expediente'}"${due_date ? ` · Vence: ${new Date(due_date).toLocaleDateString('es-AR')}` : ''}`,
        scope: 'user',
        target_user_id: assigned_to,
        is_active: true,
      })
    }

    // Email only to the assigned person (not all socios)
    const authorNameFull = `${profile.first_name} ${profile.last_name}`.trim()
    if (assigned_to) {
      notifyExpedienteToResponsible({
        responsibleId: assigned_to,
        code: exp?.code ?? id,
        title: exp?.title ?? '',
        action: 'Tarea asignada',
        authorName: authorNameFull,
        detail: `"${title.trim()}"`,
      }).catch(() => {})
    }

    // Audit trail (non-blocking)
    logAudit(admin, {
      userId: user.id,
      userName: authorNameFull,
      action: 'create_expediente_task',
      module: 'expedientes',
      entityType: 'expediente_task',
      entityId: task.id,
      description: `${authorNameFull} creó tarea: "${title.trim()}" en expediente ${exp?.code ?? id}`,
    }).catch(() => {})

    return NextResponse.json({ data: task })
  } catch (err) {
    console.error('[POST /api/expedientes/[id]/tasks]', err)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/expedientes/[id]/tasks — update task status
// ---------------------------------------------------------------------------
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const body = await request.json()
    const { task_id, status, assigned_to } = body

    if (!task_id) {
      return NextResponse.json({ error: 'task_id requerido' }, { status: 400 })
    }

    // Must provide either status or assigned_to (or both)
    if (!status && assigned_to === undefined) {
      return NextResponse.json({ error: 'status o assigned_to requerido' }, { status: 400 })
    }

    if (status) {
      const validStatuses = ['pending', 'in_progress', 'done', 'cancelled']
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Estado inválido' }, { status: 400 })
      }
    }

    // Get current task
    const { data: task } = await admin
      .from('expediente_tasks')
      .select('title, assigned_to, status, created_by')
      .eq('id', task_id)
      .single()

    if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

    // Get user profile + role
    const { data: userProfile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
    const isSocio = userProfile?.role === 'socio'

    // Reassignment — socios can always reassign, assigned person can also reassign
    if (assigned_to !== undefined) {
      const canReassign = isSocio || task.assigned_to === user.id || task.created_by === user.id
      if (!canReassign) {
        return NextResponse.json({ error: 'No tenés permiso para reasignar esta tarea' }, { status: 403 })
      }

      const updateFields: Record<string, unknown> = { assigned_to: assigned_to || null }
      if (status) updateFields.status = status

      const { error } = await admin.from('expediente_tasks').update(updateFields).eq('id', task_id)
      if (error) throw error

      // Log reassignment
      const reassignerName = userProfile ? `${userProfile.first_name} ${userProfile.last_name}`.trim() : 'Alguien'
      const newAssigneeName = assigned_to ? await getProfileName(admin, assigned_to) : 'nadie'

      await admin.from('expediente_comments').insert({
        expediente_id: id,
        author_id: user.id,
        type: 'edit',
        body: `${reassignerName} reasignó tarea "${task.title}" a ${newAssigneeName}`,
        metadata: { action: 'task_reassignment', task_id, from: task.assigned_to, to: assigned_to },
      })

      // Email to new assignee
      if (assigned_to) {
        const { data: exp } = await admin.from('expedientes').select('code, title').eq('id', id).single()
        notifyExpedienteToResponsible({
          responsibleId: assigned_to,
          code: exp?.code ?? id,
          title: exp?.title ?? '',
          action: 'Tarea reasignada',
          authorName: reassignerName,
          detail: `"${task.title}" te fue asignada`,
        }).catch(() => {})
      }

      // Notify previous assignee that they were unassigned
      if (task.assigned_to && task.assigned_to !== assigned_to) {
        const { data: exp } = await admin.from('expedientes').select('code, title').eq('id', id).single()
        notifyExpedienteToResponsible({
          responsibleId: task.assigned_to,
          code: exp?.code ?? id,
          title: exp?.title ?? '',
          action: 'Tarea reasignada',
          authorName: reassignerName,
          detail: `"${task.title}" fue reasignada a ${newAssigneeName}`,
        }).catch(() => {})
      }

      // Audit trail (non-blocking)
      const reassignerFullName = userProfile ? `${userProfile.first_name} ${userProfile.last_name}`.trim() : 'Alguien'
      logAudit(admin, {
        userId: user.id,
        userName: reassignerFullName,
        action: 'update_expediente_task',
        module: 'expedientes',
        entityType: 'expediente_task',
        entityId: task_id,
        description: `${reassignerFullName} reasignó tarea "${task.title}" a ${newAssigneeName}`,
      }).catch(() => {})

      return NextResponse.json({ success: true })
    }

    // Status change only — only assigned person or socio can do it
    const canAct = isSocio || (task.assigned_to ? task.assigned_to === user.id : task.created_by === user.id)
    if (!canAct) {
      return NextResponse.json({ error: 'Solo la persona asignada puede gestionar esta tarea' }, { status: 403 })
    }

    // Update status
    const { error } = await admin
      .from('expediente_tasks')
      .update({ status })
      .eq('id', task_id)

    if (error) throw error

    // Log status change
    const statusLabels: Record<string, string> = {
      pending: 'Pendiente',
      in_progress: 'En progreso',
      done: 'Completada',
      cancelled: 'Cancelada',
    }
    await admin.from('expediente_comments').insert({
      expediente_id: id,
      author_id: user.id,
      type: 'edit',
      body: `Tarea "${task.title}" → ${statusLabels[status]}`,
      metadata: { action: 'task_status_change', task_id, from: task.status, to: status },
    })

    // Get expediente info for notification
    const { data: exp } = await admin
      .from('expedientes')
      .select('code, author_id, responsible_id')
      .eq('id', id)
      .single()

    // Notify relevant people about task completion
    if (status === 'done' && exp) {
      const { data: updater } = await admin.from('profiles').select('first_name, last_name').eq('id', user.id).single()
      const updaterName = updater ? `${updater.first_name} ${updater.last_name}`.trim() : 'Alguien'

      // Notify expediente author and responsible (if different from updater)
      const notifyIds = new Set<string>()
      if (exp.author_id && exp.author_id !== user.id) notifyIds.add(exp.author_id)
      if (exp.responsible_id && exp.responsible_id !== user.id) notifyIds.add(exp.responsible_id)

      for (const targetId of notifyIds) {
        await admin.from('announcements').insert({
          author_id: user.id,
          type: 'operativo',
          priority: 'baja',
          title: `✅ Tarea completada: ${task.title}`,
          body: `${updaterName} completó esta tarea del expediente ${exp.code}`,
          scope: 'user',
          target_user_id: targetId,
          is_active: true,
        })
      }

      // Email only to the expediente responsible
      notifyExpedienteToResponsible({
        responsibleId: exp.responsible_id,
        code: exp.code,
        title: task.title,
        action: 'Tarea completada',
        authorName: updaterName,
        detail: `"${task.title}" marcada como completada`,
      }).catch(() => {})
    }

    // Audit trail (non-blocking)
    const statusUpdaterName = userProfile ? `${userProfile.first_name} ${userProfile.last_name}`.trim() : 'Alguien'
    logAudit(admin, {
      userId: user.id,
      userName: statusUpdaterName,
      action: 'update_expediente_task',
      module: 'expedientes',
      entityType: 'expediente_task',
      entityId: task_id,
      description: `${statusUpdaterName} cambió tarea "${task.title}" a ${statusLabels[status] ?? status}`,
    }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/expedientes/[id]/tasks]', err)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function getProfileName(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('first_name, last_name').eq('id', userId).single()
  return data ? `${data.first_name} ${data.last_name}`.trim() : null
}
