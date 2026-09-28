// ---------------------------------------------------------------------------
// Agregador único de ventas (fudo_sales) — EL lugar donde se cuentan ventas.
// ---------------------------------------------------------------------------
// Fuente: tabla local fudo_sales (sync 1×/día ~03:49 AR). Un rango que incluya
// HOY va a estar incompleto: el que llama decide si refresca antes (fresh=1 en
// range-summary) o avisa con dataHasta.
//
// Reglas de oro (medidas contra producción 2026-09-09, NO re-medir):
//   - revenue de línea = quantity × raw_payload.price (price es UNITARIO).
//   - item_name viene null en el 98,7% de las filas → los nombres salen SIEMPRE
//     de menu_items.name por fudo_product_id.
//   - La categoría real es menu_items.menu_category_id → menu_categories.
//     La columna de texto menu_items.category está rota (486/545 = 'otros').
//   - Canal: pedidosya = categoría 'PEDIDOS YA' (entra casi toda como TAKEAWAY);
//     takeaway = TAKEAWAY sin pedidosya; local = EAT-IN.
//   - Líneas a $0 (consumo de personal, promos) inflan tickets/unidades:
//     excluirSinPrecio=true (default) las deja afuera de todo.
//   - Datos continuos desde el 2026-05-02 (antes hay un hueco total): las
//     fechas se clampean a ese mínimo.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'

/** Primer día con datos continuos en fudo_sales. Antes hay un hueco total. */
export const VENTAS_DATA_DESDE = '2026-05-02'

export type VentasCanal = 'local' | 'takeaway' | 'pedidosya'

export type VentasFiltro = {
  /** Fecha AR inicial (YYYY-MM-DD), inclusive. Se clampea a VENTAS_DATA_DESDE. */
  from: string
  /** Fecha AR final (YYYY-MM-DD), inclusive (internamente to+1d exclusivo). */
  to: string
  /** Solo estos productos (fudo_product_id). */
  productos?: string[]
  /** Solo estas categorías (menu_categories.id), resueltas vía menu_items. */
  categorias?: string[]
  /** Canal de venta derivado (ver regla arriba). */
  canal?: VentasCanal
  /** Días de semana AR (0=domingo … 6=sábado). */
  dows?: number[]
  /** Franja horaria AR inclusive; si horaDesde > horaHasta, cruza medianoche. */
  horaDesde?: number
  horaHasta?: number
  /** default true: líneas con price 0/null fuera de tickets/unidades/revenue. */
  excluirSinPrecio?: boolean
}

export type VentasTotales = {
  revenue: number
  unidades: number
  tickets: number
  ticketPromedio: number
}

export type VentasAgregadas = {
  /** Rango efectivo ya clampeado. */
  from: string
  to: string
  totales: VentasTotales
  /** Serie diaria completa del rango, con ceros en los días sin ventas. */
  byDay: { date: string; revenue: number; unidades: number; tickets: number }[]
  /** 0=domingo … 6=sábado (AR). */
  byDow: { dow: number; revenue: number; unidades: number; tickets: number }[]
  /** Hora AR 0-23, las 24 siempre presentes. */
  byHour: { hour: number; revenue: number; unidades: number; tickets: number }[]
  byCanal: { canal: VentasCanal; revenue: number; unidades: number; tickets: number }[]
  byCategoria: { id: string | null; nombre: string; revenue: number; unidades: number }[]
  byProduct: { fudoProductId: string; nombre: string; revenue: number; unidades: number; tickets: number }[]
  /** max(sold_at) del rango: hasta cuándo hay datos reales. */
  dataHasta: string | null
  /** true si se cortó la paginación (rango gigante): faltan líneas. */
  truncado: boolean
}

const PAGE_SIZE = 1000
const MAX_PAGES = 50
const AR_OFFSET_MS = 3 * 60 * 60 * 1000 // AR = UTC-3, sin DST

type SaleRow = {
  fudo_ticket_id: string
  fudo_product_id: string | null
  quantity: number
  sold_at: string
  price: number | string | null
  sale_type: string | null
}

type MenuInfo = { name: string; menuCategoryId: string | null }

/**
 * Carga UNA vez por llamada el mapa fudo_product_id → {name, menu_category_id}
 * y el mapa de categorías. Tolerante a que menu_category_id no exista todavía.
 */
