import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canCountStock } from '@/lib/roles'

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

    if (!canCountStock(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const admin = createAdminClient()

    const [lastSync, openIncidents, pendingEvents, failedEvents] = await Promise.all([
      admin
        .from('fudo_sync_events')
        .select('id, operation, status, created_at, completed_at, error_message, response_payload')
        .eq('operation', 'stock_read_sync')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('fudo_sync_incidents')
        .select('id, severity, code, title, entity_type, entity_id, stock_item_id, fudo_type, fudo_id, last_seen_at')
        .eq('status', 'open')
        .order('severity', { ascending: true })
        .order('last_seen_at', { ascending: false })
        .limit(20),
      admin
        .from('fudo_sync_events')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      admin
        .from('fudo_sync_events')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    ])

    if (lastSync.error) throw lastSync.error
    if (openIncidents.error) throw openIncidents.error
    if (pendingEvents.error) throw pendingEvents.error
    if (failedEvents.error) throw failedEvents.error

    const incidents = openIncidents.data ?? []
    const critical = incidents.filter((incident) => incident.severity === 'critical').length
    const high = incidents.filter((incident) => incident.severity === 'high').length
    const lastCompletedAt = lastSync.data?.completed_at ?? lastSync.data?.created_at ?? null
    const ageMinutes = lastCompletedAt
      ? Math.round((Date.now() - new Date(lastCompletedAt).getTime()) / 60000)
      : null

    // 'error' (bloquea el conteo de TODO el stock) es solo para incidentes
    // realmente críticos (Fudo caído, auth rota, verificación de escritura
    // fallida). Un vínculo roto puntual (ingrediente borrado en Fudo, 404) se
    // registra como 'high' — visible en el banner de alertas, pero no debe
    // frenar el trabajo del resto del stock por un solo item.
    const state = critical > 0
      ? 'error'
      : high > 0 || incidents.length > 0 || (pendingEvents.count ?? 0) > 0 || (failedEvents.count ?? 0) > 0
        ? 'warning'
        : 'ok'

    return NextResponse.json({
      state,
      last_sync_at: lastCompletedAt,
      last_sync_age_minutes: ageMinutes,
      last_sync: lastSync.data ?? null,
      incidents: {
        open: incidents.length,
        critical,
        high,
        sample: incidents,
      },
      events: {
        pending: pendingEvents.count ?? 0,
        failed_last_24h: failedEvents.count ?? 0,
      },
      generated_at: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[GET /api/fudo/status]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
