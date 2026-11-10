import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { excelComprobantes } from '@/lib/compras/excel-comprobantes'

// ---------------------------------------------------------------------------
// GET /api/compras/comprobantes/export?from=YYYY-MM-DD&to=YYYY-MM-DD
// Excel de comprobantes de Fudo para conciliar y pagar a proveedores (ver
// lib/compras/excel-comprobantes). Solo encargados y socios.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ = 'America/Argentina/Buenos_Aires'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!isManagerOrAbove(profile?.role)) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const params = new URL(request.url).searchParams
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  const from = params.get('from') ?? `${hoy.slice(0, 7)}-01`
  const to = params.get('to') ?? hoy
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 })
  }

  let buf: Buffer
  try {
    buf = await excelComprobantes(createAdminClient(), from, to)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fudo no respondió' }, { status: 502 })
  }
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="comprobantes_${from}_${to}.xlsx"`,
    },
  })
}
