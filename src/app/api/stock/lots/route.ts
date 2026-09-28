import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function isSchemaMissingError(message: string | undefined) {
  if (!message) return false
  return (
    message.includes('stock_lots')
    || message.includes('produced_at')
    || message.includes('expires_at')
  )
}

async function authorize(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
    return { user: null, error: NextResponse.json({ error: 'Sin acceso' }, { status: 403 }) }
  }

  return { user, error: null }
}

function daysUntil(expiresAt: Date, now: Date) {
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const expiresDate = new Date(expiresAt.getFullYear(), expiresAt.getMonth(), expiresAt.getDate())
  return Math.round((expiresDate.getTime() - nowDate.getTime()) / 86_400_000)
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { error: authErr } = await authorize(supabase)
    if (authErr) return authErr

    const params = request.nextUrl.searchParams
    const windowDays = Math.min(Math.max(Number(params.get('window_days') ?? 7), 0), 60)
    const limit = Math.min(Math.max(Number(params.get('limit') ?? 12), 1), 50)

    const admin = createAdminClient()
    const query = await admin
      .from('stock_lots')
      .select(`
        id,
        stock_item_id,
        production_order_id,
        production_output_id,
        lot_code,
        qty_original,
        qty_remaining,
        unit,
        produced_at,
        expires_at,
        status,
        notes,
        created_at,
        stock_items(name, category),
        production_orders(id, name, completed_at)
      `)
      .not('expires_at', 'is', null)
      .in('status', ['active', 'expired'])
      .order('expires_at', { ascending: true })
      .limit(Math.max(limit * 4, 24))

    if (query.error) {
      if (isSchemaMissingError(query.error.message)) {
        return NextResponse.json({
          lots: [],
          summary: {
            total: 0,
            expired: 0,
            expiring_today: 0,
            expiring_window: 0,
            window_days: windowDays,
          },
          requires_migration: true,
        })
      }

      throw query.error
    }

    const now = new Date()
    const windowEnd = new Date(now)
    windowEnd.setDate(windowEnd.getDate() + windowDays)

    const lots = (query.data ?? [])
      .map((lot) => {
        const expiresAt = lot.expires_at ? new Date(lot.expires_at) : null
        if (!expiresAt || Number.isNaN(expiresAt.getTime())) return null

        const expiresInDays = daysUntil(expiresAt, now)
        const stockItem = lot.stock_items as { name?: string; category?: string } | null
        const productionOrder = lot.production_orders as { id?: number; name?: string | null } | null

        return {
          id: lot.id,
          stock_item_id: lot.stock_item_id,
          stock_item_name: stockItem?.name ?? 'Sin item',
          category: stockItem?.category ?? null,
          production_order_id: lot.production_order_id,
          production_order_name: productionOrder?.name ?? null,
          production_output_id: lot.production_output_id,
          lot_code: lot.lot_code,
          qty_original: Number(lot.qty_original ?? 0),
          qty_remaining: Number(lot.qty_remaining ?? 0),
          unit: lot.unit,
          produced_at: lot.produced_at,
          expires_at: lot.expires_at,
          status: expiresInDays < 0 ? 'expired' : lot.status,
          notes: lot.notes,
          expires_in_days: expiresInDays,
        }
      })
      .filter((lot): lot is NonNullable<typeof lot> => {
        if (!lot) return false
        const expiresAt = new Date(lot.expires_at)
        return expiresAt <= windowEnd || lot.expires_in_days < 0
      })
      .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())

    const summary = lots.reduce((acc, lot) => {
      acc.total += 1
      if (lot.expires_in_days < 0) acc.expired += 1
      else if (lot.expires_in_days === 0) acc.expiring_today += 1
      else if (lot.expires_in_days <= windowDays) acc.expiring_window += 1
      return acc
    }, {
      total: 0,
      expired: 0,
      expiring_today: 0,
      expiring_window: 0,
      window_days: windowDays,
    })

    return NextResponse.json({
      lots: lots.slice(0, limit),
      summary,
      requires_migration: false,
    })
  } catch (err) {
    console.error('[GET /api/stock/lots]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
