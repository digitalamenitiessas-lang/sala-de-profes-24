import type { SupabaseClient } from '@supabase/supabase-js'
import { convertQty } from '@/lib/produccion/units'
import { ORIGEN, insumosDeLa24, sugerirInsumo } from '@/lib/envios/entrantes'

// ---------------------------------------------------------------------------
// Sistema de producción LVE (16/11/2026): el stock de la 24 para Santa Fe
// ---------------------------------------------------------------------------
// Santa Fe produce y tiene la lista de productos con su stock mínimo (uno para
// Santa Fe y otro para la 24; los cambian el dueño o Joaquín, allá). Para
// saber qué mandar necesita el stock de la 24, que antes llegaba por WhatsApp:
//
//   Santa Fe → PUT /api/envios/catalogo   qué productos cuenta la 24 y su mínimo
//   Santa Fe → GET /api/envios/stock      stock de la 24, en camino y cuánto falta
//
// La 24 los cuenta al cerrar en Stock → Conteo de cierre (el mismo conteo
// diario de siempre: actualiza la app y el Fudo de la 24). Entre conteos, el
// stock lo baja Fudo con cada venta (si las recetas usan esos productos).
// Cada producto de Santa Fe es un insumo de la 24 (envios_vinculos, igual que
// en los envíos); si no se reconoce solo, lo elige un encargado una vez.
// ---------------------------------------------------------------------------

const MAX = 200
const TZ = 'America/Argentina/Buenos_Aires'
const r3 = (n: number) => Math.round(n * 1000) / 1000

// "u", "un", "unid.", "unidades" = unidad (Santa Fe y la 24 no siempre escriben igual)
const UNIDAD = /^(u|un|und|uni|unid|unidad|unidades)\.?$/i
const canon = (u: string) => (UNIDAD.test(u.trim()) ? 'unidad' : u)

/** Cantidad de una unidad a otra (kg↔g, l↔ml, unidad↔u). null si no se puede. */
export function convertir(qty: number, de: string, a: string): number | null {
  const r = convertQty(qty, canon(de), canon(a))
  return r == null ? null : r3(r)
}

export function inicioDelDiaAR(): string {
  const hoyAR = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  return new Date(`${hoyAR}T00:00:00-03:00`).toISOString()
}

// ---- Lo que manda Santa Fe ----------------------------------------------------

export type ProductoCatalogo = { item_id: string; nombre: string; unidad: string; minimo_24: number | null }

export function validarCatalogo(body: unknown): { ok: true; productos: ProductoCatalogo[] } | { ok: false; error: string } {
  const b = body as { productos?: unknown } | null
  if (!b || !Array.isArray(b.productos)) return { ok: false, error: 'Falta productos (una lista)' }
  if (b.productos.length > MAX) return { ok: false, error: `Son ${b.productos.length} productos: el máximo es ${MAX}` }
  const vistos = new Set<string>()
  const productos: ProductoCatalogo[] = []
  for (const raw of b.productos as Record<string, unknown>[]) {
    const item_id = String(raw?.item_id ?? '').trim()
    const nombre = String(raw?.nombre ?? '').trim().slice(0, 200)
    const unidad = String(raw?.unidad ?? '').trim().slice(0, 30)
    const m = raw?.minimo_24
    const minimo = m == null || m === '' ? null : Number(m)
    if (!item_id || !nombre || !unidad) return { ok: false, error: 'Cada producto necesita item_id, nombre y unidad' }
    if (vistos.has(item_id)) return { ok: false, error: `El item_id ${item_id} está repetido` }
    if (minimo != null && (!Number.isFinite(minimo) || minimo < 0)) return { ok: false, error: `${nombre}: minimo_24 no es válido` }
    vistos.add(item_id)
    productos.push({ item_id, nombre, unidad, minimo_24: minimo == null ? null : r3(minimo) })
  }
  return { ok: true, productos }
}

/**
 * Reemplaza la lista: lo que no viene deja de contarse. Vincula cada producto
 * con su insumo de la 24 (el vínculo de los envíos o, si no hay, uno con el
 * mismo nombre). Devuelve cómo quedó cada uno, para que Santa Fe lo muestre.
 */
