import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { COUNT_STOCK_ROLES } from '@/lib/roles'
import { insumosDeLa24 } from '@/lib/envios/entrantes'
import { catalogoDeLa24, convertir, inicioDelDiaAR, vincularProducto } from '@/lib/envios/catalogo'
import { conteosDeHoy, estadoConteoHoy } from '@/lib/stock/conteo-diario'

// ---------------------------------------------------------------------------
// /api/envios/cierre — la pantalla Stock → Conteo de cierre de la 24
//   GET  → los productos de Santa Fe que se cuentan (lista que manda Santa Fe),
//          los que todavía no tienen insumo de la 24 y el conteo de hoy.
//   POST { item_id, stock_item_id } → encargado o socio elige a qué insumo de
//          la 24 corresponde un producto de Santa Fe (queda para siempre).
// El conteo se guarda con POST /api/stock/conteo-diario (mismo camino de
// siempre: app + Fudo + aviso). Ver lib/envios/catalogo.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const VINCULAN = ['socio', 'encargado']

export async function GET() {
  const auth = await requireRole(COUNT_STOCK_ROLES)
  if (auth.response) return auth.response
  const admin = createAdminClient()
  const puedeVincular = VINCULAN.includes(auth.user.role)
  const [lineas, estado, conteos, insumos] = await Promise.all([
    catalogoDeLa24(admin),
    estadoConteoHoy(admin),
    conteosDeHoy(admin),
    puedeVincular ? insumosDeLa24(admin) : Promise.resolve([]),
  ])
  const hoy = inicioDelDiaAR()

  // Dos productos de Santa Fe pueden ser el mismo insumo de la 24: se cuenta una vez
  const productos = new Map<string, { stock_item_id: string; nombre: string; unidad: string; current_qty: number; contado_hoy: boolean; minimo: number | null; de_santa_fe: string[] }>()
  for (const l of lineas) {
    if (!l.stock_item_id || !l.unidad_24) continue
    const minimo = l.minimo_24 == null ? null : convertir(l.minimo_24, l.unidad, l.unidad_24)
    const p = productos.get(l.stock_item_id)
    if (p) {
      p.de_santa_fe.push(l.nombre)
      if (minimo != null) p.minimo = (p.minimo ?? 0) + minimo
      continue
    }
    productos.set(l.stock_item_id, {
      stock_item_id: l.stock_item_id,
      nombre: l.producto_24 ?? l.nombre,
      unidad: l.unidad_24,
      current_qty: l.stock_24 ?? 0,
      contado_hoy: Boolean(l.contado_at && l.contado_at >= hoy),
      minimo,
      de_santa_fe: [l.nombre],
    })
  }

  return NextResponse.json({
    productos: [...productos.values()],
    sin_vincular: lineas.filter((l) => !l.stock_item_id).map((l) => ({ item_id: l.item_id, nombre: l.nombre, unidad: l.unidad })),
    lista_de_santa_fe: lineas.length > 0,
    puede_vincular: puedeVincular,
    insumos: insumos.map((s) => ({ id: s.id, name: s.name, unit: s.unit, enFudo: s.enFudo })),
    estado,
    conteos,
  })
}

export async function POST(request: Request) {
  const auth = await requireRole(VINCULAN)
  if (auth.response) return auth.response
  const body = await request.json().catch(() => ({})) as { item_id?: string; stock_item_id?: string }
  if (!body.item_id || !body.stock_item_id) return NextResponse.json({ error: 'Faltan item_id o stock_item_id' }, { status: 400 })
  const r = await vincularProducto(createAdminClient(), { itemId: String(body.item_id), stockItemId: String(body.stock_item_id), userId: auth.user.id })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
