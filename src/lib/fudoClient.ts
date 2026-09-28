// ---------------------------------------------------------------------------
// Fudo API Client v1alpha1 — Server-side only
// ---------------------------------------------------------------------------
// Auth: POST https://auth.fu.do/api → Bearer token (24h)
// API:  https://api.fu.do/v1alpha1/...
// Format: JSON:API (data[].attributes, relationships)
// Docs: https://dev.fu.do/api/
// ---------------------------------------------------------------------------

const FUDO_AUTH_URL = 'https://auth.fu.do/authenticate'
const FUDO_API_URL = 'https://api.fu.do/v1alpha1'
const FUDO_LOGIN = process.env.FUDO_LOGIN ?? ''
const FUDO_PASSWORD = process.env.FUDO_PASSWORD ?? ''

// Fallback to old apiKey/apiSecret if login/password not set
const FUDO_API_KEY = process.env.FUDO_API_KEY ?? ''
const FUDO_API_SECRET = process.env.FUDO_API_SECRET ?? ''

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

let cachedToken: string | null = null
let tokenExpiresAt = 0
let tokenEnCurso: Promise<string> | null = null

/** Tiempo máximo por consulta a Fudo: si no responde, se corta y se informa. */
const FUDO_TIMEOUT_MS = 20_000
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

function conTiempoMaximo(ms: number, init?: RequestInit): RequestInit {
  return { ...init, signal: init?.signal ?? AbortSignal.timeout(ms) }
}

function esTimeout(err: unknown) {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

async function postAuth(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, conTiempoMaximo(15_000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    }))
  } catch (err) {
    if (esTimeout(err)) throw new Error('Fudo no respondió al iniciar sesión (15 s)')
    throw err
  }
}

async function login(): Promise<string> {
  // Primary: login/password via auth.fu.do/authenticate
  if (FUDO_LOGIN && FUDO_PASSWORD) {
    let res = await postAuth(FUDO_AUTH_URL, { login: FUDO_LOGIN, password: FUDO_PASSWORD })

    if (res.status === 429) {
      // Un reintento corto; si sigue limitado, se informa
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '5') || 5
      await esperar(Math.min(retryAfter, 10) * 1000)
      res = await postAuth(FUDO_AUTH_URL, { login: FUDO_LOGIN, password: FUDO_PASSWORD })
      if (res.status === 429) throw new Error(`Fudo rate limited. Reintentar en ${retryAfter}s`)
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Fudo auth failed (${res.status}): ${body}`)
    }

    const data = await res.json()
    cachedToken = data.token
    // JWT tokens from Fudo last ~24h
    tokenExpiresAt = data.exp ?? (Date.now() / 1000 + 82800) // 23h to be safe
    return cachedToken!
  }

  // Fallback: apiKey/apiSecret via old endpoint
  if (FUDO_API_KEY && FUDO_API_SECRET) {
    const res = await postAuth('https://auth.fu.do/api', { apiKey: FUDO_API_KEY, apiSecret: FUDO_API_SECRET })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Fudo auth fallback failed (${res.status}): ${body}`)
    }

    const data = await res.json()
    cachedToken = data.token
    tokenExpiresAt = data.exp ?? (Date.now() / 1000 + 86400)
    return cachedToken!
  }

  throw new Error('Faltan credenciales de Fudo (FUDO_LOGIN/FUDO_PASSWORD o FUDO_API_KEY/FUDO_API_SECRET)')
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() / 1000 < tokenExpiresAt - 300) {
    return cachedToken
  }
  // Varias consultas en paralelo comparten UN solo inicio de sesión
  tokenEnCurso ??= login().finally(() => { tokenEnCurso = null })
  return tokenEnCurso
}

function invalidarToken() {
  cachedToken = null
  tokenExpiresAt = 0
}

/**
 * fetch a Fudo con el token puesto, tiempo máximo, UN reintento si Fudo
 * rechaza el token (401) y hasta 3 si limita pedidos (429). Devuelve la
 * respuesta tal cual para que cada llamador maneje sus códigos (404, etc.).
 */
