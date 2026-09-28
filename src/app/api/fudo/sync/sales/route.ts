import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { importFudoSales } from '@/lib/fudo/sales-sync'
import { requireRole } from '@/lib/supabase/require-role'

// ---------------------------------------------------------------------------
// POST /api/fudo/sync/sales
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response

    const body = await request.json().catch(() => ({}))
    const from = body?.from as string | undefined
    const to = body?.to as string | undefined
    const supabase = createAdminClient()

    const result = await importFudoSales(supabase, {
      from,
      to,
      limit: 300,
      operation: 'manual_sales_import',
    })

    if (result.totalSales === 0) {
      return NextResponse.json({ success: true, importedSales: 0, message: 'Sin ventas' })
    }

    if (result.totalItems === 0) {
      return NextResponse.json({ success: true, importedSales: 0, message: 'Sin items', errors: result.errors })
    }

    return NextResponse.json({
      success: result.errors.length === 0,
      importedSales: result.imported,
      totalSales: result.totalSales,
      totalItems: result.totalItems,
      errors: result.errors,
    }, { status: result.errors.length === 0 ? 200 : 409 })
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
