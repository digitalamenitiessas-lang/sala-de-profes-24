import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// POST /api/admin/extend-shift
// Encargado/socio corrige un fichaje: la salida (extensión o salida olvidada)
// y/o la entrada (fichó tarde, o fichó en otro lado). Guarda los valores
// originales y deja registro en audit_trail.
// Body: { attendance_id, new_clock_out?, new_clock_in?, reason? }
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
    const { attendance_id, new_clock_out, new_clock_in, reason } = body as {
      attendance_id?: string; new_clock_out?: string; new_clock_in?: string; reason?: string
    }

    if (!attendance_id || (!new_clock_out && !new_clock_in)) {
      return NextResponse.json({ error: 'Falta la hora de entrada o de salida' }, { status: 400 })
    }

    // Get current attendance log
    const { data: log } = await admin
      .from('attendance_logs')
      .select('id, user_id, clock_in_at, clock_out_at, operative_date, original_clock_in, original_clock_out')
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

    const originalClockOut = log.clock_out_at
    const entrada = new_clock_in ?? log.clock_in_at
    const salida = new_clock_out ?? log.clock_out_at
    if (Number.isNaN(Date.parse(entrada)) || (salida && Number.isNaN(Date.parse(salida)))) {
      return NextResponse.json({ error: 'Hora inválida' }, { status: 400 })
    }
    if (new_clock_in && Date.parse(new_clock_in) > Date.now()) {
      return NextResponse.json({ error: 'La entrada no puede ser en el futuro' }, { status: 400 })
    }
    if (salida) {
      const horas = (Date.parse(salida) - Date.parse(entrada)) / 3_600_000
      if (horas <= 0) return NextResponse.json({ error: 'La salida tiene que ser después de la entrada' }, { status: 400 })
      if (horas > 20) return NextResponse.json({ error: `Quedarían ${Math.round(horas)} horas seguidas: revisá las horas` }, { status: 400 })
    }

    const cambios: Record<string, unknown> = {
      edited_by: user.id,
      edit_reason: reason || null,
      notes: `Corregido por ${authName}${reason ? ` — ${reason}` : ''}`,
    }
    if (new_clock_out) {
      Object.assign(cambios, {
        clock_out_at: new_clock_out,
        clock_out_type: 'edited',
        // El original se guarda una sola vez (la primera corrección)
        original_clock_out: log.original_clock_out ?? originalClockOut,
        status: 'closed',
      })
    }
    if (new_clock_in) {
      Object.assign(cambios, {
        clock_in_at: new_clock_in,
        clock_in_type: 'edited',
        original_clock_in: log.original_clock_in ?? log.clock_in_at,
      })
    }

    const { error } = await admin
      .from('attendance_logs')
      .update(cambios)
      .eq('id', attendance_id)

    if (error) throw error

    const hora = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }) : 'sin marcar'
    const partes = [
      new_clock_in ? `entrada ${hora(log.clock_in_at)} → ${hora(new_clock_in)}` : null,
      new_clock_out ? `salida ${hora(originalClockOut)} → ${hora(new_clock_out)}` : null,
    ].filter(Boolean).join(', ')

    // Audit trail
    await admin.from('audit_trail').insert({
      user_id: user.id,
      user_name: authName,
      action: new_clock_in ? 'attendance_corrected' : 'shift_extended',
      module: 'asistencia',
      entity_type: 'attendance_log',
      entity_id: attendance_id,
      description: `${authName} corrigió el fichaje de ${empName}: ${partes}`,
      metadata: {
        employee_id: log.user_id,
        employee_name: empName,
        original_clock_out: originalClockOut,
        new_clock_out: new_clock_out ?? null,
        original_clock_in: log.clock_in_at,
        new_clock_in: new_clock_in ?? null,
        reason: reason || null,
        authorized_by: authName,
      },
    })

    return NextResponse.json({
      success: true,
      message: `Fichaje de ${empName} corregido`,
    })
  } catch (error) {
    console.error('[extend-shift]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