export async function fudoHttp(url: string, init: RequestInit = {}, timeoutMs = FUDO_TIMEOUT_MS): Promise<Response> {
  let renovado = false
  let limitados = 0
  while (true) {
    const token = await getToken()
    let res: Response
    try {
      res = await fetch(url, conTiempoMaximo(timeoutMs, {
        ...init,
        headers: { 'Accept': 'application/json', ...init.headers, 'Authorization': `Bearer ${token}` },
      }))
    } catch (err) {
      if (esTimeout(err)) throw new Error(`Fudo no respondió en ${Math.round(timeoutMs / 1000)} s (${url.replace(FUDO_API_URL, '')})`)
      throw err
    }
    if (res.status === 401 && !renovado) {
      renovado = true
      invalidarToken()
      continue
    }
    if (res.status === 429 && limitados < 3) {
      limitados++
      const retryAfter = Math.min(parseInt(res.headers.get('retry-after') ?? '2') || 2, 15)
      await esperar(retryAfter * 1000 * limitados)
      continue
    }
    return res
  }
}

// ---------------------------------------------------------------------------
// JSON:API helpers
// ---------------------------------------------------------------------------

type JsonApiResource = {
  type: string
  id: string
  attributes: Record<string, unknown>
  relationships?: Record<string, { data: unknown }>
}

type JsonApiResponse = {
  data: JsonApiResource | JsonApiResource[]
}

function flattenResource(resource: JsonApiResource) {
  return {
    id: resource.id,
    ...resource.attributes,
    _relationships: resource.relationships,
  }
}

// ---------------------------------------------------------------------------
// Fetch with auth + auto-retry on 401
// ---------------------------------------------------------------------------

