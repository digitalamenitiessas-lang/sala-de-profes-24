// ---------------------------------------------------------------------------
// Conciliación de pedidos LVE ↔ GASTOS de Fudo
// ---------------------------------------------------------------------------
// La compra se carga UNA sola vez, en Fudo (módulo Gastos: proveedor, monto,
// insumos). LVE no vuelve a cargar stock ni gasto: lo que hace es cerrar el
// ciclo del pedido (pedí → llegó) apoyándose en ese gasto:
//
//   pedido 'ordered' (proveedor X, enviado el día D)
//     ↔ expense de Fudo del mismo proveedor (fudo_provider_id) con fecha ≥ D−1
//       y todavía no vinculado a otro pedido.
//
// Si además el gasto incluye el ingrediente del pedido, el match es "fuerte".
// El cron sugiere; la persona confirma desde /pedidos (o el cron cierra solo
// los matches fuertes si así se lo pide).
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchFudoExpenses, type FudoExpense } from '@/lib/fudo/expenses'

export type OrderForMatch = {
  id: number
  source: 'cocina' | 'barra'
  product_name: string
  quantity: string
  supplier_id: string | null
  stock_item_id: string | null
  ordered_at: string | null
  created_at: string
  fudo_expense_id: string | null
}

export type ExpenseMatch = {
  order_id: number
  source: 'cocina' | 'barra'
  expense: FudoExpense
  strength: 'fuerte' | 'probable'
  /** por qué: mismo proveedor + fecha; + insumo incluido en el gasto */
  why: string
}

type SupplierRow = { id: string; name: string; fudo_provider_id: string | null }

function isMissingColumn(msg: string | undefined | null) {
  return Boolean(msg && (msg.includes('ordered_at') || msg.includes('fudo_expense_id')) && (msg.includes('column') || msg.includes('schema cache')))
}

/** Pedidos en camino (ordered) de cocina y barra, tolerante a migración pendiente. */
export async function loadOrderedOrders(admin: SupabaseClient): Promise<OrderForMatch[]> {
  const out: OrderForMatch[] = []
  for (const source of ['cocina', 'barra'] as const) {
    const table = source === 'cocina' ? 'kitchen_orders' : 'bar_orders'
    let res: { data: unknown[] | null; error: { message: string } | null } = await admin
      .from(table)
      .select('id, product_name, quantity, supplier_id, stock_item_id, ordered_at, created_at, fudo_expense_id')
      .eq('status', 'ordered')
    if (res.error && isMissingColumn(res.error.message)) {
      res = await admin
        .from(table)
        .select('id, product_name, quantity, supplier_id, stock_item_id, created_at')
        .eq('status', 'ordered')
    }
    for (const row of (res.data ?? []) as unknown as Array<Partial<OrderForMatch> & { id: number; product_name: string; quantity: string; created_at: string }>) {
      out.push({
        id: row.id,
        source,
        product_name: row.product_name,
        quantity: row.quantity,
        supplier_id: row.supplier_id ?? null,
        stock_item_id: row.stock_item_id ?? null,
        ordered_at: row.ordered_at ?? null,
        created_at: row.created_at,
        fudo_expense_id: row.fudo_expense_id ?? null,
      })
    }
  }
  return out
}

/** ids de gastos Fudo ya usados por algún pedido (para no vincular dos veces). */
export async function loadLinkedExpenseIds(admin: SupabaseClient): Promise<Set<string>> {
  const linked = new Set<string>()
  for (const table of ['kitchen_orders', 'bar_orders'] as const) {
    const res = await admin.from(table).select('fudo_expense_id').not('fudo_expense_id', 'is', null)
    if (res.error) continue
    for (const r of (res.data ?? []) as { fudo_expense_id: string | null }[]) if (r.fudo_expense_id) linked.add(r.fudo_expense_id)
  }
  return linked
}

/**
 * Propone, para cada pedido en camino, el gasto de Fudo que mejor lo explica.
 * No escribe nada.
 */
