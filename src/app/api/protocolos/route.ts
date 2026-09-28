import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { isManagerOrAbove } from '@/lib/roles'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { asegurarTareasDelDia, estadoVisible, personalDeTurno, type Protocolo, type Tarea } from '@/lib/protocolos/protocolos'

// GET /api/protocolos — protocolos de hoy con sus tareas, el personal de turno
// (para asignar) y el cumplimiento de los últimos 7 días. Todo el equipo lo ve.
export const dynamic = 'force-dynamic'

const TODOS = ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha']

export async function GET() {
  const auth = await requireRole(TODOS)
  if (auth.response) return auth.response
  const admin = createAdminClient()
  const hoy = fechaOperativa()
  await asegurarTareasDelDia(admin, hoy)
  const desde = new Date(Date.parse(`${hoy}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10)

  const [{ data: protocolos }, { data: tareas }, personal, { data: perfiles }] = await Promise.all([
    admin.from('protocolos').select('*').order('nombre'),
    admin.from('protocolo_tareas').select('*').gte('fecha', desde).lte('fecha', hoy).order('hora'),
    personalDeTurno(admin, hoy),
    admin.from('profiles').select('id, first_name, last_name, role, is_active'),
  ])
  type Perfil = { id: string; first_name: string | null; last_name: string | null; role: string; is_active: boolean }
  const nombre = new Map(((perfiles ?? []) as Perfil[]).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ')]))
  // Respaldo para asignar si no hay nadie fichado ni con turno cargado
  const enTurno = new Set(personal.map((p) => p.id))
  const equipo = ((perfiles ?? []) as Perfil[])
    .filter((p) => p.is_active && !enTurno.has(p.id))
    .map((p) => ({ id: p.id, nombre: nombre.get(p.id) || 'Sin nombre', role: p.role, presente: false }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  const todas = (tareas ?? []) as Tarea[]

  // Fotos: links firmados (bucket privado), solo las de los últimos 7 días
  const rutas = [...new Set(todas.flatMap((t) => t.fotos ?? (t.foto_path ? [t.foto_path] : [])))]
  const urls = new Map<string, string>()
  if (rutas.length > 0) {
    const { data: firmadas } = await admin.storage.from('protocolos').createSignedUrls(rutas, 3600)
    for (const f of firmadas ?? []) if (f.path && f.signedUrl) urls.set(f.path, f.signedUrl)
  }
  const ahora = new Date()
  const armar = (t: Tarea) => ({
    ...t,
    visible: estadoVisible(t, ahora),
    asignado_nombre: t.asignado_a ? nombre.get(t.asignado_a) ?? null : null,
    hecho_nombre: t.hecho_por ? nombre.get(t.hecho_por) ?? null : null,
    foto_url: t.foto_path ? urls.get(t.foto_path) ?? null : null,
    fotos_urls: (t.fotos ?? (t.foto_path ? [t.foto_path] : [])).map((r) => urls.get(r)).filter((u): u is string => !!u),
  })

  const lista = ((protocolos ?? []) as Protocolo[]).map((p) => {
    const suyas = todas.filter((t) => t.protocolo_id === p.id)
    const historial = [...new Set(suyas.map((t) => t.fecha))].sort().reverse().map((fecha) => {
      const delDia = suyas.filter((t) => t.fecha === fecha)
      return { fecha, hechas: delDia.filter((t) => t.estado === 'hecha').length, total: delDia.length, tareas: delDia.map(armar) }
    })
    return { ...p, tareas: suyas.filter((t) => t.fecha === hoy).map(armar), historial }
  })

  return NextResponse.json({
    hoy,
    protocolos: lista,
    personal,
    equipo,
    yo: { id: auth.user.id, puede_asignar: isManagerOrAbove(auth.user.role), puede_configurar: isManagerOrAbove(auth.user.role) },
  })
}
