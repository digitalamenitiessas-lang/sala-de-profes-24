import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verificarClave } from '@/lib/envios/entrantes'
import { stockParaSantaFe } from '@/lib/envios/catalogo'

// ---------------------------------------------------------------------------
// GET /api/envios/stock — Santa Fe lee el stock de la 24 para armar el envío.
// Sin sesión, con la clave compartida (Authorization: Bearer <ENVIOS_CLAVE>).
// Por cada producto de la lista (PUT /api/envios/catalogo), en la unidad de
// Santa Fe: stock (último conteo menos lo vendido en Fudo desde entonces),
// en_camino, minimo_24 y falta = mínimo − stock − en camino. Además, si la 24
// ya hizo hoy el conteo de cierre. Ver lib/envios/catalogo.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const clave = verificarClave(request)
  if (clave === 'sin_configurar') return NextResponse.json({ error: 'Los envíos no están configurados en la 24 (falta ENVIOS_CLAVE)' }, { status: 503 })
  if (clave !== 'ok') return NextResponse.json({ error: 'Clave inválida' }, { status: 401 })
  try {
    return NextResponse.json(await stockParaSantaFe(createAdminClient()))
  } catch (err) {
    console.error('[envios/stock]', err)
    return NextResponse.json({ error: 'No se pudo leer el stock de la 24' }, { status: 500 })
  }
}
