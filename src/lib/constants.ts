import type { AppRole, KitchenServiceValue, KitchenLogStatusValue, MenuItemCategoryValue, KitchenOrderCategoryValue, KitchenOrderUrgencyValue } from '@/types/database'

// ---------------------------------------------------------------------------
// Roles — Each role has a unique warm color, emoji, and label
// ---------------------------------------------------------------------------

export type RoleConfig = {
  color: string
  bg: string
  emoji: string
  label: string
}

export const ROLES: Record<AppRole, RoleConfig> = {
  socio:     { color: '#1a1a2e', bg: '#ede9fe', emoji: '🏛️', label: 'Socio' },
  encargado: { color: '#006d5a', bg: '#e8f5f1', emoji: '☕', label: 'Encargado' },
  chef:      { color: '#8b5e34', bg: '#faf0e4', emoji: '👨‍🍳', label: 'Chef' },
  barista:   { color: '#2d7d6a', bg: '#e8f5f1', emoji: '🧋', label: 'Barista' },
  runner:    { color: '#c67b4b', bg: '#fef3eb', emoji: '🏃', label: 'Runner' },
  cocina:    { color: '#a85d32', bg: '#faf0e4', emoji: '🍳', label: 'Cocina' },
  bacha:     { color: '#7a8b8b', bg: '#f0f3f3', emoji: '🧽', label: 'Bachero' },
  cajero:    { color: '#3b6ab5', bg: '#eef3fb', emoji: '💵', label: 'Cajero' },
} as const

export const ROLE_OPTIONS = Object.entries(ROLES).map(([value, config]) => ({
  value: value as AppRole,
  label: `${config.emoji} ${config.label}`,
  color: config.color,
}))

// ---------------------------------------------------------------------------
// Announcement types
// ---------------------------------------------------------------------------

export const ANNOUNCEMENT_TYPES = {
  general: { label: 'General', icon: '📢' },
  urgente: { label: 'Urgente', icon: '🚨' },
  recordatorio: { label: 'Recordatorio', icon: '📌' },
  operativo: { label: 'Operativo', icon: '⚙️' },
} as const

export type AnnouncementType = keyof typeof ANNOUNCEMENT_TYPES

export const ANNOUNCEMENT_TYPE_OPTIONS = Object.entries(ANNOUNCEMENT_TYPES).map(
  ([value, config]) => ({
    value: value as AnnouncementType,
    label: `${config.icon} ${config.label}`,
  }),
)

// ---------------------------------------------------------------------------
// Priorities
// ---------------------------------------------------------------------------

export const PRIORITIES = {
  baja: { label: 'Baja', color: '#006d5a' },
  media: { label: 'Media', color: '#d4943a' },
  alta: { label: 'Alta', color: '#ea504c' },
  critica: { label: 'Crítica', color: '#c42b28' },
} as const

export type Priority = keyof typeof PRIORITIES

export const PRIORITY_OPTIONS = Object.entries(PRIORITIES).map(
  ([value, config]) => ({
    value: value as Priority,
    label: config.label,
    color: config.color,
  }),
)

// ---------------------------------------------------------------------------
// Stock categories
// ---------------------------------------------------------------------------

export const STOCK_CATEGORIES = {
  bebidas: { label: 'Bebidas', icon: '🥤' },
  lacteos: { label: 'Lácteos', icon: '🥛' },
  carnes: { label: 'Carnes', icon: '🥩' },
  verduras: { label: 'Verduras', icon: '🥬' },
  frutas: { label: 'Frutas', icon: '🍎' },
  panaderia: { label: 'Panadería', icon: '🍞' },
  elaborados: { label: 'Elaborados', icon: '🥟' },
  condimentos: { label: 'Condimentos', icon: '🧂' },
  limpieza: { label: 'Limpieza', icon: '🧹' },
  desechables: { label: 'Desechables', icon: '🥡' },
  otros: { label: 'Otros', icon: '📦' },
} as const

export type StockCategory = keyof typeof STOCK_CATEGORIES

export const STOCK_CATEGORY_OPTIONS = Object.entries(STOCK_CATEGORIES).map(
  ([value, config]) => ({
    value: value as StockCategory,
    label: `${config.icon} ${config.label}`,
  }),
)

// ---------------------------------------------------------------------------
// Stock units
// ---------------------------------------------------------------------------

export const STOCK_UNITS = [
  { value: 'kg', label: 'Kilogramos' },
  { value: 'g', label: 'Gramos' },
  { value: 'l', label: 'Litros' },
  { value: 'ml', label: 'Mililitros' },
  { value: 'unidad', label: 'Unidades' },
  { value: 'paquete', label: 'Paquetes' },
  { value: 'caja', label: 'Cajas' },
  { value: 'bolsa', label: 'Bolsas' },
] as const

