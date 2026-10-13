import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { procesarAvisos } from '@/lib/protocolos/protocolos'
import { borrarFotosViejas } from '@/lib/protocolos/fotos'

// ---------------------------------------------------------------------------
// GET /api/cron/protocolos — cada 5 minutos (lo dispara pg_cron desde Supabase,
// porque Vercel Hobby solo permite crons diarios). Manda los avisos de los
// protocolos con horario: "es la hora", "sigue sin asignar", "falta
// completar" y "no se hizo". Es idempotente: cada aviso sale una sola vez.
// También borra las fotos con más de 60 días (la tarea queda registrada).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production' && (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const admin = createAdminClient()
    const enviados = await procesarAvisos(admin)
    const fotosBorradas = await borrarFotosViejas(admin).catch(() => 0)
    return NextResponse.json({ ok: true, enviados, fotosBorradas })
  } catch (err) {
    console.error('[cron/protocolos]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
