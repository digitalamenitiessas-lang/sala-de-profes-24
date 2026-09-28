import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { matchIngredientToStock } from '@/lib/recipes/production-batches'

// ---------------------------------------------------------------------------
// Consumo de insumos — helpers server-side
// ---------------------------------------------------------------------------
// Lógica compartida con /api/stock/demand: dos rutas de consumo por stock_item.
//
// Ruta sync  — consumo real registrado por el sync de Fudo:
//              stock_movements[movement_type='out', reason='sale']
//
// Ruta stock — caída de stock entre snapshots + entradas:
//              qty en primer snapshot diario de la ventana + recepciones
//              de la ventana − qty actual = lo consumido.
//
// getWeeklyConsumption() combina ambas para responder "¿cuánto se consumió
// de este insumo en los últimos 7 días?" (para contexto en notificaciones
// de pedidos de compra). NUNCA debe usarse en un camino que bloquee la
// creación de un pedido: siempre envolver en try/catch.
// ---------------------------------------------------------------------------

type AdminClient = SupabaseClient<Database>

/** Suma de salidas por venta (sync Fudo) desde cutoffISO. Redondeado a 2 dec. */
export async function sumSaleMovements(
  admin: AdminClient,
  stockItemId: string,
  cutoffISO: string,
): Promise<number> {
  const { data: movements } = await admin
    .from('stock_movements')
    .select('qty')
    .eq('stock_item_id', stockItemId)
    .eq('movement_type', 'out')
    .eq('reason', 'sale')
    .gte('created_at', cutoffISO)

  return Math.round(
    (movements ?? []).reduce((sum, m) => sum + m.qty, 0) * 100
  ) / 100
}

/**
 * Consumo por caída de stock entre snapshots: cuánto bajó el stock desde el
 * primer snapshot diario de la ventana, sumando lo que entró en el medio.
 *
 * Retorna null si no hay snapshot en la ventana o el item no figura en él.
 * `consumed` es null cuando la caída es ≤ 0.01 (sin consumo medible), pero
 * `windowDays` se informa igual (mismo comportamiento que /api/stock/demand).
 */
export async function stockDropConsumption(
  admin: AdminClient,
  stockItem: { id: string; current_qty: number },
  cutoffDateStr: string,
  receivedInWindow: number,
): Promise<{ consumed: number | null; windowDays: number } | null> {
  const { data: snaps } = await admin
    .from('stock_snapshots')
    .select('snapshot_date, items')
    .eq('snapshot_type', 'daily')
    .gte('snapshot_date', cutoffDateStr)
    .order('snapshot_date', { ascending: true })
    .limit(1)

  const firstSnap = (snaps ?? [])[0]
  if (!firstSnap) return null

  const arr = (firstSnap.items as { id: string; current_qty: number }[] | null) ?? []
  const past = arr.find(i => i.id === stockItem.id)
  if (!past || typeof past.current_qty !== 'number') return null

  const drop = Number(past.current_qty) + receivedInWindow - Number(stockItem.current_qty)
  const consumed = drop > 0.01 ? Math.round(drop * 100) / 100 : null
  const spanDays = Math.round(
    (Date.now() - new Date(firstSnap.snapshot_date + 'T12:00:00').getTime()) / 86400000
  )
  return { consumed, windowDays: Math.max(1, spanDays) }
}

/**
 * Consumo de los últimos 7 días de un insumo, en la unidad del stock_item.
 *
 * Prioridad: consumo real del sync Fudo; si no hay, caída de stock entre
 * snapshots + entradas (extrapolada a 7 días si la ventana de snapshots
 * disponible es menor). Retorna null si no hay dato utilizable.
 */
export async function getWeeklyConsumption(
  admin: AdminClient,
  stockItemId: string,
): Promise<{ qty: number; unit: string } | null> {
  const DAYS = 7
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - DAYS)
  const cutoffISO = cutoff.toISOString()
  const cutoffDateStr = cutoffISO.slice(0, 10)

  const { data: stockItem } = await admin
    .from('stock_items')
    .select('id, unit, current_qty')
    .eq('id', stockItemId)
    .single()

  if (!stockItem) return null

  // Ruta sync — consumo real registrado
  const consumedFromSync = await sumSaleMovements(admin, stockItemId, cutoffISO)
  if (consumedFromSync > 0) return { qty: consumedFromSync, unit: stockItem.unit }

  // Ruta stock — caída entre snapshots + entradas de la ventana
  const { data: receipts } = await admin
    .from('stock_receipts')
    .select('qty')
    .eq('stock_item_id', stockItemId)
    .gte('received_date', cutoffDateStr)

  const receivedInWindow = (receipts ?? []).reduce((s, r) => s + Number(r.qty), 0)

  const drop = await stockDropConsumption(
    admin,
    { id: stockItem.id, current_qty: Number(stockItem.current_qty) },
    cutoffDateStr,
    receivedInWindow,
  )
  if (!drop || drop.consumed == null) return null

  // La ventana de snapshots puede ser < 7 días: extrapolar por tasa diaria
  const qty7d = Math.round((drop.consumed / drop.windowDays) * DAYS * 100) / 100
  return qty7d > 0 ? { qty: qty7d, unit: stockItem.unit } : null
}

/**
 * Contexto de consumo para notificaciones de pedidos de compra.
 *
 * Matchea cada nombre de producto pedido contra stock_items (fuzzy, por
 * palabras completas — misma lógica que el wizard de producción) y devuelve
 * un mapa nombre pedido → "consumo 7d: X unidad" para los que tienen dato.
 *
 * Best-effort: cualquier error interno devuelve mapa vacío, nunca lanza.
 */
export async function getConsumptionContextForNames(
  admin: AdminClient,
  productNames: string[],
): Promise<Map<string, string>> {
  const lines = new Map<string, string>()
  try {
    const { data: stockItems } = await admin
      .from('stock_items')
      .select('id, name')

    if (!stockItems?.length) return lines

    await Promise.all(productNames.map(async (name) => {
      try {
        const match = matchIngredientToStock(name, stockItems)
        if (!match) return
        const consumption = await getWeeklyConsumption(admin, match.id)
        if (!consumption || consumption.qty <= 0) return
        const qtyStr = Number.isInteger(consumption.qty)
          ? String(consumption.qty)
          : consumption.qty.toLocaleString('es-AR', { maximumFractionDigits: 2 })
        lines.set(name, `consumo 7d: ${qtyStr} ${consumption.unit}`)
      } catch { /* best-effort por item */ }
    }))
  } catch { /* best-effort global */ }
  return lines
}

/**
 * Ejecuta getConsumptionContextForNames con tope de tiempo: si tarda más de
 * `timeoutMs`, devuelve lo que haya (mapa vacío). Jamás rechaza.
 */
export async function getConsumptionContextWithTimeout(
  admin: AdminClient,
  productNames: string[],
  timeoutMs = 4000,
): Promise<Map<string, string>> {
  try {
    return await Promise.race([
      getConsumptionContextForNames(admin, productNames),
      new Promise<Map<string, string>>((resolve) =>
        setTimeout(() => resolve(new Map()), timeoutMs)
      ),
    ])
  } catch {
    return new Map()
  }
}