// ---------------------------------------------------------------------------
// Alert types
// ---------------------------------------------------------------------------

export const ALERT_TYPES = {
  low_stock: { label: 'Stock bajo', color: '#d4943a' },
  upcoming_purchase: { label: 'Recompra próxima', color: '#d4943a' },
  critical: { label: 'Crítico', color: '#ea504c' },
} as const

export type AlertType = keyof typeof ALERT_TYPES

// ---------------------------------------------------------------------------
// Recipe categories
// ---------------------------------------------------------------------------

export const RECIPE_CATEGORIES = {
  bebidas: { label: 'Café & Bebidas', icon: '☕', color: '#8b5e34', bg: '#faf0e4' },
  platos: { label: 'Platos', icon: '🍽️', color: '#006d5a', bg: '#e8f5f1' },
  postres: { label: 'Postres', icon: '🍰', color: '#d4943a', bg: '#fdf6ec' },
  snacks: { label: 'Snacks', icon: '🥐', color: '#c67b4b', bg: '#fef3eb' },
} as const

export type RecipeCategory = keyof typeof RECIPE_CATEGORIES

export const RECIPE_CATEGORY_OPTIONS = Object.entries(RECIPE_CATEGORIES).map(
  ([value, config]) => ({
    value: value as RecipeCategory,
    label: `${config.icon} ${config.label}`,
  }),
)

// ---------------------------------------------------------------------------
// Recipe units (for ingredients)
// ---------------------------------------------------------------------------

export const RECIPE_UNITS = [
  { value: 'g', label: 'g' },
  { value: 'kg', label: 'kg' },
  { value: 'ml', label: 'ml' },
  { value: 'l', label: 'l' },
  { value: 'unidad', label: 'u' },
  { value: 'cucharada', label: 'cda' },
  { value: 'cucharadita', label: 'cdta' },
  { value: 'taza', label: 'taza' },
  { value: 'pizca', label: 'pizca' },
  { value: 'a_gusto', label: 'a gusto' },
] as const

// ---------------------------------------------------------------------------
// Kitchen services (Cocina Diaria)
// ---------------------------------------------------------------------------

export const KITCHEN_SERVICES: Record<
  KitchenServiceValue,
  { label: string; icon: string; color: string; bg: string }
> = {
  desayuno_merienda: { label: 'Desayuno y Meriendas', icon: '☀️', color: '#d4943a', bg: '#fdf6ec' },
  almuerzo_cena:     { label: 'Almuerzos y Cenas',    icon: '🍽️', color: '#006d5a', bg: '#e8f5f1' },
} as const

export const KITCHEN_SERVICE_OPTIONS = Object.entries(KITCHEN_SERVICES).map(
  ([value, config]) => ({
    value: value as KitchenServiceValue,
    label: `${config.icon} ${config.label}`,
  }),
)

export const KITCHEN_LOG_STATUSES: Record<
  KitchenLogStatusValue,
  { label: string; color: string; bg: string }
> = {
  borrador: { label: 'Borrador', color: '#a39e97', bg: '#f3efe9' },
  enviado:  { label: 'Enviado',  color: '#006d5a', bg: '#e8f5f1' },
} as const

export const KITCHEN_UNITS = [
  { value: 'kg', label: 'kg' },
  { value: 'g', label: 'g' },
  { value: 'l', label: 'l' },
  { value: 'ml', label: 'ml' },
  { value: 'unidad', label: 'u' },
  { value: 'paquete', label: 'paq' },
] as const

// ---------------------------------------------------------------------------
// Menu item categories (Carta)
// ---------------------------------------------------------------------------

export const MENU_CATEGORIES: Record<
  MenuItemCategoryValue,
  { label: string; icon: string; color: string; bg: string }
> = {
  desayunos_meriendas: { label: 'Desayunos y Meriendas', icon: '☀️', color: '#d4943a', bg: '#fdf6ec' },
  entrepanes:          { label: 'Entrepanes',            icon: '🥪', color: '#8b5e34', bg: '#faf0e4' },
  tostones:            { label: 'Tostones',              icon: '🍞', color: '#c67b4b', bg: '#fef3eb' },
  sin_trigo:           { label: 'Sin Trigo',             icon: '🌾', color: '#2d7d6a', bg: '#e8f5f1' },
  panaderia_salada:    { label: 'Panaderia Salada',      icon: '🥐', color: '#c67b4b', bg: '#fef3eb' },
  entradas:            { label: 'Entradas',              icon: '🍽️', color: '#006d5a', bg: '#e8f5f1' },
  ensaladas:           { label: 'Ensaladas',             icon: '🥗', color: '#2d7d6a', bg: '#e8f5f1' },
  kids:                { label: 'Kids',                  icon: '👶', color: '#d4943a', bg: '#fdf6ec' },
  especialidades:      { label: 'Especialidades',        icon: '⭐', color: '#8b5e34', bg: '#faf0e4' },
  pizzas:              { label: 'Pizzas',                icon: '🍕', color: '#ea504c', bg: '#fef2f2' },
  entre_panes:         { label: 'Entre Panes',           icon: '🍔', color: '#a85d32', bg: '#faf0e4' },
  bebidas:             { label: 'Bebidas',               icon: '🥤', color: '#006d5a', bg: '#e8f5f1' },
  postres:             { label: 'Postres',               icon: '🍰', color: '#d4943a', bg: '#fdf6ec' },
} as const

