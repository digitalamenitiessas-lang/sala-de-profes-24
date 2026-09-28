import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/attendance/alerts
// Query params: from_date (default: 7 days ago), to_date (default: today)
// Solo accesible por socio / encargado
// ---------------------------------------------------------------------------

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

    const { data, error } = await supabase.rpc('get_suspicious_attendance', {
      p_from_date: fromDate,
      p_to_date:   toDate,
    })

    if (error) throw error

    return NextResponse.json({ alerts: data ?? [] })
  } catch (err) {
    console.error('[attendance/alerts]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
