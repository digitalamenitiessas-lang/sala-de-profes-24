import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/attendance/anomalies
// Params: employee_id?, resolved?, from?, to?
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isAdmin = profile && ['socio', 'encargado'].includes(profile.role)
  const { searchParams } = new URL(request.url)
  const targetId = isAdmin ? (searchParams.get('employee_id') ?? undefined) : user.id
  const resolved = searchParams.get('resolved')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabase
    .from('attendance_anomalies')
    .select(`
      *,
      profiles!attendance_anomalies_employee_id_fkey(first_name, last_name, role),
      clock_events!attendance_anomalies_clock_event_id_fkey(event_type, timestamp)
    `)
    .order('created_at', { ascending: false })

  if (!isAdmin) query = query.eq('employee_id', user.id)
  if (targetId) query = query.eq('employee_id', targetId)
  if (resolved !== null && resolved !== undefined) query = query.eq('resolved', resolved === 'true')
  if (from) query = query.gte('created_at', `${from}T00:00:00-03:00`)
  if (to)   query = query.lte('created_at', `${to}T23:59:59-03:00`)

  const { data, error } = await query.limit(200)

  if (error) return NextResponse.json({ error: 'Error al consultar anomalías' }, { status: 500 })
  return NextResponse.json({ anomalies: data ?? [] })
}

// PATCH /api/attendance/anomalies/:id — resolve an anomaly
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['socio', 'encargado'].includes(profile.role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { id, resolution_notes } = await request.json()
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  const { data, error } = await supabase
    .from('attendance_anomalies')
    .update({
      resolved: true,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_notes: resolution_notes ?? null,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Error al resolver anomalía' }, { status: 500 })
  return NextResponse.json({ anomaly: data })
}
