// ---------------------------------------------------------------------------
// AI Purchase Order — copiloto de compras
// ---------------------------------------------------------------------------
// Groups critical stock items by supplier, suggests quantities,
// and generates ready-to-send messages via AI.
// Never sends automatically — always requires human confirmation.
// ---------------------------------------------------------------------------

import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PurchaseItem = {
  item_id: string
  item_name: string
  category: string
  unit: string
  current_qty: number
  min_qty: number
  suggested_qty: number
  reasoning: string
  priority_score: number
  /** venta promedio por día (últimos 14 días), null si no hay historial */
  daily_sales: number | null
  /** días de stock que quedan al ritmo actual, null si no hay historial */
  days_left: number | null
}

export type PurchaseOrder = {
  supplier_id: string
  supplier_name: string
  supplier_phone: string | null
  supplier_email: string | null
  items: PurchaseItem[]
  total_items: number
  priority: 'alta' | 'media' | 'baja'
  priority_score: number
  message: string | null // AI-generated
  /** hoy es día de pedido de este proveedor */
  is_order_day: boolean
  /** días de pedido configurados (0=dom … 6=sáb) */
  order_days: number[]
  /** horizonte que tiene que cubrir la compra (días hasta la próxima entrega) */
  coverage_days: number | null
}

export type PurchaseOrderResult = {
  orders: PurchaseOrder[]
  unassigned: PurchaseItem[] // items without supplier
  generatedAt: string
  sources: string[]
}

// ---------------------------------------------------------------------------
// Sensitive categories — need extra buffer
// ---------------------------------------------------------------------------

const SENSITIVE_CATEGORIES = new Set(['bebidas', 'lacteos', 'carnes', 'verduras', 'frutas'])

// ---------------------------------------------------------------------------
// Suggest quantity — conservative, based on real data only
// ---------------------------------------------------------------------------

function suggestQuantity(item: {
  current_qty: number
  min_qty: number
  category: string
}): { qty: number; reasoning: string } {
  const { current_qty, min_qty, category } = item
  const isSensitive = SENSITIVE_CATEGORIES.has(category)
  const buffer = isSensitive ? 1.3 : 1.15 // 30% or 15% buffer

  if (current_qty === 0) {
    const suggested = Math.ceil(min_qty * buffer)
    return {
      qty: Math.max(suggested, 1),
      reasoning: `Sin stock. Sugerido: mínimo (${min_qty}) + ${isSensitive ? '30%' : '15%'} buffer`,
    }
  }

  if (current_qty < min_qty) {
    const deficit = min_qty - current_qty
    const suggested = Math.ceil(deficit * buffer)
    return {
      qty: Math.max(suggested, 1),
      reasoning: `Faltante: ${deficit} unidades para llegar al mínimo${isSensitive ? ' + buffer por categoría sensible' : ''}`,
    }
  }

  if (current_qty <= min_qty * 1.2) {
    const suggested = Math.ceil((min_qty * buffer) - current_qty)
    return {
      qty: Math.max(suggested, 1),
      reasoning: 'Cerca del mínimo — compra preventiva',
    }
  }

  return { qty: 0, reasoning: 'Sin necesidad de compra inmediata' }
}

// ---------------------------------------------------------------------------
// Calculate priority from items
// ---------------------------------------------------------------------------

function calculateOrderPriority(items: PurchaseItem[]): { priority: PurchaseOrder['priority']; score: number } {
  if (items.length === 0) return { priority: 'baja', score: 0 }
  const maxScore = Math.max(...items.map(i => i.priority_score))
  const avgScore = items.reduce((s, i) => s + i.priority_score, 0) / items.length
  const score = Math.round(maxScore * 0.7 + avgScore * 0.3)
  if (score >= 50) return { priority: 'alta', score }
  if (score >= 25) return { priority: 'media', score }
  return { priority: 'baja', score }
}

// ---------------------------------------------------------------------------
// Priority score per item (same logic as stock-priorities but inline)
// ---------------------------------------------------------------------------

function itemPriorityScore(item: { current_qty: number; min_qty: number; category: string; supplier_id: string | null }): number {
  let score = 0
  if (item.current_qty === 0) score += 50
  else if (item.current_qty <= item.min_qty) {
    const deficitPct = item.min_qty > 0 ? (item.min_qty - item.current_qty) / item.min_qty : 1
    score += 20 + Math.round(deficitPct * 25)
  } else if (item.current_qty <= item.min_qty * 1.2) {
    score += 10
  }
  if (!item.supplier_id) score += 20
  if (SENSITIVE_CATEGORIES.has(item.category)) score += 10
  return Math.min(score, 100)
}

