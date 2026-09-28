import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { isManagerOrAbove } from '@/lib/roles'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { asegurarTareasDelDia, estadoVisible, procesarAvisos, type Tarea } from '@/lib/protocolos/protocolos'

// GET /api/protocolos/pendientes — liviano, para la alarma de toda la app.
//   Encargado/socio: tareas que ya tocan y no están asignadas, o atrasadas.
//   Cualquiera: las que tiene asignadas y no hizo.
// Además, cada consulta procesa los avisos push (después de responder): así
// funcionan aunque el reloj de la base no esté activo. Es idempotente.
export const dynamic = 'force-dynamic'

const TODOS = ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha']

export async function GET() {
  const auth = await requireRole(TODOS)
  if (auth.response) return auth.response
  const admin = createAdminClient()
  await asegurarTareasDelDia(admin)
  after(() => procesarAvisos(admin).then(() => undefined, (err) => console.warn('[protocolos/pendientes] avisos', err)))
  const [{ data: tareas }, { data: protocolos }] = await Promise.all([
    admin.from('protocolo_tareas').select('id, protocolo_id, fecha, hora, estado, asignado_a, hecho_at').eq('fecha', fechaOperativa()).neq('estado', 'hecha'),
    admin.from('protocolos').select('id, nombre'),
  ])
  const nombre = new Map((protocolos ?? []).map((p: { id: string; nombre: string }) => [p.id, p.nombre]))
  const manager = isManagerOrAbove(auth.user.role)
  const ahora = new Date()
  const pendientes = ((tareas ?? []) as Tarea[])
    .map((t) => ({ id: t.id, nombre: nombre.get(t.protocolo_id) ?? 'Protocolo', hora: t.hora, visible: estadoVisible(t, ahora), mia: t.asignado_a === auth.user.id }))
    .filter((t) => t.visible !== 'programada' && (t.mia || (manager && (t.visible === 'sin_asignar' || t.visible === 'atrasada'))))
    .map((t) => ({ ...t, tipo: t.mia ? 'mia' : t.visible === 'atrasada' ? 'atrasada' : 'sin_asignar' }))
  return NextResponse.json({ pendientes })
}
