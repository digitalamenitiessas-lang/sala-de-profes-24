import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyEvent } from '@/lib/push/notify-event'
import { estadoConteoHoy } from '@/lib/stock/conteo-diario'

// ---------------------------------------------------------------------------
// GET /api/cron/conteo-recordatorio — 23:00 Argentina (02:00 UTC)
// El stock de elaborados se cuenta TODOS los días. Si a esta hora no se contó
// ninguno, avisa a encargados, socios y chef (configurable en Notificaciones).
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
    if (estado.contados > 0) return NextResponse.json({ enviado: false, estado })
    await notifyEvent(admin, 'conteo_diario_pendiente', {
      title: '📋 Falta el conteo de elaborados de hoy',
      body: 'Cargalo en Producción → Elaborados → Contar: al guardarlo le llega el resumen a todos.',
      url: '/cocina/elaborados?tab=contar',
    })
    return NextResponse.json({ enviado: true, estado })
  } catch (err) {
    console.error('[cron/conteo-recordatorio]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 })
  }
}
