import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { syncSupplierLinksFromFudo } from '@/lib/proveedores/fudo-links'

// ---------------------------------------------------------------------------
// POST /api/proveedores/vinculos/sync — actualiza los vínculos con las compras
// reales de Fudo. { force: true } saltea el cache de 30 min de gastos.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response
    const body = await request.json().catch(() => ({}))
    const result = await syncSupplierLinksFromFudo(createAdminClient(), { force: body?.force === true })
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('[POST /api/proveedores/vinculos/sync]', err)
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 502 })
  }
}
