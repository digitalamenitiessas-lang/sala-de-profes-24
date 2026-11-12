import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enviosParaLa24, recibirEnvio, type LineaRecibida } from '@/lib/envios/entrantes'

// ---------------------------------------------------------------------------
// GET  /api/envios — lo que viene de Santa Fe (en camino y recibidos de los
//      últimos 14 días) y los insumos de la 24 para elegir a cuál entra.
// POST /api/envios — «Llegó»: { envio_id, nota?, items: [{ id, stock_item_id, cantidad }] }
//      sube el stock en la app y en el Fudo de la 24 (sin gasto ni deuda).
// Solo encargado o socio, como recibir un pedido. Ver lib/envios/entrantes.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function encargadoOSocio() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
  if (!profile || !['encargado', 'socio'].includes(profile.role)) return { error: NextResponse.json({ error: 'Solo encargado o socio' }, { status: 403 }) }
  return { user, nombre: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null }
}

export async function GET() {
  const auth = await encargadoOSocio()
  if (auth.error) return auth.error
  return NextResponse.json(await enviosParaLa24(createAdminClient()))
}

export async function POST(request: Request) {
  const auth = await encargadoOSocio()
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({})) as { envio_id?: string; nota?: string; items?: LineaRecibida[] }
  if (!body.envio_id || !Array.isArray(body.items)) return NextResponse.json({ error: 'Faltan envio_id o items' }, { status: 400 })
  const r = await recibirEnvio(createAdminClient(), {
    envioId: String(body.envio_id),
    userId: auth.user.id,
    userName: auth.nombre,
    nota: typeof body.nota === 'string' && body.nota.trim() ? body.nota.trim().slice(0, 500) : null,
    lineas: body.items.map((l) => ({ id: String(l.id), stock_item_id: String(l.stock_item_id ?? ''), cantidad: Number(l.cantidad) })),
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r)
}