async function cargarMapas(admin: SupabaseClient): Promise<{
  porProducto: Map<string, MenuInfo>
  nombreCategoria: Map<string, string>
  categoriaPedidosYa: string | null
}> {
  type MenuRow = { fudo_product_id: string | null; name: string; menu_category_id?: string | null }
  let res: { data: unknown[] | null; error: { message: string } | null } = await admin
    .from('menu_items')
    .select('fudo_product_id, name, menu_category_id')
    .not('fudo_product_id', 'is', null)
  if (res.error) {
    res = await admin
      .from('menu_items')
      .select('fudo_product_id, name')
      .not('fudo_product_id', 'is', null)
  }
  if (res.error) throw new Error(res.error.message)

  const porProducto = new Map<string, MenuInfo>()
  for (const m of (res.data ?? []) as MenuRow[]) {
    if (!m.fudo_product_id) continue
    porProducto.set(String(m.fudo_product_id), {
      name: m.name,
      menuCategoryId: m.menu_category_id != null ? String(m.menu_category_id) : null,
    })
  }

  const nombreCategoria = new Map<string, string>()
  let categoriaPedidosYa: string | null = null
  const catRes = await admin.from('menu_categories').select('id, name')
  if (!catRes.error) {
    for (const c of (catRes.data ?? []) as { id: string; name: string }[]) {
      nombreCategoria.set(String(c.id), c.name)
      if (String(c.name).trim().toUpperCase() === 'PEDIDOS YA') categoriaPedidosYa = String(c.id)
    }
  }

  return { porProducto, nombreCategoria, categoriaPedidosYa }
}

function clampFecha(fecha: string): string {
  return fecha < VENTAS_DATA_DESDE ? VENTAS_DATA_DESDE : fecha
}

/** Canal derivado de una línea: la categoría PEDIDOS YA le gana al sale_type. */
function canalDe(saleType: string | null, esPedidosYa: boolean): VentasCanal {
  if (esPedidosYa) return 'pedidosya'
  if (saleType === 'EAT-IN') return 'local'
  return 'takeaway'
}

/**
 * Agrega fudo_sales para un rango calendario AR (00:00 -03:00, to exclusivo +1d),
 * con filtros opcionales. Devuelve todos los cortes de una: totales, por día,
 * por día de semana, por hora, por canal, por categoría y por producto.
 */
