import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { anularDesdeOrigen, estadoParaOrigen, verificarClave } from '@/lib/envios/entrantes'

// ---------------------------------------------------------------------------
// GET    /api/envios/entrantes/<envio_id> — Santa Fe pregunta si llegó (y con
//        qué faltantes). DELETE — Santa Fe lo anula, solo si todavía no llegó
//        (su stock lo devuelve Santa Fe). Con la clave compartida, sin sesión.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ envioId: string }> }

function rechazo(request: Request) {
  const clave = verificarClave(request)
  if (clave === 'sin_configurar') return NextResponse.json({ error: 'Los envíos no están configurados en la 24 (falta ENVIOS_CLAVE)' }, { status: 503 })
  if (clave !== 'ok') return NextResponse.json({ error: 'Clave inválida' }, { status: 401 })
  return null
}

export async function GET(request: Request, context: Ctx) {
  const r = rechazo(request)
  if (r) return r
  const { envioId } = await context.params
  const estado = await estadoParaOrigen(createAdminClient(), decodeURIComponent(envioId))
  if (!estado) return NextResponse.json({ error: 'La 24 no tiene ese envío' }, { status: 404 })
  return NextResponse.json(estado)
}

export async function DELETE(request: Request, context: Ctx) {
  const r = rechazo(request)
  if (r) return r
  const { envioId } = await context.params
  const res = await anularDesdeOrigen(createAdminClient(), decodeURIComponent(envioId))
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, estado: 'anulado' })
}
