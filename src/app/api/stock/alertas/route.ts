import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'

// ---------------------------------------------------------------------------
// GET /api/stock/alertas — alertas activas de stock + estado del pedido
// Solo encargados y socios.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !isManagerOrAbove(profile.role)) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const admin = createAdminClient()

  const [alertsRes, pedidoRes] = await Promise.all([
    admin
      .from('stock_alerts')
      .select('id, alert_type, priority, message, triggered_at, stock_items(id, name, unit, current_qty)')
      .eq('status', 'active')
      .in('alert_type', ['low_stock', 'reported_shortage'])
      .order('triggered_at', { ascending: false })
      .limit(15),
    admin
      .from('audit_trail')
      .select('user_name, created_at, description')
      .eq('action', 'stock_ordered')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return NextResponse.json({
    alerts: alertsRes.data ?? [],
    pedido: pedidoRes.data ?? null,
    count: (alertsRes.data ?? []).length,
  })
}
