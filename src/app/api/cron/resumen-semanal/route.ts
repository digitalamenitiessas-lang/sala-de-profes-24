import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { armarResumenSemanal, semanaAnterior } from '@/lib/reportes/resumen-semanal'
import { liquidacionPDF } from '@/lib/liquidacion/pdf'
import { enviarMailConAdjuntos, mailsDeRoles } from '@/lib/email/send'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// GET /api/cron/resumen-semanal — los lunes 8:00 (pg_cron, ver
// supabase/manual/resumen_semanal_reloj.sql). Manda a los socios el resumen de
// la semana anterior con la liquidación en PDF adjunta.
//   ?vista=1 → devuelve el HTML del mail sin mandar nada (para revisarlo).
// ---------------------------------------------------------------------------

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production' && (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const admin = createAdminClient()
    const { from, to } = semanaAnterior()
    const { asunto, html, liq } = await armarResumenSemanal(admin, from, to)
    if (request.nextUrl.searchParams.get('vista') === '1') {
      return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    const pdf = await liquidacionPDF(liq, request.nextUrl.origin, 'Resumen semanal')
    const destinatarios = await mailsDeRoles(['socio'])
    const r = await enviarMailConAdjuntos({
      to: destinatarios,
      subject: asunto,
      html,
      adjuntos: [{ filename: `Liquidacion LVE 24 y Maipu ${from} a ${to}.pdf`, content: pdf }],
    })
    void logAudit(admin, {
      userId: null, userName: 'Sistema', action: 'resumen_semanal', module: 'asistencia', entityType: 'mail', entityId: `${from}_${to}`,
      description: r.ok ? `Resumen semanal ${from} a ${to} enviado a ${destinatarios.length} socio${destinatarios.length !== 1 ? 's' : ''}` : `Resumen semanal ${from} a ${to} NO salió: ${r.error}`,
    })
    return NextResponse.json({ ok: r.ok, error: r.error ?? null, semana: { from, to }, destinatarios: destinatarios.length })
  } catch (err) {
    console.error('[cron/resumen-semanal]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
