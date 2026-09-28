// Shape que devuelve GET /api/stock/items/[id]/ficha.
// Se reexporta lo que ya declara el endpoint para no duplicar contratos.

export type {
  FichaItem,
  FichaFudo,
  FichaMovement,
  FichaRecipe,
  FichaReceipt,
  FichaLot,
  FichaCount,
} from '@/app/api/stock/items/[id]/ficha/route'

import type {
  FichaItem,
  FichaFudo,
  FichaMovement,
  FichaRecipe,
  FichaReceipt,
  FichaLot,
  FichaCount,
} from '@/app/api/stock/items/[id]/ficha/route'

export type FichaIncident = {
  id: string
  code: string
  title: string
  detail: string | null
  severity: string
  status: string
  first_seen_at: string
  last_seen_at: string
}

export type FichaSupplier = {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  category: string | null
  lead_time_days: number | null
  order_days: number[] | null
  is_active: boolean | null
}

export type FichaPrices = {
  receipts: FichaReceipt[]
  latest: number | null
  avg: number | null
  min: number | null
  max: number | null
  count: number
  item_cost_per_unit: number | null
  /** Fuente del costo del item: número solo si es confiable (compra/manual/produccion) */
  item_cost_source: string | null
  fudo_cost: number | null
}

export type FichaExpense = {
  id: string
  provider: string | null
  date: string
  amount: number
}

export type FichaResponse = {
  ok: true
  item: FichaItem
  fudo: FichaFudo
  incidents: FichaIncident[]
  movements: FichaMovement[]
  recipes: FichaRecipe[]
  produced_by: {
    recipe_id: string
    name: string
    category: string | null
    is_active: boolean
    yield_portions: number | null
  }[]
  prices: FichaPrices
  supplier: FichaSupplier | null
  lots: FichaLot[]
  counts: FichaCount[]
  expenses: FichaExpense[] | null
  errors: Record<string, string>
  generated_at: string
}
