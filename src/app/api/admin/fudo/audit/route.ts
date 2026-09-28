import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runFudoAudit } from '@/lib/fudo/audit'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const admin = createAdminClient()
    const report = await runFudoAudit(admin)

    return NextResponse.json(report)
  } catch (error) {
    console.error('[/api/admin/fudo/audit]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al auditar Fudo' },
      { status: 500 },
    )
  }
}
