import { fudoFetch } from '@/lib/fudoClient'
import { descripcionGasto, type CategoriaGasto, type ComprobanteTipo, type DatosGasto } from '@/lib/compras/datos-gasto'

// ---------------------------------------------------------------------------
// Fudo Expenses (módulo de GASTOS) — precio de compra REAL
// ---------------------------------------------------------------------------
// El módulo de gastos de Fudo es mucho más rico que la tabla local de
// recepciones (hoy vacía). Cada Expense agrupa pagos (payments) e items de
// gasto (expenseItems), y estos últimos referencian el ingredient comprado.
//
// Estructura JSON:API real (ya investigada, NO re-explorar):
//   - GET /v1alpha1/expenses?include=payments,provider,expenseItems.ingredient
//   - El objeto Expense NO tiene attributes; sólo relationships:
//       provider {data:{id}}, payments {data:[{id}]}, expenseItems {data:[{id}]}
//   - En `included` vienen:
//       Provider    { id, attributes:{ name } }
//       Payment     { id, attributes:{ amount:number, canceled:boolean, createdAt } }
//       ExpenseItem { id, relationships:{ ingredient:{ data:{id}|null } } }
//       Ingredient  { id, attributes:{ name } }
//   - Por gasto:
//       amount = Σ payments NO cancelados
//       date   = createdAt del primer payment no cancelado (los Expense no
//                tienen fecha propia)
//       ingredientNames = nombres de los ingredient no-null de sus expenseItems
//   - Descartar gastos sin ningún payment válido.
// ---------------------------------------------------------------------------

export type FudoExpenseItem = {
  ingredientId: string
  name: string
  qty: number   // de attributes.quantity en Fudo
  price: number // de attributes.price en Fudo (precio unitario)
}

export type FudoExpense = {
  id: string
  provider: string | null
  /** id del Provider en Fudo (= suppliers.fudo_provider_id) */
  providerId: string | null
  /** ids de los Ingredient comprados (para cruzar con stock_items.fudo_ingredient_id) */
  ingredientIds: string[]
  date: string // ISO del primer payment no cancelado
  amount: number // Σ payments no cancelados
  ingredientNames: string[]
  itemCount: number // cantidad de expenseItems con ingredient
  /** Items con cantidad y precio unitario (disponibles cuando Fudo los incluyó) */
  items: FudoExpenseItem[]
}

type JsonApiRes = {
  type: string
  id: string
  attributes?: Record<string, unknown>
  relationships?: Record<string, { data: { id: string; type: string } | { id: string; type: string }[] | null }>
}

type ExpensesResponse = {
  data: JsonApiRes[]
  included?: JsonApiRes[]
}

export type FudoExpensesMeta = {
  expenses: FudoExpense[]
  /** Conteo CRUDO de expenses que devolvió Fudo, ANTES de descartar los que no
   *  tienen pago válido: es el número que hay que comparar contra el tope de
   *  paginación para saber si la cobertura puede estar incompleta. */
  rawCount: number
}

// Cache en memoria de módulo (30 min), patrón de personal/consumo.
// Guarda la lista COMPLETA (sin filtrar): cada llamada filtra por su sinceISO,
// así el cache sirve para cualquier ventana (antes se cacheaba filtrado por un
// sinceISO con milisegundos → nunca coincidía y el cache no servía de nada).
const CACHE_TTL_MS = 30 * 60 * 1000
let cache: { at: number; expenses: FudoExpense[]; rawCount: number } | null = null

function relArray(rel: JsonApiRes['relationships'], key: string): { id: string; type: string }[] {
  const data = rel?.[key]?.data
  if (!data) return []
  return Array.isArray(data) ? data : [data]
}

function relOne(rel: JsonApiRes['relationships'], key: string): { id: string; type: string } | null {
  const data = rel?.[key]?.data
  if (!data || Array.isArray(data)) return null
  return data
}

