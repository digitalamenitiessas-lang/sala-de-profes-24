import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/recipes/pending-links
// ---------------------------------------------------------------------------
// Lista ingredientes pendientes de vinculación, con filtros opcionales.
//
// Query params:
//   status   — 'pending' | 'approved' | 'rejected' | 'manual' | 'all' (default: 'pending')
//   recipe_id — filtrar por receta específica
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const params = request.nextUrl.searchParams
    const status = params.get('status') ?? 'pending'
    const recipeId = params.get('recipe_id')

    const admin = createAdminClient()

    let query = admin
      .from('recipe_ingredient_pending_links')
      .select('*')
      .order('recipe_name', { ascending: true })
      .order('ingredient_name', { ascending: true })

    if (status !== 'all') {
      query = query.eq('status', status)
    }
    if (recipeId) {
      query = query.eq('recipe_id', recipeId)
    }

    const { data, error } = await query

    if (error) throw error

    // Counts per status for summary
    const { data: counts } = await admin
      .from('recipe_ingredient_pending_links')
      .select('status')

    const statusCounts = {
      pending: 0, approved: 0, rejected: 0, manual: 0,
    }
    for (const row of counts ?? []) {
      if (row.status in statusCounts) {
        statusCounts[row.status as keyof typeof statusCounts]++
      }
    }

    return NextResponse.json({
      items: data ?? [],
      total: data?.length ?? 0,
      counts: statusCounts,
    })
  } catch (error) {
    console.error('[GET /api/recipes/pending-links]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
