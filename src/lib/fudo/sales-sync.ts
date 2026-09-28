import { SupabaseClient } from '@supabase/supabase-js'
import { fudo } from '@/lib/fudoClient'
import {
  createFudoSyncEvent,
  finishFudoSyncEvent,
  recordFudoIncident,
} from '@/lib/fudo/sync-events'

type ImportSalesOptions = {
  from?: string
  to?: string
  limit?: number
  userId?: string | null
  operation?: string
}

type FudoSaleRow = {
  fudo_sale_item_id: string
  fudo_ticket_id: string
  fudo_product_id: string
  quantity: number
  sold_at: string
  raw_payload: Record<string, unknown>
}

type FudoSubitemRow = {
  fudo_subitem_id: string
  fudo_sale_item_id: string
  fudo_ticket_id: string
  fudo_product_id: string
  quantity: number
  price: number | null
  sold_at: string
}

export type FudoSalesImportResult = {
  imported: number
  /** sub-ítems (opciones elegidas dentro de cada ítem) nuevos guardados */
  subitems: number
  totalSales: number
  totalItems: number
  errors: string[]
}

export async function importFudoSales(
  admin: SupabaseClient,
  options: ImportSalesOptions = {},
): Promise<FudoSalesImportResult> {
  const result: FudoSalesImportResult = {
    imported: 0,
    subitems: 0,
    totalSales: 0,
    totalItems: 0,
    errors: [],
  }

  const eventId = await createFudoSyncEvent(admin, {
    operation: options.operation ?? 'sales_import',
    direction: 'fudo_to_lve',
    entityType: 'fudo_sales',
    entityId: options.from ?? 'latest',
    fudoType: 'sale',
    requestPayload: {
      from: options.from ?? null,
      to: options.to ?? null,
      limit: options.limit ?? null,
    },
    createdBy: options.userId ?? null,
  })

  try {
    // Una sola pasada paginada con include=items.product: el endpoint
    // /sales/{id}/items devuelve 404 en la API real de Fudo (verificado
    // 2026-07-14) y además hacía N+1 requests que superaban el timeout.
    const flatRows: FudoSaleRow[] = []
    // Opciones elegidas dentro de cada ítem (infusión del combo, leche,
    // packaging de PedidosYa…): alimentan el consumo vía la vista fudo_consumo.
    const subitemRows: FudoSubitemRow[] = []
    let salesCount = 0

    type JsonApiRow = { type: string; id: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data: unknown }> }

    const relOne = (row: JsonApiRow | undefined, key: string): { id?: string } | null => {
      const data = row?.relationships?.[key]?.data
      if (!data || Array.isArray(data)) return null
      return data as { id?: string }
    }
    const relMany = (row: JsonApiRow | undefined, key: string): Array<{ id: string }> => {
      const data = row?.relationships?.[key]?.data
      return Array.isArray(data) ? (data as Array<{ id: string }>) : []
    }

    // Include enriquecido: además de items.product traemos payments (medio de
    // pago), waiter y table, para poder comparar por mozo/medio de pago más
    // adelante. Si la API rechaza el include enriquecido, caemos al básico
    // (los campos nuevos quedan null y el sync no se rompe).
    const INCLUDE_RICO = 'items.product,items.subitems,payments.paymentMethod,table,waiter'
    const INCLUDE_BASE = 'items.product,items.subitems'
    let includeActual = INCLUDE_RICO

    let page = 1
    while (page <= 30) {
      let res: { data?: JsonApiRow[]; included?: JsonApiRow[] }
      try {
        res = await fudo.fetch<{ data?: JsonApiRow[]; included?: JsonApiRow[] }>(
          `/sales?include=${includeActual}&sort=-createdAt&page[size]=200&page[number]=${page}`
        )
      } catch (err) {
        // Degradar al include básico SOLO si la API lo rechazó (400/422).
        // Un error transitorio (500/timeout/429 agotado) se propaga como
        // siempre: si no, una falla pasajera degradaba el sync para siempre
        // y quedaban datos mixtos (filas sin mozo/medio de pago).
        const status = (err instanceof Error ? err.message : '').match(/^Fudo API (\d{3}) on /)?.[1]
        const includeRechazado = status === '400' || status === '422'
        if (includeActual === INCLUDE_RICO && includeRechazado) {
          // La API no aceptó el include enriquecido: reintentar con el básico
          console.error('[sales-sync] include enriquecido rechazado, uso el básico:', err)
          includeActual = INCLUDE_BASE
          res = await fudo.fetch<{ data?: JsonApiRow[]; included?: JsonApiRow[] }>(
            `/sales?include=${includeActual}&sort=-createdAt&page[size]=200&page[number]=${page}`
          )
        } else {
          throw err
        }
      }
      const salesData = res.data ?? []
      const included = res.included ?? []

      const itemMap = new Map<string, JsonApiRow>()
      const subitemMap = new Map<string, JsonApiRow>()
      const paymentMap = new Map<string, JsonApiRow>()
      const paymentMethodName = new Map<string, string>()
      const tableMap = new Map<string, JsonApiRow>()
      const personName = new Map<string, string>()
      for (const r of included) {
        if (r.type === 'Item') itemMap.set(r.id, r)
        else if (r.type === 'Subitem') subitemMap.set(r.id, r)
        else if (r.type === 'Payment') paymentMap.set(r.id, r)
        else if (r.type === 'PaymentMethod' && typeof r.attributes?.name === 'string') paymentMethodName.set(r.id, r.attributes.name)
        else if (r.type === 'Table') tableMap.set(r.id, r)
        // El waiter puede venir tipado como User o Waiter según la versión de la API
        else if ((r.type === 'User' || r.type === 'Waiter') && typeof r.attributes?.name === 'string') personName.set(r.id, r.attributes.name)
      }

      let allBeforeRange = salesData.length > 0
      for (const sale of salesData) {
        const createdAt = String(sale.attributes?.createdAt ?? '')
        const argDate = new Date(createdAt).toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)

        if (options.from && argDate >= options.from) allBeforeRange = false
        if (options.from && argDate < options.from) continue
        if (!options.from) allBeforeRange = false
        if (options.to && argDate > options.to) continue
        if (String(sale.attributes?.saleState) !== 'CLOSED') continue

        salesCount++

        // Contexto del ticket (viene con el include enriquecido; si el include
        // básico está activo o el dato no vino, queda null sin romper nada)
        const paymentRefs = relMany(sale, 'payments')
        let paymentMethod: string | null = null
        for (const pRef of paymentRefs) {
          const payment = paymentMap.get(pRef.id)
          if (!payment || payment.attributes?.canceled) continue
          const methodId = relOne(payment, 'paymentMethod')?.id
          paymentMethod = methodId ? paymentMethodName.get(methodId) ?? String(methodId) : null
          if (paymentMethod) break
        }
        const waiterId = relOne(sale, 'waiter')?.id
        const waiter = waiterId ? personName.get(waiterId) ?? null : null
        const tableId = relOne(sale, 'table')?.id
        const tableRow = tableId ? tableMap.get(tableId) : undefined
        // Si la Table no vino en included NO guardamos el id interno crudo
        // como número de mesa: mejor null que "mesa 48213".
        const table = tableRow?.attributes?.number != null
          ? String(tableRow.attributes.number)
          : null
        const saleTotal = sale.attributes?.total != null ? Number(sale.attributes.total) : null

        const refs = relMany(sale, 'items')
        for (const ref of refs) {
          const item = itemMap.get(ref.id)
          if (!item || item.attributes?.canceled) continue
          const prodRef = (item.relationships as Record<string, { data: unknown }> | undefined)?.product?.data as { id?: string } | undefined
          const itemQty = Number(item.attributes?.quantity ?? 1) || 1
          for (const subRef of relMany(item, 'subitems')) {
            const sub = subitemMap.get(subRef.id)
            const subProduct = relOne(sub, 'product')?.id
            if (!sub || !subProduct || sub.attributes?.canceled) continue
            subitemRows.push({
              fudo_subitem_id: sub.id,
              fudo_sale_item_id: item.id,
              fudo_ticket_id: sale.id,
              fudo_product_id: String(subProduct),
              // La cantidad de la opción es por unidad del ítem
              quantity: (Number(sub.attributes?.quantity ?? 1) || 1) * itemQty,
              price: sub.attributes?.price != null ? Number(sub.attributes.price) : null,
              sold_at: createdAt || new Date().toISOString(),
            })
          }
          flatRows.push({
            fudo_sale_item_id: item.id,
            fudo_ticket_id: sale.id,
            fudo_product_id: String(prodRef?.id ?? item.id),
            quantity: Number(item.attributes?.quantity ?? 1) || 1,
            sold_at: createdAt || new Date().toISOString(),
            raw_payload: {
              sale_id: sale.id,
              sale_item_id: item.id,
              item_name: item.attributes?.name ?? null,
              price: Number(item.attributes?.price ?? 0),
              sale_type: sale.attributes?.saleType ?? null,
              operation: options.operation ?? 'sales_import',
              // Campos nuevos (2026-09): para comparar por mozo/medio de pago
              // en unas semanas. Sin backfill: las filas viejas no los tienen.
              payment_method: paymentMethod,
              waiter,
              table,
              sale_total: saleTotal,
              item_total: item.attributes?.total != null ? Number(item.attributes.total) : null,
            },
          })
        }
      }

      if (allBeforeRange || salesData.length < 200) break
      page++
    }

    result.totalSales = salesCount

    // Sub-ítems: idempotente por fudo_subitem_id (se re-guardan sin duplicar
    // aunque el ítem padre ya estuviera importado — así se completa el histórico).
    for (let i = 0; i < subitemRows.length; i += 500) {
      const batch = subitemRows.slice(i, i + 500)
      const { error, count } = await admin
        .from('fudo_sale_subitems')
        .upsert(batch, { onConflict: 'fudo_subitem_id', ignoreDuplicates: true, count: 'exact' })
      if (error) result.errors.push(`sub-ítems: ${error.message}`)
      else result.subitems += count ?? 0
    }

    if (salesCount === 0) {
      await finishFudoSyncEvent(admin, eventId, 'success', { responsePayload: result })
      return result
    }

    result.totalItems = flatRows.length
    if (flatRows.length === 0) {
      await finishFudoSyncEvent(admin, eventId, result.errors.length > 0 ? 'failed' : 'success', {
        responsePayload: result,
        errorMessage: result.errors.join('; ') || null,
      })
      return result
    }

    // Ventana del existingSet con la MISMA semántica AR que el filtro de
    // arriba: from/to son fechas calendario AR → [fromT00:00-03:00,
    // (to+1d)T00:00-03:00). Antes se pasaba 'YYYY-MM-DD' crudo y Postgres lo
    // casteaba a medianoche UTC: con to=hoy, TODA la jornada AR de hoy quedaba
    // fuera del set y fresh=1 re-insertaba filas ya importadas por el cron.
    // Sin from (sync manual "lo último"): acotar a la venta más vieja traída
    // −1 día, para no paginar la tabla entera.
    const minSoldMs = flatRows.reduce((min, r) => {
      const t = Date.parse(r.sold_at)
      return Number.isNaN(t) ? min : Math.min(min, t)
    }, Infinity)
    const fromISO = options.from
      ? new Date(`${options.from}T00:00:00-03:00`).toISOString()
      : Number.isFinite(minSoldMs) ? new Date(minSoldMs - 86_400_000).toISOString() : null
    // +24h en ms (AR no tiene DST; setDate dependería del huso del server)
    const toExclISO = options.to ? new Date(Date.parse(`${options.to}T00:00:00-03:00`) + 86_400_000).toISOString() : null

    // Paginado: PostgREST corta en 1000 filas y 2 días de ventas pueden
    // pasarlo; un set truncado dejaba escapar duplicados al insert.
    const existingSet = new Set<string>()
    for (let p = 0; p < 50; p++) {
      let query = admin
        .from('fudo_sales')
        .select('fudo_sale_item_id')
        .not('fudo_sale_item_id', 'is', null)
      if (fromISO) query = query.gte('sold_at', fromISO)
      if (toExclISO) query = query.lt('sold_at', toExclISO)

      const { data: existing, error: existingError } = await query
        .order('id', { ascending: true })
        .range(p * 1000, p * 1000 + 999)
      if (existingError) throw existingError
      for (const row of existing ?? []) {
        if (row.fudo_sale_item_id) existingSet.add(String(row.fudo_sale_item_id))
      }
      if ((existing ?? []).length < 1000) break
    }

    const newRows = flatRows.filter((row) => !existingSet.has(row.fudo_sale_item_id))

    for (let i = 0; i < newRows.length; i += 50) {
      const batch = newRows.slice(i, i + 50)
      const { error } = await admin.from('fudo_sales').insert(batch)
      if (!error) {
        result.imported += batch.length
        continue
      }
      if (error.code === '23505') {
        // Duplicado que se escapó del existingSet (índice único parcial
        // uq_fudo_sales_sale_item). Upsert con ON CONFLICT no sirve acá:
        // el índice es PARCIAL y PostgREST no le pasa el predicado. En vez
        // de perder el batch entero, reintentar fila por fila salteando
        // las repetidas.
        for (const row of batch) {
          const { error: rowError } = await admin.from('fudo_sales').insert(row)
          if (!rowError) result.imported += 1
          else if (rowError.code !== '23505') result.errors.push(rowError.message)
        }
      } else {
        result.errors.push(error.message)
      }
    }

    await finishFudoSyncEvent(admin, eventId, result.errors.length > 0 ? 'failed' : 'success', {
      responsePayload: result,
      errorMessage: result.errors.join('; ') || null,
    })

    if (result.errors.length > 0) {
      await recordFudoIncident(admin, {
        source: 'sales_import',
        code: 'fudo_sales_import_partial_failure',
        severity: 'high',
        entityType: 'fudo_sales',
        entityId: options.from ?? 'latest',
        fudoType: 'sale',
        title: 'Importación de ventas Fudo con errores',
        detail: result.errors.join('; '),
        payload: result as unknown as Record<string, unknown>,
      })
    }

    return result
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Error al importar ventas Fudo'
    result.errors.push(error)
    await finishFudoSyncEvent(admin, eventId, 'failed', { responsePayload: result, errorMessage: error })
    await recordFudoIncident(admin, {
      source: 'sales_import',
      code: 'fudo_sales_import_failed',
      severity: 'critical',
      entityType: 'fudo_sales',
      entityId: options.from ?? 'latest',
      fudoType: 'sale',
      title: 'No se pudieron importar ventas desde Fudo',
      detail: error,
      payload: {
        from: options.from ?? null,
        to: options.to ?? null,
      },
    })
    throw err
  }
}
