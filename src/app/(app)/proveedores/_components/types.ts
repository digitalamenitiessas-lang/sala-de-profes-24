import type { Supplier, StockItem } from '@/types/database'

export type { Supplier }

export type SupplierFormData = {
  name: string
  category: string
  contact_name: string
  phone: string
  email: string
  notes: string
  /** Días de pedido: 0=domingo … 6=sábado */
  order_days: number[]
  lead_time_days: string
}

export const EMPTY_FORM: SupplierFormData = {
  name: '',
  category: '',
  contact_name: '',
  phone: '',
  email: '',
  notes: '',
  order_days: [],
  lead_time_days: '',
}

export const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const

export type LowStockItem = Pick<StockItem, 'id' | 'name' | 'current_qty' | 'min_qty' | 'unit' | 'supplier_id' | 'category'>