export type MenuCategory = keyof typeof MENU_CATEGORIES

// ---------------------------------------------------------------------------
// Service → Menu category mapping (which menu categories belong to each service)
// ---------------------------------------------------------------------------

export const SERVICE_MENU_CATEGORIES: Record<KitchenServiceValue, MenuItemCategoryValue[]> = {
  desayuno_merienda: [
    'desayunos_meriendas',
    'entrepanes',
    'tostones',
    'sin_trigo',
    'panaderia_salada',
    'bebidas',
    'postres',
  ],
  almuerzo_cena: [
    'entradas',
    'ensaladas',
    'kids',
    'especialidades',
    'pizzas',
    'entre_panes',
    'bebidas',
    'postres',
  ],
} as const

// ---------------------------------------------------------------------------
// Kitchen Operations — Turnos de cocina, Checklists, Mise en Place
// ---------------------------------------------------------------------------

import type {
  KitchenShiftTypeValue,
  KitchenShiftStatusValue,
  ChecklistTimingValue,
  ChecklistTypeValue,
  KitchenFamilyValue,
  ChecklistItemStatusValue,
  MiseRecordStatusValue,
  BarCategoryValue,
  BarOrderUrgencyValue,
} from '@/types/database'

export const KITCHEN_SHIFT_TYPES: Record<KitchenShiftTypeValue, { label: string; icon: string; color: string; bg: string }> = {
  morning: { label: 'Turno Mañana', icon: '☀️', color: '#d4943a', bg: '#fdf6ec' },
  night:   { label: 'Turno Noche',  icon: '🌙', color: '#5a6b52', bg: '#eef2ec' },
}

export const KITCHEN_SHIFT_STATUSES: Record<KitchenShiftStatusValue, { label: string; color: string; bg: string }> = {
  pending:     { label: 'Pendiente',  color: '#a39e97', bg: '#f3efe9' },
  in_progress: { label: 'En curso',   color: '#d4943a', bg: '#fdf6ec' },
  completed:   { label: 'Cerrado',    color: '#006d5a', bg: '#e8f5f1' },
}

export const CHECKLIST_TYPES: Record<ChecklistTypeValue, { label: string; icon: string }> = {
  opening:    { label: 'Apertura',   icon: '🔓' },
  production: { label: 'Producción', icon: '🔥' },
  service:    { label: 'Servicio',   icon: '🍽️' },
  closing:    { label: 'Cierre',     icon: '🔒' },
}

export const CHECKLIST_TIMINGS: Record<ChecklistTimingValue, { label: string; icon: string }> = {
  on_arrival:     { label: 'Al entrar',      icon: '🚪' },
  pre_service:    { label: 'Pre-servicio',   icon: '📋' },
  during_service: { label: 'En servicio',    icon: '⚡' },
  closing:        { label: 'Cierre',         icon: '🔒' },
  scheduled:      { label: 'Hora fija',      icon: '⏰' },
}

export const KITCHEN_FAMILIES: Record<KitchenFamilyValue, { label: string; icon: string; color: string; bg: string }> = {
  equipment:     { label: 'Equipos',       icon: '⚙️', color: '#8b5e34', bg: '#faf0e4' },
  proteins:      { label: 'Proteínas',     icon: '🥩', color: '#ea504c', bg: '#fef2f2' },
  vegetables:    { label: 'Verduras',      icon: '🥬', color: '#2d7d6a', bg: '#e8f5f1' },
  pastry:        { label: 'Pastelería',    icon: '🍰', color: '#d4943a', bg: '#fdf6ec' },
  bread:         { label: 'Panes',         icon: '🍞', color: '#c67b4b', bg: '#fef3eb' },
  dairy:         { label: 'Lácteos',       icon: '🥛', color: '#006d5a', bg: '#e8f5f1' },
  cold_storage:  { label: 'Frío',          icon: '❄️', color: '#4a90d9', bg: '#eef4fc' },
  mise_en_place: { label: 'Mise en Place', icon: '🔪', color: '#3d2c24', bg: '#f3efe9' },
  general:       { label: 'General',       icon: '📦', color: '#a39e97', bg: '#f3efe9' },
}

