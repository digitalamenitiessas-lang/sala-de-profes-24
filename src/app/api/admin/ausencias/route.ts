import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { esEncargadoAhora } from '@/lib/turnos/rol-del-turno'
import { logAudit } from '@/lib/audit'
import { ETIQUETA_AUSENCIA, MOTIVOS_AUSENCIA, type MotivoAusencia } from '@/lib/attendance/ausencias'

// ---------------------------------------------------------------------------
// /api/admin/ausencias — por qué alguien con turno no fichó
//   GET    ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD → { ausencias }
//   POST   { user_id, fecha, motivo, nota? }  → anota (o cambia) el motivo
//   DELETE { id }                             → lo quita
// Encargados, socios y quien trabaja hoy de encargado.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const TODOS = ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FECHA = /^\d{4}-\d{2}-\d{2}$/
async function autorizar() {
  const auth = await requireRole(TODOS)
  if (auth.response) return { response: auth.response }
  const admin = createAdminClient()
  if (!(await esEncargadoAhora(admin, auth.user))) {
    return { response: NextResponse.json({ error: 'Solo encargados y socios' }, { status: 403 }) }
  }
  return { admin, user: auth.user }
}

export async function GET(request: Request) {
  const a = await autorizar()
  if (a.response) return a.response
  const url = new URL(request.url)
  const desde = url.searchParams.get('desde') ?? ''
  const hasta = url.searchParams.get('hasta') ?? desde
  if (!FECHA.test(desde) || !FECHA.test(hasta)) return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 })
  const { data, error } = await a.admin.from('ausencias').select('id, user_id, fecha, motivo, nota').gte('fecha', desde).lte('fecha', hasta)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ausencias: data ?? [] })
}

export async function POST(request: Request) {
  const a = await autorizar()
  if (a.response) return a.response
  const body = await request.json().catch(() => null) as { user_id?: string; fecha?: string; motivo?: string; nota?: string } | null
  if (!UUID.test(String(body?.user_id)) || !FECHA.test(String(body?.fecha)) || !MOTIVOS_AUSENCIA.includes(body?.motivo as MotivoAusencia)) {
    return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
  }
  const nota = String(body!.nota ?? '').trim().slice(0, 300) || null
  const [{ data: persona }, { data: yo }] = await Promise.all([
    a.admin.from('profiles').select('first_name, last_name').eq('id', body!.user_id!).maybeSingle(),
    a.admin.from('profiles').select('first_name, last_name').eq('id', a.user.id).maybeSingle(),
  ])
  if (!persona) return NextResponse.json({ error: 'Persona no encontrada' }, { status: 404 })
  const { data, error } = await a.admin.from('ausencias').upsert({
    user_id: body!.user_id!, fecha: body!.fecha!, motivo: body!.motivo!, nota, created_by: a.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,fecha' }).select('id, user_id, fecha, motivo, nota').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const quien = [yo?.first_name, yo?.last_name].filter(Boolean).join(' ') || null
  void logAudit(a.admin, {
    userId: a.user.id, userName: quien, action: 'ausencia_motivo', module: 'asistencia', entityType: 'ausencia', entityId: data.id,
    description: `${quien ?? 'Alguien'} anotó "${ETIQUETA_AUSENCIA[body!.motivo as MotivoAusencia]}" para ${[persona.first_name, persona.last_name].filter(Boolean).join(' ')} el ${body!.fecha}${nota ? ` (${nota})` : ''}`,
  })
  return NextResponse.json({ success: true, ausencia: data })
}

export async function DELETE(request: Request) {
  const a = await autorizar()
  if (a.response) return a.response
  const body = await request.json().catch(() => null) as { id?: string } | null
  if (!UUID.test(String(body?.id))) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
  const { error } = await a.admin.from('ausencias').delete().eq('id', body!.id!)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
