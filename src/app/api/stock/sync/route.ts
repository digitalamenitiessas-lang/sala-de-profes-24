import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fullSync, syncToFudo } from '@/lib/fudo/stock-sync'
import { canCountStock } from '@/lib/roles'

// ---------------------------------------------------------------------------
// GET /api/stock/sync — Pull stock from Fudo → update Supabase
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

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

    return NextResponse.json({
      success: true,
      ...result,
      fudoConnected: true,
      audit: auditSummary,
      auditError,
    })
  } catch (error) {
    console.error('[stock/sync GET]', error)
    return NextResponse.json(
      {
        success: false,
        fudoConnected: false,
        error: error instanceof Error ? error.message : 'Error de sincronización con Fudo',
      },
      { status: 502 },
    )
  }
}

// ---------------------------------------------------------------------------
// POST /api/stock/sync — Write stock change to Supabase + Fudo
// Body: { stockItemId, newQty }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    // Escribir stock en el POS es operativo: socio, encargado, chef y cocina.
    const { data: profile } = await userSupabase.from('profiles').select('role').eq('id', user.id).single()
    if (!canCountStock(profile?.role)) {
      return NextResponse.json({ error: 'Sin permiso para modificar stock' }, { status: 403 })
    }

    const body = await request.json()
    const { stockItemId, newQty } = body
    const reason = body?.reason === 'manual_adjustment' ? 'manual_adjustment' : 'physical_count'
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : null

    if (!stockItemId || typeof newQty !== 'number') {
      return NextResponse.json({ error: 'stockItemId y newQty requeridos' }, { status: 400 })
    }

    const admin = createAdminClient()
    const result = await syncToFudo(admin, stockItemId, newQty, user.id, { reason, note })

    return NextResponse.json({
      success: result.success,
      fudoSynced: result.fudoSynced,
      error: result.error,
      message: result.fudoSynced
        ? 'Stock actualizado en webapp y Fudo ✓'
        : result.success
          ? 'Stock actualizado en webapp (sin vínculo Fudo)'
          : `Stock no actualizado: ${result.error}`,
    }, { status: result.success ? 200 : 502 })
  } catch (error) {
    console.error('[stock/sync POST]', error)
    return NextResponse.json(
      {
        success: false,
        fudoSynced: false,
        fudoConnected: false,
        error: error instanceof Error ? error.message : 'Error de sincronización con Fudo',
      },
      { status: 502 },
    )
  }
}