async function fudoFetch<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const res = await fudoHttp(`${FUDO_API_URL}${path}`, options)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Fudo API ${res.status} on ${path}: ${body}`)
  }
  return res.json() as Promise<T>
}

/** Fetch all pages, flatten JSON:API resources */
async function fudoFetchAll<T = Record<string, unknown>>(path: string): Promise<T[]> {
  const pageSize = 500
  let page = 1
  const all: T[] = []

  while (true) {
    const sep = path.includes('?') ? '&' : '?'
    const response = await fudoFetch<JsonApiResponse>(`${path}${sep}page[size]=${pageSize}&page[number]=${page}`)

    const items = Array.isArray(response.data) ? response.data : response.data ? [response.data] : []
    const flattened = items.map(flattenResource) as T[]
    all.push(...flattened)

    if (items.length < pageSize) break
    page++
    if (page > 100) break
  }

  return all
}

// ---------------------------------------------------------------------------
// Types (flattened from JSON:API)
// ---------------------------------------------------------------------------

export type FudoProduct = {
  id: string
  name: string
  price: number
  cost: number | null
  code: string | null
  active: boolean
  stock: number | null
  stockControl: boolean
  description: string | null
  sellAlone: boolean
  _relationships?: Record<string, { data: unknown }>
}

export type FudoCategory = {
  id: string
  name: string
  position: number
  _relationships?: Record<string, { data: unknown }>
}

export type FudoSale = {
  id: string
  total: number
  saleType: string
  saleState: string
  createdAt: string
  closedAt: string | null
  comment: string | null
  _relationships?: Record<string, { data: unknown }>
}

export type FudoSaleItem = {
  id: string
  name: string
  quantity: number
  price: number
  total: number
  _relationships?: Record<string, { data: unknown }>
}

export type FudoRoom = {
  id: string
  name: string
}

export type FudoTable = {
  id: string
  number: number
  column: number
  row: number
  shape: string
  size: string
  _relationships?: Record<string, { data: unknown }>
}

export type FudoPaymentMethod = {
  id: string
  name: string
  active: boolean
  code: string
  position: number
}

export type FudoCustomer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  active: boolean
  address: string | null
  comment: string | null
}

export type FudoIngredient = {
  id: string
  name: string
  cost: number | null
  stock: number | null
  stockControl: boolean | null
  _relationships?: Record<string, { data: unknown }>
}

// ---------------------------------------------------------------------------
// Exported client
// ---------------------------------------------------------------------------

export const fudo = {
  testConnection: async () => {
    try {
      await getToken()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown' }
    }
  },

  getCategories: async (): Promise<FudoCategory[]> => {
    return fudoFetchAll<FudoCategory>('/product-categories')
  },

  getProducts: async (): Promise<FudoProduct[]> => {
    return fudoFetchAll<FudoProduct>('/products')
  },

  getSales: async (params?: { from?: string; to?: string; includeItems?: boolean }): Promise<FudoSale[]> => {
    const include = params?.includeItems ? '?include=items,payments&sort=-closedAt' : '?sort=-closedAt'
    const path = `/sales${include}`

    if (!params?.from) {
      const all = await fudoFetchAll<FudoSale>(path)
      if (!params?.to) return all
      return all.filter((s) => (s.createdAt || s.closedAt || '') <= params.to! + 'T23:59:59')
    }

    // Con `from`: las ventas vienen ordenadas por fecha descendente, así que
    // cortamos la paginación apenas una página entera queda antes del rango.
    const pageSize = 500
    const matched: FudoSale[] = []
    let page = 1
    while (page <= 100) {
      const sep = path.includes('?') ? '&' : '?'
      const response = await fudoFetch<JsonApiResponse>(`${path}${sep}page[size]=${pageSize}&page[number]=${page}`)
      const items = Array.isArray(response.data) ? response.data : response.data ? [response.data] : []
      const sales = items.map(flattenResource) as unknown as FudoSale[]

      let allBeforeRange = sales.length > 0
      for (const s of sales) {
        const d = s.createdAt || s.closedAt || ''
        if (d >= params.from) allBeforeRange = false
        if (d < params.from) continue
        if (params.to && d > params.to + 'T23:59:59') continue
        matched.push(s)
      }

      if (allBeforeRange || items.length < pageSize) break
      page++
    }
    return matched
  },

  /** Fetch sales with included items in a single request (more efficient) */
  getSalesWithItems: async (pageSize = 50): Promise<{ sales: FudoSale[]; included: JsonApiResource[] }> => {
    const response = await fudoFetch<JsonApiResponse & { included?: JsonApiResource[] }>(
      `/sales?include=items,payments&sort=-closedAt&page[size]=${pageSize}&page[number]=1`
    )
    const sales = (Array.isArray(response.data) ? response.data : [response.data])
      .map(flattenResource) as unknown as FudoSale[]
    return { sales, included: response.included ?? [] }
  },

  getSaleItems: async (saleId: string): Promise<FudoSaleItem[]> => {
    return fudoFetchAll<FudoSaleItem>(`/sales/${saleId}/items`)
  },

  getRooms: async (): Promise<FudoRoom[]> => {
    return fudoFetchAll<FudoRoom>('/rooms')
  },

  getTables: async (): Promise<FudoTable[]> => {
    return fudoFetchAll<FudoTable>('/tables')
  },

  getPaymentMethods: async (): Promise<FudoPaymentMethod[]> => {
    return fudoFetchAll<FudoPaymentMethod>('/payment-methods')
  },

  getCustomers: async (): Promise<FudoCustomer[]> => {
    return fudoFetchAll<FudoCustomer>('/customers')
  },

  getIngredients: async (): Promise<FudoIngredient[]> => {
    return fudoFetchAll<FudoIngredient>('/ingredients')
  },

  updateIngredientStock: async (ingredientId: string, stock: number): Promise<void> => {
    await fudoFetch(`/ingredients/${ingredientId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          type: 'Ingredient',
          id: ingredientId,
          attributes: { stock },
        },
      }),
    })
  },

  updateProductStock: async (productId: string, stock: number): Promise<void> => {
    await fudoFetch(`/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          type: 'Product',
          id: productId,
          attributes: { stock },
        },
      }),
    })
  },

  fetch: fudoFetch,
  fetchAll: fudoFetchAll,
}

export { fudoFetch, fudoFetchAll, getToken as getFudoToken }
