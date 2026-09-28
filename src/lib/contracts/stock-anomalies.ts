export type StockAnomalySeverity = 'critical' | 'high' | 'medium'
export type StockAnomalyAction = 'sync' | 'count' | 'map' | 'pending_links'
export type StockAnomalySourceKind = 'fudo' | 'local' | 'unmapped' | null

export type StockAnomalyItem = {
  id: string
  source: 'fudo' | 'recipes'
  code: string
  severity: StockAnomalySeverity
  title: string
  detail: string
  primary_action: StockAnomalyAction
  action_label: string
  action_href: string | null
  stock_item_id: string | null
  stock_item_name: string | null
  current_qty: number | null
  min_qty: number | null
  unit: string | null
  source_kind: StockAnomalySourceKind
  recipe_count: number
  recipe_names: string[]
  fudo_type: string | null
  fudo_id: string | null
  last_seen_at: string | null
}

export type StockAnomaliesResponse = {
  summary: {
    total: number
    critical: number
    high: number
    medium: number
    items_blocked: number
    pending_recipe_links: number
    requires_sync: boolean
    requires_mapping: boolean
  }
  items: StockAnomalyItem[]
  generated_at: string
}
