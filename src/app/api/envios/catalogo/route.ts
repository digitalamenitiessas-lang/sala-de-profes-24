import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verificarClave } from '@/lib/envios/entrantes'
import { guardarCatalogo, validarCatalogo } from '@/lib/envios/catalogo'

// ---------------------------------------------------------------------------
// PUT /api/envios/catalogo — Santa Fe manda qué productos cuenta la 24 al
// cierre y el stock mínimo de la 24 de cada uno (en la unidad de Santa Fe).
// Sin sesión: lo llama el servidor de Santa Fe con la clave compartida
// (Authorization: Bearer <ENVIOS_CLAVE>). Body:
//   { productos: [{ item_id, nombre, unidad, minimo_24 }] }
// Reemplaza la lista entera (lo que no viene deja de contarse). Responde cómo
// quedó vinculado cada producto con un insumo de la 24.
// Ver lib/envios/catalogo.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function PUT(request: Request) {
  const clave = verificarClave(request)
  if (clave === 'sin_configurar') return NextResponse.json({ error: 'Los envíos no están configurados en la 24 (falta ENVIOS_CLAVE)' }, { status: 503 })
  if (clave !== 'ok') return NextResponse.json({ error: 'Clave inválida' }, { status: 401 })

  const v = validarCatalogo(await request.json().catch(() => null))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  try {
    const r = await guardarCatalogo(createAdminClient(), v.productos)
    return NextResponse.json({ ok: true, ...r })
  } catch (err) {
    console.error('[envios/catalogo] no se pudo guardar', err)
    return NextResponse.json({ error: 'No se pudo guardar la lista en la 24' }, { status: 500 })
  }
}
