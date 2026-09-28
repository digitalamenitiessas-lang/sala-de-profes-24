// ---------------------------------------------------------------------------
// Fudo Stock Sync Engine — Bidirectional
// ---------------------------------------------------------------------------
// READS from Fudo: cantidades, costo, unidad, mínimo, categoría y proveedor.
// WRITES to Fudo: cambios hechos en la app (Fudo primero, LVE después).
//
// Fuente de verdad: FUDO para items con fudo_ingredient_id / fudo_product_id
//                   SUPABASE para items locales (fudo_skip = true)
//
// Reglas de escritura ("nunca ir en contra de Fudo"):
//   - Conteo físico / ajuste manual  → valor ABSOLUTO (lo contado es la verdad)
//   - Producción / merma / recepción → DELTA sobre lo que Fudo tiene AHORA
//     (writeFudoStockDelta): si Fudo vendió entre medio, esas ventas no se pisan.
// ---------------------------------------------------------------------------

import { SupabaseClient } from '@supabase/supabase-js'
import { fudoHttp } from '@/lib/fudoClient'
import {
  createFudoSyncEvent,
  finishFudoSyncEvent,
  recordFudoIncident,
  resolveItemIncidents,
  resolveSourceIncidents,
  type FudoEntityType,
} from '@/lib/fudo/sync-events'
import { notifyEvent } from '@/lib/push/notify-event'
import {
  mapFudoIngredientCategory,
  mapFudoProductCategory,
  areaFromLveCategory,
  isStockArea,
} from '@/lib/stock/areas'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FudoIngredient = {
  id: string
  name: string
  stock: number | null
  cost: number | null
  minStock: number | null
  stockControl: boolean
  categoryId?: string
  categoryName?: string
  providerId?: string
  /** Unidad normalizada a LVE: 'kg' | 'l' | 'unidad' (null si Fudo no la informa) */
  unit: 'kg' | 'l' | 'unidad' | null
}

export type SyncResult = {
  read: { synced: number; total: number; errors: string[] }
  write?: { pushed: number; errors: string[] }
  timestamp: string
  fudoConnected: boolean
}

type FudoWriteContext = {
  admin: SupabaseClient
  operation: string
  stockItemId?: string | number | null
  userId?: string | null
  entityType?: string | null
  entityId?: string | number | null
  fudoType: FudoEntityType
  fudoId: string
  oldQty?: number | null
  newQty: number
  reason?: string | null
  note?: string | null
  idempotencyKey?: string | null
}

export type StockWriteReason = 'physical_count' | 'manual_adjustment' | 'waste' | 'reception'

type StockWriteOptions = {
  reason?: StockWriteReason
  note?: string | null
  /** Costo unitario de la entrada (recepción) para valorizar el movimiento. */
  costPerUnit?: number | null
  /**
   * Delta explícito a aplicar sobre el stock ACTUAL de Fudo, para los motivos
   * que son por naturaleza un movimiento y no un valor absoluto (merma).
   * Sin esto, el delta se deduce de `newQty − current_qty` de LVE, que miente
   * cuando LVE está desfasado o cuando el valor viene clampeado a 0.
   */
  deltaOverride?: number | null
}

const MOVEMENT_TYPE_BY_REASON: Record<StockWriteReason, 'ajuste' | 'merma' | 'entrada'> = {
  physical_count: 'ajuste',
  manual_adjustment: 'ajuste',
  waste: 'merma',
  reception: 'entrada',
}

function stockWriteNeedsNote(currentQty: number, newQty: number, unit?: string | null) {
  const abs = Math.abs(newQty - currentQty)
  const pct = currentQty > 0 ? abs / currentQty : abs > 0 ? 1 : 0
  const normalizedUnit = (unit ?? '').toLowerCase()
  const threshold = normalizedUnit.includes('kg') || normalizedUnit.includes('kilo')
    ? Math.max(0.5, currentQty * 0.12)
    : Math.max(2, currentQty * 0.15)
  return abs >= threshold || pct >= 0.25
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function findDuplicateIds(ids: Array<string | null | undefined>): Set<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (!id) continue
    if (seen.has(id)) duplicates.add(id)
    else seen.add(id)
  }
  return duplicates
}

/**
 * Factor para reexpresar una cantidad de `from` a `to` dentro de la misma
 * magnitud (g↔kg, ml↔l). null si no son convertibles (ej. unidad↔kg).
 */
function unitScaleFactor(from: string | null | undefined, to: string | null | undefined): number | null {
  const f = (from ?? '').toLowerCase().trim()
  const t = (to ?? '').toLowerCase().trim()
  if (!f || !t) return null
  if (f === t) return 1
  const mass: Record<string, number> = { g: 0.001, gr: 0.001, gramos: 0.001, kg: 1, kilo: 1, kilos: 1 }
  const volume: Record<string, number> = { ml: 0.001, cc: 0.001, l: 1, lt: 1, litro: 1, litros: 1 }
  if (f in mass && t in mass) return mass[f] / mass[t]
  if (f in volume && t in volume) return volume[f] / volume[t]
  return null
}

/** Fudo informa 'kg' | 'litre' | 'unit'. */
export function mapFudoUnitName(raw: string | null | undefined): 'kg' | 'l' | 'unidad' | null {
  const value = (raw ?? '').toLowerCase().trim()
  if (!value) return null
  if (value.includes('kg') || value.includes('kilo')) return 'kg'
  if (value.includes('lit') || value === 'l') return 'l'
  if (value.includes('unit') || value.includes('unidad')) return 'unidad'
  return null
}

/** Error de PostgREST por columna inexistente (migración pendiente). */
function isMissingColumnError(message: string | undefined | null, columns: string[]) {
  if (!message) return false
  const m = message.toLowerCase()
  return columns.some((c) => m.includes(c.toLowerCase())) && (m.includes('column') || m.includes('schema cache'))
}

const AREA_COLUMNS = ['area', 'fudo_category', 'area_locked']
const MOVEMENT_NEW_COLUMNS = ['production_order_id', 'fudo_synced', 'cost_per_unit']

// ---------------------------------------------------------------------------
// READ: Fetch all ingredients from Fudo with stock
// ---------------------------------------------------------------------------

