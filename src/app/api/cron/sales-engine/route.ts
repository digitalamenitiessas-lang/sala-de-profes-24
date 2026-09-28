import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runSalesEngine } from '@/lib/stock/sales-engine'
import { notifyEvent } from '@/lib/push/notify-event'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// GET /api/cron/sales-engine
// ---------------------------------------------------------------------------
// FASE 1 del reemplazo de Fudo: corre el motor de stock paralelo (sombra)
// para AYER (día AR), después del fudo-sync (que deja current_qty = espejo).
// Cron diario 07:30 UTC = 04:30 AR. Backfill manual: ?day=YYYY-MM-DD.
//
// Si ≥3 insumos tienen |diff| relativo >15% (sobre max(1,|fudo_qty|)) manda
// push `parallel_drift` con el top 5. Audita en audit_trail (module stock,
// action sales_engine_run).
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const DRIFT_MIN_ITEMS = 3

/** Fecha AR (YYYY-MM-DD) de ayer. */
function yesterdayAR(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000)
  return d.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

const fmtQty = (n: number) =>
  n.toLocaleString('es-AR', { maximumFractionDigits: 1 })

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const dayParam = request.nextUrl.searchParams.get('day')
  if (dayParam && !/^\d{4}-\d{2}-\d{2}$/.test(dayParam)) {
    return NextResponse.json({ error: 'day inválido (YYYY-MM-DD)' }, { status: 400 })
  }
  const day = dayParam ?? yesterdayAR()

  try {
    const admin = createAdminClient()
    const summary = await runSalesEngine(admin, day)

    // ---------------------------------------------------------------------
    // Push si la divergencia es significativa (≥3 items con drift >15%)
    // ---------------------------------------------------------------------
    let pushSent = false
    if (summary.drift.length >= DRIFT_MIN_ITEMS) {
      const lines = summary.drift.slice(0, 5).map(d => {
        const sign = d.diff < 0 ? '−' : '+'
        return `• ${d.name}: LVE ${fmtQty(d.lve_qty)} vs Fudo ${fmtQty(d.fudo_qty)} (${sign}${fmtQty(Math.abs(d.diff))} ${d.unit})`
      })
      await notifyEvent(admin, 'parallel_drift', {
        title: `🔬 Motor paralelo: ${summary.drift.length} insumos divergen de Fudo`,
        body: lines.join('\n'),
        url: '/stock',
      })
      pushSent = true
    }

    // ---------------------------------------------------------------------
    // Auditoría (no bloqueante)
    // ---------------------------------------------------------------------
    await logAudit(admin, {
      userId: null,
      userName: 'cron',
      action: 'sales_engine_run',
      module: 'stock',
      entityType: 'cron',
      entityId: 'sales-engine',
      description: `Motor paralelo ${day}: ${summary.items} insumos, ${summary.consumidos} con consumo, ${summary.drift.length} en drift >15%${summary.seeded ? ' (seed inicial)' : ''}`,
      metadata: JSON.parse(JSON.stringify({ ...summary, push_sent: pushSent })),
    })

    return NextResponse.json({ success: true, push_sent: pushSent, summary })
  } catch (error) {
    console.error('[GET /api/cron/sales-engine]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
