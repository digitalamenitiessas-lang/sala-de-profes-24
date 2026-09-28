import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// POST /api/admin/extend-shift
// Encargado/socio authorizes an employee to stay past their shift end.
// This edits the clock_out time and logs the authorization in audit_trail.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    // Check role — only encargado/socio
    const { data: profile } = await admin
      .from('profiles')
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .single()

    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Solo encargados pueden autorizar extensiones' }, { status: 403 })
    }

    const body = await request.json()
    const { attendance_id, new_clock_out, reason } = body

    if (!attendance_id || !new_clock_out) {
      return NextResponse.json({ error: 'attendance_id y new_clock_out requeridos' }, { status: 400 })
    }

    // Get current attendance log
    const { data: log } = await admin
      .from('attendance_logs')
      .select('id, user_id, clock_in_at, clock_out_at, operative_date')
      .eq('id', attendance_id)
      .single()

    if (!log) return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 })

    // Get employee name
    const { data: empProfile } = await admin
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', log.user_id)
      .single()

    const empName = empProfile ? `${empProfile.first_name} ${empProfile.last_name}` : '?'
    const authName = `${profile.first_name} ${profile.last_name}`

    // Save original clock_out before editing
    const originalClockOut = log.clock_out_at

    // Update attendance log
    const { error } = await admin
      .from('attendance_logs')
      .update({
        clock_out_at: new_clock_out,
        clock_out_type: 'edited',
        edited_by: user.id,
        original_clock_out: originalClockOut,
        status: 'closed',
        notes: `Extensión autorizada por ${authName}${reason ? ` — ${reason}` : ''}`,
      })
      .eq('id', attendance_id)

    if (error) throw error

    // Audit trail
    await admin.from('audit_trail').insert({
      user_id: user.id,
      user_name: authName,
      action: 'shift_extended',
      module: 'asistencia',
      entity_type: 'attendance_log',
      entity_id: attendance_id,
      description: `${authName} autorizó extensión de turno de ${empName}: ${originalClockOut ? new Date(originalClockOut).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }) : 'sin egreso'} → ${new Date(new_clock_out).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })}`,
      metadata: {
        employee_id: log.user_id,
        employee_name: empName,
        original_clock_out: originalClockOut,
        new_clock_out,
        reason: reason || null,
        authorized_by: authName,
      },
    })

    return NextResponse.json({
      success: true,
      message: `Extensión autorizada para ${empName}`,
    })
  } catch (error) {
    console.error('[extend-shift]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
