import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { buildProductionPlan } from '@/lib/ai/production-plan'

// ---------------------------------------------------------------------------
// GET /api/ai/production-plan
// Plan de producción sugerido para hoy: ventas (Fudo) × stock × vida útil
// × producción en curso. Para chef, cocina y encargados.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  try {
    const auth = await requireRole(['socio', 'encargado', 'chef', 'cocina'])
    if (auth.response) return auth.response

    const admin = createAdminClient()
    const plan = await buildProductionPlan(admin)
    return NextResponse.json(plan)
  } catch (error) {
    console.error('[GET /api/ai/production-plan]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
