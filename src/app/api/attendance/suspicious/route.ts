import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/attendance/suspicious
// Returns flagged attendance records. Socio/encargado only.
// Query: ?days=7
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const days = Number(request.nextUrl.searchParams.get('days') ?? 7)
    const since = new Date()
    since.setDate(since.getDate() - days)

    const admin = createAdminClient()
    const { data: logs, error } = await admin
      .from('attendance_logs')
      .select('id, user_id, operative_date, clock_in_at, clock_out_at, status, is_suspicious, suspicious_reasons, clock_in_lat, clock_in_lng, device_fingerprint, network_ip, profiles!attendance_logs_user_id_fkey(first_name, last_name, role)')
      .eq('is_suspicious', true)
      .gte('operative_date', since.toISOString().split('T')[0])
      .order('operative_date', { ascending: false })
      .limit(50)

    if (error) throw error

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (logs ?? []).map((l: any) => ({
      id: l.id,
      user_id: l.user_id,
      employee_name: l.profiles ? `${l.profiles.first_name} ${l.profiles.last_name}` : '?',
      role: l.profiles?.role ?? '?',
      operative_date: l.operative_date,
      clock_in_at: l.clock_in_at,
      clock_out_at: l.clock_out_at,
      status: l.status,
      reasons: l.suspicious_reasons ?? [],
      lat: l.clock_in_lat,
      lng: l.clock_in_lng,
      device: l.device_fingerprint,
      ip: l.network_ip,
    }))

    // Summary by reason
    const reasonCounts: Record<string, number> = {}
    for (const item of items) {
      for (const r of item.reasons) {
        const key = r.split(':')[0]
        reasonCounts[key] = (reasonCounts[key] ?? 0) + 1
      }
    }

    return NextResponse.json({
      items,
      total: items.length,
      reason_summary: reasonCounts,
    })
  } catch (error) {
    console.error('[GET /api/attendance/suspicious]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/attendance/suspicious
// Dismiss a suspicious flag. Socio/encargado only.
// Body: { logId, action: 'dismiss' | 'reviewed' }
// ---------------------------------------------------------------------------

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role, first_name').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const body = await request.json()
    if (!body.logId) return NextResponse.json({ error: 'logId requerido' }, { status: 400 })

    const admin = createAdminClient()
    const { error } = await admin
      .from('attendance_logs')
      .update({
        is_suspicious: false,
        suspicious_reasons: [],
      })
      .eq('id', body.logId)

    if (error) throw error

    await admin.from('audit_trail').insert({
      user_id: user.id,
      user_name: profile.first_name,
      action: 'dismiss_suspicious',
      module: 'asistencia',
      entity_type: 'attendance_log',
      entity_id: body.logId,
      description: `${profile.first_name} descartó alerta sospechosa`,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[PATCH /api/attendance/suspicious]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