export async function readFudoStock(): Promise<FudoIngredient[]> {
  const allIngredients: FudoIngredient[] = []
  let page = 1
  let rateLimitRetries = 0

  while (page <= 50) {
    const res = await fudoHttp(
      `https://api.fu.do/v1alpha1/ingredients?include=ingredientCategory,unit&page[size]=200&page[number]=${page}`,
    )

    if (!res.ok) {
      if (res.status === 429 && rateLimitRetries < 5) {
        // Rate limited — esperar y reintentar la MISMA página (con tope)
        rateLimitRetries++
        await new Promise(r => setTimeout(r, 2000 * rateLimitRetries))
        continue
      }
      throw new Error(`Fudo API error: ${res.status}`)
    }

    const data = await res.json()
    const items = data.data ?? []
    const included = data.included ?? []

    const catMap = new Map<string, string>()
    const unitMap = new Map<string, string>()
    for (const inc of included) {
      if (inc.type === 'IngredientCategory') catMap.set(inc.id, inc.attributes?.name ?? '')
      if ((inc.type ?? '').toLowerCase() === 'unit') {
        unitMap.set(String(inc.id), String(inc.attributes?.name ?? inc.attributes?.code ?? inc.id))
      }
    }

    for (const item of items) {
      const catRef = item.relationships?.ingredientCategory?.data
      const provRef = item.relationships?.provider?.data as { id?: string } | null | undefined
      const unitRef = item.relationships?.unit?.data as { id?: string } | null | undefined
      allIngredients.push({
        id: item.id,
        name: item.attributes.name,
        stock: asNullableNumber(item.attributes.stock),
        cost: asNullableNumber(item.attributes.cost),
        minStock: asNullableNumber(item.attributes.minStock),
        stockControl: item.attributes.stockControl ?? false,
        categoryId: catRef?.id,
        categoryName: catRef?.id ? catMap.get(catRef.id) : undefined,
        providerId: provRef?.id,
        unit: unitRef?.id != null ? mapFudoUnitName(unitMap.get(String(unitRef.id))) : null,
      })
    }

    if (items.length < 200) break
    page++
  }

  return allIngredients
}

/** Stock actual de UN ingrediente en Fudo (para escrituras por delta). */
export async function readFudoIngredientStock(fudoIngredientId: string): Promise<number | null> {
  const res = await fudoHttp(`https://api.fu.do/v1alpha1/ingredients/${fudoIngredientId}`)
  if (!res.ok) throw new Error(`Fudo ${res.status} al leer ingrediente #${fudoIngredientId}`)
  const data = await res.json()
  return asNullableNumber(data.data?.attributes?.stock)
}

/** Stock actual de UN producto en Fudo (para escrituras por delta). */
export async function readFudoProductStock(fudoProductId: string): Promise<number | null> {
  const res = await fudoHttp(`https://api.fu.do/v1alpha1/products/${fudoProductId}`)
  if (!res.ok) throw new Error(`Fudo ${res.status} al leer producto #${fudoProductId}`)
  const data = await res.json()
  return asNullableNumber(data.data?.attributes?.stock)
}

// ---------------------------------------------------------------------------
// WRITE: Push a single stock change to Fudo
// ---------------------------------------------------------------------------

export async function writeFudoStock(
  fudoIngredientId: string,
  newQty: number,
  context?: FudoWriteContext,
): Promise<{ success: boolean; error?: string }> {
  const eventId = context
    ? await createFudoSyncEvent(context.admin, {
      operation: context.operation,
      direction: 'lve_to_fudo',
      entityType: context.entityType ?? 'stock_item',
      entityId: context.entityId ?? context.stockItemId,
      stockItemId: context.stockItemId,
      fudoType: 'ingredient',
      fudoId: fudoIngredientId,
      idempotencyKey: context.idempotencyKey ?? null,
      requestPayload: {
        old_qty: context.oldQty ?? null,
        new_qty: newQty,
        reason: context.reason ?? null,
        note: context.note ?? null,
      },
      createdBy: context.userId ?? null,
    })
    : null

  try {
    const res = await fudoHttp(`https://api.fu.do/v1alpha1/ingredients/${fudoIngredientId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          type: 'Ingredient',
          id: fudoIngredientId,
          attributes: { stock: newQty },
        },
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // Un 404 significa que el ingrediente fue borrado/renombrado en Fudo —
      // es un vínculo roto puntual de ESTE item, no una caída de Fudo. No debe
      // tratarse como incidente crítico (eso bloquea la carga de stock para
      // TODOS los items durante 24hs por un solo vínculo roto).
      const isMissingIngredient = res.status === 404
      const error = isMissingIngredient
        ? `Vínculo Fudo roto: el ingrediente #${fudoIngredientId} ya no existe en Fudo (fue borrado o renombrado). Avisá al administrador para re-vincularlo o desactivar este insumo.`
        : `Fudo ${res.status}: ${text.slice(0, 100)}`
      if (context) {
        await finishFudoSyncEvent(context.admin, eventId, 'failed', { errorMessage: error })
        await recordFudoIncident(context.admin, {
          source: 'write_stock',
          code: isMissingIngredient ? 'fudo_ingredient_not_found' : 'fudo_write_failed',
          severity: isMissingIngredient ? 'high' : 'critical',
          entityType: context.entityType ?? 'stock_item',
          entityId: context.entityId ?? context.stockItemId,
          stockItemId: context.stockItemId,
          fudoType: 'ingredient',
          fudoId: fudoIngredientId,
          title: isMissingIngredient ? 'Vínculo Fudo roto (ingrediente inexistente)' : 'Fudo rechazó una escritura de stock',
          detail: error,
          payload: { operation: context.operation, new_qty: newQty },
        })
      }
      return { success: false, error }
    }

    const data = await res.json()
    const actualStock = data.data?.attributes?.stock

    // Verify the write
    if (typeof actualStock === 'number' && Math.abs(actualStock - newQty) > 0.01) {
      const error = `Fudo aceptó pero stock quedó en ${actualStock} (esperado: ${newQty})`
      if (context) {
        await finishFudoSyncEvent(context.admin, eventId, 'failed', {
          responsePayload: { actual_stock: actualStock },
          errorMessage: error,
        })
        await recordFudoIncident(context.admin, {
          source: 'write_stock',
          code: 'fudo_write_verification_failed',
          severity: 'critical',
          entityType: context.entityType ?? 'stock_item',
          entityId: context.entityId ?? context.stockItemId,
          stockItemId: context.stockItemId,
          fudoType: 'ingredient',
          fudoId: fudoIngredientId,
          title: 'Fudo no confirmó la cantidad esperada',
          detail: error,
          payload: { operation: context.operation, expected_qty: newQty, actual_stock: actualStock },
        })
      }
      return { success: false, error }
    }

    if (context) {
      await finishFudoSyncEvent(context.admin, eventId, 'success', {
        responsePayload: { actual_stock: typeof actualStock === 'number' ? actualStock : newQty },
      })
      if (context.stockItemId) {
        await resolveItemIncidents(context.admin, String(context.stockItemId)).catch(() => null)
      }
    }

    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Error desconocido'
    if (context) {
      await finishFudoSyncEvent(context.admin, eventId, 'failed', { errorMessage: error })
      await recordFudoIncident(context.admin, {
        source: 'write_stock',
        code: 'fudo_write_exception',
        severity: 'critical',
        entityType: context.entityType ?? 'stock_item',
        entityId: context.entityId ?? context.stockItemId,
        stockItemId: context.stockItemId,
        fudoType: 'ingredient',
        fudoId: fudoIngredientId,
        title: 'No se pudo escribir stock en Fudo',
        detail: error,
        payload: { operation: context.operation, new_qty: newQty },
      })
    }
    return { success: false, error }
  }
}

