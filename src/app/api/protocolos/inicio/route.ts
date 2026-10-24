import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { logAudit } from '@/lib/audit'
import { CLAVE_INICIO_POR_DIA, normalizarInicioPorDia } from '@/lib/protocolos/protocolos'

// PUT /api/protocolos/inicio { inicio_por_dia: { "6": "08:45" } } — encargado/socio.
// Hora de arranque de TODOS los protocolos por día de la semana (0 = domingo):
// ese día, lo que esté antes pasa a esa hora. Rige cuando se arman las tareas
// del día; las de hoy ya están armadas y no se tocan (no se duplican).
export const dynamic = 'force-dynamic'

const DIA = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados']

export async function PUT(request: Request) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response
    const body = await request.json().catch(() => null) as { inicio_por_dia?: unknown } | null
    const pedido = body?.inicio_por_dia
    if (!pedido || typeof pedido !== 'object') return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
    const valor = normalizarInicioPorDia(pedido)
    const cargados = Object.values(pedido as Record<string, unknown>).filter((h) => h != null && h !== '').length
    if (cargados !== Object.keys(valor).length) {
      return NextResponse.json({ error: 'Hora inválida: tiene que ser entre las 06:00 y las 23:59' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin.from('app_settings').upsert(
      { key: CLAVE_INICIO_POR_DIA, value: valor, updated_by: auth.user.id, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    )
    if (error) throw error

    const { data: yo } = await admin.from('profiles').select('first_name, last_name').eq('id', auth.user.id).maybeSingle()
    const quien = [yo?.first_name, yo?.last_name].filter(Boolean).join(' ') || null
    const texto = Object.entries(valor).map(([d, h]) => `${DIA[Number(d)]} desde las ${h}`).join(', ') || 'como siempre todos los días'
    void logAudit(admin, { userId: auth.user.id, userName: quien, action: 'protocolo_config', module: 'configuracion', entityType: 'app_settings', entityId: CLAVE_INICIO_POR_DIA, description: `${quien ?? 'Alguien'} cambió la hora de arranque de los protocolos: ${texto}`, metadata: { inicio_por_dia: valor } })
    return NextResponse.json({ success: true, inicio_por_dia: valor })
  } catch (err) {
    console.error('[PUT /api/protocolos/inicio]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
