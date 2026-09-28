import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/produccion/dashboard
// Métricas agregadas de rendimiento de producción.
// Query params:
//   days — rango en días (default: 30)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const admin = createAdminClient()
    const days = Number(request.nextUrl.searchParams.get('days') ?? 30)

    const { data, error } = await admin.rpc('production_dashboard', { p_days: days })
    if (error) throw error

    return NextResponse.json(data)
  } catch (err) {
    console.error('[GET /api/produccion/dashboard]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
