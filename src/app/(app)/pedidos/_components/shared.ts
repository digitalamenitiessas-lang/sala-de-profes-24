// Tipos y utilidades compartidas de Pedidos (página y diálogos).

export type Order = {
  id: number
  product_name: string
  category: string
  quantity: string
  urgency: string
  status: string
  note: string | null
  supplier_id: string | null
  created_by: string | null
  /** bar_orders guarda el autor en requested_by */
  requested_by?: string | null
  created_at: string
  source: 'barra' | 'cocina'
  stock_item_id: string | null
  received_qty: string | null
  unit_cost: number | null
  received_at: string | null
  received_by: string | null
  ordered_at?: string | null
  fudo_expense_id?: string | null
  fudo_amount?: number | null
  received_mode?: string | null
  received_note?: string | null
  payment_method?: string | null
}

export type Supplier = { id: string; name: string; phone: string | null; contact_name: string | null; fudo_provider_id?: string | null }
export type Profile = { id: string; first_name: string; last_name: string }
export type StockLite = { id: string; name: string; unit: string; current_qty: number; cost_per_unit?: number | null; fudo_skip?: boolean | null; fudo_ingredient_id?: string | null; fudo_product_id?: string | null; supplier_id?: string | null; has_supplier?: boolean }

/**
 * ¿Aparece en el buscador de compras? Un producto de Fudo sin ingrediente
 * suele ser un plato del menú ("Adicional Huevo") y no se compra… salvo los
 * de reventa (bebidas: Coca-Cola, agua) que tienen proveedor vinculado. Antes
 * se escondían todos y no había forma de cargar la compra a Salta Refresco.
 */
export function esComprable(s: StockLite): boolean {
  if (s.fudo_product_id && !s.fudo_ingredient_id) return !!s.has_supplier || !!s.supplier_id
  return true
}

export type ExpenseLite = { id: string; provider: string | null; providerId: string | null; date: string; amount: number; ingredientIds: string[]; ingredientNames: string[] }
export type Match = { order_id: number; source: 'cocina' | 'barra'; strength: 'fuerte' | 'probable'; why: string; expense: ExpenseLite }
export type ConciliarPayload = { matches: Match[]; expenses: ExpenseLite[] }

export type PaymentMethod = 'cuenta_corriente' | 'efectivo' | 'transferencia' | 'tarjeta'

export const PAYMENT_METHODS: { key: PaymentMethod; label: string; hint: string }[] = [
  { key: 'cuenta_corriente', label: 'Cuenta corriente', hint: 'Queda en cuentas por pagar' },
  { key: 'efectivo', label: 'Efectivo', hint: 'Pagado en el momento' },
  { key: 'transferencia', label: 'Transferencia', hint: 'Pagado en el momento' },
  { key: 'tarjeta', label: 'Tarjeta', hint: 'Pagado en el momento' },
]

export function money(n: number) { return `$${Math.round(n).toLocaleString('es-AR')}` }

/**
 * Cantidad tipeada → número. Acepta coma decimal ('2,5' → 2.5): antes
 * Number('2,5') daba NaN y el ítem desaparecía del pedido en silencio.
 * Devuelve NaN si no hay número parseable.
 */
export function parseQty(raw: string | undefined | null): number {
  if (raw == null) return NaN
  const n = parseFloat(String(raw).trim().replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