/**
 * Trae los gastos del módulo de gastos de Fudo, ya normalizados.
 * @param sinceISO opcional — si se pasa, se descartan gastos con date < sinceISO.
 * @param options.force true → saltea el cache (botón "Actualizar gastos de Fudo").
 * Cache en memoria 30 min. Si Fudo falla, lanza error claro.
 */
export async function fetchFudoExpenses(
  sinceISO?: string,
  options: { force?: boolean } = {},
): Promise<FudoExpense[]> {
  return (await fetchFudoExpensesConMeta(sinceISO, options)).expenses
}

/**
 * Igual que fetchFudoExpenses pero devuelve también rawCount (conteo crudo
 * de expenses traídos de Fudo, antes de descartar los sin pago válido), para
 * detectar honestamente cuándo el cache vino lleno.
 */
export async function fetchFudoExpensesConMeta(
  sinceISO?: string,
  options: { force?: boolean } = {},
): Promise<FudoExpensesMeta> {
  if (!options.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return {
      expenses: sinceISO ? cache.expenses.filter((e) => e.date >= sinceISO) : cache.expenses,
      rawCount: cache.rawCount,
    }
  }

  const pageSize = 200
  const rawExpenses: JsonApiRes[] = []
  // included se va acumulando entre páginas (Provider/Payment/ExpenseItem/Ingredient)
  const providerName = new Map<string, string>()
  const payments = new Map<string, { amount: number; canceled: boolean; createdAt: string }>()
  const ingredientName = new Map<string, string>()
  const expenseItemIngredient = new Map<string, string | null>()
  const expenseItemDetail = new Map<string, { qty: number; price: number }>()

  try {
    for (let page = 1; page <= 20; page++) {
      const res = await fudoFetch<ExpensesResponse>(
        `/expenses?include=payments,provider,expenseItems.ingredient&page[size]=${pageSize}&page[number]=${page}`,
      )
      const data = Array.isArray(res.data) ? res.data : []
      rawExpenses.push(...data)

      for (const inc of res.included ?? []) {
        const attrs = inc.attributes ?? {}
        switch (inc.type) {
          case 'Provider':
            if (typeof attrs.name === 'string') providerName.set(inc.id, attrs.name)
            break
          case 'Payment':
            payments.set(inc.id, {
              amount: Number(attrs.amount ?? 0) || 0,
              canceled: Boolean(attrs.canceled),
              createdAt: String(attrs.createdAt ?? ''),
            })
            break
          case 'Ingredient':
            if (typeof attrs.name === 'string') ingredientName.set(inc.id, attrs.name)
            break
          case 'ExpenseItem':
            expenseItemIngredient.set(inc.id, relOne(inc.relationships, 'ingredient')?.id ?? null)
            expenseItemDetail.set(inc.id, {
              qty: Number(attrs.quantity ?? 0) || 0,
              price: Number(attrs.price ?? 0) || 0,
            })
            break
        }
      }

      if (data.length < pageSize) break
    }
  } catch (err) {
    throw new Error(
      `No se pudieron leer los gastos de Fudo: ${err instanceof Error ? err.message : 'error desconocido'}`,
    )
  }

  const expenses: FudoExpense[] = []
  for (const exp of rawExpenses) {
    // Pagos no cancelados de este gasto
    const paymentRefs = relArray(exp.relationships, 'payments')
    const validPayments = paymentRefs
      .map((p) => payments.get(p.id))
      .filter((p): p is { amount: number; canceled: boolean; createdAt: string } => !!p && !p.canceled)

    if (validPayments.length === 0) continue // sin pago válido → descartar

    const amount = validPayments.reduce((s, p) => s + p.amount, 0)
    // Fecha = createdAt del primer pago no cancelado (orden por createdAt asc)
    const sortedByDate = [...validPayments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    const date = sortedByDate[0]?.createdAt || ''
    if (!date) continue

    // Ingredientes: nombres, ids y detalle (qty/price) de los expenseItems
    const itemRefs = relArray(exp.relationships, 'expenseItems')
    const names: string[] = []
    const ingredientIds: string[] = []
    const items: FudoExpenseItem[] = []
    for (const it of itemRefs) {
      const ingId = expenseItemIngredient.get(it.id)
      if (!ingId) continue
      ingredientIds.push(ingId)
      const name = ingredientName.get(ingId) ?? ingId
      const detail = expenseItemDetail.get(it.id) ?? { qty: 0, price: 0 }
      if (name !== ingId) names.push(name)
      items.push({ ingredientId: ingId, name, qty: detail.qty, price: detail.price })
    }

    const providerId = relOne(exp.relationships, 'provider')?.id
    expenses.push({
      id: exp.id,
      provider: providerId ? providerName.get(providerId) ?? null : null,
      providerId: providerId ?? null,
      ingredientIds,
      date,
      amount: Math.round(amount * 100) / 100,
      ingredientNames: names,
      itemCount: items.length,
      items,
    })
  }

  expenses.sort((a, b) => b.date.localeCompare(a.date))
  const rawCount = rawExpenses.length
  cache = { at: Date.now(), expenses, rawCount }

  return {
    expenses: sinceISO ? expenses.filter((e) => e.date >= sinceISO) : expenses,
    rawCount,
  }
}

// Pagar un gasto NO genera movimiento de caja en Fudo: en el local, los
// movimientos de caja son solo retiros e ingresos de dinero. (Hasta el 03/10
// se creaba un egreso en /cash-movements por cada pago en efectivo.)

// ---------------------------------------------------------------------------
// Categorías de gasto y tipos de comprobante de Fudo
// ---------------------------------------------------------------------------
const META_TTL_MS = 30 * 60 * 1000
let categoriasCache: { at: number; list: CategoriaGasto[] } | null = null
let tiposCache: { at: number; map: Map<ComprobanteTipo, string> } | null = null

/**
 * Categorías de gasto activas de Fudo, para elegir: las que cuelgan de otra
 * (con su padre como grupo) y las sueltas. Las que son padre de otras no se
 * ofrecen: para el análisis sirve la específica ("Verdulería", no "Compras").
 * OJO: Fudo devuelve las categorías SIN atributos salvo que se pidan con
 * fields[expenseCategory]; sin eso no venía ningún nombre y la lista quedaba
 * vacía (la categoría no se pedía y los gastos llegaban sin categoría).
 */
export async function fetchFudoExpenseCategories(): Promise<CategoriaGasto[]> {
  if (categoriasCache && Date.now() - categoriasCache.at < META_TTL_MS) return categoriasCache.list
  const todas: { id: string; name: string; active: boolean; parentId: string | null }[] = []
  for (let page = 1; page <= 10; page++) {
    const res = await fudoFetch<{ data?: JsonApiRes[] }>(
      `/expense-categories?page[size]=200&page[number]=${page}&sort=name&fields[expenseCategory]=name,active,parentCategory`,
    )
    const data = Array.isArray(res.data) ? res.data : []
    for (const c of data) {
      const a = c.attributes ?? {}
      if (typeof a.name !== 'string') continue
      todas.push({ id: c.id, name: a.name.trim(), active: a.active !== false, parentId: relOne(c.relationships, 'parentCategory')?.id ?? null })
    }
    if (data.length < 200) break
  }
  const nombre = new Map(todas.map((c) => [c.id, c.name]))
  const padres = new Set(todas.map((c) => c.parentId).filter(Boolean))
  const list = todas
    .filter((c) => c.active && !padres.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, grupo: c.parentId ? nombre.get(c.parentId) ?? null : null }))
  categoriasCache = { at: Date.now(), list }
  return list
}

