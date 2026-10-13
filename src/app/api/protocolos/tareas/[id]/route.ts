import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { esEncargadoAhora } from '@/lib/turnos/rol-del-turno'
import { logAudit } from '@/lib/audit'
import { sendPushToUser } from '@/lib/push/send'
import { ANTICIPO_MIN, candidatosPara, personalDeTurno, sePuedeCerrar, type Tarea } from '@/lib/protocolos/protocolos'
import { optimizarFoto } from '@/lib/protocolos/fotos'
import { registrarPesoTolva } from '@/lib/protocolos/tolva'
import { estadoConteoHoy } from '@/lib/stock/conteo-diario'
import { instanteDe } from '@/lib/attendance/jornada'

// ---------------------------------------------------------------------------
// POST /api/protocolos/tareas/[id]
//   JSON { accion: 'asignar', user_id }      → encargado/socio (o quien trabaja hoy
//        de encargado) asigna a alguien que esté en turno a esa hora
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

    const { data: tarea } = await admin.from('protocolo_tareas').select('*, protocolos(nombre, pasos, fotos, requiere_foto, medicion_etiqueta, medicion_unidad, registro, roles)').eq('id', id).maybeSingle()
    if (!tarea) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })
    const t = tarea as unknown as Tarea & { protocolos: { nombre: string; pasos: string[]; fotos: string[]; requiere_foto: boolean; medicion_etiqueta: string | null; medicion_unidad: string | null; registro: string | null; roles: string[] | null } }
    const { data: yo } = await admin.from('profiles').select('first_name, last_name').eq('id', auth.user.id).maybeSingle()
    const quien = [yo?.first_name, yo?.last_name].filter(Boolean).join(' ') || 'Alguien'

    const esForm = (request.headers.get('content-type') ?? '').includes('multipart/form-data')

    // ---- ASIGNAR ----
    if (!esForm) {
      const body = await request.json().catch(() => null) as { accion?: string; user_id?: string } | null
      if (body?.accion !== 'asignar' || !UUID.test(String(body.user_id))) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
      if (!(await esEncargadoAhora(admin, auth.user))) return NextResponse.json({ error: 'Solo el encargado de turno o un socio asigna' }, { status: 403 })
      if (t.estado === 'hecha') return NextResponse.json({ error: 'Ya está hecha' }, { status: 409 })
      const { data: persona } = await admin.from('profiles').select('id, first_name, last_name, is_active').eq('id', body.user_id!).maybeSingle()
      if (!persona?.is_active) return NextResponse.json({ error: 'Esa persona no está activa' }, { status: 400 })
      // Solo a quien esté trabajando a esa hora (turno cargado o fichado ahora)
      const candidatos = candidatosPara(await personalDeTurno(admin, t.fecha), t, new Date(), t.protocolos.roles)
      if (!candidatos.some((c) => c.id === persona.id)) {
        const primer = persona.first_name || 'Esa persona'
        const soloRoles = t.protocolos.roles?.length ? ` de ${t.protocolos.roles.join(' o ')}` : ''
        return NextResponse.json({ error: `${primer} no está en turno${soloRoles} a las ${t.hora}: solo se asigna a quien trabaja a esa hora${soloRoles ? ' en ese puesto' : ''}` }, { status: 400 })
      }

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
    const esManager = await esEncargadoAhora(admin, auth.user)
    if (t.estado === 'hecha') return NextResponse.json({ error: 'Ya está hecha' }, { status: 409 })
    if (t.asignado_a !== auth.user.id && !esManager) return NextResponse.json({ error: 'Esta tarea no está asignada a vos' }, { status: 403 })
    if (!sePuedeCerrar(t)) return NextResponse.json({ error: `Esta es la de las ${t.hora}: se puede cerrar desde ${ANTICIPO_MIN} minutos antes. ¿No será otra tarea?` }, { status: 400 })

    let pasos: string[] = []
    try { pasos = JSON.parse(String(form.get('pasos') ?? '[]')) } catch { /* inválido */ }
    const faltan = t.protocolos.pasos.filter((p) => !pasos.includes(p))
    if (faltan.length > 0) return NextResponse.json({ error: `Faltan pasos: ${faltan.join(', ')}` }, { status: 400 })

    // Conteo de elaborados: la tarea no se cierra sin el conteo del día cargado
    // (antes se podía tildar los pasos y cerrarla sin cargar ninguna cantidad)
    if (t.protocolos.registro === 'conteo_elaborados') {
      const c = await estadoConteoHoy(admin)
      const minimo = Math.min(10, c.total)
      if (c.contados < minimo) {
        return NextResponse.json({
          error: `Primero cargá el conteo: tocá "Cargar el conteo" (Cocina → Elaborados → Contar), poné cuánto hay de cada uno y guardalo. Hoy van ${c.contados} de ${c.total} elaborados.`,
        }, { status: 400 })
      }
    }

    // Control de descartables: los vasos tienen que estar contados en Stock
    // (antes se escribían en la nota y el stock no se enteraba)
    if (t.protocolos.registro === 'conteo_descartables') {
      const desde = new Date(instanteDe(t.fecha, t.hora).getTime() - 60 * 60_000).toISOString()
      const { data: vasos } = await admin.from('stock_items').select('name, last_counted_at').eq('is_active', true).eq('area', 'descartables').ilike('name', '%vaso%')
      const sinContar = ((vasos ?? []) as { name: string; last_counted_at: string | null }[]).filter((v) => !v.last_counted_at || v.last_counted_at < desde)
      if (sinContar.length > 0) {
        return NextResponse.json({
          error: `Primero contá los vasos: tocá "Contar los vasos", cargá cuántos hay y guardá. Faltan: ${sinContar.map((v) => v.name).join(', ')}.`,
        }, { status: 400 })
      }
    }

    // Número a registrar (ej. peso de la tolva): obligatorio si el protocolo lo pide
    let medicion: number | null = null
    if (t.protocolos.medicion_etiqueta) {
      const crudo = String(form.get('medicion') ?? '').replace(',', '.').trim()
      medicion = crudo === '' ? NaN : Number(crudo)
      if (!Number.isFinite(medicion) || medicion < 0 || medicion > 100_000) {
        return NextResponse.json({ error: `Falta: ${t.protocolos.medicion_etiqueta.toLowerCase()}` }, { status: 400 })
      }
    }

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
      // Se achica en el servidor (1024 px, ~50 KB) para no llenar el almacenamiento
      const foto = await optimizarFoto(Buffer.from(await archivos[i].arrayBuffer()))
      const { error: upErr } = await admin.storage.from('protocolos').upload(ruta, foto.buffer, { contentType: foto.contentType, upsert: true })
      if (upErr) throw new Error(`No se pudo guardar ${etiquetas[i].toLowerCase()}: ${upErr.message}`)
      fotos.push(ruta)
    }
    const fotoPath = fotos[0] ?? null

    const nota = String(form.get('nota') ?? '').trim().slice(0, 500) || null
    const ahora = new Date().toISOString()
    const { error } = await admin.from('protocolo_tareas').update({
      estado: 'hecha', hecho_por: auth.user.id, hecho_at: ahora, foto_path: fotoPath, fotos: fotos.length ? fotos : null, pasos_ok: pasos, nota, medicion,
      ...(t.asignado_a ? {} : { asignado_a: auth.user.id, asignado_por: auth.user.id, asignado_at: ahora }),
    }).eq('id', id).neq('estado', 'hecha')
    if (error) throw error

    // El peso de la tolva pasa solo al registro de Tolva
    let enTolva: string | null = null
    if (t.protocolos.registro === 'tolva' && medicion != null) {
      enTolva = await registrarPesoTolva(admin, t.fecha, t.hora, medicion, auth.user.id).catch((e) => {
        console.warn('[protocolos] no se pudo pasar el peso a Tolva', e)
        return null
      })
    }

    // Aviso a quien la asignó: quedó hecha
    if (t.asignado_por && t.asignado_por !== auth.user.id) {
      await sendPushToUser(t.asignado_por, { title: `✅ Hecho: ${t.protocolos.nombre} (${t.hora})`, body: `${quien} la completó${medicion != null ? ` · ${medicion.toLocaleString('es-AR')} ${t.protocolos.medicion_unidad ?? ''}`.trimEnd() : ''}${fotos.length ? ` con ${fotos.length === 1 ? 'foto' : `${fotos.length} fotos`}` : ''}.${nota ? ` Nota: ${nota.slice(0, 140)}` : ''}`, url: '/protocolos' }).catch(() => {})
    }
    // La nota (ej. "falta lomo, pappardelle…") les llega a todos los encargados
    // (cajeros incluidos), aunque nadie haya asignado la tarea
    if (nota) {
      const yaAvisado = new Set([auth.user.id, t.asignado_por ?? ''])
      const { data: encs } = await admin.from('profiles').select('id').eq('is_active', true).eq('role', 'encargado')
      const encargados = ((encs ?? []) as { id: string }[]).map((p) => p.id).filter((x) => !yaAvisado.has(x))
      await Promise.allSettled(encargados.map((uid) => sendPushToUser(uid, {
        title: `📝 ${t.protocolos.nombre}: nota de ${quien.split(' ')[0]}`,
        body: nota.slice(0, 180),
        url: '/protocolos',
      })))
    }
    void logAudit(admin, { userId: auth.user.id, userName: quien, action: 'protocolo_completar', module: 'equipo', entityType: 'protocolo_tarea', entityId: id, description: `${quien} completó "${t.protocolos.nombre}" (${t.hora})` })
    return NextResponse.json({ success: true, enTolva })
  } catch (err) {
    console.error('[POST /api/protocolos/tareas]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
