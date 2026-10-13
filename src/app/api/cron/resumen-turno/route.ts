import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { armarResumenTurno, partirMensaje, turnoQueTermino, type Turno } from '@/lib/reportes/resumen-turno'
import { enviarTelegram } from '@/lib/telegram/send'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// GET /api/cron/resumen-turno — al cierre de cada turno (pg_cron, ver
// supabase/manual/resumen_turno_reloj.sql): 16:30 → turno mañana, 01:30 →
// turno tarde/noche. Manda el resumen por Telegram.
//   ?vista=1 → devuelve el texto sin mandar · ?turno=TM|TT&fecha=YYYY-MM-DD
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production' && (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const admin = createAdminClient()
    const p = request.nextUrl.searchParams
    const auto = turnoQueTermino()
    const turno = (p.get('turno') === 'TM' || p.get('turno') === 'TT' ? p.get('turno') : auto.turno) as Turno
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(p.get('fecha') ?? '') ? p.get('fecha')! : auto.fecha
    const texto = await armarResumenTurno(admin, fecha, turno)
    if (p.get('vista') === '1') return new NextResponse(texto, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    const r = await enviarTelegram(admin, partirMensaje(texto))
    void logAudit(admin, {
      userId: null, userName: 'Sistema', action: 'resumen_turno', module: 'equipo', entityType: 'telegram', entityId: `${fecha}_${turno}`,
      description: r.ok ? `Resumen ${turno} ${fecha} enviado a ${r.enviados} chat${r.enviados !== 1 ? 's' : ''}` : `Resumen ${turno} ${fecha} NO salió: ${r.error}`,
    })
    return NextResponse.json({ ok: r.ok, enviados: r.enviados, error: r.error ?? null, fecha, turno })
  } catch (err) {
    console.error('[cron/resumen-turno]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