async function writeFudoProductStock(
  fudoProductId: string,
  newQty: number,
  context?: FudoWriteContext,
): Promise<{ success: boolean; error?: string }> {
  const eventId = context
    ? await createFudoSyncEvent(context.admin, {
      operation: context.operation,
      direction: 'lve_to_fudo',
      entityType: context.entityType ?? 'stock_item',
      entityId: context.entityId ?? context.stockItemId,
      stockItemId: context.stockItemId,
      fudoType: 'product',
      fudoId: fudoProductId,
      idempotencyKey: context.idempotencyKey ?? null,
      requestPayload: {
        old_qty: context.oldQty ?? null,
        new_qty: newQty,
        reason: context.reason ?? null,
        note: context.note ?? null,
      },
      createdBy: context.userId ?? null,
    })
    : null

  try {
    const { fudo: fudoClient } = await import('@/lib/fudoClient')
    await fudoClient.updateProductStock(fudoProductId, newQty)
    // Verificación puntual (antes se releía TODO el catálogo de productos)
    const actualStock = await readFudoProductStock(fudoProductId).catch(() => null)

    if (typeof actualStock === 'number' && Math.abs(actualStock - newQty) > 0.01) {
      const error = `Fudo aceptó producto pero stock quedó en ${actualStock} (esperado: ${newQty})`
      if (context) {
        await finishFudoSyncEvent(context.admin, eventId, 'failed', {
          responsePayload: { actual_stock: actualStock },
          errorMessage: error,
        })
        await recordFudoIncident(context.admin, {
          source: 'write_stock',
          code: 'fudo_product_write_verification_failed',
          severity: 'critical',
          entityType: context.entityType ?? 'stock_item',
          entityId: context.entityId ?? context.stockItemId,
          stockItemId: context.stockItemId,
          fudoType: 'product',
          fudoId: fudoProductId,
          title: 'Fudo producto no confirmó la cantidad esperada',
          detail: error,
          payload: { operation: context.operation, expected_qty: newQty, actual_stock: actualStock },
        })
      }
      return { success: false, error }
    }

    if (context) {
      await finishFudoSyncEvent(context.admin, eventId, 'success', {
        responsePayload: { actual_stock: typeof actualStock === 'number' ? actualStock : newQty },
      })
      if (context.stockItemId) {
        await resolveItemIncidents(context.admin, String(context.stockItemId)).catch(() => null)
      }
    }

    return { success: true }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Error desconocido'
    if (context) {
      await finishFudoSyncEvent(context.admin, eventId, 'failed', { errorMessage: error })
      await recordFudoIncident(context.admin, {
        source: 'write_stock',
        code: 'fudo_product_write_exception',
        severity: 'critical',
        entityType: context.entityType ?? 'stock_item',
        entityId: context.entityId ?? context.stockItemId,
        stockItemId: context.stockItemId,
        fudoType: 'product',
        fudoId: fudoProductId,
        title: 'No se pudo escribir stock de producto en Fudo',
        detail: error,
        payload: { operation: context.operation, new_qty: newQty },
      })
    }
    return { success: false, error }
  }
}

// ---------------------------------------------------------------------------
// WRITE BY DELTA: suma/resta sobre lo que Fudo tiene AHORA
// ---------------------------------------------------------------------------
// Para producción, merma y recepción. Lee el stock actual del ingrediente o
// producto en Fudo, aplica el delta y escribe. Así una venta ocurrida entre el
// cálculo local y el push no se pierde (antes se pisaba con el número de LVE).
// Devuelve el stock final en Fudo para que LVE quede espejado a ESE número.

export async function writeFudoStockDelta(
  link: { fudoIngredientId?: string | null; fudoProductId?: string | null },
  delta: number,
  context: Omit<FudoWriteContext, 'fudoType' | 'fudoId' | 'newQty'>,
): Promise<{ success: boolean; error?: string; fudoBefore?: number | null; fudoAfter?: number }> {
  try {
    if (link.fudoIngredientId) {
      const before = await readFudoIngredientStock(link.fudoIngredientId)
      // Sin stock legible en Fudo (control de stock apagado) no hay base sobre
      // la cual sumar: escribir `delta` a secas sería inventar un absoluto.
      if (before === null) {
        return { success: false, error: 'Fudo no informa stock de este insumo (¿control de stock apagado?). No se puede sumar ni restar sobre un valor desconocido.', fudoBefore: null }
      }
      const after = Math.round((before + delta) * 100) / 100
      const write = await writeFudoStock(link.fudoIngredientId, after, {
        ...context,
        fudoType: 'ingredient',
        fudoId: link.fudoIngredientId,
        oldQty: before,
        newQty: after,
      })
      return { ...write, fudoBefore: before, fudoAfter: after }
    }
    if (link.fudoProductId) {
      const before = await readFudoProductStock(link.fudoProductId)
      if (before === null) {
        return { success: false, error: 'Fudo no informa stock de este producto (¿control de stock apagado?). No se puede sumar ni restar sobre un valor desconocido.', fudoBefore: null }
      }
      const after = Math.round((before + delta) * 100) / 100
      const write = await writeFudoProductStock(link.fudoProductId, after, {
        ...context,
        fudoType: 'product',
        fudoId: link.fudoProductId,
        oldQty: before,
        newQty: after,
      })
      return { ...write, fudoBefore: before, fudoAfter: after }
    }
    return { success: false, error: 'Item sin vínculo Fudo' }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Error desconocido'
    await recordFudoIncident(context.admin, {
      source: 'write_stock',
      code: 'fudo_read_before_write_failed',
      // 'high': el movimiento queda en la cola de reintentos; una lectura
      // fallida puntual no debe bloquear el conteo de todo el stock.
      severity: 'high',
      entityType: context.entityType ?? 'stock_item',
      entityId: context.entityId ?? context.stockItemId,
      stockItemId: context.stockItemId,
      fudoType: link.fudoIngredientId ? 'ingredient' : 'product',
      fudoId: link.fudoIngredientId ?? link.fudoProductId ?? null,
      title: 'No se pudo leer el stock actual de Fudo antes de escribir',
      detail: error,
      payload: { operation: context.operation, delta },
    }).catch(() => null)
    return { success: false, error }
  }
}

// ---------------------------------------------------------------------------
// Kardex: un movimiento por cada cambio que LVE origina (tolerante a que la
// migración 20260906 no esté aplicada todavía).
// ---------------------------------------------------------------------------

