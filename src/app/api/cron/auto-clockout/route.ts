import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cargarDatosCierre, cierrePrevisto } from '@/lib/attendance/jornada'
import { logAudit } from '@/lib/audit'
import { avisarIngresosSinMarcar } from '@/lib/attendance/recordatorios'

// ---------------------------------------------------------------------------
// GET /api/cron/auto-clockout
// Lo llama el reloj de la base cada 15 minutos (pg_cron, ver
// supabase/manual/fichajes_reloj.sql) y, de respaldo, el cron diario de
// Vercel. Cierra los fichajes que quedaron abiertos cuando ya pasó su hora
// prevista de salida (turno; sin turno, cierre del local con máximo 9 h).
// Además avisa a quien no marcó la entrada (y al encargado si sigue sin fichar).
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

  try {
    const admin = createAdminClient()
    const now = new Date()

    const avisos = await avisarIngresosSinMarcar(admin, now).catch((e) => {
      console.warn('[auto-clockout] avisos de entrada', e)
      return { personas: 0, encargados: 0 }
    })

    // Fichajes abiertos (alguien se olvidó de marcar la salida)
    const { data: openLogs } = await admin
      .from('attendance_logs')
      .select('id, user_id, clock_in_at, operative_date')
      .is('clock_out_at', null)
      .eq('status', 'open')

    if (!openLogs?.length) {
      return NextResponse.json({ message: 'No open shifts to close', closed: 0, avisos })
    }

    // Hora prevista de salida: su turno de ese día o el cierre del local
    // (misma regla que al fichar; ver lib/attendance/jornada.ts). Solo se
    // cierra si esa hora ya pasó.
    const datos = await cargarDatosCierre(admin, openLogs.map((l) => l.operative_date))

    let closed = 0
    const details: string[] = []

    for (const log of openLogs) {
      const cierre = cierrePrevisto(log, datos)
      if (now < cierre.at) continue

      const { data: profile } = await admin
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', log.user_id)
        .single()
      const empName = profile ? `${profile.first_name} ${profile.last_name}` : '?'
      const hora = cierre.at.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })

      const { error } = await admin
        .from('attendance_logs')
        .update({
          clock_out_at: cierre.at.toISOString(),
          status: 'closed',
          clock_out_type: 'auto',
          notes: `Salida no marcada: cerrado a las ${hora} (${cierre.fuente})`,
        })
        .eq('id', log.id)
        .eq('status', 'open')

      if (!error) {
        closed++
        details.push(`${empName}: ${hora} (${cierre.fuente})`)
      }
    }

    // Audit trail (non-blocking)
    if (closed > 0) {
      logAudit(admin, {
        userId: null,
        userName: 'Sistema',
        action: 'auto_clockout',
        module: 'asistencia',
        entityType: 'attendance_log',
        description: `Auto-egreso de ${closed} empleados`,
      })
    }

    return NextResponse.json({
      message: `Auto clock-out: ${closed}/${openLogs.length} cerrados`,
      closed,
      total: openLogs.length,
      details,
      avisos,
    })
  } catch (error) {
    console.error('[auto-clockout]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
