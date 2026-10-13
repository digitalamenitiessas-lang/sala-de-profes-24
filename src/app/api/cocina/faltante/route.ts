import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isKitchenRole, isManagerOrAbove } from '@/lib/roles'
import { notifyEvent } from '@/lib/push/notify-event'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// GET  /api/cocina/faltante — lista de insumos para el selector
//   Devuelve: { critical: CriticalItem[], items: StockItem[] }
//   critical: los que ya están bajo umbral (de fn_stock_critico_manana)
//   items:    todos los insumos activos para búsqueda
//
// POST /api/cocina/faltante — cocina reporta que falta un insumo
//   Body: { stock_item_id: string, nota?: string }
//   Rate limit: 1 reporte por item cada 2 horas
//   Lo usan cocina y barra (baristas: descartables, café, leche…).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function getUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
  if (!profile || (!isKitchenRole(profile.role) && !isManagerOrAbove(profile.role) && profile.role !== 'barista')) return null
  return { id: user.id, role: profile.role, name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null }
}

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const admin = createAdminClient()

  const [criticalRes, itemsRes] = await Promise.all([
    admin.rpc('fn_stock_critico_manana'),
    admin
      .from('stock_items')
      .select('id, name, unit, current_qty, category')
      .eq('is_active', true)
      .order('name'),
  ])

  return NextResponse.json({
    critical: (criticalRes.data ?? []) as { stock_item_id: string; name: string; unit: string; current_qty: number; days_of_stock: number | null }[],
    items: (itemsRes.data ?? []) as { id: string; name: string; unit: string; current_qty: number; category: string }[],
  })
}

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const body = await request.json().catch(() => null) as { stock_item_id?: string; nota?: string } | null
  if (!body || !UUID.test(String(body.stock_item_id))) {
    return NextResponse.json({ error: 'stock_item_id inválido' }, { status: 400 })
  }
  const { stock_item_id, nota } = body as { stock_item_id: string; nota?: string }

  const admin = createAdminClient()
  const sector = user.role === 'barista' ? 'barra' : 'cocina'

  // Verificar que el item existe
  const { data: item } = await admin
    .from('stock_items')
    .select('id, name, unit, current_qty')
    .eq('id', stock_item_id)
    .eq('is_active', true)
    .maybeSingle()
  if (!item) return NextResponse.json({ error: 'Insumo no encontrado' }, { status: 404 })

  // Rate limit: no repetir el mismo reporte en 2 horas
  const { data: reciente } = await admin
    .from('stock_alerts')
    .select('id, created_at')
    .eq('stock_item_id', stock_item_id)
    .eq('alert_type', 'reported_shortage')
    .eq('status', 'active')
    .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle()

  if (reciente) {
    return NextResponse.json(
      { error: 'Este insumo ya fue reportado hace menos de 2 horas. El encargado ya recibió el aviso.' },
      { status: 429 },
    )
  }

  // Crear alerta
  await admin.from('stock_alerts').insert({
    stock_item_id,
    alert_type: 'reported_shortage',
    priority: 'critical',
    message: nota
      ? `Falta ${item.name} — reportado por ${user.name ?? sector}: "${nota.slice(0, 200)}"`
      : `Falta ${item.name} — reportado por ${user.name ?? sector}. Hay ${Number(item.current_qty).toFixed(1)} ${item.unit} en sistema.`,
    status: 'active',
    triggered_at: new Date().toISOString(),
  })

  // Push a encargados y socios
  const notaTexto = nota ? ` "${nota.slice(0, 100)}"` : ''
  await notifyEvent(admin, 'faltante_reportado', {
    title: `⚠️ ${sector === 'barra' ? 'Barra' : 'Cocina'} reporta: falta ${item.name}`,
    body: `${user.name ?? sector} avisa que se está terminando ${item.name}.${notaTexto} Verificá y pedí.`,
    url: '/control',
  }, { excludeUserId: user.id })

  // Audit
  void logAudit(admin, {
    userId: user.id,
    userName: user.name,
    action: 'reported_shortage',
    module: 'stock',
    entityType: 'stock_item',
    entityId: stock_item_id,
    description: `${user.name ?? sector}: reportó faltante de "${item.name}"${nota ? ` — "${nota.slice(0, 100)}"` : ''}`,
    metadata: { stock_item_id, item_name: item.name, current_qty: item.current_qty, nota: nota ?? null },
  })

  return NextResponse.json({ success: true, item_name: item.name })
}
