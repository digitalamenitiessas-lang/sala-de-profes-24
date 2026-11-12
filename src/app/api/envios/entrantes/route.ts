import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { registrarEnvio, validarEnvio, verificarClave } from '@/lib/envios/entrantes'

// ---------------------------------------------------------------------------
// POST /api/envios/entrantes — Santa Fe registra un envío a la 24.
// Sin sesión: lo llama el servidor de Santa Fe con la clave compartida
// (Authorization: Bearer <ENVIOS_CLAVE>). Body:
//   { envio_id, enviado_at?, enviado_por?, nota?,
//     items: [{ item_id, nombre, unidad, cantidad, costo_unitario? }],
//     avisar?: false }   (false: sin notificación, para pruebas)
// El mismo envio_id dos veces no duplica nada (responde el que ya está).
// Ver lib/envios/entrantes.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const clave = verificarClave(request)
  if (clave === 'sin_configurar') return NextResponse.json({ error: 'Los envíos no están configurados en la 24 (falta ENVIOS_CLAVE)' }, { status: 503 })
  if (clave !== 'ok') return NextResponse.json({ error: 'Clave inválida' }, { status: 401 })

  const v = validarEnvio(await request.json().catch(() => null))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  try {
    const r = await registrarEnvio(createAdminClient(), v.envio)
    return NextResponse.json({ ok: true, envio_id: v.envio.envio_id, estado: r.estado, duplicado: r.duplicado }, { status: r.duplicado ? 200 : 201 })
  } catch (err) {
    console.error('[envios] no se pudo registrar', err)
    return NextResponse.json({ error: 'No se pudo registrar el envío en la 24' }, { status: 500 })
  }
}
