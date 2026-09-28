import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'

// GET /api/attendance/config
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data, error } = await supabase.from('attendance_config').select('key, value')
  if (error) return NextResponse.json({ error: 'Error al leer config' }, { status: 500 })

  const config: Record<string, unknown> = {}
  for (const row of data ?? []) {
    config[row.key] = row.value
  }

  return NextResponse.json({ config })
}

// PUT /api/attendance/config — update one or more config keys
export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['socio', 'encargado'].includes(profile.role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { updates } = await request.json() as { updates: Array<{ key: string; value: unknown }> }

  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: 'updates[] requerido' }, { status: 400 })
  }

  // La tabla solo deja LEER a los usuarios: con el cliente del usuario el
  // update no hacía nada y respondía "ok". Se escribe con el cliente interno
  // DESPUÉS de validar el rol (arriba) y el valor.
  const admin = createAdminClient()
  const errors: string[] = []
  for (const { key, value } of updates) {
    if (key === 'location') {
      const v = value as { lat?: unknown; lng?: unknown; radius_meters?: unknown }
      const ok = typeof v?.lat === 'number' && Math.abs(v.lat) <= 90 && typeof v?.lng === 'number' && Math.abs(v.lng) <= 180
        && typeof v?.radius_meters === 'number' && v.radius_meters >= 20 && v.radius_meters <= 500
      if (!ok) { errors.push('Ubicación inválida: latitud, longitud y radio entre 20 y 500 m'); continue }
    }
    const { data, error } = await admin
      .from('attendance_config')
      .update({ value: value as Json, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq('key', key)
      .select('key')
    if (error) errors.push(`Error al actualizar ${key}: ${error.message}`)
    else if (!data || data.length === 0) errors.push(`No existe la configuración "${key}"`)
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join('; ') }, { status: 500 })
  }

  return NextResponse.json({ success: true, updated: updates.map(u => u.key) })
}
