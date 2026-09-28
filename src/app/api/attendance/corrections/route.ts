import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/attendance/corrections
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = profile && ['socio', 'encargado'].includes(profile.role)
  const { searchParams } = new URL(request.url)
  const statusFilter = searchParams.get('status')

  let query = supabase
    .from('attendance_corrections')
    .select(`
      *,
      requester:profiles!attendance_corrections_requested_by_fkey(first_name, last_name),
      employee:profiles!attendance_corrections_employee_id_fkey(first_name, last_name, role)
    `)
    .order('created_at', { ascending: false })

  if (!isAdmin) {
    query = query.or(`employee_id.eq.${user.id},requested_by.eq.${user.id}`)
  }
  if (statusFilter) query = query.eq('status', statusFilter)

  const { data, error } = await query.limit(100)
  if (error) return NextResponse.json({ error: 'Error al consultar correcciones' }, { status: 500 })
  return NextResponse.json({ corrections: data ?? [] })
}

// POST /api/attendance/corrections — request a correction
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const body = await request.json()
  const { employee_id, original_event_id, correction_type, old_value, new_value, reason } = body

  if (!correction_type || !new_value || !reason) {
    return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = profile && ['socio', 'encargado'].includes(profile.role)

  // Only admins can request corrections for other employees
  const targetEmployee = employee_id ?? user.id
  if (targetEmployee !== user.id && !isAdmin) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('attendance_corrections')
    .insert({
      employee_id: targetEmployee,
      original_event_id: original_event_id ?? null,
      correction_type,
      old_value: old_value ?? null,
      new_value,
      reason,
      requested_by: user.id,
      // Admins auto-approve their own corrections
      status: isAdmin ? 'approved' : 'pending',
      approved_by: isAdmin ? user.id : null,
      approved_at: isAdmin ? new Date().toISOString() : null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Error al crear corrección' }, { status: 500 })

  // If admin approved, apply the correction
  if (isAdmin && data) {
    await applyCorrection(supabase, data)
  }

  return NextResponse.json({ correction: data })
}

// PATCH /api/attendance/corrections — approve or reject
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['socio', 'encargado'].includes(profile.role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { id, action, rejection_reason } = await request.json()
  if (!id || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected'

  const { data, error } = await supabase
    .from('attendance_corrections')
    .update({
      status: newStatus,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      rejection_reason: rejection_reason ?? null,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Error al actualizar corrección' }, { status: 500 })

  if (action === 'approve' && data) {
    await applyCorrection(supabase, data)
  }

  return NextResponse.json({ correction: data })
}

// Apply an approved correction to clock_events
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyCorrection(supabase: any, correction: any) {
  const { correction_type, original_event_id, new_value, employee_id } = correction

  if (correction_type === 'change_time' && original_event_id && new_value?.timestamp) {
    await supabase
      .from('clock_events')
      .update({ timestamp: new_value.timestamp, verified: false })
      .eq('id', original_event_id)
  }

  if (correction_type === 'remove_event' && original_event_id) {
    await supabase.from('clock_events').delete().eq('id', original_event_id)
  }

  if (correction_type === 'add_missing' && new_value?.event_type && new_value?.timestamp) {
    await supabase.from('clock_events').insert({
      employee_id,
      event_type: new_value.event_type,
      timestamp: new_value.timestamp,
      verified: false,
      anomaly_flags: [{ type: 'manual_correction', correction_id: correction.id }],
    })
  }
}
