import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// POST /api/stock/pedido — encargado confirma que ya hizo el pedido
//   Queda en audit_trail para que otros encargados vean quién se encargó.
//   Los alerts se mantienen activos hasta que el stock se recupere
//   (el cron los resuelve cuando days_of_stock ≥ 1.5).
//
// GET /api/stock/pedido — devuelve la confirmación de hoy (si existe)
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

async function getUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, first_name, last_name')
    .eq('id', user.id)
    .single()
  if (!profile || !isManagerOrAbove(profile.role)) return null
  return {
    id: user.id,
    name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Encargado',
  }
}

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const admin = createAdminClient()

  // Busca la confirmación más reciente de hoy (día operativo = últimas 24hs)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await admin
    .from('audit_trail')
    .select('user_name, created_at, description')
    .eq('action', 'stock_ordered')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ pedido: data ?? null })
}

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const body = await request.json().catch(() => ({})) as { nota?: string }
  const nota = typeof body.nota === 'string' ? body.nota.trim() : ''

  const admin = createAdminClient()

  // Contar cuántos alerts activos hay para incluir en el log
  const { count } = await admin
    .from('stock_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .in('alert_type', ['low_stock', 'reported_shortage'])

  void logAudit(admin, {
    userId: user.id,
    userName: user.name,
    action: 'stock_ordered',
    module: 'stock',
    entityType: 'stock_alert',
    entityId: null,
    description: nota
      ? `${user.name} confirmó que hizo el pedido de los insumos bajos (${count ?? '?'} alertas activas): "${nota}"`
      : `${user.name} confirmó que hizo el pedido de los insumos bajos (${count ?? '?'} alertas activas).`,
    metadata: { alerts_count: count, nota: nota || null },
  })

  return NextResponse.json({ success: true, by: user.name })
}
