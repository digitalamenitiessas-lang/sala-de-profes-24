import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { ROLES } from '@/lib/constants'
import type { AppRole, PriorityValue, AnnouncementTypeValue } from '@/types/database'

// ---------------------------------------------------------------------------
// POST /api/report
// ---------------------------------------------------------------------------
// Cualquier empleado puede reportar un problema al encargado.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body?.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'Mensaje requerido' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('first_name, last_name, role')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ success: false, error: 'Perfil no encontrado' }, { status: 404 })
    }

    const isUrgent = body.urgency === 'urgente'
    const authorName = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Empleado'
    const roleLabel = ROLES[profile.role as AppRole]?.label ?? profile.role

    await admin.from('announcements').insert({
      author_id: user.id,
      type: (isUrgent ? 'urgente' : 'operativo') as AnnouncementTypeValue,
      priority: (isUrgent ? 'critica' : 'alta') as PriorityValue,
      title: `⚠️ Reporte de ${roleLabel} — ${authorName}`,
      body: body.message.trim(),
      scope: 'role',
      target_role: 'encargado',
      is_active: true,
    })

    // Audit trail (non-blocking)
    logAudit(admin, {
      userId: user.id,
      userName: authorName,
      action: 'generate_report',
      module: 'avisos',
      entityType: 'announcement',
      description: `${authorName} generó reporte: ${body.message.trim().slice(0, 80)}`,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[/api/report] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
