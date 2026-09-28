import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  generateStockEvents,
  generateExpedienteEvents,
  generateTurnoEvents,
  generateOrderEvents,
  sortEvents,
  deduplicateEvents,
} from '@/lib/events/operational-events'
import { format } from 'date-fns'

// ---------------------------------------------------------------------------
// GET /api/ai/action-center — unified operational events
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const admin = createAdminClient()
    const today = format(new Date(), 'yyyy-MM-dd')

    // Parallel data fetching
    const [stockRes, expedientesRes, kitchenOrdersRes, barOrdersRes, shiftsRes, attendanceRes] = await Promise.all([
      admin.from('stock_items')
        .select('id, name, current_qty, min_qty, supplier_id, category, last_ordered_at')
        .eq('is_active', true),
      admin.from('expedientes')
        .select('id, code, title, status, urgency, target_date, updated_at, responsible_id')
        .not('status', 'in', '("cumplido","cerrado_sin_implementacion","archivado")'),
      admin.from('kitchen_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      admin.from('bar_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      admin.from('shifts').select('id', { count: 'exact', head: true }).eq('shift_date', today),
      admin.from('attendance_logs').select('id, clock_out_at', { count: 'exact' }).eq('operative_date', today),
    ])

    // Generate events from each domain
    const stockEvents = generateStockEvents(stockRes.data ?? [])
    const expedienteEvents = generateExpedienteEvents(expedientesRes.data ?? [])
    const orderEvents = generateOrderEvents(kitchenOrdersRes.count ?? 0, barOrdersRes.count ?? 0)

    // Turnos: calculate missing coverage
    const scheduledCount = shiftsRes.count ?? 0
    const attendanceLogs = attendanceRes.data ?? []
    const presentCount = attendanceLogs.length
    const missingCheckouts = attendanceLogs.filter(a => !a.clock_out_at).length
    const turnoEvents = generateTurnoEvents({ scheduled_count: scheduledCount, present_count: presentCount, missing_checkouts: missingCheckouts })

    // Combine, deduplicate, sort
    const allEvents = sortEvents(deduplicateEvents([
      ...stockEvents,
      ...expedienteEvents,
      ...orderEvents,
      ...turnoEvents,
    ]))

    // Summary counts
    const alta = allEvents.filter(e => e.priority === 'alta').length
    const media = allEvents.filter(e => e.priority === 'media').length
    const baja = allEvents.filter(e => e.priority === 'baja').length

    return NextResponse.json({
      events: allEvents,
      summary: { total: allEvents.length, alta, media, baja },
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/ai/action-center]', error)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}
