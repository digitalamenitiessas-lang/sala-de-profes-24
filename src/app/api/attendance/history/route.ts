import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/attendance/history?user_id=UUID&limit=14
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const targetUserId = searchParams.get('user_id') ?? user.id
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '14'), 60)

  // Employees can only see their own history; managers can see anyone's
  if (targetUserId !== user.id) {
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('attendance_logs')
    .select('id, operative_date, clock_in_at, clock_out_at, status, notes, is_suspicious, clock_in_lat, clock_out_lat')
    .eq('user_id', targetUserId)
    .order('operative_date', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[attendance/history]', error)
    return NextResponse.json({ error: 'Error al consultar historial' }, { status: 500 })
  }

  return NextResponse.json({ records: data ?? [] })
}