/**
 * Id del tipo de comprobante (ReceiptType) en Fudo. La API no tiene un listado
 * de tipos: se toman de los gastos ya cargados en Fudo. Si ese tipo nunca se
 * usó, no se manda (el gasto igual lleva número y descripción).
 */
async function receiptTypeId(tipo: ComprobanteTipo | null): Promise<string | null> {
  if (!tipo || tipo === 'sin_comprobante') return null
  if (!tiposCache || Date.now() - tiposCache.at >= META_TTL_MS) {
    const map = new Map<ComprobanteTipo, string>()
    try {
      const res = await fudoFetch<ExpensesResponse>('/expenses?include=receiptType&page[size]=200&sort=-id')
      for (const inc of res.included ?? []) {
        if (inc.type !== 'ReceiptType') continue
        const nombre = String(inc.attributes?.name ?? inc.attributes?.description ?? '').toLowerCase()
        const letra = nombre.match(/factura\s*([abc])\b/)?.[1]
        const key: ComprobanteTipo | null = letra ? (`factura_${letra}` as ComprobanteTipo) : /ticket/.test(nombre) ? 'ticket' : null
        if (key && !map.has(key)) map.set(key, inc.id)
      }
    } catch (err) {
      console.warn('[receiptTypeId] no se pudieron leer los tipos de comprobante:', err instanceof Error ? err.message : err)
    }
    tiposCache = { at: Date.now(), map }
  }
  return tiposCache.map.get(tipo) ?? null
}

