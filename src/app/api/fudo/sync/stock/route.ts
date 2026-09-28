import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fullSync } from '@/lib/fudo/stock-sync'
import { isKitchenRole } from '@/lib/roles'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// POST /api/fudo/sync/stock
// Legacy entrypoint kept for existing UI buttons.
//
// Strict rule: Fudo is the source of truth for linked stock. This endpoint only
// pulls Fudo -> LVE and explicitly rejects app_to_fudo/both directions.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!isKitchenRole(profile?.role)) {
      return NextResponse.json({ success: false, error: 'Sin acceso' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const direction = body?.direction ?? 'fudo_to_app'

    if (direction !== 'fudo_to_app') {
      return NextResponse.json({
        success: false,
        fudoConnected: true,
        error: 'Dirección bloqueada: LVE no puede sobrescribir stock de Fudo desde este endpoint',
        allowedDirection: 'fudo_to_app',
        blockedDirection: direction,
      }, { status: 409 })
    }

    const admin = createAdminClient()
    const result = await fullSync(admin)
    let auditSummary: Record<string, unknown> | null = null
    let auditError: string | null = null
    try {
      const { runFudoAudit } = await import('@/lib/fudo/audit')
      const audit = await runFudoAudit(admin)
      auditSummary = audit.summary
    } catch (err) {
      auditError = err instanceof Error ? err.message : 'No se pudo auditar Fudo'
    }
    const hasErrors = result.read.errors.length > 0

    return NextResponse.json({
      success: !hasErrors,
      direction: 'fudo_to_app',
      fudoConnected: true,
      synced: result.read.synced,
      total: result.read.total,
      errors: result.read.errors.length,
      errorDetails: result.read.errors,
      read: result.read,
      audit: auditSummary,
      auditError,
      timestamp: result.timestamp,
      message: hasErrors
        ? 'Fudo respondió, pero hay inconsistencias para corregir'
        : 'Stock sincronizado desde Fudo',
    }, { status: hasErrors ? 409 : 200 })
  } catch (error) {
    console.error('[/api/fudo/sync/stock] Error:', error)
    return NextResponse.json(
      {
        success: false,
        fudoConnected: false,
        error: error instanceof Error ? error.message : 'Error de conexión con Fudo',
      },
      { status: 502 },
    )
  }
}
