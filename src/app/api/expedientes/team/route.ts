import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/expedientes/team — lista de personas asignables
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    // Only socio/encargado can assign
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role as string
    if (role !== 'socio' && role !== 'encargado') {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }

    const { data, error } = await admin
      .from('profiles')
      .select('id, first_name, last_name, role')
      .eq('is_active', true)
      .order('first_name')

    if (error) throw error
    return NextResponse.json({ data: data ?? [] })
  } catch (error) {
    console.error('[GET /api/expedientes/team]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