// ---------------------------------------------------------------------------
// Medios de pago: Sala de Profes → Fudo
// ---------------------------------------------------------------------------
// Antes todo se mandaba como id '1' (Efectivo): una transferencia figuraba en
// Fudo como efectivo y un gasto en cuenta corriente quedaba SIN medio de pago,
// así que no aparecía en la cuenta corriente del proveedor (órdenes de pago).
// Se resuelve por tipo contra /payment-methods. Los ids de respaldo (si Fudo no
// responde) son de CADA cuenta de Fudo: los de LVE ('1'…'5') no valen acá. Se
// cargan en FUDO_MEDIOS_PAGO (JSON, ej. {"efectivo":"1","transferencia":"5"})
// una vez verificados en GET /payment-methods del Fudo de esta sucursal. Sin
// respaldo, un medio que no se encuentra corta con error en vez de imputarse a otro.
// tarjeta_credito: solo para leer pagos hechos en Fudo (en Sala de Profes es una sola "Tarjeta" → débito)
const MEDIOS_PAGO = ['efectivo', 'cuenta_corriente', 'tarjeta_credito', 'tarjeta', 'transferencia']
const MEDIO_FUDO_RESPALDO: Record<string, string> = (() => {
  try {
    const raw = JSON.parse(process.env.FUDO_MEDIOS_PAGO ?? '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(raw).filter(([k, v]) => MEDIOS_PAGO.includes(k) && typeof v === 'string' && v)) as Record<string, string>
  } catch {
    console.warn('[fudoPaymentMethodId] FUDO_MEDIOS_PAGO no es un JSON válido: se ignora')
    return {}
  }
})()
let mediosCache: { at: number; map: Record<string, string> } | null = null

/**
 * Caja de Fudo donde entran los pagos en efectivo ("Usar en arqueo" + caja),
 * igual que los gastos que el equipo carga a mano. La API no lista cajas: en
 * Santa Fe hay una sola, la 1 (verificado en los gastos en efectivo el 22/10).
 * FUDO_CAJA_ID permite cambiarla sin tocar código.
 */
const CAJA_LOCAL = process.env.FUDO_CAJA_ID || '1'

/** PaymentMethod de Fudo para un medio de Sala de Profes (efectivo, transferencia, tarjeta, cuenta_corriente). */
export async function fudoPaymentMethodId(medio: string | null | undefined): Promise<string> {
  const clave = medio && MEDIOS_PAGO.includes(medio) ? medio : 'efectivo'
  let map: Record<string, string> = mediosCache?.map ?? { ...MEDIO_FUDO_RESPALDO }
  if (!mediosCache || Date.now() - mediosCache.at >= META_TTL_MS) {
    map = { ...MEDIO_FUDO_RESPALDO }
    try {
      const res = await fudoFetch<{ data?: JsonApiRes[] }>('/payment-methods?page[size]=100&fields[paymentMethod]=name,code,kind,forExpenses,active')
      const medios = (res.data ?? []).filter((m) => m.attributes?.active !== false && m.attributes?.forExpenses !== false)
      const buscar = (f: (a: Record<string, unknown>) => boolean) => medios.find((m) => f(m.attributes ?? {}))?.id
      const encontrados: Record<string, string | undefined> = {
        cuenta_corriente: buscar((a) => a.kind === 'HOUSE-ACCOUNT'),
        efectivo: buscar((a) => a.kind === 'CASH'),
        tarjeta: buscar((a) => a.kind === 'DEBIT-CARD'),
        tarjeta_credito: buscar((a) => a.kind === 'CREDIT-CARD'),
        transferencia: buscar((a) => /transfer/i.test(String(a.name ?? '')) || /transfer/i.test(String(a.code ?? ''))),
      }
      for (const [k, id] of Object.entries(encontrados)) if (id) map[k] = id
      mediosCache = { at: Date.now(), map }
    } catch (err) {
      // Sin cachear: el próximo pedido vuelve a consultar a Fudo
      console.warn('[fudoPaymentMethodId] Fudo no respondió, uso FUDO_MEDIOS_PAGO:', err instanceof Error ? err.message : err)
    }
  }
  const id = map[clave]
  if (!id) throw new Error(`No encontré el medio de pago "${clave}" en Fudo (revisar FUDO_MEDIOS_PAGO o los medios de pago de Fudo)`)
  return id
}

/** Al revés: medio de Sala de Profes para un PaymentMethod de Fudo (null si no hay equivalente). */
export async function medioLveDesdeFudo(fudoId: string): Promise<string | null> {
  await fudoPaymentMethodId('efectivo') // carga el mapa
  const map = mediosCache?.map ?? MEDIO_FUDO_RESPALDO
  const medio = Object.entries(map).find(([, id]) => id === fudoId)?.[0] ?? null
  if (medio === 'tarjeta_credito') return 'tarjeta'
  return medio === 'cuenta_corriente' ? null : medio
}

/** Imputa un pago a un gasto de Fudo con su medio real. */
export async function postFudoPayment(params: { expenseId: string; amount: number; medio: string | null | undefined }) {
  // Un pago no puede ser "cuenta corriente" (eso es deber): sin medio real, efectivo
  const medio = params.medio === 'cuenta_corriente' ? 'efectivo' : params.medio
  const medioId = await fudoPaymentMethodId(medio)
  const enEfectivo = (medio ?? 'efectivo') === 'efectivo'
  const res = await fudoFetch<{ data?: { id?: string } }>('/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { type: 'Payment', attributes: { amount: params.amount },
      relationships: {
        paymentMethod: { data: { type: 'PaymentMethod', id: medioId } },
        expense: { data: { type: 'Expense', id: params.expenseId } },
        // Efectivo: sale del cajón → a la caja, para que lo descuente el arqueo
        ...(enEfectivo ? { cashRegister: { data: { type: 'CashRegister', id: CAJA_LOCAL } } } : {}),
      } } }),
  })
  // "Usar en arqueo" del pago (el alta de pagos no lo recibe; se marca después)
  const pagoId = res?.data?.id
  if (enEfectivo && pagoId) {
    await fudoFetch(`/payments/${encodeURIComponent(pagoId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { id: pagoId, type: 'Payment', attributes: { useInCashCount: true } } }),
    }).catch((e) => console.warn('[postFudoPayment] no se pudo marcar "usar en arqueo":', e instanceof Error ? e.message : e))
  }
  return res
}

/** ¿El gasto ya figura pagado en Fudo? (p. ej. por una orden de pago hecha en Fudo) */
export async function fudoExpensePagado(expenseId: string): Promise<boolean> {
  const res = await fudoFetch<{ data?: JsonApiRes }>(`/expenses/${encodeURIComponent(expenseId)}?fields[expense]=status`)
  return res?.data?.attributes?.status === 'PAID'
}

/** Cuerpo del POST /expenses: proveedor + categoría + comprobante + medio de pago. */
export async function fudoExpenseBody(params: {
  fudoProviderId: string
  amount: number
  date: string
  gasto?: DatosGasto | null
  /** Medio de Sala de Profes; cuenta corriente lo deja en la cuenta del proveedor en Fudo */
  medioPago?: string | null
  conTipoComprobante?: boolean
}) {
  const { fudoProviderId, amount, date, gasto, medioPago, conTipoComprobante = true } = params
  const tipoId = conTipoComprobante ? await receiptTypeId(gasto?.comprobante ?? null) : null
  const medioId = medioPago ? await fudoPaymentMethodId(medioPago) : null
  const descripcion = descripcionGasto(gasto ?? null)
  return {
    data: {
      type: 'Expense',
      attributes: {
        amount,
        date,
        ...(gasto?.numero ? { receiptNumber: gasto.numero } : {}),
        ...(descripcion ? { description: descripcion } : {}),
        // Pagado en efectivo: cuenta en el arqueo de la caja (como lo cargan a mano)
        ...(medioPago === 'efectivo' ? { useInCashCount: true } : {}),
      },
      relationships: {
        provider: { data: { type: 'Provider', id: fudoProviderId } },
        ...(gasto?.categoriaId ? { expenseCategory: { data: { type: 'ExpenseCategory', id: gasto.categoriaId } } } : {}),
        ...(tipoId ? { receiptType: { data: { type: 'ReceiptType', id: tipoId } } } : {}),
        ...(medioId ? { paymentMethod: { data: { type: 'PaymentMethod', id: medioId } } } : {}),
        ...(medioPago === 'efectivo' ? { cashRegister: { data: { type: 'CashRegister', id: CAJA_LOCAL } } } : {}),
      },
    },
  }
}

/** POST /expenses; si Fudo rechaza el tipo de comprobante, reintenta sin él. */
export async function postFudoExpense(params: Parameters<typeof fudoExpenseBody>[0]): Promise<string | null> {
  const enviar = async (conTipoComprobante: boolean) => {
    const res = await fudoFetch<{ data?: { id?: string } }>('/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await fudoExpenseBody({ ...params, conTipoComprobante })),
    })
    return res?.data?.id ?? null
  }
  try {
    return await enviar(true)
  } catch (err) {
    if (!params.gasto?.comprobante || params.gasto.comprobante === 'sin_comprobante') throw err
    console.warn('[postFudoExpense] reintento sin tipo de comprobante:', err instanceof Error ? err.message : err)
    return await enviar(false)
  }
}

/**
 * Detalle de mercadería: agrega el producto al gasto de Fudo. En Fudo, un
 * gasto con insumo SUMA stock; por eso se lee el stock antes y después:
 *   · sumoStock: Fudo sumó la cantidad → quien llama NO debe sumarla otra vez
 *     (syncToFudo con fudoSumadoPorGasto).
 *   · si no sumó (o el ítem no entró) → se suma como siempre, por delta.
 * Nunca queda sin sumar ni sumado dos veces. Si agregar el ítem le cambia el
 * monto al gasto, se le devuelve el monto que tenía.
 */
export async function agregarItemAGastoFudo(params: {
  expenseId: string
  fudoIngredientId?: string | null
  fudoProductId?: string | null
  qty: number
  /**
   * TOTAL del renglón (cantidad × precio). En Fudo el "precio" de un ítem de
   * gasto es el total de esa línea: con el precio por kg el detalle mostraba
   * el costo de 1 kg (gasto 2240: Jamón crudo 2,61 kg → $13.933 en vez de $36.364).
   */
  precioTotal: number
}): Promise<{ itemCreado: boolean; sumoStock: boolean; fudoAfter: number | null }> {
  const { expenseId, fudoIngredientId, fudoProductId, qty, precioTotal } = params
  const nada = { itemCreado: false, sumoStock: false, fudoAfter: null }
  if (!(qty > 0) || !(precioTotal > 0) || (!fudoIngredientId && !fudoProductId)) return nada
  const { readFudoIngredientStock, readFudoProductStock } = await import('@/lib/fudo/stock-sync')
  const leer = () => (fudoIngredientId ? readFudoIngredientStock(fudoIngredientId) : readFudoProductStock(fudoProductId!))
  try {
    const antes = await leer()
    // Sin control de stock en Fudo no hay cómo verificar: se suma como siempre
    if (antes === null) return nada
    const montoRes = await fudoFetch<{ data?: JsonApiRes }>(`/expenses/${encodeURIComponent(expenseId)}?fields[expense]=amount`)
    const montoAntes = Number(montoRes?.data?.attributes?.amount ?? NaN)

    await fudoFetch('/expense-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          type: 'ExpenseItem',
          attributes: { price: Math.round(precioTotal * 100) / 100, quantity: qty },
          relationships: {
            expense: { data: { type: 'Expense', id: expenseId } },
            ...(fudoIngredientId
              ? { ingredient: { data: { type: 'Ingredient', id: fudoIngredientId } } }
              : { product: { data: { type: 'Product', id: fudoProductId! } } }),
          },
        },
      }),
    })

    const despues = await leer().catch(() => null)
    // Con margen: alguna venta justo en el medio puede mover un poco el número.
    // Si el ítem entró pero no se puede releer, se asume que Fudo lo sumó (es
    // lo que hace con un gasto con insumo): sumarlo de nuevo sería doble.
    const sumoStock = despues === null || despues - antes >= qty * 0.5

    // El monto del gasto lo manda Sala de Profes (factura, resto sin detallar)
    if (Number.isFinite(montoAntes)) {
      const r = await fudoFetch<{ data?: JsonApiRes }>(`/expenses/${encodeURIComponent(expenseId)}?fields[expense]=amount`).catch(() => null)
      const montoDespues = Number(r?.data?.attributes?.amount ?? NaN)
      if (Number.isFinite(montoDespues) && Math.abs(montoDespues - montoAntes) >= 0.01) {
        await fudoFetch(`/expenses/${encodeURIComponent(expenseId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { id: expenseId, type: 'Expense', attributes: { amount: montoAntes } } }),
        }).catch((e) => console.warn('[agregarItemAGastoFudo] no se pudo devolver el monto:', e instanceof Error ? e.message : e))
      }
    }
    cache = null
    return { itemCreado: true, sumoStock, fudoAfter: sumoStock && despues !== null ? despues : null }
  } catch (err) {
    console.warn('[agregarItemAGastoFudo] sin detalle, el stock se suma como siempre:', err instanceof Error ? err.message : err)
    return nada
  }
}

