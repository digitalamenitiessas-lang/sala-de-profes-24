import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { isManagerOrAbove } from '@/lib/roles'
import { logAudit } from '@/lib/audit'
import { esRedDelLocal, ipDelPedido, registrarRedDelLocal } from '@/lib/attendance/red-local'

// GET  /api/attendance/red-local → { local }: ¿este celular está en el WiFi del local?
// POST /api/attendance/red-local → el encargado/socio, estando en el local,
//      registra esta red como la del local (si el proveedor cambió la IP).
export const dynamic = 'force-dynamic'

const TODOS = ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha']

export async function GET() {
  const auth = await requireRole(TODOS)
  if (auth.response) return auth.response
  const ip = ipDelPedido(await headers())
  return NextResponse.json({ local: await esRedDelLocal(createAdminClient(), ip) })
}

export async function POST() {
  const auth = await requireRole(TODOS)
  if (auth.response) return auth.response
  if (!isManagerOrAbove(auth.user.role)) return NextResponse.json({ error: 'Solo encargados y socios' }, { status: 403 })
  const ip = ipDelPedido(await headers())
  if (!ip) return NextResponse.json({ error: 'No se pudo leer la red' }, { status: 400 })
  const admin = createAdminClient()
  await registrarRedDelLocal(admin, ip)
  void logAudit(admin, {
    userId: auth.user.id, userName: null, action: 'red_local_registrada', module: 'asistencia', entityType: 'attendance_config',
    entityId: 'redes_local', description: 'Registró el WiFi del local para fichar sin GPS',
  })
  return NextResponse.json({ success: true, local: true })
}
