import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { logAudit } from '@/lib/audit'
import { probarFudo, registrarPrueba } from '@/lib/fudo/salud'
import { armarPanelSalud } from '@/lib/fudo/panel-salud'
import { procesarReintentos } from '@/lib/fudo/reintentos'

// ---------------------------------------------------------------------------
// /api/fudo/salud — panel "Salud de Fudo" (socios y encargados)
//   GET  → conexión, ventas/stock/menú al día, cola de reintentos, vínculos
//          rotos con acción sugerida, insumos con control de stock apagado
//          en Fudo y el resto de las diferencias agrupadas.
//   POST { accion, ... }
//     unir        { duplicado, bueno } → pasa recetas/proveedores y desactiva
//     solo_app    { stock_item_id }    → desvincula de Fudo, sigue en la app
//     desactivar  { stock_item_id }    → solo si no se usa en recetas
//     reintentar  { id }               → reintenta ya un pendiente
//     descartar   { id }               → descarta un pendiente
//     probar                           → prueba la conexión ahora
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROLES = ['socio', 'encargado']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const auth = await requireRole(ROLES)
  if (auth.response) return auth.response
  return NextResponse.json(await armarPanelSalud(createAdminClient()))
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(ROLES)
    if (auth.response) return auth.response
    const body = await request.json().catch(() => null) as { accion?: string; id?: string; stock_item_id?: string; duplicado?: string; bueno?: string } | null
    const admin = createAdminClient()
    const { data: yo } = await admin.from('profiles').select('first_name, last_name').eq('id', auth.user.id).maybeSingle()
    const quien = [yo?.first_name, yo?.last_name].filter(Boolean).join(' ') || null
    const auditar = (description: string, entityId: string, metadata?: Record<string, unknown>) =>
      logAudit(admin, { userId: auth.user.id, userName: quien, action: 'fudo_salud', module: 'stock', entityType: 'stock_item', entityId, description, metadata })

    switch (body?.accion) {
      case 'probar': {
        const error = await probarFudo()
        await registrarPrueba(admin, error)
        return NextResponse.json({ ok: !error, error })
      }
      case 'reintentar': {
        if (!UUID.test(String(body.id))) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
        await admin.from('fudo_reintentos').update({ proximo_intento_at: new Date().toISOString() }).eq('id', body.id!).eq('estado', 'pendiente')
        const r = await procesarReintentos(admin, 10)
        const { data: fila } = await admin.from('fudo_reintentos').select('estado, ultimo_error').eq('id', body.id!).maybeSingle()
        return NextResponse.json({ success: true, estado: fila?.estado, error: fila?.estado === 'pendiente' ? fila.ultimo_error : null, resumen: r })
      }
      case 'descartar': {
        if (!UUID.test(String(body.id))) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
        await admin.from('fudo_reintentos').update({ estado: 'descartado', ultimo_error: `Descartado a mano por ${quien ?? 'alguien'}`, updated_at: new Date().toISOString() }).eq('id', body.id!).eq('estado', 'pendiente')
        void auditar('Descartó un movimiento pendiente hacia Fudo', body.id!)
        return NextResponse.json({ success: true })
      }
      case 'unir': {
        if (!UUID.test(String(body.duplicado)) || !UUID.test(String(body.bueno))) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
        type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
        const { data, error } = await (admin.rpc as unknown as Rpc).call(admin, 'unir_insumos', { p_duplicado: body.duplicado, p_bueno: body.bueno, p_user: auth.user.id })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        const r = data as { duplicado: string; bueno: string; recetas: number }
        void auditar(`Unió "${r.duplicado}" en "${r.bueno}" (${r.recetas} receta${r.recetas === 1 ? '' : 's'})`, body.duplicado!, r as unknown as Record<string, unknown>)
        return NextResponse.json({ success: true, ...r })
      }
      case 'desactivar_platos': {
        // Solo platos que NO están en Fudo (carta vieja cargada a mano)
        const ids = Array.isArray((body as { ids?: unknown }).ids) ? ((body as { ids: unknown[] }).ids).map(String).filter((x) => UUID.test(x)).slice(0, 500) : []
        if (ids.length === 0) return NextResponse.json({ error: 'No hay platos para desactivar' }, { status: 400 })
        const { data, error } = await admin.from('menu_items').update({ is_active: false, updated_at: new Date().toISOString() })
          .in('id', ids).is('fudo_product_id', null).eq('is_active', true).select('name')
        if (error) throw error
        const nombres = (data ?? []).map((d: { name: string }) => d.name)
        void auditar(`Desactivó ${nombres.length} plato${nombres.length === 1 ? '' : 's'} de la carta vieja (no están en Fudo)`, ids[0], { platos: nombres })
        return NextResponse.json({ success: true, desactivados: nombres.length })
      }
      case 'solo_app':
      case 'desactivar': {
        if (!UUID.test(String(body.stock_item_id))) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
        const id = body.stock_item_id!
        const { data: it } = await admin.from('stock_items').select('name').eq('id', id).maybeSingle()
        if (!it) return NextResponse.json({ error: 'Insumo no encontrado' }, { status: 404 })
        if (body.accion === 'desactivar') {
          const { count } = await admin.from('recipe_ingredients').select('id', { count: 'exact', head: true }).eq('stock_item_id', id)
          if ((count ?? 0) > 0) return NextResponse.json({ error: `Se usa en ${count} receta${count === 1 ? '' : 's'}: dejalo "solo en la app" o unilo con el correcto` }, { status: 409 })
        }
        const cambios: Record<string, unknown> = { fudo_ingredient_id: null, fudo_product_id: null, fudo_skip: true, updated_at: new Date().toISOString() }
        if (body.accion === 'desactivar') cambios.is_active = false
        const { error } = await admin.from('stock_items').update(cambios).eq('id', id)
        if (error) throw error
        await admin.from('fudo_sync_incidents').update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: auth.user.id, updated_at: new Date().toISOString() }).eq('stock_item_id', id).eq('status', 'open')
        // Lo pendiente hacia Fudo de este insumo ya no tiene a dónde ir
        await admin.from('fudo_reintentos').update({ estado: 'descartado', ultimo_error: 'El insumo quedó solo en la app', updated_at: new Date().toISOString() }).eq('stock_item_id', id).eq('estado', 'pendiente')
        void auditar(body.accion === 'desactivar' ? `Desactivó "${it.name}" (vínculo roto con Fudo)` : `Dejó "${it.name}" solo en la app (Fudo lo borró)`, id)
        return NextResponse.json({ success: true })
      }
      default:
        return NextResponse.json({ error: 'Acción inválida' }, { status: 400 })
    }
  } catch (err) {
    console.error('[POST /api/fudo/salud]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