// ---------------------------------------------------------------------------
// Calendario: días hasta la próxima entrega de un proveedor
// ---------------------------------------------------------------------------

function daysUntilNextDelivery(orderDays: number[], todayDow: number, leadTime: number | null): number | null {
  if (!orderDays || orderDays.length === 0) return null
  // Próximo día de pedido DESPUÉS de hoy (si hoy es día de pedido, lo que se
  // compra hoy tiene que durar hasta la entrega del próximo pedido)
  let delta = 7
  for (let d = 1; d <= 7; d++) {
    if (orderDays.includes((todayDow + d) % 7)) { delta = d; break }
  }
  return delta + (leadTime ?? 0)
}

// ---------------------------------------------------------------------------
// Generate purchase orders grouped by supplier
// ---------------------------------------------------------------------------

type SupplierData = {
  id: string; name: string; phone: string | null; email: string | null
  order_days: number[]; lead_time_days: number | null
}

export async function generatePurchaseOrders(): Promise<PurchaseOrderResult> {
  const admin = createAdminClient()

  const todayDow = new Date(
    new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10) + 'T12:00:00',
  ).getDay()

  // Fetch stock items that need attention (below minimum * 1.2)
  const { data: items } = await admin
    .from('stock_items')
    .select('id, name, category, unit, current_qty, min_qty, supplier_id, fudo_product_id, suppliers!stock_items_supplier_id_fkey(id, name, phone, email, order_days, lead_time_days)')
    .eq('is_active', true)

  if (!items) return { orders: [], unassigned: [], generatedAt: new Date().toISOString(), sources: [] }

  // Velocidad de consumo real: ventas de los últimos 14 días por producto Fudo
  const since = new Date()
  since.setDate(since.getDate() - 14)
  const sinceStr = since.toISOString().slice(0, 10)
  const soldByProduct = new Map<string, number>()
  const activeDates = new Set<string>()
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { data: batch } = await admin
      .from('fudo_sales')
      .select('fudo_product_id, quantity, sold_at')
      .gte('sold_at', sinceStr)
      .range(offset, offset + 999)
    if (!batch || batch.length === 0) break
    for (const row of batch as { fudo_product_id: string; quantity: number; sold_at: string }[]) {
      soldByProduct.set(row.fudo_product_id, (soldByProduct.get(row.fudo_product_id) ?? 0) + Number(row.quantity))
      activeDates.add(row.sold_at.slice(0, 10))
    }
    if (batch.length < 1000) break
  }
  const activeDays = Math.max(activeDates.size, 1)

  // Filter to items that need replenishment (por mínimo) O que se acaban pronto (por consumo)
  const enriched = items.map(item => {
    const fudoProductId = (item as { fudo_product_id?: string | null }).fudo_product_id ?? null
    const sold = fudoProductId ? soldByProduct.get(fudoProductId) ?? 0 : 0
    const dailySales = sold > 0 ? Math.round((sold / activeDays) * 10) / 10 : null
    const daysLeft = dailySales && dailySales > 0
      ? Math.round((Math.max(item.current_qty, 0) / dailySales) * 10) / 10
      : null
    return { ...item, dailySales, daysLeft }
  })

  const needsOrder = enriched.filter(i =>
    (i.current_qty <= i.min_qty * 1.2 && i.min_qty > 0)
    || (i.daysLeft !== null && i.daysLeft <= 4),
  )

  // Build purchase items
  const purchaseItems: (PurchaseItem & { supplier_id: string | null; supplier_data: SupplierData | null })[] =
    needsOrder.map(item => {
      const supplierData = item.suppliers as unknown as SupplierData | null
      const coverage = supplierData
        ? daysUntilNextDelivery(supplierData.order_days ?? [], todayDow, supplierData.lead_time_days)
        : null

      // Cantidad: si conocemos el consumo, cubrir hasta la próxima entrega + 20%;
      // si no, la heurística por mínimos de siempre
      let qty: number
      let reasoning: string
      if (item.dailySales && item.dailySales > 0 && coverage) {
        const target = item.dailySales * coverage * 1.2
        qty = Math.max(0, Math.ceil(target - Math.max(item.current_qty, 0)))
        reasoning = `Vendés ~${item.dailySales}/día y la próxima entrega es en ${coverage} días (te quedan ~${item.daysLeft} días de stock)`
      } else if (item.dailySales && item.dailySales > 0 && item.daysLeft !== null && item.daysLeft <= 4) {
        qty = Math.max(0, Math.ceil(item.dailySales * 7 * 1.2 - Math.max(item.current_qty, 0)))
        reasoning = `Al ritmo actual (~${item.dailySales}/día) te quedan ~${item.daysLeft} días de stock`
      } else {
        const suggestion = suggestQuantity(item)
        qty = suggestion.qty
        reasoning = suggestion.reasoning
      }

      let score = itemPriorityScore(item)
      if (item.daysLeft !== null && item.daysLeft <= 2) score = Math.min(score + 30, 100)

      return {
        item_id: item.id,
        item_name: item.name,
        category: item.category,
        unit: item.unit ?? 'unidad',
        current_qty: item.current_qty,
        min_qty: item.min_qty,
        suggested_qty: qty,
        reasoning,
        priority_score: score,
        daily_sales: item.dailySales,
        days_left: item.daysLeft,
        supplier_id: item.supplier_id,
        supplier_data: supplierData,
      }
    })
    .filter(i => i.suggested_qty > 0)
    .sort((a, b) => b.priority_score - a.priority_score)

  // Separate assigned vs unassigned
  const assigned = purchaseItems.filter(i => i.supplier_id && i.supplier_data)
  const unassigned: PurchaseItem[] = purchaseItems
    .filter(i => !i.supplier_id)
    .map(({ supplier_id, supplier_data, ...rest }) => rest)

  // Group by supplier
  const supplierGroups = new Map<string, { supplier: SupplierData; items: PurchaseItem[] }>()

  for (const item of assigned) {
    const sid = item.supplier_id!
    if (!supplierGroups.has(sid)) {
      supplierGroups.set(sid, { supplier: item.supplier_data!, items: [] })
    }
    const { supplier_id, supplier_data, ...purchaseItem } = item
    supplierGroups.get(sid)!.items.push(purchaseItem)
  }

  // Build orders — los proveedores cuyo día de pedido es HOY van primero
  const orders: PurchaseOrder[] = Array.from(supplierGroups.values())
    .map(({ supplier, items: orderItems }) => {
      const { priority, score } = calculateOrderPriority(orderItems)
      const orderDays = supplier.order_days ?? []
      const isOrderDay = orderDays.includes(todayDow)
      return {
        supplier_id: supplier.id,
        supplier_name: supplier.name,
        supplier_phone: supplier.phone,
        supplier_email: supplier.email,
        items: orderItems,
        total_items: orderItems.length,
        priority,
        priority_score: isOrderDay ? Math.min(score + 25, 100) : score,
        message: null, // Generated separately via AI
        is_order_day: isOrderDay,
        order_days: orderDays,
        coverage_days: daysUntilNextDelivery(orderDays, todayDow, supplier.lead_time_days),
      }
    })
    .sort((a, b) => (Number(b.is_order_day) - Number(a.is_order_day)) || (b.priority_score - a.priority_score))

  return {
    orders,
    unassigned,
    generatedAt: new Date().toISOString(),
    sources: ['supabase:stock_items', 'supabase:suppliers', 'supabase:fudo_sales(14d)'],
  }
}

