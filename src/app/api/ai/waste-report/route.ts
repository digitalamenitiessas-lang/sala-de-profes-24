import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { buildWasteReport } from '@/lib/ai/waste-report'

// ---------------------------------------------------------------------------
// GET /api/ai/waste-report?days=7
// Mermas con costo: faltantes sin explicar (snapshots vs ventas), lotes
// vencidos y desperdicio de producción, valorizados. Solo socio/encargado.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response

    const daysParam = Number(request.nextUrl.searchParams.get('days'))
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 30) : 7

    const admin = createAdminClient()
    const report = await buildWasteReport(admin, days)
    return NextResponse.json(report)
  } catch (error) {
    console.error('[GET /api/ai/waste-report]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
