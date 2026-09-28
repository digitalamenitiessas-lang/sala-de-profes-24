import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function requireAdmin(role: string) {
  return ['socio', 'encargado'].includes(role)
}

// GET /api/attendance/devices
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const isAdmin = profile && requireAdmin(profile.role)

  const { searchParams } = new URL(request.url)
  const targetId = isAdmin ? (searchParams.get('employee_id') ?? undefined) : user.id

  let query = supabase
    .from('device_registrations')
    .select('*, profiles!device_registrations_employee_id_fkey(first_name, last_name, role)')
    .order('registered_at', { ascending: false })

  if (!isAdmin) query = query.eq('employee_id', user.id)
  else if (targetId) query = query.eq('employee_id', targetId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Error al consultar dispositivos' }, { status: 500 })
  return NextResponse.json({ devices: data ?? [] })
}

// POST /api/attendance/devices — approve or register a device
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !requireAdmin(profile.role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { device_id, device_name, is_active } = await request.json()
  if (!device_id) return NextResponse.json({ error: 'device_id requerido' }, { status: 400 })

  const { data, error } = await supabase
    .from('device_registrations')
    .update({
      is_active: is_active ?? true,
      device_name: device_name ?? undefined,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', device_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Error al actualizar dispositivo' }, { status: 500 })
  return NextResponse.json({ device: data })
}

// DELETE /api/attendance/devices?id=
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !requireAdmin(profile.role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  const { error } = await supabase
    .from('device_registrations')
    .update({ is_active: false })
    .eq('id', id)

  if (error) return NextResponse.json({ error: 'Error al desactivar dispositivo' }, { status: 500 })
  return NextResponse.json({ success: true })
}
