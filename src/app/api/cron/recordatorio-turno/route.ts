import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToUser } from '@/lib/push/send'
import { getNotificationSettings } from '@/lib/push/notify-event'

// ---------------------------------------------------------------------------
// GET /api/cron/recordatorio-turno
// ---------------------------------------------------------------------------
// Corre a las 18:00 AR (21:00 UTC). Para cada turno de mañana, avisa a la
// persona con el horario y le pide que confirme con el encargado si no puede
// ir. Así nadie llega "de sorpresa" sin saber que tiene que trabajar.
//
// Dedup: avisos_enviados con clave "turno_manana:{shift.id}" — no se repite
// aunque el cron se vuelva a ejecutar. Si el turno fue modificado después de
// enviar el aviso, el encargado lo comunica directamente (caso raro).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const admin = createAdminClient()

  // Verificar que el evento esté habilitado en la config del admin
  const settings = await getNotificationSettings(admin)
  if (!settings['turno_manana']?.enabled) {
    return NextResponse.json({ skipped: true, reason: 'evento deshabilitado' })
  }

  // Fecha de mañana en Argentina (calendar date, no operativa)
  const ahoraAR = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  const mañanaAR = new Date(ahoraAR)
  mañanaAR.setDate(mañanaAR.getDate() + 1)
  const mañanaStr = mañanaAR.toLocaleDateString('en-CA') // 'YYYY-MM-DD'
  const diaNombre = mañanaAR.toLocaleDateString('es-AR', { weekday: 'long', timeZone: 'America/Argentina/Buenos_Aires' })

  // Turnos de mañana
  const { data: turnos, error } = await admin
    .from('shifts')
    .select('id, user_id, start_time, end_time, shift_role')
    .eq('shift_date', mañanaStr)
    .order('start_time')

  if (error) {
    console.error('[recordatorio-turno] error leyendo shifts:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!turnos || turnos.length === 0) {
    return NextResponse.json({ enviados: 0, sin_turnos: true })
  }

  // Perfiles activos (nombre y rol)
  const userIds = [...new Set(turnos.map((t: { user_id: string }) => t.user_id))]
  const { data: perfiles } = await admin
    .from('profiles')
    .select('id, first_name, last_name, role')
    .in('id', userIds)
    .eq('is_active', true)
  const perfil = new Map(
    ((perfiles ?? []) as { id: string; first_name: string | null; last_name: string | null; role: string }[])
      .map((p) => [p.id, p]),
  )

  // Ausencias ya anotadas para mañana (no avisar si tiene licencia/franco)
  const { data: ausencias } = await admin
    .from('ausencias')
    .select('user_id')
    .eq('fecha', mañanaStr)
  const tieneAusencia = new Set((ausencias ?? []).map((a: { user_id: string }) => a.user_id))

  // Avisar solo una vez por turno
  const reservar = async (shiftId: string): Promise<boolean> => {
    const clave = `turno_manana:${shiftId}`
    const { data } = await admin
      .from('avisos_enviados')
      .upsert({ clave }, { onConflict: 'clave', ignoreDuplicates: true })
      .select('clave')
    return (data ?? []).length > 0
  }

  let enviados = 0
  const sinPush: string[] = []

  for (const t of turnos as { id: string; user_id: string; start_time: string; end_time: string | null; shift_role: string | null }[]) {
    const p = perfil.get(t.user_id)
    if (!p) continue
    if (tieneAusencia.has(t.user_id)) continue

    const hora = t.start_time?.slice(0, 5) ?? '?'
    const horaFin = t.end_time?.slice(0, 5)
    const nombre = p.first_name ?? 'Hola'

    if (!(await reservar(t.id))) continue // ya enviado

    const result = await sendPushToUser(t.user_id, {
      title: `📅 Mañana ${diaNombre} trabajás a las ${hora}`,
      body: `${nombre}, tenés turno el ${diaNombre}${horaFin ? ` de ${hora} a ${horaFin}` : ` a las ${hora}`}. Si no podés ir, avisale a tu encargado lo antes posible.`,
      url: '/mi-turno',
    }).catch(() => null)

    if (result === null || result === false) {
      sinPush.push(p.first_name ?? t.user_id)
    } else {
      enviados++
    }
  }

  return NextResponse.json({
    mañana: mañanaStr,
    turnos: turnos.length,
    enviados,
    sin_push: sinPush.length > 0 ? sinPush : undefined,
  })
}