export async function insertStockMovement(
  admin: SupabaseClient,
  row: {
    stock_item_id: string
    movement_type: 'entrada' | 'uso' | 'ajuste' | 'merma'
    qty: number
    previous_qty: number
    new_qty: number
    reason: string
    note?: string | null
    created_by?: string | null
    production_order_id?: number | null
    fudo_synced?: boolean
    cost_per_unit?: number | null
  },
): Promise<string | null> {
  const full = {
    stock_item_id: row.stock_item_id,
    movement_type: row.movement_type,
    qty: Math.abs(row.qty),
    previous_qty: row.previous_qty,
    new_qty: row.new_qty,
    reason: row.reason,
    note: row.note ?? null,
    created_by: row.created_by ?? null,
    production_order_id: row.production_order_id ?? null,
    fudo_synced: row.fudo_synced ?? false,
    cost_per_unit: row.cost_per_unit ?? null,
  }
  let res = await admin.from('stock_movements').insert(full).select('id').single()
  if (res.error && isMissingColumnError(res.error.message, MOVEMENT_NEW_COLUMNS)) {
    const { production_order_id: _p, fudo_synced: _f, cost_per_unit: _c, ...legacy } = full
    void _p; void _f; void _c
    res = await admin.from('stock_movements').insert(legacy).select('id').single()
  }
  if (res.error) {
    console.warn('[stock_movements] insert failed', res.error.message)
    return null
  }
  return (res.data as { id: string } | null)?.id ?? null
}

// ---------------------------------------------------------------------------
// SYNC READ: Pull Fudo stock → update Supabase stock_items
// ---------------------------------------------------------------------------

type LveStockRow = {
  id: string
  name: string
  unit: string
  category: string | null
  min_qty: number | null
  is_produced: boolean | null
  fudo_ingredient_id: string | null
  fudo_product_id: string | null
  current_qty: number
  cost_per_unit: number | null
  supplier_id: string | null
  area?: string | null
  fudo_category?: string | null
  area_locked?: boolean | null
}