// ---------------------------------------------------------------------------
// AI message generation for a single supplier order
// ---------------------------------------------------------------------------

export async function generateOrderMessage(order: PurchaseOrder): Promise<string> {
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY

  // Build items list
  const itemsList = order.items
    .map(i => `- ${i.item_name} x ${i.suggested_qty} ${i.unit}`)
    .join('\n')

  // Fallback — structured text without AI
  const fallback = `Hola ${order.supplier_name}, necesito reponer:\n\n${itemsList}\n\n¿Podés confirmarme disponibilidad y tiempos de entrega? Gracias.`

  if (!OPENROUTER_KEY) return fallback

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content: `Redactá un mensaje breve para pedir mercadería a un proveedor. Tono: profesional pero cercano, como un WhatsApp de trabajo. Español argentino. No uses markdown ni emojis. El mensaje es para ${order.supplier_name}. Incluí la lista de items exacta que te paso. Cerrá pidiendo confirmación de disponibilidad y tiempos.`,
          },
          {
            role: 'user',
            content: `Items a pedir:\n${itemsList}\n\nPrioridad: ${order.priority}`,
          },
        ],
      }),
    })

    if (!res.ok) return fallback
    const json = await res.json()
    return json.choices?.[0]?.message?.content?.trim() ?? fallback
  } catch {
    return fallback
  }
}
