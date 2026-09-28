import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { isManagerOrAbove } from '@/lib/roles'
import { armarElaborados, type ElaboradosPayload } from '@/lib/produccion/elaborados'

// ---------------------------------------------------------------------------
// /api/produccion/elaborados — lo que elabora la cocina, en un solo lugar
//   GET  → cada elaborado con uso por día, stock, receta de producción,
//          costo por receta, vida útil y última producción. ?item=<id> → uno.
//   POST → { stock_item_id, rinde, ingredientes: [{ stock_item_id, qty, unit }], notas? }
//          guarda la receta de producción (guardar_receta_produccion: chef,
//          encargado o socio; lo valida la base).
// "Lo hice" usa /api/produccion/orders/quick; contar, /api/stock/sync; la vida
// útil, PATCH /api/stock/items/[id].
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let cache: { at: number; base: Omit<ElaboradosPayload, 'permisos'> } | null = null
const CACHE_MS = 5 * 60 * 1000

export async function GET(request: Request) {
  try {
    const auth = await requireRole(['socio', 'encargado', 'chef', 'cocina'])
    if (auth.response) return auth.response
    const fresh = new URL(request.url).searchParams.get('fresh') === '1'
    if (fresh || !cache || Date.now() - cache.at > CACHE_MS) cache = { at: Date.now(), base: await armarElaborados(createAdminClient()) }

    const permisos = {
      receta: ['socio', 'encargado', 'chef'].includes(auth.user.role),
      vida_util: isManagerOrAbove(auth.user.role),
      cerrar_produccion: isManagerOrAbove(auth.user.role),
    }
    const item = new URL(request.url).searchParams.get('item')
    if (item) {
      const e = cache.base.elaborados.find((x) => x.id === item)
      if (!e) return NextResponse.json({ error: 'Elaborado no encontrado' }, { status: 404 })
      return NextResponse.json({ elaborados: [e], insumos: cache.base.insumos, permisos })
    }
    return NextResponse.json({ ...cache.base, permisos } satisfies ElaboradosPayload)
  } catch (err) {
    console.error('[GET /api/produccion/elaborados]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(['socio', 'encargado', 'chef'])
    if (auth.response) return auth.response
    const body = await request.json().catch(() => null) as {
      stock_item_id?: string; rinde?: number; notas?: string | null
      ingredientes?: { stock_item_id?: string; qty?: number; unit?: string | null; nota?: string | null }[]
    } | null
    const rinde = Number(body?.rinde)
    const ingredientes = (body?.ingredientes ?? []).map((i) => ({
      stock_item_id: String(i.stock_item_id ?? ''),
      qty: Number(i.qty),
      unit: i.unit ? String(i.unit).slice(0, 20) : null,
      nota: i.nota ? String(i.nota).slice(0, 200) : null,
    }))
    if (!UUID.test(String(body?.stock_item_id)) || !(rinde > 0) || ingredientes.length === 0
      || ingredientes.some((i) => !UUID.test(i.stock_item_id) || !(i.qty > 0))) {
      return NextResponse.json({ error: 'Faltan datos: rinde mayor a cero y cada ingrediente con insumo y cantidad' }, { status: 400 })
    }

    const supabase = await createClient()
    // rpc usa `this`: llamarlo sobre el cliente (ver proveedores/vinculos)
    type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: { recipe_id: string } | null; error: { message: string; code?: string } | null }>
    const { data, error } = await (supabase.rpc as unknown as Rpc).call(supabase, 'guardar_receta_produccion', {
      p_output: body!.stock_item_id,
      p_rinde: rinde,
      p_ingredientes: ingredientes,
      p_notas: body?.notas ?? null,
    })
    if (error) {
      const status = error.code === '42501' ? 403 : error.code === '22023' ? 400 : 500
      return NextResponse.json({ error: error.message }, { status })
    }
    cache = null
    return NextResponse.json({ success: true, recipe_id: data?.recipe_id })
  } catch (err) {
    console.error('[POST /api/produccion/elaborados]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
