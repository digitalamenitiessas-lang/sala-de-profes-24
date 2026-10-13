import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { sincronizarPagosDesdeFudo } from '@/lib/compras/pagos-fudo'

// ---------------------------------------------------------------------------
// POST /api/compras/pagos-fudo — al abrir Cuentas por pagar: marca pagado lo
// que ya se pagó en Fudo y devuelve los gastos cancelados en Fudo para avisar.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const auth = await requireRole(['socio', 'encargado'])
  if (auth.response) return auth.response
  try {
    return NextResponse.json(await sincronizarPagosDesdeFudo(createAdminClient()))
  } catch (err) {
    console.error('[pagos-fudo]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error' }, { status: 500 })
  }
}