export async function guardarCatalogo(admin: SupabaseClient, productos: ProductoCatalogo[]) {
  const ahora = new Date().toISOString()
  if (productos.length) {
    const { error } = await admin.from('envios_catalogo').upsert(
      productos.map((p, i) => ({ origen: ORIGEN, item_origen_id: p.item_id, nombre: p.nombre, unidad: p.unidad, minimo_24: p.minimo_24, activo: true, orden: i, updated_at: ahora })),
      { onConflict: 'origen,item_origen_id' },
    )
    if (error) throw new Error(error.message)
  }
  const { data: antes } = await admin.from('envios_catalogo').select('item_origen_id').eq('origen', ORIGEN).eq('activo', true)
  const nuevos = new Set(productos.map((p) => p.item_id))
  const sobran = ((antes ?? []) as { item_origen_id: string }[]).map((a) => a.item_origen_id).filter((id) => !nuevos.has(id))
  if (sobran.length) await admin.from('envios_catalogo').update({ activo: false, updated_at: ahora }).eq('origen', ORIGEN).in('item_origen_id', sobran)

  const insumos = await insumosDeLa24(admin)
  const activos = new Map(insumos.map((s) => [s.id, s]))
  const { data: vinc } = productos.length
    ? await admin.from('envios_vinculos').select('item_origen_id, stock_item_id').eq('origen', ORIGEN).in('item_origen_id', productos.map((p) => p.item_id))
    : { data: [] }
  const vinculo = new Map(((vinc ?? []) as { item_origen_id: string; stock_item_id: string }[]).map((v) => [v.item_origen_id, v.stock_item_id]))

  const resultado = []
  for (const p of productos) {
    let sid = vinculo.get(p.item_id)
    if (!sid || !activos.has(sid)) {
      sid = sugerirInsumo(p.nombre, insumos) ?? undefined
      if (sid) {
        await admin.from('envios_vinculos').upsert(
          { origen: ORIGEN, item_origen_id: p.item_id, stock_item_id: sid, nombre_origen: p.nombre, updated_at: ahora },
          { onConflict: 'origen,item_origen_id' },
        )
      }
    }
    const s = sid ? activos.get(sid) : undefined
    resultado.push({
      item_id: p.item_id,
      nombre: p.nombre,
      vinculado: Boolean(s),
      producto_24: s?.name ?? null,
      unidad_24: s?.unit ?? null,
      // false: la 24 lo cuenta en otra unidad que no se puede convertir (ej. kg ↔ unidad)
      unidad_compatible: s ? convertir(1, p.unidad, s.unit) != null : null,
    })
  }
  return { productos: resultado, desactivados: sobran.length }
}

// ---- La lista con el stock de la 24 ------------------------------------------

export type LineaCatalogo = {
  item_id: string
  nombre: string
  unidad: string
  minimo_24: number | null
  stock_item_id: string | null
  producto_24: string | null
  unidad_24: string | null
  stock_24: number | null
  contado_at: string | null
}

export async function catalogoDeLa24(admin: SupabaseClient): Promise<LineaCatalogo[]> {
  const { data: cat } = await admin.from('envios_catalogo').select('item_origen_id, nombre, unidad, minimo_24').eq('origen', ORIGEN).eq('activo', true).order('orden')
  const filas = (cat ?? []) as { item_origen_id: string; nombre: string; unidad: string; minimo_24: number | null }[]
  if (!filas.length) return []
  const { data: vinc } = await admin.from('envios_vinculos').select('item_origen_id, stock_item_id').eq('origen', ORIGEN).in('item_origen_id', filas.map((f) => f.item_origen_id))
  const vinculo = new Map(((vinc ?? []) as { item_origen_id: string; stock_item_id: string }[]).map((v) => [v.item_origen_id, v.stock_item_id]))
  const ids = [...new Set(vinculo.values())]
  const { data: items } = ids.length
    ? await admin.from('stock_items').select('id, name, unit, current_qty, last_counted_at').eq('is_active', true).in('id', ids)
    : { data: [] }
  const item = new Map(((items ?? []) as { id: string; name: string; unit: string; current_qty: number; last_counted_at: string | null }[]).map((i) => [i.id, i]))
  return filas.map((f) => {
    const s = item.get(vinculo.get(f.item_origen_id) ?? '')
    return {
      item_id: f.item_origen_id,
      nombre: f.nombre,
      unidad: f.unidad,
      minimo_24: f.minimo_24 == null ? null : Number(f.minimo_24),
      stock_item_id: s?.id ?? null,
      producto_24: s?.name ?? null,
      unidad_24: s?.unit ?? null,
      stock_24: s ? Number(s.current_qty) : null,
      contado_at: s?.last_counted_at ?? null,
    }
  })
}

