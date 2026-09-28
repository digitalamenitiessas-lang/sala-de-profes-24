import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { isManagerOrAbove } from '@/lib/roles'
import { countBySemaphore } from '@/lib/contracts/stock'

// ---------------------------------------------------------------------------
// POST /api/stock/snapshot — Create a stock snapshot
// GET  /api/stock/snapshot — List snapshots + compare
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    // Check role
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !isManagerOrAbove(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const type = body.type || 'manual'
    const label = body.label || null
    const source = body.source || 'stock' // 'stock' or 'vajilla'

    if (source === 'vajilla') {
      // Vajilla snapshot
      const { data: items } = await admin.from('vajilla_stock').select('*').order('category,item_name')
      const totalPieces = (items ?? []).reduce((s, i) => s + (i.quantity ?? 0), 0)

      const { error } = await admin.from('vajilla_snapshots').insert({
        snapshot_date: new Date().toISOString().slice(0, 10),
        label,
        items: items ?? [],
        total_pieces: totalPieces,
        created_by: user.id,
      })

      if (error) throw error

      // Audit trail (non-blocking)
      logAudit(admin, {
        userId: user.id,
        userName: null,
        action: 'create_snapshot',
        module: 'stock',
        entityType: 'stock_snapshot',
        description: 'Snapshot de vajilla creado',
      })

      return NextResponse.json({ success: true, source: 'vajilla', totalPieces, itemCount: items?.length ?? 0 })
    }

    // Stock snapshot
    const { data: items } = await admin
      .from('stock_items')
      .select('id, name, category, current_qty, min_qty, unit, is_active')
      .eq('is_active', true)
      .order('category,name')

    const stockItems = items ?? []
    const totalQty = stockItems.reduce((s, i) => s + (i.current_qty ?? 0), 0)
    const criticalCount = countBySemaphore(stockItems).red

    const { error } = await admin.from('stock_snapshots').insert({
      snapshot_date: new Date().toISOString().slice(0, 10),
      snapshot_type: type,
      label,
      items: stockItems,
      total_items: stockItems.length,
      total_qty: totalQty,
      critical_count: criticalCount,
      created_by: user.id,
    })

    if (error) throw error

    // Audit trail (non-blocking)
    logAudit(admin, {
      userId: user.id,
      userName: null,
      action: 'create_snapshot',
      module: 'stock',
      entityType: 'stock_snapshot',
      description: 'Snapshot de stock creado',
    })

    return NextResponse.json({ success: true, source: 'stock', totalItems: stockItems.length, totalQty, criticalCount })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const url = new URL(request.url)
    const table = url.searchParams.get('table')
    const id = url.searchParams.get('id')

    // Single snapshot detail request
    if (table && id) {
      const { data } = await admin.from(table).select('items').eq('id', id).single()
      return NextResponse.json({ items: data?.items ?? [] })
    }

    // List all snapshots
    const [stockRes, vajillaRes] = await Promise.all([
      admin.from('stock_snapshots')
        .select('id, snapshot_date, snapshot_type, label, total_items, total_qty, critical_count, created_at, created_by')
        .order('snapshot_date', { ascending: false })
        .limit(50),
      admin.from('vajilla_snapshots')
        .select('id, snapshot_date, label, total_pieces, created_at, created_by')
        .order('snapshot_date', { ascending: false })
        .limit(50),
    ])

    return NextResponse.json({
      stock: stockRes.data ?? [],
      vajilla: vajillaRes.data ?? [],
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
