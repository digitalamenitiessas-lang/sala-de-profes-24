/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON:API de Fudo, sin esquema publicado */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { fudoHttp } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// Herramientas de Fudo para Claude — SOLO LECTURA (todo sale por fudoGet: GET)
// ---------------------------------------------------------------------------
// Lo que aprendimos de la API y esto respeta:
//   - El `price` de un ítem es el total de la LÍNEA, no el precio por unidad.
//   - Un día es el día operativo: de 06:00 a 05:59 (hora Argentina).
//   - La API no expone recetas ni la cantidad comprada en cada gasto.
//   - Un gasto sin pago imputado (cuenta corriente) no trae ni monto ni fecha.
// `alLlamar` deja registro de cada consulta (ver /api/mcp).
// ---------------------------------------------------------------------------

const API = 'https://api.fu.do/v1alpha1'
const TZ = 'America/Argentina/Buenos_Aires'
const LIMITE_TEXTO = 50_000
const ESTADOS = ['PENDING', 'CANCELED', 'CLOSED', 'IN-COURSE', 'PAYMENT-PROCESS', 'DELIVERY-SENT', 'READY-TO-DELIVER'] as const
const TIPOS = ['EAT-IN', 'TAKEAWAY', 'DELIVERY'] as const
// Lo que se puede leer con la consulta libre (nada de autenticación ni rutas raras)
const RUTAS_LIBRES = new Set(['customers', 'providers', 'users', 'tables', 'rooms', 'kitchens', 'payments', 'payment-methods', 'cash-registers', 'discounts', 'expense-categories', 'product-categories', 'ingredient-categories', 'price-lists', 'sales', 'products', 'ingredients', 'expenses'])

/** GET a la API de Fudo. Es la única forma de llegar a la API desde estas herramientas. */
async function fudoGet(ruta: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
  const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
  const r = await fudoHttp(`${API}/${ruta}${qs ? `?${qs}` : ''}`, undefined, 30_000)
  if (r.status === 404) throw new Error(`Fudo no encontró "${ruta}". Revisá el id o la ruta.`)
  if (!r.ok) {
    const detalle = await r.json().then((j: any) => j.errors?.map((x: any) => x.detail).filter(Boolean).join('; ')).catch(() => '')
    throw new Error(`Fudo respondió ${r.status} en "${ruta}"${detalle ? `: ${detalle}` : ''}`)
  }
  return r.json()
}

// ---- JSON:API ------------------------------------------------------------
const refs = (rel: any): any[] => (Array.isArray(rel?.data) ? rel.data : rel?.data ? [rel.data] : [])
const indice = (included: any[] = []) => new Map<string, any>(included.map((i) => [`${i.type}|${i.id}`, i]))
const uno = (idx: Map<string, any>, rel: any) => { const r = refs(rel)[0]; return r ? idx.get(`${r.type}|${r.id}`) ?? null : null }
const varios = (idx: Map<string, any>, rel: any): any[] => refs(rel).map((r) => idx.get(`${r.type}|${r.id}`)).filter(Boolean)

// ---- Fechas --------------------------------------------------------------
const local = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: TZ, hour12: false }).slice(0, 16) : null)
const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá el formato AAAA-MM-DD')
const inicioDia = (f: string) => `${f}T09:00:00Z` // 06:00 Argentina
const finDia = (f: string) => new Date(Date.parse(`${f}T09:00:00Z`) + 86_400_000 - 1000).toISOString().slice(0, 19) + 'Z'
const diaOperativo = (iso: string) => new Date(Date.parse(iso) - 9 * 3_600_000).toISOString().slice(0, 10)
const hoy = () => diaOperativo(new Date().toISOString())

// ---- Ventas --------------------------------------------------------------
const INCLUDE_VENTA = 'items.product,items.subitems.product,payments.paymentMethod,table.room,customer,waiter,discounts'