export async function syncFromFudo(admin: SupabaseClient): Promise<SyncResult['read']> {
  const result = { synced: 0, total: 0, errors: [] as string[] }
  const eventId = await createFudoSyncEvent(admin, {
    operation: 'stock_read_sync',
    direction: 'fudo_to_lve',
    entityType: 'stock',
    entityId: 'all',
    requestPayload: { source: 'syncFromFudo' },
  })

  try {

  // 1. Read all Fudo ingredients (stock, cost, unit, minStock, category, provider)
  // Transport/auth failures must bubble up. Stock cannot pretend it synced.
  const fudoItems = await readFudoStock()

  // 2. Read Fudo products (for finished goods like empanadas, budines, gaseosas)
  const { fudo } = await import('@/lib/fudoClient')
  const [products, productCategories] = await Promise.all([
    fudo.getProducts(),
    fudo.getCategories().catch(() => [] as { id: string; name: string }[]),
  ])
  const productCategoryName = new Map(productCategories.map((c) => [String(c.id), c.name]))
  const fudoProducts = products
    .filter(p => p.stockControl && p.stock != null)
    .map(p => {
      const catRef = p._relationships?.productCategory?.data as { id?: string } | null | undefined
      return {
        id: p.id,
        name: p.name,
        stock: p.stock!,
        cost: p.cost,
        stockControl: true,
        categoryName: catRef?.id ? productCategoryName.get(String(catRef.id)) ?? null : null,
      }
    })

  result.total = fudoItems.length + fudoProducts.length

  // 3. Get all stock_items (ingredient-linked AND product-linked), excluding fudo_skip.
  //    Select tolerante: si la migración de áreas no está, cae al select legacy.
  const baseSelect = 'id, name, unit, category, min_qty, is_produced, fudo_ingredient_id, fudo_product_id, current_qty, cost_per_unit, supplier_id'
  let schemaHasAreas = true
  let stockItemsRes: { data: unknown[] | null; error: { message: string } | null } = await admin
    .from('stock_items')
    .select(`${baseSelect}, area, fudo_category, area_locked`)
    .eq('is_active', true)
    .neq('fudo_skip', true)
  if (stockItemsRes.error && isMissingColumnError(stockItemsRes.error.message, AREA_COLUMNS)) {
    schemaHasAreas = false
    stockItemsRes = await admin
      .from('stock_items')
      .select(baseSelect)
      .eq('is_active', true)
      .neq('fudo_skip', true)
  }
  const stockItems = (stockItemsRes.data ?? null) as LveStockRow[] | null
  const { deltasPendientes } = await import('@/lib/fudo/reintentos')
  const pendientesFudo = await deltasPendientes(admin).catch(() => new Map<string, number>())

  if (!stockItems) {
    // No se pudo leer LVE: no es un éxito (antes quedaba marcado como tal)
    await finishFudoSyncEvent(admin, eventId, stockItemsRes.error ? 'failed' : 'success', {
      errorMessage: stockItemsRes.error?.message,
      responsePayload: { synced: result.synced, total: result.total, errors: result.errors },
    })
    return result
  }

  // Items producidos alguna vez, o declarados como salida de alguna receta:
  // no se les quita is_produced aunque Fudo no los llame "Pre-Producto".
  const producedEver = new Set<string>()
  const recipeOutputItems = new Set<string>()
  if (schemaHasAreas) {
    const [outsRes, recipesRes] = await Promise.all([
      admin.from('production_outputs').select('stock_item_id').not('stock_item_id', 'is', null),
      admin.from('recipes').select('output_stock_item_id').not('output_stock_item_id', 'is', null),
    ])
    for (const o of outsRes.data ?? []) if (o.stock_item_id) producedEver.add(String(o.stock_item_id))
    for (const r of recipesRes.data ?? []) {
      const id = (r as { output_stock_item_id?: string | null }).output_stock_item_id
      if (id) recipeOutputItems.add(String(id))
    }
  }

  // 4. Build supplier map: fudo_provider_id → supplier.id
  const { data: suppliers } = await admin
    .from('suppliers')
    .select('id, fudo_provider_id')
    .not('fudo_provider_id', 'is', null)

  const providerToSupplier = new Map(
    (suppliers ?? []).map(s => [s.fudo_provider_id!, s.id]),
  )

  // 5. Build Fudo maps
  const fudoIngMap = new Map<string, FudoIngredient>()
  for (const fi of fudoItems) fudoIngMap.set(fi.id, fi)

  const fudoProdMap = new Map<string, (typeof fudoProducts)[number]>()
  for (const fp of fudoProducts) fudoProdMap.set(fp.id, fp)

  const duplicateIngredientIds = findDuplicateIds(stockItems.map((item) => item.fudo_ingredient_id))
  const duplicateProductIds = findDuplicateIds(stockItems.map((item) => item.fudo_product_id))

  // Discrepancias de trazabilidad (vínculos faltantes/duplicados): se reportan
  // pero NO son fallas de conexión — el evento de sync no debe marcarse failed.
  const discrepancies: string[] = []

  for (const id of duplicateIngredientIds) discrepancies.push(`Duplicate Fudo ingredient link detected: ${id}`)
  for (const id of duplicateProductIds) discrepancies.push(`Duplicate Fudo product link detected: ${id}`)

  const linkedIngredientIds = new Set(stockItems.map((item) => item.fudo_ingredient_id).filter((id): id is string => Boolean(id)))
  const linkedProductIds = new Set(stockItems.map((item) => item.fudo_product_id).filter((id): id is string => Boolean(id)))

  for (const fudoItem of fudoItems) {
    if (!fudoItem.stockControl) continue
    if (!linkedIngredientIds.has(fudoItem.id)) {
      discrepancies.push(`Unmapped Fudo ingredient: ${fudoItem.name} (${fudoItem.id})`)
    }
  }
  for (const fudoProduct of fudoProducts) {
    if (!linkedProductIds.has(fudoProduct.id)) {
      discrepancies.push(`Unmapped Fudo product with stock control: ${fudoProduct.name} (${fudoProduct.id})`)
    }
  }

  const unitChanges: string[] = []

  // 6. Update each stock_item with Fudo's current stock, cost, unit, min, category, provider
  for (const si of stockItems) {
    if (
      (si.fudo_ingredient_id && duplicateIngredientIds.has(si.fudo_ingredient_id))
      || (si.fudo_product_id && duplicateProductIds.has(si.fudo_product_id))
    ) {
      continue
    }

    let fudoQty: number | null = null
    let fudoCost: number | null = null
    let fudoProviderId: string | undefined
    let fudoUnit: 'kg' | 'l' | 'unidad' | null = null
    let fudoMin: number | null = null
    let fudoCategory: string | null = null
    let mapped: { area: string; category: string | null; isPreProduct: boolean } | null = null

    // Check ingredient link first
    if (si.fudo_ingredient_id) {
      const fudoItem = fudoIngMap.get(si.fudo_ingredient_id)
      if (!fudoItem) {
        discrepancies.push(`Missing Fudo ingredient ${si.fudo_ingredient_id} for stock item ${si.id}`)
      }
      if (fudoItem?.stockControl && typeof fudoItem.stock === 'number') {
        fudoQty = Math.round(fudoItem.stock * 100) / 100
      }
      if (fudoItem?.stockControl && fudoItem.stock === null) {
        discrepancies.push(`Fudo ingredient ${si.fudo_ingredient_id} has null stock for stock item ${si.id}`)
      }
      if (fudoItem) {
        fudoCost = typeof fudoItem.cost === 'number' && fudoItem.cost > 0 ? fudoItem.cost : null
        fudoProviderId = fudoItem.providerId
        fudoUnit = fudoItem.unit
        fudoMin = fudoItem.minStock != null && fudoItem.minStock > 0 ? fudoItem.minStock : null
        fudoCategory = fudoItem.categoryName ?? null
        const m = mapFudoIngredientCategory(fudoCategory)
        mapped = { area: m.area, category: m.category, isPreProduct: m.isPreProduct }
      }
    }

    // Then check product link (product takes precedence for finished goods)
    if (si.fudo_product_id) {
      const fudoProd = fudoProdMap.get(si.fudo_product_id)
      if (!fudoProd) {
        discrepancies.push(`Missing Fudo product ${si.fudo_product_id} for stock item ${si.id}`)
      }
      if (fudoProd) {
        fudoQty = Math.round(fudoProd.stock * 100) / 100
        if (fudoProd.cost && fudoProd.cost > 0) fudoCost = fudoProd.cost
        fudoCategory = fudoProd.categoryName ?? fudoCategory
        const m = mapFudoProductCategory(fudoProd.categoryName)
        mapped = { area: m.area, category: m.category, isPreProduct: false }
      }
    }

    if (fudoQty === null && fudoCost === null && !fudoProviderId && !fudoCategory && !fudoUnit && fudoMin === null) continue

    // Build update payload — only include fields that changed
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    let hasChanges = false

    // Lo que todavía está en la cola hacia Fudo se suma: si no, el espejo
    // borraría de LVE una producción/recepción que Fudo aún no recibió.
    const pendiente = pendientesFudo.get(String(si.id)) ?? 0
    const objetivo = fudoQty !== null ? Math.round((fudoQty + pendiente) * 1000) / 1000 : null
    if (objetivo !== null && Math.abs(si.current_qty - objetivo) >= 0.01) {
      update.current_qty = objetivo
      hasChanges = true
    }

    // COSTO: el sync YA NO escribe cost_per_unit. Los costos de la API de Fudo
    // no son reales (decisión de producto 2026-09): el costo solo entra por
    // recepción de compra, carga manual o producción, con cost_source sellado.
    // fudoCost se sigue leyendo únicamente para decidir si hay algo que espejar.

    // Unidad: Fudo manda, pero SOLO cuando además estamos espejando la cantidad
    // en esa unidad. Cambiar la etiqueta sin cambiar el número deja un dato
    // falso (500 g pasarían a leerse "500 kg").
    const scaleToFudoUnit = fudoUnit ? unitScaleFactor(si.unit, fudoUnit) : null
    if (fudoUnit && fudoUnit !== si.unit && fudoQty !== null) {
      update.unit = fudoUnit
      unitChanges.push(`${si.name}: ${si.unit} → ${fudoUnit}`)
      hasChanges = true

      // El mínimo operativo lo puso una persona en la unidad vieja: se reescala
      // para que siga significando lo mismo (0,5 kg y no "500 kg").
      if (scaleToFudoUnit !== null && scaleToFudoUnit !== 1 && si.min_qty && si.min_qty > 0) {
        update.min_qty = Math.round(si.min_qty * scaleToFudoUnit * 1000) / 1000
        hasChanges = true
      }

      // El costo unitario también se reexpresa: $/kg → $/g divide 1000. Si la
      // unidad nueva no es convertible (kg → unidad), el número deja de tener
      // sentido y se borra: mejor "sin costo real" que un costo fantasma.
      if (si.cost_per_unit && si.cost_per_unit > 0) {
        if (scaleToFudoUnit !== null && scaleToFudoUnit !== 1) {
          update.cost_per_unit = Math.round((si.cost_per_unit / scaleToFudoUnit) * 10000) / 10000
          // Reexpresado: misma fuente, pero la fecha del costo se refresca
          update.cost_updated_at = new Date().toISOString()
          hasChanges = true
        } else if (scaleToFudoUnit === null) {
          update.cost_per_unit = null
          // Sin costo no puede quedar una fuente/fecha apuntando a la nada:
          // el item vuelve a "sin dato" limpio.
          update.cost_source = null
          update.cost_updated_at = null
          hasChanges = true
        }
      }
    }

    // Mínimo: si LVE no tiene mínimo y Fudo sí, tomarlo (Fudo es la verdad).
    if (fudoMin !== null && (!si.min_qty || si.min_qty <= 0) && update.min_qty === undefined) {
      update.min_qty = fudoMin
      hasChanges = true
    }

    // Link supplier if not already set and Fudo has provider
    if (!si.supplier_id && fudoProviderId) {
      const supplierId = providerToSupplier.get(fudoProviderId)
      if (supplierId) {
        update.supplier_id = supplierId
        hasChanges = true
      }
    }

    // Categoría LVE sugerida (solo si el item está en 'otros')
    if (mapped?.category && (!si.category || si.category === 'otros') && si.category !== mapped.category) {
      update.category = mapped.category
      hasChanges = true
    }

    // Intermedio (Pre-Producto en Fudo) → is_produced. Limpieza de falsos
    // positivos: items en 'otros' marcados producidos que Fudo no clasifica
    // como pre-producto y que nunca salieron de una producción.
    if (mapped?.isPreProduct && !si.is_produced) {
      update.is_produced = true
      hasChanges = true
    } else if (
      schemaHasAreas
      && si.is_produced
      && mapped
      && !mapped.isPreProduct
      && si.fudo_ingredient_id
      && si.category === 'otros'
      && !producedEver.has(si.id)
      && !recipeOutputItems.has(si.id)
    ) {
      update.is_produced = false
      hasChanges = true
    }

    // Área + categoría Fudo (espejo). area_locked = fijada a mano → no se toca.
    if (schemaHasAreas) {
      if (fudoCategory && si.fudo_category !== fudoCategory) {
        update.fudo_category = fudoCategory
        hasChanges = true
      }
      const targetArea = mapped?.area && mapped.area !== 'otros'
        ? mapped.area
        : areaFromLveCategory((update.category as string | undefined) ?? si.category)
      if (!si.area_locked && isStockArea(targetArea) && si.area !== targetArea) {
        update.area = targetArea
        hasChanges = true
      }
    }

    if (!hasChanges) {
      result.synced++
      continue
    }

    let { error } = await admin.from('stock_items').update(update).eq('id', si.id)

    // Migración de cost_source pendiente: guardar el resto igual (patrón usual)
    if (error && isMissingColumnError(error.message, ['cost_source', 'cost_updated_at'])) {
      delete update.cost_source
      delete update.cost_updated_at
      ;({ error } = await admin.from('stock_items').update(update).eq('id', si.id))
    }

    if (error) {
      result.errors.push(`${si.id}: ${error.message}`)
    } else {
      result.synced++
    }
  }

  if (unitChanges.length > 0) {
    await admin.from('audit_trail').insert({
      action: 'fudo_unit_sync',
      module: 'stock',
      entity_type: 'stock',
      entity_id: 'sync',
      description: `Unidades alineadas con Fudo: ${unitChanges.slice(0, 10).join('; ')}${unitChanges.length > 10 ? ` (+${unitChanges.length - 10})` : ''}`,
      metadata: { changes: unitChanges },
    }).then(() => null, () => null)
  }

  // Solo los errores reales (transporte / escritura en BD) marcan el evento como
  // failed. Las discrepancias de mapeo son el reporte de trazabilidad, no una falla.
  await finishFudoSyncEvent(admin, eventId, result.errors.length > 0 ? 'failed' : 'success', {
    responsePayload: {
      synced: result.synced,
      total: result.total,
      errors: result.errors,
      discrepancies,
      discrepancy_count: discrepancies.length,
      schema_has_areas: schemaHasAreas,
    },
    errorMessage: result.errors.length > 0 ? `${result.errors.length} errores de sync` : null,
  })

  // Si el sync de lectura tuvo éxito (Fudo accesible), limpiar cualquier incident
  // de fallo de lectura anterior que haya quedado abierto (ej: fudo_read_failed).
  await resolveSourceIncidents(admin, 'stock_read_sync').catch(() => null)

  // El caller sigue recibiendo todo junto para mostrar el detalle en la UI.
  result.errors.push(...discrepancies)

  return result
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Error desconocido'
    await finishFudoSyncEvent(admin, eventId, 'failed', { errorMessage: error })
    await recordFudoIncident(admin, {
      source: 'stock_read_sync',
      code: 'fudo_read_failed',
      severity: 'critical',
      entityType: 'stock',
      entityId: 'all',
      title: 'No se pudo leer stock desde Fudo',
      detail: error,
      payload: { operation: 'stock_read_sync' },
    })
    throw err
  }
}

