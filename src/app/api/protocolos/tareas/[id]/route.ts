import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { isManagerOrAbove } from '@/lib/roles'
import { logAudit } from '@/lib/audit'
import { sendPushToUser } from '@/lib/push/send'
import type { Tarea } from '@/lib/protocolos/protocolos'

// ---------------------------------------------------------------------------
// POST /api/protocolos/tareas/[id]
//   JSON { accion: 'asignar', user_id }      → encargado/socio asigna (o se asigna)
//   FormData accion=completar, foto_0…foto_N, pasos (JSON), nota
//        → quien la tiene asignada (o encargado/socio) la completa: TODOS los
//          pasos marcados y TODAS las fotos del protocolo (baño: general + basura).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TODOS = ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_FOTO = 5 * 1024 * 1024

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRole(TODOS)
    if (auth.response) return auth.response
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Tarea inválida' }, { status: 400 })
    const admin = createAdminClient()

    const { data: tarea } = await admin.from('protocolo_tareas').select('*, protocolos(nombre, pasos, fotos, requiere_foto)').eq('id', id).maybeSingle()
    if (!tarea) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })
    const t = tarea as Tarea & { protocolos: { nombre: string; pasos: string[]; fotos: string[]; requiere_foto: boolean } }
    const { data: yo } = await admin.from('profiles').select('first_name, last_name').eq('id', auth.user.id).maybeSingle()
    const quien = [yo?.first_name, yo?.last_name].filter(Boolean).join(' ') || 'Alguien'

    const esForm = (request.headers.get('content-type') ?? '').includes('multipart/form-data')

    // ---- ASIGNAR ----
    if (!esForm) {
      const body = await request.json().catch(() => null) as { accion?: string; user_id?: string } | null
      if (body?.accion !== 'asignar' || !UUID.test(String(body.user_id))) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
      if (!isManagerOrAbove(auth.user.role)) return NextResponse.json({ error: 'Solo el encargado o un socio asigna' }, { status: 403 })
      if (t.estado === 'hecha') return NextResponse.json({ error: 'Ya está hecha' }, { status: 409 })
      const { data: persona } = await admin.from('profiles').select('id, first_name, last_name, is_active').eq('id', body.user_id!).maybeSingle()
      if (!persona?.is_active) return NextResponse.json({ error: 'Esa persona no está activa' }, { status: 400 })

      const { error } = await admin.from('protocolo_tareas').update({
        estado: 'asignada', asignado_a: persona.id, asignado_por: auth.user.id, asignado_at: new Date().toISOString(), recordatorio_at: null,
      }).eq('id', id).neq('estado', 'hecha')
      if (error) throw error
      const nombrePersona = [persona.first_name, persona.last_name].filter(Boolean).join(' ')
      if (persona.id !== auth.user.id) {
        await sendPushToUser(persona.id, {
          title: `🧽 Te toca: ${t.protocolos.nombre} (${t.hora})`,
          body: `Te lo asignó ${quien.split(' ')[0]}. Al terminar, marcá los pasos y subí las fotos.`,
          url: '/protocolos',
        }).catch(() => {})
      }
      void logAudit(admin, { userId: auth.user.id, userName: quien, action: 'protocolo_asignar', module: 'equipo', entityType: 'protocolo_tarea', entityId: id, description: `${quien} asignó "${t.protocolos.nombre}" (${t.hora}) a ${nombrePersona}` })
      return NextResponse.json({ success: true })
    }

    // ---- COMPLETAR (con foto) ----
    const form = await request.formData()
    if (form.get('accion') !== 'completar') return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
    const esManager = isManagerOrAbove(auth.user.role)
    if (t.estado === 'hecha') return NextResponse.json({ error: 'Ya está hecha' }, { status: 409 })
    if (t.asignado_a !== auth.user.id && !esManager) return NextResponse.json({ error: 'Esta tarea no está asignada a vos' }, { status: 403 })

    let pasos: string[] = []
    try { pasos = JSON.parse(String(form.get('pasos') ?? '[]')) } catch { /* inválido */ }
    const faltan = t.protocolos.pasos.filter((p) => !pasos.includes(p))
    if (faltan.length > 0) return NextResponse.json({ error: `Faltan pasos: ${faltan.join(', ')}` }, { status: 400 })

    const etiquetas = t.protocolos.requiere_foto ? (t.protocolos.fotos?.length ? t.protocolos.fotos : ['Foto']) : []
    const archivos: File[] = []
    for (let i = 0; i < etiquetas.length; i++) {
      const f = form.get(`foto_${i}`) ?? (i === 0 ? form.get('foto') : null)
      if (!(f instanceof File) || f.size === 0) return NextResponse.json({ error: `Falta: ${etiquetas[i]}` }, { status: 400 })
      if (!f.type.startsWith('image/')) return NextResponse.json({ error: `${etiquetas[i]}: tiene que ser una foto` }, { status: 400 })
      if (f.size > MAX_FOTO) return NextResponse.json({ error: `${etiquetas[i]}: la foto es muy pesada (máx. 5 MB)` }, { status: 400 })
      archivos.push(f)
    }
    const fotos: string[] = []
    for (let i = 0; i < archivos.length; i++) {
      const ruta = `${t.fecha}/${t.id}-${i + 1}.jpg`
      const { error: upErr } = await admin.storage.from('protocolos').upload(ruta, Buffer.from(await archivos[i].arrayBuffer()), { contentType: archivos[i].type, upsert: true })
      if (upErr) throw new Error(`No se pudo guardar ${etiquetas[i].toLowerCase()}: ${upErr.message}`)
      fotos.push(ruta)
    }
    const fotoPath = fotos[0] ?? null

    const nota = String(form.get('nota') ?? '').trim().slice(0, 500) || null
    const ahora = new Date().toISOString()
    const { error } = await admin.from('protocolo_tareas').update({
      estado: 'hecha', hecho_por: auth.user.id, hecho_at: ahora, foto_path: fotoPath, fotos: fotos.length ? fotos : null, pasos_ok: pasos, nota,
      ...(t.asignado_a ? {} : { asignado_a: auth.user.id, asignado_por: auth.user.id, asignado_at: ahora }),
    }).eq('id', id).neq('estado', 'hecha')
    if (error) throw error

    // Aviso a quien la asignó: quedó hecha
    if (t.asignado_por && t.asignado_por !== auth.user.id) {
      await sendPushToUser(t.asignado_por, { title: `✅ Hecho: ${t.protocolos.nombre} (${t.hora})`, body: `${quien} la completó con ${fotos.length === 1 ? 'foto' : `${fotos.length} fotos`}.`, url: '/protocolos' }).catch(() => {})
    }
    void logAudit(admin, { userId: auth.user.id, userName: quien, action: 'protocolo_completar', module: 'equipo', entityType: 'protocolo_tarea', entityId: id, description: `${quien} completó "${t.protocolos.nombre}" (${t.hora})` })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[POST /api/protocolos/tareas]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