function armarVenta(s: any, idx: Map<string, any>, conDetalle: boolean) {
  const a = s.attributes
  const mesa = uno(idx, s.relationships?.table)
  const base = {
    id: s.id, abierta: local(a.createdAt), cerrada: local(a.closedAt), estado: a.saleState, tipo: a.saleType, total: a.total,
    mesa: mesa?.attributes?.number ?? null, personas: a.people ?? null,
    cliente: a.customerName ?? uno(idx, s.relationships?.customer)?.attributes?.name ?? null,
  }
  if (!conDetalle) return base
  return {
    ...base,
    comentario: a.comment ?? undefined,
    mozo: uno(idx, s.relationships?.waiter)?.attributes?.name ?? undefined,
    items: varios(idx, s.relationships?.items).map((i) => ({
      producto: uno(idx, i.relationships?.product)?.attributes?.name ?? '?',
      cantidad: i.attributes.quantity,
      importe_linea: i.attributes.price,
      cancelado: !!i.attributes.canceled,
      comentario: i.attributes.comment ?? undefined,
      opciones: varios(idx, i.relationships?.subitems).map((o) => ({ producto: uno(idx, o.relationships?.product)?.attributes?.name ?? '?', cantidad: o.attributes.quantity, importe: o.attributes.price })),
    })),
    pagos: varios(idx, s.relationships?.payments).filter((p) => !p.attributes.canceled).map((p) => ({ medio: uno(idx, p.relationships?.paymentMethod)?.attributes?.name ?? '?', monto: p.attributes.amount, hora: local(p.attributes.createdAt) })),
    descuentos: varios(idx, s.relationships?.discounts).filter((x) => !x.attributes.canceled).map((x) => ({ monto: x.attributes.amount, porcentaje: x.attributes.percentage })),
  }
}

function filtrosVenta({ desde, hasta, estados, tipo }: { desde?: string; hasta?: string; estados?: readonly string[]; tipo?: string }) {
  const d = desde ?? hasta ?? hoy()
  const h = hasta ?? desde ?? hoy()
  if (d > h) throw new Error(`"desde" (${d}) es posterior a "hasta" (${h}).`)
  const params: Record<string, string> = { 'filter[createdAt]': `and(gte.${inicioDia(d)},lte.${finDia(h)})` }
  if (estados?.length) params['filter[saleState]'] = `in.(${estados.join(',')})`
  if (tipo) params['filter[saleType]'] = `eq.${tipo}`
  return { d, h, params }
}