// ---------------------------------------------------------------------------
// SYNC WRITE: Push Supabase change → Fudo
// Called when a user updates stock in the webapp
// ---------------------------------------------------------------------------

export async function syncToFudo(
  admin: SupabaseClient,
  stockItemId: string,
  newQty: number,
  userId?: string,
  options: StockWriteOptions = {},
): Promise<{ success: boolean; fudoSynced: boolean; error?: string; movementId?: string | null; fudoPendiente?: boolean }> {
  // 1. Get the stock_item to find fudo link
  const { data: item } = await admin
    .from('stock_items')
    .select('id, name, unit, fudo_ingredient_id, fudo_product_id, fudo_skip, current_qty, cost_per_unit')
    .eq('id', stockItemId)
    .single()

  if (!item) return { success: false, fudoSynced: false, error: 'Item no encontrado' }

  // If item is marked as fudo_skip, treat as local-only
  const skipFudo = (item as Record<string, unknown>).fudo_skip === true

  const fudoLink = item.fudo_ingredient_id || item.fudo_product_id
  const writeReason: StockWriteReason = options.reason ?? 'physical_count'
  const writeOperation = writeReason === 'physical_count'
    ? 'physical_stock_count'
    : writeReason === 'reception'
      ? 'stock_reception'
      : writeReason === 'waste'
        ? 'stock_waste'
        : 'manual_stock_write'
  const note = options.note?.trim() || null
  const delta = Math.round((newQty - item.current_qty) * 1000) / 1000
  // Para merma/recepción manda el delta explícito si vino; si no, el implícito.
  const effectiveDelta = options.deltaOverride != null
    ? Math.round(options.deltaOverride * 1000) / 1000
    : delta

  if (writeReason === 'physical_count' && stockWriteNeedsNote(item.current_qty, newQty, item.unit) && !note) {
    return {
      success: false,
      fudoSynced: false,
      error: 'La diferencia de conteo es relevante. Agregá una nota para auditoría.',
    }
  }

  if (!fudoLink && !skipFudo) {
    return {
      success: false,
      fudoSynced: false,
      error: 'Item sin mapeo Fudo. Mapealo o marcalo como local explícito antes de actualizar stock.',
    }
  }

  // 2. Fudo-linked stock must write to Fudo first. If Fudo fails, local stock stays unchanged.
  //    Conteos y ajustes → absoluto. Merma y recepción → delta sobre Fudo actual.
  let finalQty = newQty
  // Movimiento (merma/recepción) que Fudo no aceptó: queda en LVE y en la cola
  let pendienteFudo: { delta: number; error: string } | null = null
  if (fudoLink && !skipFudo) {
    const isDeltaReason = writeReason === 'waste' || writeReason === 'reception'
    const baseContext = {
      admin,
      operation: writeOperation,
      stockItemId,
      userId,
      entityType: 'stock_item',
      entityId: stockItemId,
      reason: writeReason,
      note,
    }

    let fudoResult: { success: boolean; error?: string; fudoAfter?: number }
    if (isDeltaReason) {
      // Merma y recepción son MOVIMIENTOS: se aplican sobre lo que Fudo tiene
      // ahora. Nunca se escribe un absoluto por este camino — hacerlo pisaría
      // el stock real de Fudo con el número (posiblemente viejo) de LVE.
      if (effectiveDelta === 0) {
        fudoResult = { success: true }
      } else {
        fudoResult = await writeFudoStockDelta(
          { fudoIngredientId: item.fudo_ingredient_id, fudoProductId: item.fudo_product_id },
          effectiveDelta,
          baseContext,
        )
        if (fudoResult.success && typeof fudoResult.fudoAfter === 'number') finalQty = fudoResult.fudoAfter
      }
    } else if (item.fudo_ingredient_id) {
      fudoResult = await writeFudoStock(item.fudo_ingredient_id, newQty, {
        ...baseContext,
        fudoType: 'ingredient',
        fudoId: item.fudo_ingredient_id,
        oldQty: item.current_qty,
        newQty,
      })
    } else {
      fudoResult = await writeFudoProductStock(item.fudo_product_id!, newQty, {
        ...baseContext,
        fudoType: 'product',
        fudoId: item.fudo_product_id!,
        oldQty: item.current_qty,
        newQty,
      })
    }

    if (!fudoResult.success && isDeltaReason) {
      // La mercadería llegó (o se tiró) de verdad: se registra en LVE y el
      // movimiento se reintenta solo hacia Fudo (ver lib/fudo/reintentos.ts).
      console.error(`[FudoSync] Write failed for ${item.name} (queda en cola): ${fudoResult.error}`)
      pendienteFudo = { delta: effectiveDelta, error: fudoResult.error ?? 'Fudo no aceptó el movimiento' }
    } else if (!fudoResult.success) {
      console.error(`[FudoSync] Write failed for ${item.name}: ${fudoResult.error}`)
      await admin.from('audit_trail').insert({
        user_id: userId ?? null,
        action: 'fudo_sync_error',
        module: 'stock',
        entity_type: 'stock_item',
        entity_id: stockItemId,
        description: `Stock NO actualizado en LVE porque Fudo falló para ${item.name}: ${fudoResult.error}`,
        metadata: { fudo_id: fudoLink, attempted_qty: newQty, local_qty_kept: item.current_qty, reason: writeReason, note },
      })

      return { success: false, fudoSynced: false, error: fudoResult.error }
    }
  }

  // 3. Update Supabase only after Fudo accepted the change, or for local-only items.
  const itemUpdate: Record<string, unknown> = { current_qty: finalQty, updated_at: new Date().toISOString() }
  if (writeReason === 'physical_count') itemUpdate.last_counted_at = new Date().toISOString()
  const isCostWrite = writeReason === 'reception' && Boolean(options.costPerUnit && options.costPerUnit > 0)
  if (isCostWrite) {
    // Costo de compra real → fuente CONFIABLE ('compra').
    itemUpdate.cost_per_unit = options.costPerUnit
    itemUpdate.cost_source = 'compra'
    itemUpdate.cost_updated_at = new Date().toISOString()
  }
  let { error: dbError } = await admin
    .from('stock_items')
    .update(itemUpdate)
    .eq('id', stockItemId)

  // Migración de cost_source pendiente: guardar el resto igual (patrón usual)
  if (dbError && isCostWrite && isMissingColumnError(dbError.message, ['cost_source', 'cost_updated_at'])) {
    delete itemUpdate.cost_source
    delete itemUpdate.cost_updated_at
    ;({ error: dbError } = await admin
      .from('stock_items')
      .update(itemUpdate)
      .eq('id', stockItemId))
  }

  if (dbError) {
    await recordFudoIncident(admin, {
      source: 'write_stock',
      code: 'lve_update_after_fudo_failed',
      severity: 'critical',
      entityType: 'stock_item',
      entityId: stockItemId,
      stockItemId,
      fudoType: item.fudo_ingredient_id ? 'ingredient' : 'product',
      fudoId: fudoLink,
      title: 'Fudo cambió pero LVE no pudo guardar el nuevo stock',
      detail: dbError.message,
      payload: { old_qty: item.current_qty, new_qty: finalQty },
    })

    return { success: false, fudoSynced: false, error: dbError.message }
  }

  // 4. Log the change (conteos) + kardex (movimiento valorizado)
  await admin.from('stock_logs').insert({
    stock_item_id: stockItemId,
    user_id: userId ?? null,
    action: writeReason,
    old_qty: item.current_qty,
    new_qty: finalQty,
    note,
  })

  // El movimiento se registra contra el número con el que LVE quedó (finalQty),
  // que para merma/recepción es el que devolvió Fudo. Así previous → new → qty
  // cierran entre sí en el kardex.
  const appliedDelta = Math.round((finalQty - item.current_qty) * 1000) / 1000
  const movementId = appliedDelta !== 0
    ? await insertStockMovement(admin, {
      stock_item_id: stockItemId,
      movement_type: MOVEMENT_TYPE_BY_REASON[writeReason],
      qty: appliedDelta,
      previous_qty: item.current_qty,
      new_qty: finalQty,
      reason: writeReason,
      note,
      created_by: userId ?? null,
      fudo_synced: Boolean(fudoLink && !skipFudo && !pendienteFudo),
      cost_per_unit: options.costPerUnit ?? item.cost_per_unit ?? null,
    })
    : null

  if (pendienteFudo) {
    const { encolarDeltaStock } = await import('@/lib/fudo/reintentos')
    await encolarDeltaStock(admin, {
      stockItemId,
      delta: pendienteFudo.delta,
      origen: writeReason === 'waste' ? 'merma' : 'recepcion',
      error: pendienteFudo.error,
      nota: note,
      movimientoIds: movementId ? [movementId] : [],
      userId: userId ?? null,
    })
    await admin.from('audit_trail').insert({
      user_id: userId ?? null,
      action: 'fudo_sync_pendiente',
      module: 'stock',
      entity_type: 'stock_item',
      entity_id: stockItemId,
      description: `${item.name}: ${item.current_qty} → ${finalQty} en LVE; Fudo falló y quedó en cola de reintentos (${pendienteFudo.error})`,
      metadata: { fudo_id: fudoLink, delta: pendienteFudo.delta, reason: writeReason, note, movement_id: movementId },
    })
    return { success: true, fudoSynced: false, fudoPendiente: true, movementId }
  }

  if (fudoLink && !skipFudo) {
    await admin.from('audit_trail').insert({
      user_id: userId ?? null,
      action: 'fudo_stock_sync',
      module: 'stock',
      entity_type: 'stock_item',
      entity_id: stockItemId,
      description: `${item.name}: ${item.current_qty} → ${finalQty} (sincronizado con Fudo)`,
      metadata: { fudo_id: fudoLink, old_qty: item.current_qty, new_qty: finalQty, synced: true, reason: writeReason, note, movement_id: movementId },
    })

    if (writeReason === 'physical_count' || writeReason === 'manual_adjustment') {
      notifyEvent(admin, 'stock_adjusted', {
        title: '📦 Stock modificado',
        body: `${item.name}: ${item.current_qty} → ${finalQty} ${item.unit}${note ? ` — ${note}` : ''}`,
        url: '/stock',
      }).catch(() => {})
    }

    return { success: true, fudoSynced: true, movementId }
  }

  // No Fudo ID — local only. El conteo físico igual debe quedar auditado
  // (item.fudo_skip o sin vínculo Fudo aún no impide la trazabilidad).
  if (writeReason === 'physical_count') {
    await admin.from('audit_trail').insert({
      user_id: userId ?? null,
      action: 'physical_count',
      module: 'stock',
      entity_type: 'stock_item',
      entity_id: stockItemId,
      description: `${item.name}: ${item.current_qty} → ${finalQty} (conteo físico, local)`,
      metadata: { old_qty: item.current_qty, new_qty: finalQty, reason: writeReason, note, fudo_synced: false, movement_id: movementId },
    })
  }

  if (writeReason === 'physical_count' || writeReason === 'manual_adjustment') {
    notifyEvent(admin, 'stock_adjusted', {
      title: '📦 Stock modificado',
      body: `${item.name}: ${item.current_qty} → ${finalQty} ${item.unit}${note ? ` — ${note}` : ''}`,
      url: '/stock',
    }).catch(() => {})
  }

  return { success: true, fudoSynced: false, movementId }
}

