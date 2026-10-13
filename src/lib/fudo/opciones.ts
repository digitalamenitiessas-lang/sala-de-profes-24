import { fudoHttp } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// Opciones de los productos de Fudo (grupos modificadores)
// ---------------------------------------------------------------------------
// Productos como el "Clásico" no tienen receta fija: se arman con opciones
// (infusión, leche, 2 de medialuna/bollito/tortilla, vaso para llevar…).
// Fudo descuenta el stock con la receta de CADA opción elegida. Acá se leen
// de la API de Fudo (sí las expone, a diferencia de las recetas):
//   · productosConOpciones(): qué productos tienen opciones (cache 1 h)
//   · opcionesDeProducto(id): los grupos y sus opciones de un producto
// ---------------------------------------------------------------------------

const API = 'https://api.fu.do/v1alpha1'
type Rel = { data?: { id: string } | { id: string }[] | null }
type Res = { type: string; id: string; attributes?: Record<string, unknown>; relationships?: Record<string, Rel> }
const ids = (r?: Rel) => (Array.isArray(r?.data) ? r!.data : r?.data ? [r.data] : []).map((x) => x.id)

let cache: { at: number; mapa: Map<string, number> } | null = null

/** fudo_product_id → cantidad de grupos de opciones (solo los que tienen). */
export async function productosConOpciones(): Promise<Map<string, number>> {
  if (cache && Date.now() - cache.at < 3_600_000) return cache.mapa
  const mapa = new Map<string, number>()
  for (let p = 1; p <= 10; p++) {
    const r = await fudoHttp(`${API}/products?page[size]=500&page[number]=${p}`)
    if (!r.ok) throw new Error(`Fudo productos: ${r.status}`)
    const d = await r.json() as { data: Res[] }
    for (const x of d.data) {
      const n = ids(x.relationships?.productModifiersGroups).length
      if (n > 0) mapa.set(x.id, n)
    }
    if (d.data.length < 500) break
  }
  cache = { at: Date.now(), mapa }
  return mapa
}

export type GrupoOpciones = {
  nombre: string
  min: number
  max: number
  opciones: { fudoProductId: string; nombre: string; precioExtra: number }[]
}

export async function opcionesDeProducto(fudoProductId: string): Promise<GrupoOpciones[]> {
  const r = await fudoHttp(`${API}/products/${encodeURIComponent(fudoProductId)}?include=productModifiersGroups.productModifiers.product`)
  if (!r.ok) throw new Error(`Fudo producto ${fudoProductId}: ${r.status}`)
  const d = await r.json() as { data: Res; included?: Res[] }
  const inc = new Map((d.included ?? []).map((i) => [`${i.type}|${i.id}`, i]))
  return ids(d.data.relationships?.productModifiersGroups).map((gid) => {
    const g = inc.get(`ProductModifiersGroup|${gid}`)
    return {
      nombre: String(g?.attributes?.name ?? 'Opciones'),
      min: Number(g?.attributes?.minQuantity ?? 0),
      max: Number(g?.attributes?.maxQuantity ?? 1),
      opciones: ids(g?.relationships?.productModifiers).map((mid) => {
        const m = inc.get(`ProductModifier|${mid}`)
        const pid = ids(m?.relationships?.product)[0] ?? ''
        const p = inc.get(`Product|${pid}`)
        return { fudoProductId: pid, nombre: String(p?.attributes?.name ?? '?'), precioExtra: Number(m?.attributes?.price ?? 0) }
      }),
    }
  })
}