export async function matchOrdersWithExpenses(admin: SupabaseClient, options: { sinceDays?: number; forceExpenses?: boolean } = {}): Promise<{
  matches: ExpenseMatch[]
  orders: OrderForMatch[]
  expenses_considered: number
}> {
  const orders = await loadOrderedOrders(admin)
  if (orders.length === 0) return { matches: [], orders, expenses_considered: 0 }

  const sinceDays = options.sinceDays ?? 21
  const sinceISO = new Date(Date.now() - sinceDays * 86_400_000).toISOString()
  const [expenses, { data: suppliers }, linkedIds, { data: stockItems }] = await Promise.all([
    fetchFudoExpenses(sinceISO, { force: options.forceExpenses }),
    admin.from('suppliers').select('id, name, fudo_provider_id'),
    loadLinkedExpenseIds(admin),
    admin.from('stock_items').select('id, fudo_ingredient_id').not('fudo_ingredient_id', 'is', null),
  ])

  const supById = new Map((suppliers ?? []).map((s) => [s.id, s as SupplierRow]))
  const fudoIngByItem = new Map((stockItems ?? []).map((s) => [s.id, String(s.fudo_ingredient_id)]))

  const matches: ExpenseMatch[] = []
  const usedExpense = new Set<string>(linkedIds)

  // Pedidos más viejos primero: se llevan el gasto más antiguo compatible
  const sorted = [...orders].sort((a, b) => (a.ordered_at ?? a.created_at).localeCompare(b.ordered_at ?? b.created_at))

  for (const order of sorted) {
    if (order.fudo_expense_id) continue
    const sup = order.supplier_id ? supById.get(order.supplier_id) : null
    if (!sup?.fudo_provider_id) continue
    const from = new Date(new Date(order.ordered_at ?? order.created_at).getTime() - 86_400_000).toISOString()
    const fudoIng = order.stock_item_id ? fudoIngByItem.get(order.stock_item_id) ?? null : null

    const candidates = expenses
      .filter((e) => e.providerId === sup.fudo_provider_id && e.date >= from && !usedExpense.has(e.id))
      .sort((a, b) => a.date.localeCompare(b.date))
    if (candidates.length === 0) continue

    const strong = fudoIng ? candidates.find((e) => e.ingredientIds.includes(fudoIng)) : undefined
    const chosen = strong ?? candidates[0]
    usedExpense.add(chosen.id)
    matches.push({
      order_id: order.id,
      source: order.source,
      expense: chosen,
      strength: strong ? 'fuerte' : 'probable',
      why: strong
        ? `Gasto a ${sup.name} del ${chosen.date.slice(0, 10)} que incluye este insumo`
        : `Gasto a ${sup.name} del ${chosen.date.slice(0, 10)} (posterior al pedido)`,
    })
  }

  return { matches, orders, expenses_considered: expenses.length }
}

/**
 * Cierra un pedido como recibido apoyándose en un gasto de Fudo (o sin gasto,
 * si el encargado confirma a mano). NO toca stock: el stock lo movió la compra
 * cargada en Fudo y el sync lo espeja.
 */
export async function closeOrderWithExpense(
  admin: SupabaseClient,
  params: {
    orderId: number
    source: 'cocina' | 'barra'
    userId: string
    expense?: { id: string; amount: number } | null
    mode: 'fudo_expense' | 'lve_stock' | 'sin_stock'
    note?: string | null
    receivedQty?: string | null
  },
): Promise<{ success: boolean; error?: string }> {
  const table = params.source === 'cocina' ? 'kitchen_orders' : 'bar_orders'
  const now = new Date().toISOString()
  const full: Record<string, unknown> = {
    status: 'received',
    received_by: params.userId,
    received_at: now,
    received_qty: params.receivedQty ?? null,
    fudo_expense_id: params.expense?.id ?? null,
    fudo_amount: params.expense?.amount ?? null,
    received_mode: params.mode,
    received_note: params.note ?? null,
  }
  let res = await admin.from(table).update(full).eq('id', params.orderId)
  if (res.error && isMissingColumn(res.error.message)) {
    res = await admin.from(table).update({
      status: 'received',
      received_by: params.userId,
      received_at: now,
      received_qty: params.receivedQty ?? null,
    }).eq('id', params.orderId)
  }
  if (res.error) return { success: false, error: res.error.message }
  return { success: true }
}
