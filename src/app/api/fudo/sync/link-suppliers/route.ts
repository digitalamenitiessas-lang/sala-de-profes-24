import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { syncSupplierLinksFromFudo } from '@/lib/proveedores/fudo-links'

// ---------------------------------------------------------------------------
// POST /api/fudo/sync/link-suppliers
// ---------------------------------------------------------------------------
// Vincula insumos con proveedores a partir de las compras reales en Fudo.
// Antes leía ingredient._relationships.provider, que la API de Fudo no tiene
// (los Ingredient solo traen ingredientCategory y recipeCard): nunca vinculaba
// nada. Ver src/lib/proveedores/fudo-links.ts.
// ---------------------------------------------------------------------------

export async function POST() {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response
    const result = await syncSupplierLinksFromFudo(createAdminClient(), { force: true })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('[/api/fudo/sync/link-suppliers] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