// ---- Catálogos (cache corto: cambian poco y se filtran acá) ---------------
const CACHE_MS = 5 * 60_000
const cache = new Map<string, { at: number; v: { data: any[]; idx: Map<string, any> } }>()
async function todas(clave: string, ruta: string, params: Record<string, string>, tam: number) {
  const c = cache.get(clave)
  if (c && Date.now() - c.at < CACHE_MS) return c.v
  const data: any[] = []
  const included: any[] = []
  for (let n = 1; n <= 20; n++) {
    const j = await fudoGet(ruta, { ...params, 'page[size]': tam, 'page[number]': n })
    data.push(...j.data)
    included.push(...(j.included ?? []))
    if (j.data.length < tam) break
  }
  const v = { data, idx: indice(included) }
  cache.set(clave, { at: Date.now(), v })
  return v
}
const normal = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// ---- Servidor ------------------------------------------------------------
export function crearServidorFudo(alLlamar: (herramienta: string, args: unknown) => Promise<void>): McpServer {
  const server = new McpServer({ name: 'fudo-la-vieja-escuela-24', version: '1.0.0' })
  const limite = (def: number, max: number) => z.number().int().min(1).max(max).default(def)
  const LECTURA = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }

  /** Registro, recorte de respuestas largas y errores que Claude pueda entender. */
  const herramienta = <A,>(nombre: string, fn: (a: A) => Promise<unknown>) => async (a: A) => {
    try {
      await alLlamar(nombre, a)
      let texto = JSON.stringify(await fn(a))
      if (texto.length > LIMITE_TEXTO) texto = `${texto.slice(0, LIMITE_TEXTO)}… [RECORTADO: la respuesta superaba ${LIMITE_TEXTO} caracteres. Pedí un rango más chico, usá "limite" y "pagina" o buscá un término más específico]`
      return { content: [{ type: 'text' as const, text: texto }] }
    } catch (e) {
      return { isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] }
    }
  }

  server.registerTool('fudo_listar_ventas', {
    title: 'Listar ventas',
    description: 'Lista ventas de Fudo en un rango de días operativos (cada día va de 06:00 a 05:59, hora Argentina), de la más nueva a la más vieja. Sin fechas, usa el día de hoy. Con "detalle" trae ítems, opciones, pagos y descuentos.',
    inputSchema: {
      desde: FECHA.optional().describe('Primer día, AAAA-MM-DD'),
      hasta: FECHA.optional().describe('Último día, AAAA-MM-DD'),
      estados: z.array(z.enum(ESTADOS)).optional().describe('Ej. ["CLOSED"] cerradas, ["IN-COURSE"] mesas abiertas. Sin esto trae todas, incluso canceladas'),
      tipo: z.enum(TIPOS).optional().describe('EAT-IN salón, TAKEAWAY para llevar, DELIVERY'),
      detalle: z.boolean().default(false),
      limite: limite(50, 200),
      pagina: z.number().int().min(1).default(1),
    },
    annotations: { ...LECTURA, title: 'Listar ventas' },
  }, herramienta('fudo_listar_ventas', async (a: { desde?: string; hasta?: string; estados?: string[]; tipo?: string; detalle: boolean; limite: number; pagina: number }) => {
    const { d, h, params } = filtrosVenta(a)
    const j = await fudoGet('sales', { ...params, sort: '-createdAt', 'page[size]': a.limite, 'page[number]': a.pagina, include: a.detalle ? INCLUDE_VENTA : 'table' })
    const idx = indice(j.included)
    return { rango: { desde: d, hasta: h }, pagina: a.pagina, cantidad: j.data.length, hay_mas: j.data.length === a.limite, ventas: j.data.map((s: any) => armarVenta(s, idx, a.detalle)) }
  }))

  server.registerTool('fudo_ver_venta', {
    title: 'Ver una venta',
    description: 'Detalle completo de una venta por su id: ítems con sus opciones, pagos, descuentos, mesa y mozo.',
    inputSchema: { id: z.string().regex(/^\d+$/).describe('Id de la venta, ej. 15392') },
    annotations: { ...LECTURA, title: 'Ver una venta' },
  }, herramienta('fudo_ver_venta', async ({ id }: { id: string }) => {
    const j = await fudoGet(`sales/${id}`, { include: INCLUDE_VENTA })
    return armarVenta(j.data, indice(j.included), true)
  }))

  server.registerTool('fudo_resumen_ventas', {
    title: 'Resumen de ventas',
    description: 'Suma las ventas CERRADAS de un rango de días operativos (hasta 62): total, tickets y ticket promedio, por día, por tipo, por medio de pago y los productos más vendidos. "criterio" define a qué día va cada venta: "apertura" (por defecto, igual que Sala de Profes) o "cierre". El total de un día cambia según el criterio; para el total de un período largo la diferencia es mínima. El importe de cada producto es antes de descuentos, por eso su suma puede superar el total. Sin fechas, usa hoy.',
    inputSchema: {
      desde: FECHA.optional(),
      hasta: FECHA.optional(),
      criterio: z.enum(['apertura', 'cierre']).default('apertura').describe('Si cada venta cuenta el día en que se abrió o en que se cerró'),
      top_productos: limite(15, 100),
    },
    annotations: { ...LECTURA, title: 'Resumen de ventas' },
  }, herramienta('fudo_resumen_ventas', async (a: { desde?: string; hasta?: string; criterio: 'apertura' | 'cierre'; top_productos: number }) => {
    const { d, h, params } = filtrosVenta({ ...a, estados: ['CLOSED'] })
    const dias = Math.round((Date.parse(h) - Date.parse(d)) / 86_400_000) + 1
    if (dias > 62) throw new Error(`El rango tiene ${dias} días y el máximo es 62. Pedilo por partes.`)
    const porCierre = a.criterio === 'cierre'
    if (porCierre) {
      // La API filtra por apertura: se traen 3 días antes, por las ventas abiertas antes y cerradas en el rango
      const antes = new Date(Date.parse(d) - 3 * 86_400_000).toISOString().slice(0, 10)
      params['filter[createdAt]'] = `and(gte.${inicioDia(antes)},lte.${finDia(h)})`
    }
    const TAM = 200, TOPE_PAGINAS = 100
    type Fila = { tickets: number; total: number }
    const pordia = new Map<string, Fila>(), portipo = new Map<string, Fila>(), pormedio = new Map<string, Fila>()
    const porprod = new Map<string, { cantidad: number; importe: number }>()
    const sumar = (m: Map<string, Fila>, k: string, monto: number) => { const x = m.get(k) ?? { tickets: 0, total: 0 }; x.tickets += 1; x.total += monto; m.set(k, x) }
    let tickets = 0, total = 0, completo = false
    for (let n = 1; n <= TOPE_PAGINAS; n++) {
      const j = await fudoGet('sales', { ...params, sort: 'createdAt', include: 'items.product,payments.paymentMethod', 'page[size]': TAM, 'page[number]': n })
      const idx = indice(j.included)
      for (const s of j.data) {
        const dia = diaOperativo(porCierre ? s.attributes.closedAt ?? s.attributes.createdAt : s.attributes.createdAt)
        if (dia < d || dia > h) continue
        const t = Number(s.attributes.total ?? 0)
        tickets++; total += t
        sumar(pordia, dia, t)
        sumar(portipo, s.attributes.saleType ?? '?', t)
        for (const p of varios(idx, s.relationships?.payments)) if (!p.attributes.canceled) sumar(pormedio, uno(idx, p.relationships?.paymentMethod)?.attributes?.name ?? '?', Number(p.attributes.amount ?? 0))
        for (const i of varios(idx, s.relationships?.items)) {
          if (i.attributes.canceled) continue
          const nombre = uno(idx, i.relationships?.product)?.attributes?.name ?? '?'
          const x = porprod.get(nombre) ?? { cantidad: 0, importe: 0 }
          x.cantidad += Number(i.attributes.quantity ?? 0)
          x.importe += Number(i.attributes.price ?? 0) // price = total de la línea
          porprod.set(nombre, x)
        }
      }
      if (j.data.length < TAM) { completo = true; break }
    }
    return {
      rango: { desde: d, hasta: h },
      criterio: a.criterio,
      completo,
      ...(completo ? {} : { aviso: `Se cortó en ${TOPE_PAGINAS * TAM} ventas: los totales están incompletos. Pedí un rango más chico.` }),
      tickets, total, ticket_promedio: tickets ? Math.round(total / tickets) : 0,
      por_dia: [...pordia].map(([dia, v]) => ({ dia, ...v })).sort((x, y) => x.dia.localeCompare(y.dia)),
      por_tipo: [...portipo].map(([tipo, v]) => ({ tipo, ...v })).sort((x, y) => y.total - x.total),
      por_medio_de_pago: [...pormedio].map(([medio, v]) => ({ medio, pagos: v.tickets, total: v.total })).sort((x, y) => y.total - x.total),
      productos_mas_vendidos: [...porprod].map(([producto, v]) => ({ producto, ...v })).sort((x, y) => y.cantidad - x.cantidad).slice(0, a.top_productos),
    }
  }))

  server.registerTool('fudo_buscar_productos', {
    title: 'Buscar productos',
    description: 'Busca en la carta de Fudo por nombre o categoría (sin distinguir acentos). Devuelve id, precio, costo, stock, categoría y si se arma con opciones (grupos modificadores). Las recetas NO están disponibles en la API.',
    inputSchema: {
      buscar: z.string().optional().describe('Parte del nombre, ej. "hamburguesa"'),
      categoria: z.string().optional().describe('Parte del nombre de la categoría, ej. "cafeter"'),
      solo_activos: z.boolean().default(true),
      limite: limite(50, 200),
    },
    annotations: { ...LECTURA, title: 'Buscar productos' },
  }, herramienta('fudo_buscar_productos', async (a: { buscar?: string; categoria?: string; solo_activos: boolean; limite: number }) => {
    const { data, idx } = await todas('productos', 'products', { include: 'productCategory' }, 500)
    const q = normal(a.buscar), c = normal(a.categoria)
    const hallados = data.map((p) => ({ p, cat: uno(idx, p.relationships?.productCategory)?.attributes?.name ?? null }))
      .filter(({ p, cat }) => (!a.solo_activos || p.attributes.active) && (!q || normal(p.attributes.name).includes(q)) && (!c || normal(cat).includes(c)))
    return {
      total_encontrados: hallados.length,
      mostrando: Math.min(hallados.length, a.limite),
      productos: hallados.slice(0, a.limite).map(({ p, cat }) => ({
        id: p.id, nombre: p.attributes.name, categoria: cat, precio: p.attributes.price, costo: p.attributes.cost,
        stock: p.attributes.stock, control_stock: p.attributes.stockControl, activo: p.attributes.active,
        grupos_de_opciones: refs(p.relationships?.productModifiersGroups).length,
      })),
    }
  }))

  server.registerTool('fudo_ver_producto', {
    title: 'Ver un producto',
    description: 'Detalle de un producto por id: precio, stock y sus grupos de opciones con cada opción (ej. el Clásico: infusión, leche, medialunas, vaso para llevar).',
    inputSchema: { id: z.string().regex(/^\d+$/) },
    annotations: { ...LECTURA, title: 'Ver un producto' },
  }, herramienta('fudo_ver_producto', async ({ id }: { id: string }) => {
    const j = await fudoGet(`products/${id}`, { include: 'productCategory,productModifiersGroups.productModifiers.product' })
    const idx = indice(j.included), p = j.data
    return {
      id: p.id, nombre: p.attributes.name, categoria: uno(idx, p.relationships?.productCategory)?.attributes?.name ?? null,
      precio: p.attributes.price, costo: p.attributes.cost, stock: p.attributes.stock, control_stock: p.attributes.stockControl, activo: p.attributes.active,
      grupos_de_opciones: varios(idx, p.relationships?.productModifiersGroups).map((g) => ({
        grupo: g.attributes.name, elige_min: g.attributes.minQuantity, elige_max: g.attributes.maxQuantity,
        opciones: varios(idx, g.relationships?.productModifiers).map((m) => ({ id_producto: refs(m.relationships?.product)[0]?.id, nombre: uno(idx, m.relationships?.product)?.attributes?.name ?? '?', precio_extra: m.attributes.price })),
      })),
    }
  }))

  server.registerTool('fudo_buscar_ingredientes', {
    title: 'Buscar ingredientes',
    description: 'Stock de los ingredientes en Fudo: stock, mínimo, costo, unidad y categoría. Filtra por nombre, por stock negativo o por estar bajo el mínimo. Ojo: es lo que Fudo calcula, no lo que hay contado físicamente.',
    inputSchema: {
      buscar: z.string().optional(),
      solo_negativos: z.boolean().default(false),
      solo_bajo_minimo: z.boolean().default(false),
      limite: limite(100, 500),
    },
    annotations: { ...LECTURA, title: 'Buscar ingredientes' },
  }, herramienta('fudo_buscar_ingredientes', async (a: { buscar?: string; solo_negativos: boolean; solo_bajo_minimo: boolean; limite: number }) => {
    const { data, idx } = await todas('ingredientes', 'ingredients', { include: 'ingredientCategory,unit' }, 200)
    const q = normal(a.buscar)
    const hallados = data.filter((i) => {
      const s = i.attributes.stock, m = i.attributes.minStock
      return (!q || normal(i.attributes.name).includes(q)) && (!a.solo_negativos || Number(s) < 0) && (!a.solo_bajo_minimo || (m != null && Number(s) <= Number(m)))
    })
    return {
      total_encontrados: hallados.length,
      mostrando: Math.min(hallados.length, a.limite),
      ingredientes: hallados.slice(0, a.limite).map((i) => ({
        id: i.id, nombre: i.attributes.name, stock: i.attributes.stock, minimo: i.attributes.minStock, costo: i.attributes.cost,
        unidad: uno(idx, i.relationships?.unit)?.attributes?.name ?? null, categoria: uno(idx, i.relationships?.ingredientCategory)?.attributes?.name ?? null,
      })),
    }
  }))

  server.registerTool('fudo_listar_gastos', {
    title: 'Listar gastos',
    description: 'Gastos de Fudo, del más nuevo al más viejo: proveedor, categoría, insumos y lo pagado. La API no da la cantidad comprada de cada insumo. Un gasto sin pago imputado (cuenta corriente) viene sin monto ni fecha: sale con sin_pago=true y, si filtrás por fechas, aparece igual porque no se puede ubicar en el tiempo.',
    inputSchema: {
      desde: FECHA.optional().describe('Corta la búsqueda en los gastos pagados antes de este día'),
      hasta: FECHA.optional(),
      proveedor: z.string().optional().describe('Parte del nombre del proveedor'),
      limite: limite(50, 200),
    },
    annotations: { ...LECTURA, title: 'Listar gastos' },
  }, herramienta('fudo_listar_gastos', async (a: { desde?: string; hasta?: string; proveedor?: string; limite: number }) => {
    const q = normal(a.proveedor)
    const TAM = 100, TOPE_PAGINAS = 30
    const gastos: unknown[] = []
    let terminado = false
    for (let n = 1; n <= TOPE_PAGINAS && !terminado; n++) {
      const j = await fudoGet('expenses', { include: 'payments,provider,expenseCategory,expenseItems.ingredient', sort: '-id', 'page[size]': TAM, 'page[number]': n })
      const idx = indice(j.included)
      for (const e of j.data) {
        const pagos = varios(idx, e.relationships?.payments).filter((p) => !p.attributes.canceled)
        const fecha: string | null = pagos.map((p) => p.attributes.createdAt).sort()[0] ?? null
        const dia = fecha ? diaOperativo(fecha) : null
        if (a.desde && dia && dia < a.desde) { terminado = true; continue }
        if (a.hasta && dia && dia > a.hasta) continue
        const proveedor = uno(idx, e.relationships?.provider)?.attributes?.name ?? null
        if (q && !normal(proveedor).includes(q)) continue
        gastos.push({
          id: e.id, fecha: local(fecha), proveedor,
          categoria: uno(idx, e.relationships?.expenseCategory)?.attributes?.name ?? null,
          pagado: pagos.reduce((s, p) => s + Number(p.attributes.amount ?? 0), 0),
          sin_pago: pagos.length === 0,
          insumos: varios(idx, e.relationships?.expenseItems).map((it) => uno(idx, it.relationships?.ingredient)?.attributes?.name).filter(Boolean),
        })
        if (gastos.length >= a.limite) { terminado = true; break }
      }
      if (j.data.length < TAM) terminado = true
    }
    return { cantidad: gastos.length, ...(terminado ? {} : { aviso: `Se revisaron ${TOPE_PAGINAS * TAM} gastos sin llegar al inicio del rango: puede faltar información.` }), gastos }
  }))

  server.registerTool('fudo_consultar', {
    title: 'Consulta libre (solo lectura)',
    description: `Lectura libre de la API de Fudo para lo que no cubren las otras herramientas. Rutas permitidas: ${[...RUTAS_LIBRES].join(', ')}. Devuelve el JSON:API crudo. Atención: customers y users traen datos personales.`,
    inputSchema: {
      ruta: z.string().regex(/^[a-z][a-z-]*(\/[A-Za-z0-9-]+)*$/, 'Solo la ruta, sin / inicial ni parámetros: ej. "customers" o "customers/12"'),
      parametros: z.record(z.string(), z.string()).optional().describe('Ej. {"page[size]":"20","page[number]":"1","sort":"-id","include":"room"}'),
    },
    annotations: { ...LECTURA, title: 'Consulta libre (solo lectura)' },
  }, herramienta('fudo_consultar', async ({ ruta, parametros }: { ruta: string; parametros?: Record<string, string> }) => {
    if (!RUTAS_LIBRES.has(ruta.split('/')[0])) throw new Error(`La ruta "${ruta}" no está permitida. Permitidas: ${[...RUTAS_LIBRES].join(', ')}.`)
    return fudoGet(ruta, parametros ?? { 'page[size]': '20' })
  }))

  return server
}
