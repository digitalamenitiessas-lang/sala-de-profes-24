import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sincronizarMenu } from '@/lib/fudo/menu-sync'

// ---------------------------------------------------------------------------
// POST /api/fudo/sync/products
// ---------------------------------------------------------------------------
// Sincroniza categorías y productos desde Fudo hacia Supabase.
//
// - Upsert de categorías en `menu_categories` (match por fudo_category_id).
// - Upsert de productos en `menu_items` (match por fudo_product_id).
// - Fudo es source of truth para nombre, precio y categoría.
// - Sala de Profes mantiene recipe_id, costo interno, etc.
// ---------------------------------------------------------------------------

export async function POST() {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await userSupabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['encargado', 'socio', 'chef'].includes(profile.role)) {
      return NextResponse.json({ success: false, error: 'Sin permisos' }, { status: 403 })
    }

    const r = await sincronizarMenu(createAdminClient())
    return NextResponse.json({ success: true, ...r })
  } catch (error) {
    console.error('[/api/fudo/sync/products] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      },
      { status: 500 },
    )
  }
}