export async function aggregateVentas(
  admin: SupabaseClient,
  filtro: VentasFiltro,
): Promise<VentasAgregadas> {
  // Un rango ENTERO anterior al primer día con datos no se clampea: clampear
  // from y to por separado devolvía el 2026-05-02 real en vez de vacío.
  const rangoSinDatos = filtro.to < VENTAS_DATA_DESDE
  const from = clampFecha(filtro.from)
  const to = clampFecha(filtro.to)
  const excluirSinPrecio = filtro.excluirSinPrecio ?? true

  // Ventana calendario AR → UTC (misma semántica que range-summary).
  // +24h en ms (no setDate: depende del huso del server).
  const fromUTC = new Date(`${from}T00:00:00-03:00`).toISOString()
  const toUTC = new Date(Date.parse(`${to}T00:00:00-03:00`) + 86_400_000).toISOString()

  const { porProducto, nombreCategoria, categoriaPedidosYa } = await cargarMapas(admin)

  // Filtro por categorías → resolver a fudo_product_ids (server-side)
  let productosFiltro = filtro.productos?.map(String)
  let sinResultadosPosibles = false
  if (filtro.categorias && filtro.categorias.length > 0) {
    const setCat = new Set(filtro.categorias.map(String))
    const deCategoria = [...porProducto.entries()]
      .filter(([, info]) => info.menuCategoryId != null && setCat.has(info.menuCategoryId))
      .map(([id]) => id)
    productosFiltro = productosFiltro
      ? productosFiltro.filter((p) => deCategoria.includes(p))
      : deCategoria
    if (productosFiltro.length === 0) sinResultadosPosibles = true
  }

  // Fetch paginado liviano: alias de columnas de raw_payload, NUNCA el jsonb entero
  const rows: SaleRow[] = []
  let truncado = false
  if (!sinResultadosPosibles && !rangoSinDatos) {
    for (let page = 0; page < MAX_PAGES; page++) {
      let query = admin
        .from('fudo_sales')
        .select('fudo_ticket_id, fudo_product_id, quantity, sold_at, price:raw_payload->price, sale_type:raw_payload->>sale_type')
        .gte('sold_at', fromUTC)
        .lt('sold_at', toUTC)
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      if (productosFiltro && productosFiltro.length > 0) {
        query = query.in('fudo_product_id', productosFiltro)
      }
      const { data, error } = await query
      if (error) throw new Error(error.message)
      const pageRows = (data ?? []) as unknown as SaleRow[]
      if (pageRows.length === 0) break
      rows.push(...pageRows)
      if (pageRows.length < PAGE_SIZE) break
      if (page === MAX_PAGES - 1) truncado = true
    }
  }

  // dataHasta con filtro de productos/categorías: la query de arriba solo ve
  // esos productos y el "datos hasta" quedaría atrasado (el último pancho no
  // es el último sync). Se mide aparte, sobre la tabla entera del rango.
  const filtraProductos = (productosFiltro?.length ?? 0) > 0 || sinResultadosPosibles
  let dataHastaGlobal: string | null = null
  if (filtraProductos && !rangoSinDatos) {
    const { data: ultima } = await admin
      .from('fudo_sales')
      .select('sold_at')
      .gte('sold_at', fromUTC)
      .lt('sold_at', toUTC)
      .order('sold_at', { ascending: false })
      .limit(1)
    dataHastaGlobal = (ultima?.[0] as { sold_at?: string } | undefined)?.sold_at ?? null
  }

  // Acumuladores. Los tickets se cuentan con Sets (una mesa aparece en varias líneas).
  type Bucket = { revenue: number; unidades: number; tickets: Set<string> }
  const nuevoBucket = (): Bucket => ({ revenue: 0, unidades: 0, tickets: new Set() })

  const total = nuevoBucket()
  const porDia = new Map<string, Bucket>()
  const porDow = new Map<number, Bucket>()
  const porHora = new Map<number, Bucket>()
  const porCanal = new Map<VentasCanal, Bucket>()
  const porCategoria = new Map<string, { nombre: string; revenue: number; unidades: number }>()
  const porProductoAgg = new Map<string, Bucket & { nombre: string }>()

  // Serie diaria completa con ceros (recorre el rango clampeado). Si el rango
  // entero es anterior a los datos, la serie queda vacía: no hay días reales.
  if (!rangoSinDatos) {
    const cursor = new Date(`${from}T12:00:00Z`)
    const fin = new Date(`${to}T12:00:00Z`)
    while (cursor.getTime() <= fin.getTime()) {
      porDia.set(cursor.toISOString().slice(0, 10), nuevoBucket())
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }

  let dataHasta: string | null = null

  const dowsSet = filtro.dows && filtro.dows.length > 0 ? new Set(filtro.dows) : null
  const horaEnFranja = (h: number): boolean => {
    const d = filtro.horaDesde
    const hh = filtro.horaHasta
    if (d == null && hh == null) return true
    const desde = d ?? 0
    const hasta = hh ?? 23
    // Franja que cruza medianoche (ej. 20 a 2): h >= desde || h <= hasta
    return desde <= hasta ? h >= desde && h <= hasta : h >= desde || h <= hasta
  }

  for (const row of rows) {
    if (dataHasta === null || row.sold_at > dataHasta) dataHasta = row.sold_at

    const qty = Number(row.quantity ?? 0)
    const price = row.price != null ? Number(row.price) : 0
    if (excluirSinPrecio && !(price > 0)) continue

    // Hora/fecha/día de semana en AR: correr el timestamp -3h y leer en UTC
    const t = new Date(row.sold_at).getTime()
    if (Number.isNaN(t)) continue
    const enAR = new Date(t - AR_OFFSET_MS)
    const fechaAR = enAR.toISOString().slice(0, 10)
    const horaAR = enAR.getUTCHours()
    const dowAR = enAR.getUTCDay()

    if (dowsSet && !dowsSet.has(dowAR)) continue
    if (!horaEnFranja(horaAR)) continue

    const productId = row.fudo_product_id != null ? String(row.fudo_product_id) : null
    const info = productId ? porProducto.get(productId) : undefined
    const esPedidosYa = categoriaPedidosYa != null && info?.menuCategoryId === categoriaPedidosYa
    const canal = canalDe(row.sale_type, esPedidosYa)
    if (filtro.canal && canal !== filtro.canal) continue

    const lineRevenue = qty * price
    const acumular = (b: Bucket) => {
      b.revenue += lineRevenue
      b.unidades += qty
      b.tickets.add(row.fudo_ticket_id)
    }

    acumular(total)

    const dia = porDia.get(fechaAR)
    if (dia) acumular(dia)

    if (!porDow.has(dowAR)) porDow.set(dowAR, nuevoBucket())
    acumular(porDow.get(dowAR)!)

    if (!porHora.has(horaAR)) porHora.set(horaAR, nuevoBucket())
    acumular(porHora.get(horaAR)!)

    if (!porCanal.has(canal)) porCanal.set(canal, nuevoBucket())
    acumular(porCanal.get(canal)!)

    const catId = info?.menuCategoryId ?? null
    const catKey = catId ?? '(sin categoría)'
    const cat = porCategoria.get(catKey) ?? {
      nombre: catId ? nombreCategoria.get(catId) ?? `Categoría ${catId}` : 'Sin categoría',
      revenue: 0,
      unidades: 0,
    }
    cat.revenue += lineRevenue
    cat.unidades += qty
    porCategoria.set(catKey, cat)

    if (productId) {
      const prod = porProductoAgg.get(productId) ?? {
        ...nuevoBucket(),
        // Fallback honesto: si el producto no está en menu_items, no inventamos nombre
        nombre: info?.name ?? `Producto ${productId}`,
      }
      prod.revenue += lineRevenue
      prod.unidades += qty
      prod.tickets.add(row.fudo_ticket_id)
      porProductoAgg.set(productId, prod)
    }
  }

  const aTotales = (b: Bucket): VentasTotales => ({
    revenue: Math.round(b.revenue),
    unidades: b.unidades,
    tickets: b.tickets.size,
    ticketPromedio: b.tickets.size > 0 ? Math.round(b.revenue / b.tickets.size) : 0,
  })

  const totales = aTotales(total)

  return {
    // Rango entero sin datos: devolvemos el pedido tal cual (no hay rango
    // efectivo; clampeado quedaría "2026-05-02 a 2026-05-02", que miente).
    from: rangoSinDatos ? filtro.from : from,
    to: rangoSinDatos ? filtro.to : to,
    totales,
    byDay: [...porDia.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, b]) => ({ date, revenue: Math.round(b.revenue), unidades: b.unidades, tickets: b.tickets.size })),
    byDow: Array.from({ length: 7 }, (_, dow) => {
      const b = porDow.get(dow) ?? nuevoBucket()
      return { dow, revenue: Math.round(b.revenue), unidades: b.unidades, tickets: b.tickets.size }
    }),
    byHour: Array.from({ length: 24 }, (_, hour) => {
      const b = porHora.get(hour) ?? nuevoBucket()
      return { hour, revenue: Math.round(b.revenue), unidades: b.unidades, tickets: b.tickets.size }
    }),
    byCanal: (['local', 'takeaway', 'pedidosya'] as VentasCanal[])
      .filter((c) => porCanal.has(c))
      .map((c) => {
        const b = porCanal.get(c)!
        return { canal: c, revenue: Math.round(b.revenue), unidades: b.unidades, tickets: b.tickets.size }
      }),
    byCategoria: [...porCategoria.entries()]
      .map(([id, c]) => ({
        id: id === '(sin categoría)' ? null : id,
        nombre: c.nombre,
        revenue: Math.round(c.revenue),
        unidades: c.unidades,
      }))
      .sort((a, b) => b.revenue - a.revenue),
    byProduct: [...porProductoAgg.entries()]
      .map(([fudoProductId, p]) => ({
        fudoProductId,
        nombre: p.nombre,
        revenue: Math.round(p.revenue),
        unidades: p.unidades,
        tickets: p.tickets.size,
      }))
      .sort((a, b) => b.unidades - a.unidades),
    dataHasta: filtraProductos ? dataHastaGlobal : dataHasta,
    truncado,
  }
}
