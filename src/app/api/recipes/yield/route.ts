import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// GET /api/recipes/yield — cuántas porciones se pueden hacer con el stock actual
// GET /api/recipes/yield?at_risk=true&min=5 — solo las que no alcanzan para 5 porciones

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const atRisk = req.nextUrl.searchParams.get('at_risk') === 'true'
    const minPortions = Number(req.nextUrl.searchParams.get('min') ?? 5)

    // Use admin client since RPC types haven't been regenerated yet
    const admin = createAdminClient()

    if (atRisk) {
      const { data, error } = await (admin.rpc as any)('recipes_at_risk', {
        p_min_portions: minPortions,
      })
      if (error) throw error
      return NextResponse.json({ at_risk: data, min_portions: minPortions })
    }

    const { data, error } = await (admin.rpc as any)('stock_yield')
    if (error) throw error
    return NextResponse.json({ yields: data })
  } catch (error) {
    console.error('[/api/recipes/yield]', error)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}
