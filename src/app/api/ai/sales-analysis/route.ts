import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { buildSalesAnalysis } from '@/lib/ai/sales-analysis'

// ---------------------------------------------------------------------------
// POST /api/ai/sales-analysis
// Body: { month?: 'yyyy-MM', dows: number[], hourFrom: number, hourTo: number }
// Devuelve análisis IA + estadísticas de la ventana elegida.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response

    const body = await request.json().catch(() => ({}))
    const dows = Array.isArray(body.dows) ? body.dows.map(Number).filter((d: number) => d >= 0 && d <= 6) : []
    const hourFrom = Number.isFinite(Number(body.hourFrom)) ? Math.max(0, Math.min(23, Number(body.hourFrom))) : 0
    const hourTo = Number.isFinite(Number(body.hourTo)) ? Math.max(hourFrom, Math.min(23, Number(body.hourTo))) : 23

    const admin = createAdminClient()
    const result = await buildSalesAnalysis(admin, {
      month: typeof body.month === 'string' ? body.month : null,
      dows,
      hourFrom,
      hourTo,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('[POST /api/ai/sales-analysis]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
