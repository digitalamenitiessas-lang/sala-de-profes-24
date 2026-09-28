import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyExpedienteToResponsible } from '@/lib/email/send'
import { STATUS_TRANSITIONS, EXPEDIENTE_STATUSES } from '@/lib/constants/expedientes'
import type { ExpedienteStatus } from '@/types/expedientes'
import { logAudit } from '@/lib/audit'
import { sendPushToUser } from '@/lib/push/send'

// ---------------------------------------------------------------------------
// PATCH /api/expedientes/[id]/status — transición de estado
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

    const body = await request.json().catch(() => null)
    if (!body?.status) return NextResponse.json({ error: 'Nuevo estado requerido' }, { status: 400 })

    const newStatus = body.status as ExpedienteStatus
    const closeReason = body.close_reason as string | undefined

    const admin = createAdminClient()

    // Get current expediente and user profile
    const [{ data: expediente }, { data: profile }] = await Promise.all([
      admin.from('expedientes')
        .select('id, code, title, status, author_id, responsible_id, urgency')
        .eq('id', id)
        .single(),
      admin.from('profiles')
        .select('role, first_name, last_name')
        .eq('id', user.id)
        .single(),
    ])

    if (!expediente) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    if (!profile) return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 404 })

    const currentStatus = expediente.status as ExpedienteStatus
    const role = profile.role as string

    // Permission checks
    const isSocio = role === 'socio'
    const isEncargado = role === 'encargado'

    // Validate transition — socio can skip to any status
    if (!isSocio) {
      const validNext = STATUS_TRANSITIONS[currentStatus] ?? []
      if (!validNext.includes(newStatus)) {
        return NextResponse.json({
          error: `Transición ${currentStatus} → ${newStatus} no permitida`,
        }, { status: 400 })
      }
    }
    const isAuthor = expediente.author_id === user.id
    const isResponsible = expediente.responsible_id === user.id

    // borrador → presentado: only author
    if (currentStatus === 'borrador' && !isAuthor && !isSocio && !isEncargado) {
      return NextResponse.json({ error: 'Solo el autor puede presentar' }, { status: 403 })
    }

    // Administrative transitions: only socio/encargado
    const adminStatuses: ExpedienteStatus[] = ['en_revision', 'admitido', 'asignado']
    if (adminStatuses.includes(newStatus) && !isSocio && !isEncargado) {
      return NextResponse.json({ error: 'Solo socio/encargado' }, { status: 403 })
    }

    // Close/complete: only socio/encargado
    const closeStatuses: ExpedienteStatus[] = ['cumplido', 'cerrado_sin_implementacion', 'archivado']
    if (closeStatuses.includes(newStatus) && !isSocio && !isEncargado) {
      return NextResponse.json({ error: 'Solo socio/encargado puede cerrar' }, { status: 403 })
    }

    // Execution flow: author, responsible, socio, or encargado
    const execStatuses: ExpedienteStatus[] = ['en_ejecucion', 'pausado', 'pendiente_tercero', 'pendiente_decision', 'revision_final']
    if (execStatuses.includes(newStatus) && !isSocio && !isEncargado && !isResponsible) {
      return NextResponse.json({ error: 'Sin permisos para esta transición' }, { status: 403 })
    }

    // Require close_reason for closing statuses
    if ((newStatus === 'cerrado_sin_implementacion' || newStatus === 'cumplido') && !closeReason?.trim()) {
      return NextResponse.json({ error: 'Motivo de cierre requerido' }, { status: 400 })
    }

    // Update
    const updateData: Record<string, unknown> = { status: newStatus }
    if (closeReason) updateData.close_reason = closeReason.trim()
    if (closeStatuses.includes(newStatus)) updateData.closed_at = new Date().toISOString()
    if (newStatus === 'cumplido' || newStatus === 'cerrado_sin_implementacion') {
      updateData.approver_id = user.id
    }

    const { error } = await admin.from('expedientes').update(updateData).eq('id', id)
    if (error) throw error

    // Log status change
    const authorName = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim()
    const fromLabel = EXPEDIENTE_STATUSES[currentStatus]?.label ?? currentStatus
    const toLabel = EXPEDIENTE_STATUSES[newStatus]?.label ?? newStatus

    await admin.from('expediente_comments').insert({
      expediente_id: id,
      author_id: user.id,
      type: 'status_change',
      body: `${authorName} cambió el estado: ${fromLabel} → ${toLabel}${closeReason ? ` — ${closeReason}` : ''}`,
      metadata: { from_status: currentStatus, to_status: newStatus, close_reason: closeReason || null },
    })

    // Notify author about status change (if changed by someone else)
    if (expediente.author_id !== user.id) {
      await admin.from('announcements').insert({
        author_id: user.id,
        type: 'operativo',
        priority: expediente.urgency === 'critica' ? 'critica' : 'media',
        title: `📋 ${expediente.title} → ${toLabel}`,
        body: `${authorName} cambió el estado del expediente ${expediente.code}`,
        scope: 'user',
        target_user_id: expediente.author_id,
        is_active: true,
      })

      // Push notification to author
      sendPushToUser(expediente.author_id, {
        title: `📋 ${expediente.title} → ${toLabel}`,
        body: `${authorName} cambió el estado del expediente ${expediente.code}`,
        url: `/expedientes/${id}`,
      }).catch(() => {})
    }

    // Email only to the responsible person
    notifyExpedienteToResponsible({
      responsibleId: expediente.responsible_id,
      code: expediente.code,
      title: expediente.title,
      action: `Cambio de estado: ${fromLabel} → ${toLabel}`,
      authorName,
      detail: closeReason || undefined,
    }).catch(() => {})

    // Audit trail (non-blocking)
    logAudit(admin, {
      userId: user.id,
      userName: authorName,
      action: 'update_expediente_status',
      module: 'expedientes',
      entityType: 'expediente',
      entityId: id,
      description: `${authorName} cambió estado de expediente a ${toLabel}`,
      metadata: { from_status: currentStatus, to_status: newStatus },
    }).catch(() => {})

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[PATCH /api/expedientes/[id]/status]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
