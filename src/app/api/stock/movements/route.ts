import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// GET /api/stock/movements?itemId=<uuid>&limit=60
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const itemId = request.nextUrl.searchParams.get('itemId')
    const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? '60'), 200)

    if (!itemId) return NextResponse.json({ error: 'itemId requerido' }, { status: 400 })

    const admin = createAdminClient()

    const { data, error } = await admin
      .from('stock_movements')
      .select('id, movement_type, qty, reason, note, created_at, created_by, profiles:created_by(first_name, last_name)')
      .eq('stock_item_id', itemId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    // Normalise: expose `change` as signed qty (positive=entrada, negative=salida)
    const movements = (data ?? []).map((m) => ({
      ...m,
      change: m.movement_type === 'out' ? -(m.qty ?? 0) : (m.qty ?? 0),
    }))

    return NextResponse.json({ movements })
  } catch (error) {
    console.error('[GET /api/stock/movements]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