// ---------------------------------------------------------------------------
// SYNC PRODUCTION: Push production movements to Fudo BY DELTA
// The RPC already updated stock_items — this pushes each item's net change
// onto Fudo's CURRENT stock (never overwrites sales that happened in between)
// and re-mirrors LVE to the number Fudo ends up with.
// ---------------------------------------------------------------------------

export async function syncProductionToFudo(
  admin: SupabaseClient,
  movements: { stock_item_id: number | string; change: number; movement_id?: string | null }[],
  userId?: string,
): Promise<{ synced: number; errors: string[]; encolados: string[] }> {
  // errors → no se puede mandar nunca (sin vínculo); encolados → Fudo falló y
  // se reintenta solo. En ambos casos la producción queda registrada en LVE.
  const result = { synced: 0, errors: [] as string[], encolados: [] as string[] }

  // Delta neto por item (un insumo puede aparecer más de una vez)
  const deltaByItem = new Map<string, number>()
  const movementIdsByItem = new Map<string, string[]>()
  for (const m of movements) {
    const key = String(m.stock_item_id)
    deltaByItem.set(key, (deltaByItem.get(key) ?? 0) + Number(m.change))
    if (m.movement_id) movementIdsByItem.set(key, [...(movementIdsByItem.get(key) ?? []), m.movement_id])
  }

  for (const [itemId, delta] of deltaByItem) {
    const { data: item } = await admin
      .from('stock_items')
      .select('id, name, fudo_ingredient_id, fudo_product_id, fudo_skip, current_qty')
      .eq('id', itemId)
      .single()

    if (!item) {
      result.errors.push(`${itemId}: item de stock no encontrado`)
      continue
    }

    // Skip items flagged as local-only
    if ((item as Record<string, unknown>).fudo_skip === true) continue

    if (!item.fudo_ingredient_id && !item.fudo_product_id) {
      result.errors.push(`${item.name}: sin mapeo Fudo ni local explícito`)
      continue
    }

    if (Math.abs(delta) < 0.0005) { result.synced++; continue }

    const fudoResult = await writeFudoStockDelta(
      { fudoIngredientId: item.fudo_ingredient_id, fudoProductId: item.fudo_product_id },
      delta,
      {
        admin,
        operation: 'production_stock_write',
        stockItemId: itemId,
        userId,
        entityType: 'production_movement',
        entityId: itemId,
        reason: 'production',
      },
    )

    if (fudoResult.success) {
      result.synced++
      // LVE queda espejado al número final de Fudo (incluye ventas intermedias)
      if (typeof fudoResult.fudoAfter === 'number' && Math.abs(fudoResult.fudoAfter - Number(item.current_qty)) >= 0.01) {
        await admin.from('stock_items').update({ current_qty: fudoResult.fudoAfter, updated_at: new Date().toISOString() }).eq('id', itemId)
      }
      const ids = movementIdsByItem.get(itemId) ?? []
      if (ids.length > 0) {
        await admin.from('stock_movements').update({ fudo_synced: true }).in('id', ids).then(() => null, () => null)
      }
      await admin.from('audit_trail').insert({
        user_id: userId ?? null,
        action: 'fudo_production_sync',
        module: 'stock',
        entity_type: 'stock_item',
        entity_id: String(itemId),
        description: `Producción: ${item.name} ${delta > 0 ? '+' : ''}${delta} → Fudo ${fudoResult.fudoBefore ?? '?'} → ${fudoResult.fudoAfter}`,
        metadata: {
          fudo_ingredient_id: item.fudo_ingredient_id,
          fudo_product_id: item.fudo_product_id,
          delta,
          fudo_before: fudoResult.fudoBefore ?? null,
          fudo_after: fudoResult.fudoAfter ?? null,
        },
      })
    } else {
      result.encolados.push(`${item.name}: ${fudoResult.error}`)
      const { encolarDeltaStock } = await import('@/lib/fudo/reintentos')
      await encolarDeltaStock(admin, {
        stockItemId: itemId,
        delta,
        origen: 'produccion',
        error: fudoResult.error ?? 'Fudo no aceptó el movimiento',
        movimientoIds: movementIdsByItem.get(itemId) ?? [],
        userId: userId ?? null,
      })
      await admin.from('audit_trail').insert({
        user_id: userId ?? null,
        action: 'fudo_sync_error',
        module: 'stock',
        entity_type: 'stock_item',
        entity_id: String(itemId),
        description: `Producción de ${item.name} no entró a Fudo (queda en cola de reintentos): ${fudoResult.error}`,
        metadata: {
          fudo_ingredient_id: item.fudo_ingredient_id,
          fudo_product_id: item.fudo_product_id,
          attempted_delta: delta,
        },
      })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// FULL BIDIRECTIONAL SYNC
// Reads from Fudo first, then returns current state
// ---------------------------------------------------------------------------

export async function fullSync(admin: SupabaseClient): Promise<SyncResult> {
  const readResult = await syncFromFudo(admin)

  return {
    read: readResult,
    timestamp: new Date().toISOString(),
    fudoConnected: true,
  }
}
