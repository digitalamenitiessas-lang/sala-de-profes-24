import { fudoFetch } from '@/lib/fudoClient'

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

    // Ingredientes: nombres de los ingredient no-null de sus expenseItems
    const itemRefs = relArray(exp.relationships, 'expenseItems')
    const names: string[] = []
    const ingredientIds: string[] = []
    for (const it of itemRefs) {
      const ingId = expenseItemIngredient.get(it.id)
      if (!ingId) continue
      ingredientIds.push(ingId)
      const name = ingredientName.get(ingId)
      if (name) names.push(name)
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
      itemCount: names.length,
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
