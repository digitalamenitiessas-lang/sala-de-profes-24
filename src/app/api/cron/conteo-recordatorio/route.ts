import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyEvent } from '@/lib/push/notify-event'
import { estadoConteoHoy } from '@/lib/stock/conteo-diario'

// ---------------------------------------------------------------------------
// GET /api/cron/conteo-recordatorio — 23:00 Argentina (02:00 UTC)
// El stock de elaborados (en la 24: lo que manda Santa Fe) se cuenta TODOS los días. Si a esta hora no se contó
// ninguno, avisa a encargados, socios y chef (configurable en Notificaciones).
// Si no hay ningún elaborado cargado (total 0) no hay nada que contar: no avisa.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production' && (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const admin = createAdminClient()
    const estado = await estadoConteoHoy(admin)
    if (estado.total === 0 || estado.contados > 0) return NextResponse.json({ enviado: false, estado })
    const cierre = estado.destino.url === '/stock/cierre'
    await notifyEvent(admin, 'conteo_diario_pendiente', {
      title: cierre ? '📋 Falta el conteo de cierre de hoy' : '📋 Falta el conteo de elaborados de hoy',
      body: cierre
        ? 'Cargalo en Stock → Conteo de cierre: con eso Santa Fe sabe qué mandar mañana.'
        : 'Cargalo en Producción → Elaborados → Contar: al guardarlo le llega el resumen a todos.',
      url: estado.destino.url,
    })
    return NextResponse.json({ enviado: true, estado })
  } catch (err) {
    console.error('[cron/conteo-recordatorio]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 })
  }
}
