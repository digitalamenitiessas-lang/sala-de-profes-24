import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/attendance/alerts
// Query params: from_date (default: 7 days ago), to_date (opcional, sin tope)
// Solo accesible por socio / encargado
// ---------------------------------------------------------------------------
// Fichajes sospechosos (is_suspicious) o sin egreso (status missing_checkout)
// del rango. Lee attendance_logs directo: la RPC get_suspicious_attendance
// de LVE no existe en esta base.
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const fromDate = searchParams.get('from_date') ?? undefined
    const toDate   = searchParams.get('to_date') ?? undefined

    if ((fromDate && !DATE_RE.test(fromDate)) || (toDate && !DATE_RE.test(toDate))) {
      return NextResponse.json({ error: 'Fechas inválidas (formato YYYY-MM-DD)' }, { status: 400 })
    }

    // Mismo default que tenía la RPC: últimos 7 días
    const since = new Date()
    since.setDate(since.getDate() - 7)
    const from = fromDate ?? since.toISOString().split('T')[0]

    let query = admin
      .from('attendance_logs')
      .select('id, user_id, operative_date, clock_in_at, clock_out_at, status, suspicious_reasons, profiles!attendance_logs_user_id_fkey(first_name, last_name, role)')
      .or('is_suspicious.eq.true,status.eq.missing_checkout')
      .gte('operative_date', from)
      .order('operative_date', { ascending: false })
      .order('clock_in_at', { ascending: false })

    if (toDate) query = query.lte('operative_date', toDate)

    const { data: logs, error } = await query

    if (error) throw error

    // Misma forma que devolvía get_suspicious_attendance (la consume /control)
    const alerts = (logs ?? []).map((l) => {
      const p = Array.isArray(l.profiles) ? l.profiles[0] : l.profiles
      return {
        log_id: l.id,
        user_id: l.user_id,
        first_name: p?.first_name ?? '?',
        last_name: p?.last_name ?? '',
        role: p?.role ?? '?',
        operative_date: l.operative_date,
        clock_in_at: l.clock_in_at,
        clock_out_at: l.clock_out_at,
        hours_worked: l.clock_out_at
          ? Math.round(((new Date(l.clock_out_at).getTime() - new Date(l.clock_in_at).getTime()) / 3600000) * 100) / 100
          : null,
        suspicious_reasons: l.suspicious_reasons ?? [],
        status: l.status,
      }
    })

    return NextResponse.json({ alerts })
  } catch (err) {
    console.error('[attendance/alerts]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