/**
 * Cuenta corriente: Fudo anota la deuda (un pago "Cta. Cte.") por el monto del
 * gasto AL CREARLO. Si después el monto cambia (misma factura cargada de a un
 * producto, o "Llegó todo" que se ajusta al final), la deuda quedaba en el
 * monto viejo y aparecía un "saldo a pagar" que no correspondía (gasto 2240).
 * Esto lleva la deuda al monto actual. Si no hay deuda en Cta. Cte., no hace nada.
 */
export async function ajustarDeudaCtaCte(expenseId: string, montoTotal: number): Promise<void> {
  try {
    const ctaCteId = await fudoPaymentMethodId('cuenta_corriente')
    const res = await fudoFetch<{ data?: JsonApiRes; included?: JsonApiRes[] }>(
      `/expenses/${encodeURIComponent(expenseId)}?include=payments&fields[expense]=payments`,
    )
    const deuda = (res.included ?? []).find((i) => i.type === 'Payment' && i.attributes?.canceled !== true
      && (i.relationships?.paymentMethod?.data as { id: string } | null | undefined)?.id === ctaCteId)
    if (!deuda) return
    const monto = Math.round(montoTotal * 100) / 100
    if (Math.abs(Number(deuda.attributes?.amount ?? 0) - monto) < 0.01) return
    await fudoFetch(`/payments/${encodeURIComponent(deuda.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { id: deuda.id, type: 'Payment', attributes: { amount: monto } } }),
    })
  } catch (err) {
    console.warn('[ajustarDeudaCtaCte] la deuda en Cta. Cte. no se pudo ajustar:', err instanceof Error ? err.message : err)
  }
}

/**
 * Suma un producto a un gasto de Fudo que ya existe (misma factura cargada
 * producto por producto con "Llegó"). Solo si el gasto sigue en el mismo
 * estado que la compra nueva: cuenta corriente → impago; pagado → pagado (el
 * pago del monto agregado lo imputa quien llama). Si no, null: va aparte.
 */
export async function sumarAGastoFudo(params: { expenseId: string; delta: number; medioPago: string | null | undefined }): Promise<{ id: string; amount: number } | null> {
  const { expenseId, delta, medioPago } = params
  if (!(delta > 0)) return null
  try {
    const res = await fudoFetch<{ data?: JsonApiRes }>(`/expenses/${encodeURIComponent(expenseId)}?fields[expense]=amount,status,canceled`)
    const a = res?.data?.attributes
    if (!a || a.canceled === true) return null
    const ctaCte = medioPago === 'cuenta_corriente'
    if (ctaCte ? a.status !== 'UNPAID' : a.status !== 'PAID') return null
    const nuevo = Math.round((Number(a.amount ?? 0) + delta) * 100) / 100
    await fudoFetch(`/expenses/${encodeURIComponent(expenseId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { id: expenseId, type: 'Expense', attributes: { amount: nuevo } } }),
    })
    cache = null
    // Cuenta corriente: la deuda anotada en Fudo pasa al total nuevo
    if (ctaCte) await ajustarDeudaCtaCte(expenseId, nuevo)
    return { id: expenseId, amount: delta }
  } catch (err) {
    console.warn('[sumarAGastoFudo] va como gasto aparte:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Crea un gasto en Fudo al confirmar la llegada de un pedido en modo lve_stock.
 * Devuelve { id, amount } si tuvo éxito, null si Fudo falla (no corta el flujo
 * de recepción — el stock ya fue actualizado).
 */
export async function createFudoExpenseForReceipt(params: {
  fudoProviderId: string
  fudoIngredientId?: string | null
  qty: number
  costTotal: number
  costPerUnit: number | null
  receivedDate: string
  /** Categoría y comprobante */
  gasto?: DatosGasto | null
  /** efectivo | transferencia | tarjeta | cuenta_corriente */
  medioPago?: string | null
}): Promise<{ id: string; amount: number } | null> {
  const { fudoProviderId, fudoIngredientId, qty, costTotal, costPerUnit, receivedDate, gasto, medioPago } = params
  try {
    const expenseId = await postFudoExpense({ fudoProviderId, amount: costTotal, date: receivedDate, gasto, medioPago })
    if (!expenseId) return null

    // El producto (detalle de mercadería) lo agrega agregarItemAGastoFudo,
    // que además decide quién suma el stock en Fudo para no contarlo dos veces.
    void fudoIngredientId; void qty; void costPerUnit

    // Invalidar cache para que conciliación vea el nuevo gasto
    cache = null
    return { id: expenseId, amount: costTotal }
  } catch (err) {
    console.warn('[createFudoExpenseForReceipt] error:', err instanceof Error ? err.message : err)
    return null
  }
}
