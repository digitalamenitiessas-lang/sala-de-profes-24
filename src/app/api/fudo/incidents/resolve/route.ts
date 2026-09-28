import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'

export const dynamic = 'force-dynamic'

// POST /api/fudo/incidents/resolve
// Resuelve manualmente todos los incidentes Fudo abiertos.
// Solo encargados y socios pueden hacerlo (como válvula de emergencia cuando
// Fudo volvió a funcionar pero los incidents viejos bloquean el conteo).

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!isManagerOrAbove(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const admin = createAdminClient()

    const { data: open } = await admin
      .from('fudo_sync_incidents')
      .select('id')
      .eq('status', 'open')

    if (!open?.length) {
      return NextResponse.json({ resolved: 0, message: 'No había incidentes abiertos' })
    }

    const { error } = await admin
      .from('fudo_sync_incidents')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'open')

    if (error) throw error

    await admin.from('audit_trail').insert({
      user_id: user.id,
      action: 'resolve_fudo_incidents',
      module: 'stock',
      entity_type: 'fudo_sync_incidents',
      entity_id: 'all',
      description: `${open.length} incidente(s) Fudo resueltos manualmente`,
    })

    return NextResponse.json({ resolved: open.length, message: `${open.length} incidente(s) resueltos` })
  } catch (error) {
    console.error('[POST /api/fudo/incidents/resolve]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
