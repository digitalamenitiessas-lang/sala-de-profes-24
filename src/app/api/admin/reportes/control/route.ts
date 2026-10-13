import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { informeControl } from '@/lib/reportes/control'

// GET /api/admin/reportes/control?from=YYYY-MM-DD&to=YYYY-MM-DD
// Asistencia por persona, qué hizo cada encargado y costo laboral vs ventas.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  const auth = await requireRole(['socio', 'encargado'])
  if (auth.response) return auth.response
  const from = request.nextUrl.searchParams.get('from') ?? ''
  const to = request.nextUrl.searchParams.get('to') ?? ''
  if (!FECHA.test(from) || !FECHA.test(to) || from > to) return NextResponse.json({ error: 'Período inválido' }, { status: 400 })
  try {
    return NextResponse.json(await informeControl(createAdminClient(), from, to))
  } catch (err) {
    console.error('[reportes/control]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'No se pudo armar el informe' }, { status: 500 })
  }
}
