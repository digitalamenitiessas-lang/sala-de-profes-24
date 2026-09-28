import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fechaOperativa } from '@/lib/attendance/jornada'

// GET /api/attendance/status
// El fichaje "actual": el ingreso abierto (aunque haya pasado la medianoche)
// o, si no hay, el último del día operativo (corte 06:00).
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const hoy = fechaOperativa()
  const campos = 'id, operative_date, clock_in_at, clock_out_at, status, is_suspicious, suspicious_reasons, clock_in_lat, clock_in_lng'

  const { data: abierto } = await supabase
    .from('attendance_logs')
    .select(campos)
    .eq('user_id', user.id)
    .eq('status', 'open')
    .order('clock_in_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: delDia } = abierto ? { data: null } : await supabase
    .from('attendance_logs')
    .select(campos)
    .eq('user_id', user.id)
    .eq('operative_date', hoy)
    .order('clock_in_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const todayRecord = abierto ?? delDia
  const status = !todayRecord ? 'not_clocked_in' : todayRecord.status === 'open' ? 'clocked_in' : 'completed'

  return NextResponse.json({ status, today_record: todayRecord, operative_date: hoy })
}
