import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { procesarAvisos } from '@/lib/protocolos/protocolos'

// ---------------------------------------------------------------------------
// GET /api/cron/protocolos — cada 5 minutos (lo dispara pg_cron desde Supabase,
// porque Vercel Hobby solo permite crons diarios). Manda los avisos de los
// protocolos con horario: "es la hora", "sigue sin asignar", "falta
// completar" y "no se hizo". Es idempotente: cada aviso sale una sola vez.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production' && (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const enviados = await procesarAvisos(createAdminClient())
    return NextResponse.json({ ok: true, enviados })
  } catch (err) {
    console.error('[cron/protocolos]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
