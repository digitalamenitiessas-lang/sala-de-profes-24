import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { esEncargadoAhora } from '@/lib/turnos/rol-del-turno'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// POST /api/admin/anular-ingreso  { attendance_id, reason? }
// Deshace una entrada marcada por error (un "Llegó" tocado sin querer, o
// alguien que fichó y en realidad no trabaja hoy). Sin esto la entrada
// quedaba abierta: el cierre automático le sumaba las horas de todo el turno
// y la persona no podía fichar cuando llegaba de verdad.
//
// Solo entradas de HOY que todavía no tienen salida; lo demás se corrige con
// el lápiz. Se borra el registro y queda completo en audit_trail (metadata)
// para poder reponerlo si hiciera falta.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const TODOS = ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  try {
    const auth = await requireRole(TODOS)
    if (auth.response) return auth.response
    const admin = createAdminClient()
    // Los mismos que pueden marcar "Llegó" pueden deshacerlo
    if (!(await esEncargadoAhora(admin, auth.user))) {
      return NextResponse.json({ error: 'Solo el encargado de turno o un socio' }, { status: 403 })
    }
    const body = await request.json().catch(() => null) as { attendance_id?: string; reason?: string } | null
    if (!UUID.test(String(body?.attendance_id))) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 200) : ''

    const { data: log } = await admin
      .from('attendance_logs')
      .select('*')
      .eq('id', body!.attendance_id!)
      .maybeSingle()
    if (!log) return NextResponse.json({ error: 'Fichaje no encontrado' }, { status: 404 })
    if (log.status !== 'open' || log.clock_out_at || log.operative_date !== fechaOperativa()) {
      return NextResponse.json({
        error: 'Solo se puede anular una entrada de hoy que todavía no tiene salida. Para otros casos corregí las horas con el lápiz.',
      }, { status: 409 })
    }

    const [{ data: persona }, { data: yo }] = await Promise.all([
      admin.from('profiles').select('first_name, last_name').eq('id', log.user_id).maybeSingle(),
      admin.from('profiles').select('first_name, last_name').eq('id', auth.user.id).maybeSingle(),
    ])
    const nombre = [persona?.first_name, persona?.last_name].filter(Boolean).join(' ') || 'la persona'
    const quien = [yo?.first_name, yo?.last_name].filter(Boolean).join(' ') || 'El encargado'

    // .eq('status','open'): si justo marcó la salida, no se borra nada
    const { data: borrados, error } = await admin
      .from('attendance_logs')
      .delete()
      .eq('id', log.id)
      .eq('status', 'open')
      .is('clock_out_at', null)
      .select('id')
    if (error) throw error
    if (!borrados?.length) {
      return NextResponse.json({ error: `${nombre} ya tiene la salida marcada: corregí las horas con el lápiz` }, { status: 409 })
    }

    const hora = new Date(log.clock_in_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })
    void logAudit(admin, {
      userId: auth.user.id,
      userName: quien,
      action: 'attendance_voided',
      module: 'asistencia',
      entityType: 'attendance_log',
      entityId: log.id,
      description: `${quien} anuló la entrada de ${nombre} de las ${hora}${reason ? ` — ${reason}` : ''}`,
      // El registro completo, para poder reponerlo
      metadata: { reason: reason || null, registro: log },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[anular-ingreso]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