export const CHECKLIST_ITEM_STATUSES: Record<ChecklistItemStatusValue, { label: string; color: string; bg: string; icon: string }> = {
  pending: { label: 'Pendiente', color: '#a39e97', bg: '#f3efe9', icon: '⬜' },
  done:    { label: 'Hecho',     color: '#006d5a', bg: '#e8f5f1', icon: '✅' },
  skipped: { label: 'Omitido',   color: '#d4943a', bg: '#fdf6ec', icon: '⏭️' },
  overdue: { label: 'Vencido',   color: '#ea504c', bg: '#fef2f2', icon: '🔴' },
}

export const MISE_RECORD_STATUSES: Record<MiseRecordStatusValue, { label: string; color: string; bg: string }> = {
  pending:     { label: 'Pendiente',   color: '#a39e97', bg: '#f3efe9' },
  in_progress: { label: 'En curso',    color: '#d4943a', bg: '#fdf6ec' },
  done:        { label: 'Listo',       color: '#006d5a', bg: '#e8f5f1' },
  low:         { label: 'Bajo',        color: '#d4943a', bg: '#fdf6ec' },
  missing:     { label: 'Faltante',    color: '#ea504c', bg: '#fef2f2' },
}

// ---------------------------------------------------------------------------
// Bar / Cafetería
// ---------------------------------------------------------------------------

export const BAR_CATEGORIES: Record<BarCategoryValue, { label: string; icon: string; color: string; bg: string }> = {
  lacteos:          { label: 'Lácteos',     icon: '🥛', color: '#006d5a', bg: '#e8f5f1' },
  cafe:             { label: 'Café',        icon: '☕', color: '#8b5e34', bg: '#faf0e4' },
  packaging:        { label: 'Packaging',   icon: '🥤', color: '#5a6b52', bg: '#eef2ec' },
  suministros:      { label: 'Suministros', icon: '🍫', color: '#c67b4b', bg: '#fef3eb' },
  insumos_oyambre:  { label: 'Oyambre',     icon: '🫖', color: '#2d7d6a', bg: '#e8f5f1' },
  libreria:         { label: 'Librería',    icon: '📎', color: '#a39e97', bg: '#f3efe9' },
  general:          { label: 'General',     icon: '📦', color: '#a39e97', bg: '#f3efe9' },
}

export const BAR_ORDER_URGENCY: Record<BarOrderUrgencyValue, { label: string; color: string; bg: string }> = {
  normal:  { label: 'Normal',  color: '#006d5a', bg: '#e8f5f1' },
  alta:    { label: 'Alta',    color: '#d4943a', bg: '#fdf6ec' },
  urgente: { label: 'Urgente', color: '#ea504c', bg: '#fef2f2' },
}

// ---------------------------------------------------------------------------
// Cocina — Pedidos de mercadería
// ---------------------------------------------------------------------------

export const KITCHEN_ORDER_CATEGORIES: Record<KitchenOrderCategoryValue, { label: string; icon: string; color: string; bg: string }> = {
  verduleria:  { label: 'Verdulería',  icon: '🥬', color: '#2d7d6a', bg: '#e8f5f1' },
  fruteria:    { label: 'Frutería',    icon: '🍎', color: '#d4943a', bg: '#fdf6ec' },
  carniceria:  { label: 'Carnicería',  icon: '🥩', color: '#c05746', bg: '#fef2f2' },
  fiambreria:  { label: 'Fiambrería',  icon: '🧀', color: '#d4943a', bg: '#fdf6ec' },
  panaderia:   { label: 'Panadería',   icon: '🍞', color: '#c67b4b', bg: '#fef3eb' },
  lacteos:     { label: 'Lácteos',     icon: '🥛', color: '#006d5a', bg: '#e8f5f1' },
  secos:       { label: 'Secos',       icon: '🌾', color: '#8b5e34', bg: '#faf0e4' },
  limpieza:    { label: 'Limpieza',    icon: '🧹', color: '#5a6b52', bg: '#eef2ec' },
  otros:       { label: 'Otros',       icon: '📦', color: '#a39e97', bg: '#f3efe9' },
}

export const KITCHEN_ORDER_URGENCY: Record<KitchenOrderUrgencyValue, { label: string; color: string; bg: string }> = {
  normal:  { label: 'Normal',  color: '#006d5a', bg: '#e8f5f1' },
  alta:    { label: 'Alta',    color: '#d4943a', bg: '#fdf6ec' },
  urgente: { label: 'Urgente', color: '#ea504c', bg: '#fef2f2' },
}
