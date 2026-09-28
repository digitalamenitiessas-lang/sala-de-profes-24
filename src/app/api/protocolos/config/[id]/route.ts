import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { logAudit } from '@/lib/audit'
import { fechaOperativa } from '@/lib/attendance/jornada'

// PUT /api/protocolos/config/[id] { horarios?, pasos?, fotos?, activo? } — encargado/socio.
// Los horarios nuevos aplican desde hoy: se crean las tareas que falten y se
// borran las de horarios quitados que todavía no se asignaron ni hicieron.
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Protocolo inválido' }, { status: 400 })
    const body = await request.json().catch(() => null) as { horarios?: string[]; pasos?: string[]; fotos?: string[]; activo?: boolean } | null
    if (!body) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })

    const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.horarios !== undefined) {
      const h = [...new Set((body.horarios ?? []).map((x) => String(x).trim()))].sort()
      if (h.length === 0 || h.length > 12 || !h.every((x) => HORA.test(x))) return NextResponse.json({ error: 'Horarios inválidos (formato 14:30, entre 1 y 12)' }, { status: 400 })
      cambios.horarios = h
    }
    if (body.pasos !== undefined) {
      const p = (body.pasos ?? []).map((x) => String(x).trim().slice(0, 120)).filter(Boolean)
      if (p.length === 0 || p.length > 20) return NextResponse.json({ error: 'Tiene que haber entre 1 y 20 pasos' }, { status: 400 })
      cambios.pasos = p
    }
    if (body.fotos !== undefined) {
      const f = (body.fotos ?? []).map((x) => String(x).trim().slice(0, 80)).filter(Boolean)
      if (f.length === 0 || f.length > 4) return NextResponse.json({ error: 'Tiene que haber entre 1 y 4 fotos' }, { status: 400 })
      cambios.fotos = f
    }
    if (body.activo !== undefined) cambios.activo = Boolean(body.activo)

    const admin = createAdminClient()
    const { data: prot, error } = await admin.from('protocolos').update(cambios).eq('id', id).select('id, nombre, horarios, activo').maybeSingle()
    if (error) throw error
    if (!prot) return NextResponse.json({ error: 'Protocolo no encontrado' }, { status: 404 })

    // Aplicar a hoy
    const hoy = fechaOperativa()
    if (prot.activo) {
      await admin.from('protocolo_tareas').upsert((prot.horarios as string[]).map((hora) => ({ protocolo_id: id, fecha: hoy, hora })), { onConflict: 'protocolo_id,fecha,hora', ignoreDuplicates: true })
    }
    const sobran = prot.activo ? (prot.horarios as string[]) : []
    let borrar = admin.from('protocolo_tareas').delete().eq('protocolo_id', id).gte('fecha', hoy).eq('estado', 'pendiente')
    if (sobran.length > 0) borrar = borrar.not('hora', 'in', `(${sobran.map((h) => `"${h}"`).join(',')})`)
    await borrar

    const { data: yo } = await admin.from('profiles').select('first_name, last_name').eq('id', auth.user.id).maybeSingle()
    const quien = [yo?.first_name, yo?.last_name].filter(Boolean).join(' ') || null
    void logAudit(admin, { userId: auth.user.id, userName: quien, action: 'protocolo_config', module: 'configuracion', entityType: 'protocolo', entityId: id, description: `${quien ?? 'Alguien'} cambió el protocolo "${prot.nombre}"`, metadata: cambios })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PUT /api/protocolos/config]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
