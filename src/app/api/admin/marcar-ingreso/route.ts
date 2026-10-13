import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { esEncargadoAhora } from '@/lib/turnos/rol-del-turno'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// POST /api/admin/marcar-ingreso  { user_id }
// El encargado marca "Llegó" a alguien que está trabajando y no fichó (sin
// celular, se olvidó). Queda la entrada ahora; si llegó antes, se corrige la
// hora con el lápiz de Equipo. Se marca como cargada por el encargado.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const TODOS = ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  try {
    const auth = await requireRole(TODOS)
    if (auth.response) return auth.response
    const admin = createAdminClient()
    if (!(await esEncargadoAhora(admin, auth.user))) {
      return NextResponse.json({ error: 'Solo el encargado de turno o un socio' }, { status: 403 })
    }
    const body = await request.json().catch(() => null) as { user_id?: string } | null
    if (!UUID.test(String(body?.user_id))) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })

    const hoy = fechaOperativa()
    const [{ data: persona }, { data: yo }, { data: abiertos }] = await Promise.all([
      admin.from('profiles').select('id, first_name, last_name, role, is_active').eq('id', body!.user_id!).maybeSingle(),
      admin.from('profiles').select('first_name, last_name').eq('id', auth.user.id).maybeSingle(),
      admin.from('attendance_logs').select('id, operative_date').eq('user_id', body!.user_id!).eq('status', 'open'),
    ])
    if (!persona?.is_active) return NextResponse.json({ error: 'Esa persona no está activa' }, { status: 400 })
    if ((abiertos ?? []).some((a: { operative_date: string }) => a.operative_date === hoy)) {
      return NextResponse.json({ error: `${persona.first_name} ya tiene la entrada marcada` }, { status: 409 })
    }
    if ((abiertos ?? []).length > 0) {
      return NextResponse.json({ error: `${persona.first_name} tiene una salida sin marcar de otro día: corregila primero` }, { status: 409 })
    }

    const quien = [yo?.first_name, yo?.last_name].filter(Boolean).join(' ') || 'El encargado'
    const nombre = [persona.first_name, persona.last_name].filter(Boolean).join(' ')
    const { data: log, error } = await admin.from('attendance_logs').insert({
      user_id: persona.id,
      operative_date: hoy,
      clock_in_at: new Date().toISOString(),
      clock_in_type: 'encargado',
      status: 'open',
      edited_by: auth.user.id,
      notes: `Entrada marcada por ${quien}`,
    }).select('id').single()
    if (error) throw error

    void logAudit(admin, {
      userId: auth.user.id, userName: quien, action: 'attendance_marked_by_manager', module: 'asistencia',
      entityType: 'attendance_log', entityId: log.id, description: `${quien} marcó la entrada de ${nombre}`,
    })
    return NextResponse.json({ success: true, id: log.id })
  } catch (err) {
    console.error('[marcar-ingreso]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
