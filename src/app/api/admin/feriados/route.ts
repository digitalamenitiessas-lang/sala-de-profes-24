import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// /api/admin/feriados — días que se pagan 50% más (socios y encargados)
//   GET    ?desde&hasta      → { feriados }
//   POST   { fecha, nombre } → agrega (o renombra)
//   DELETE { fecha }         → quita
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  const auth = await requireRole(['socio', 'encargado'])
  if (auth.response) return auth.response
  const url = new URL(request.url)
  const desde = url.searchParams.get('desde') ?? '2000-01-01'
  const hasta = url.searchParams.get('hasta') ?? '2100-12-31'
  if (!FECHA.test(desde) || !FECHA.test(hasta)) return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 })
  const { data, error } = await createAdminClient().from('feriados').select('fecha, nombre').gte('fecha', desde).lte('fecha', hasta).order('fecha')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ feriados: data ?? [] })
}

export async function POST(request: Request) {
  const auth = await requireRole(['socio', 'encargado'])
  if (auth.response) return auth.response
  const body = await request.json().catch(() => null) as { fecha?: string; nombre?: string } | null
  const nombre = String(body?.nombre ?? '').trim().slice(0, 120)
  if (!FECHA.test(String(body?.fecha)) || !nombre) return NextResponse.json({ error: 'Poné la fecha y el nombre del feriado' }, { status: 400 })
  const admin = createAdminClient()
  const { error } = await admin.from('feriados').upsert({ fecha: body!.fecha!, nombre, created_by: auth.user.id }, { onConflict: 'fecha' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  void logAudit(admin, { userId: auth.user.id, userName: null, action: 'feriado_agregado', module: 'asistencia', entityType: 'feriado', entityId: body!.fecha!, description: `Agregó el feriado ${body!.fecha} (${nombre})` })
  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const auth = await requireRole(['socio', 'encargado'])
  if (auth.response) return auth.response
  const body = await request.json().catch(() => null) as { fecha?: string } | null
  if (!FECHA.test(String(body?.fecha))) return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 })
  const admin = createAdminClient()
  const { error } = await admin.from('feriados').delete().eq('fecha', body!.fecha!)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  void logAudit(admin, { userId: auth.user.id, userName: null, action: 'feriado_quitado', module: 'asistencia', entityType: 'feriado', entityId: body!.fecha!, description: `Quitó el feriado ${body!.fecha}` })
  return NextResponse.json({ success: true })
}