/** Los insumos de la 24 que se cuentan al cierre (los de Santa Fe ya vinculados). */
export async function idsDelCierre(admin: SupabaseClient): Promise<string[]> {
  return [...new Set((await catalogoDeLa24(admin)).map((l) => l.stock_item_id).filter((x): x is string => Boolean(x)))]
}

/** Lo que está en camino desde Santa Fe, por producto (en la unidad de Santa Fe). */
async function enCaminoPorProducto(admin: SupabaseClient): Promise<Map<string, number>> {
  const { data: envios } = await admin.from('envios_entrantes').select('id').eq('origen', ORIGEN).eq('estado', 'en_camino')
  const ids = ((envios ?? []) as { id: string }[]).map((e) => e.id)
  const total = new Map<string, number>()
  if (!ids.length) return total
  const { data: items } = await admin.from('envios_entrantes_items').select('item_origen_id, cantidad').in('envio_id', ids)
  for (const i of (items ?? []) as { item_origen_id: string; cantidad: number }[]) total.set(i.item_origen_id, r3((total.get(i.item_origen_id) ?? 0) + Number(i.cantidad)))
  return total
}

/**
 * Para Santa Fe: el stock de la 24 de cada producto de la lista, en la unidad
 * de Santa Fe. stock = último conteo menos lo que Fudo descontó con las ventas
 * desde entonces. falta = mínimo − stock − en camino (lo que habría que mandar).
 */
export async function stockParaSantaFe(admin: SupabaseClient) {
  const [lineas, enCamino, { data: conteos }] = await Promise.all([
    catalogoDeLa24(admin),
    enCaminoPorProducto(admin),
    admin.from('audit_trail').select('user_name, created_at, metadata').eq('action', 'conteo_diario').order('created_at', { ascending: false }).limit(1),
  ])
  const hoy = inicioDelDiaAR()
  const ultimo = ((conteos ?? []) as { user_name: string | null; created_at: string; metadata: { lineas?: unknown[] } | null }[])[0]
  return {
    generado_at: new Date().toISOString(),
    conteo_cierre: {
      hecho_hoy: Boolean(ultimo && ultimo.created_at >= hoy),
      ultimo: ultimo ? { quien: ultimo.user_name, hora: ultimo.created_at, productos: ultimo.metadata?.lineas?.length ?? 0 } : null,
    },
    productos: lineas.map((l) => {
      const stock = l.stock_24 != null && l.unidad_24 ? convertir(l.stock_24, l.unidad_24, l.unidad) : null
      const camino = enCamino.get(l.item_id) ?? 0
      return {
        item_id: l.item_id,
        nombre: l.nombre,
        unidad: l.unidad,
        minimo_24: l.minimo_24,
        // null: no está vinculado en la 24, o se cuenta en una unidad que no se convierte
        stock,
        en_camino: camino,
        falta: l.minimo_24 != null && stock != null ? Math.max(0, r3(l.minimo_24 - stock - camino)) : null,
        contado_at: l.contado_at,
        contado_hoy: Boolean(l.contado_at && l.contado_at >= hoy),
        producto_24: l.producto_24,
        stock_24: l.stock_24,
        unidad_24: l.unidad_24,
      }
    }),
  }
}

/** Un encargado de la 24 elige a qué insumo corresponde un producto de Santa Fe. */
export async function vincularProducto(admin: SupabaseClient, p: { itemId: string; stockItemId: string; userId: string }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: cat } = await admin.from('envios_catalogo').select('nombre').eq('origen', ORIGEN).eq('item_origen_id', p.itemId).eq('activo', true).maybeSingle()
  if (!cat) return { ok: false, status: 404, error: 'Santa Fe ya no tiene ese producto en la lista' }
  const { data: s } = await admin.from('stock_items').select('id').eq('id', p.stockItemId).eq('is_active', true).maybeSingle()
  if (!s) return { ok: false, status: 400, error: 'Ese producto de la 24 no existe o está desactivado' }
  const { error } = await admin.from('envios_vinculos').upsert(
    { origen: ORIGEN, item_origen_id: p.itemId, stock_item_id: p.stockItemId, nombre_origen: (cat as { nombre: string }).nombre, updated_by: p.userId, updated_at: new Date().toISOString() },
    { onConflict: 'origen,item_origen_id' },
  )
  return error ? { ok: false, status: 500, error: error.message } : { ok: true }
}
