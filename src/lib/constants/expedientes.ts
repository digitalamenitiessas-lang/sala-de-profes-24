import type {
  ExpedienteType,
  ExpedienteArea,
  ExpedienteStatus,
  ExpedienteUrgency,
} from '@/types/expedientes'

// ---------------------------------------------------------------------------
// Tipos de expediente
// ---------------------------------------------------------------------------

export const EXPEDIENTE_TYPES: Record<ExpedienteType, { label: string; icon: string; color: string; bg: string }> = {
  idea:                    { label: 'Idea',                icon: '💡', color: '#d4943a', bg: '#fdf6ec' },
  tarea:                   { label: 'Tarea',               icon: '✅', color: '#006d5a', bg: '#e8f5f1' },
  proyecto:                { label: 'Proyecto',            icon: '📐', color: '#1a1a2e', bg: '#ede9fe' },
  incidencia:              { label: 'Incidencia',          icon: '⚠️', color: '#ea504c', bg: '#fef2f2' },
  mejora:                  { label: 'Mejora',              icon: '🔧', color: '#2d7d6a', bg: '#e8f5f1' },
  compra:                  { label: 'Compra',              icon: '🛒', color: '#8b5e34', bg: '#faf0e4' },
  mantenimiento:           { label: 'Mantenimiento',       icon: '🔨', color: '#5a6b52', bg: '#eef2ec' },
  contenido:               { label: 'Contenido',           icon: '📸', color: '#c67b4b', bg: '#fef3eb' },
  desarrollo_gastronomico: { label: 'Desarrollo Gastro.',  icon: '👨‍🍳', color: '#a85d32', bg: '#faf0e4' },
  experiencia_cliente:     { label: 'Experiencia Cliente', icon: '🌟', color: '#d4943a', bg: '#fdf6ec' },
  estetica:                { label: 'Estética',            icon: '🎨', color: '#8b5e34', bg: '#faf0e4' },
  gestion_terceros:        { label: 'Gestión Terceros',    icon: '🤝', color: '#a39e97', bg: '#f3efe9' },
}

// ---------------------------------------------------------------------------
// Áreas de la empresa
// ---------------------------------------------------------------------------

export const EXPEDIENTE_AREAS: Record<ExpedienteArea, { label: string; icon: string }> = {
  gastronomia:    { label: 'Gastronomía',    icon: '🍽️' },
  barra:          { label: 'Barra',          icon: '☕' },
  salon:          { label: 'Salón',          icon: '🪑' },
  branding:       { label: 'Branding',       icon: '🎯' },
  marketing:      { label: 'Marketing',      icon: '📣' },
  experiencia:    { label: 'Experiencia',    icon: '✨' },
  administracion: { label: 'Administración', icon: '📊' },
  mantenimiento:  { label: 'Mantenimiento',  icon: '🔧' },
  eventos:        { label: 'Eventos',        icon: '🎪' },
  compras:        { label: 'Compras',        icon: '🛒' },
  desarrollo:     { label: 'Desarrollo',     icon: '🚀' },
}

// ---------------------------------------------------------------------------
// Estados del expediente
// ---------------------------------------------------------------------------

export const EXPEDIENTE_STATUSES: Record<ExpedienteStatus, { label: string; color: string; bg: string; step: number }> = {
  borrador:                    { label: 'Borrador',           color: '#a39e97', bg: '#f3efe9', step: 0 },
  presentado:                  { label: 'Presentado',         color: '#4a90d9', bg: '#eef4fc', step: 1 },
  en_revision:                 { label: 'En Revisión',        color: '#d4943a', bg: '#fdf6ec', step: 2 },
  admitido:                    { label: 'Admitido',           color: '#006d5a', bg: '#e8f5f1', step: 3 },
  asignado:                    { label: 'Asignado',           color: '#2d7d6a', bg: '#e8f5f1', step: 4 },
  en_ejecucion:                { label: 'En Ejecución',       color: '#006d5a', bg: '#e8f5f1', step: 5 },
  pausado:                     { label: 'Pausado',            color: '#d4943a', bg: '#fdf6ec', step: 5 },
  pendiente_tercero:           { label: 'Pend. Tercero',      color: '#c67b4b', bg: '#fef3eb', step: 5 },
  pendiente_decision:          { label: 'Pend. Decisión',     color: '#8b5e34', bg: '#faf0e4', step: 5 },
  revision_final:              { label: 'Revisión Final',     color: '#4a90d9', bg: '#eef4fc', step: 6 },
  cumplido:                    { label: 'Cumplido',           color: '#006d5a', bg: '#e8f5f1', step: 7 },
  cerrado_sin_implementacion:  { label: 'Cerrado s/ Impl.',  color: '#ea504c', bg: '#fef2f2', step: 7 },
  archivado:                   { label: 'Archivado',          color: '#a39e97', bg: '#f3efe9', step: 8 },
}

// ---------------------------------------------------------------------------
// Transiciones de estado válidas
// ---------------------------------------------------------------------------

export const STATUS_TRANSITIONS: Record<ExpedienteStatus, ExpedienteStatus[]> = {
  borrador:                   ['presentado'],
  presentado:                 ['en_revision', 'cerrado_sin_implementacion'],
  en_revision:                ['admitido', 'cerrado_sin_implementacion'],
  admitido:                   ['asignado'],
  asignado:                   ['en_ejecucion', 'pausado'],
  en_ejecucion:               ['pausado', 'pendiente_tercero', 'pendiente_decision', 'revision_final'],
  pausado:                    ['en_ejecucion', 'cerrado_sin_implementacion'],
  pendiente_tercero:          ['en_ejecucion', 'pausado'],
  pendiente_decision:         ['en_ejecucion', 'pausado', 'cerrado_sin_implementacion'],
  revision_final:             ['cumplido', 'en_ejecucion'],
  cumplido:                   ['archivado'],
  cerrado_sin_implementacion: ['archivado'],
  archivado:                  [],
}

// ---------------------------------------------------------------------------
// Urgencias (reutiliza PriorityValue pero con contexto propio)
// ---------------------------------------------------------------------------

export const EXPEDIENTE_URGENCIES: Record<ExpedienteUrgency, { label: string; color: string; bg: string }> = {
  baja:    { label: 'Baja',    color: '#a39e97', bg: '#f3efe9' },
  media:   { label: 'Media',   color: '#d4943a', bg: '#fdf6ec' },
  alta:    { label: 'Alta',    color: '#ea504c', bg: '#fef2f2' },
  critica: { label: 'Crítica', color: '#dc2626', bg: '#fef2f2' },
}

// ---------------------------------------------------------------------------
// Impacto
// ---------------------------------------------------------------------------

export const IMPACT_CATEGORIES = [
  { value: 'ventas',       label: 'Ventas',       icon: '💰' },
  { value: 'operacion',    label: 'Operación',    icon: '⚙️' },
  { value: 'experiencia',  label: 'Experiencia',  icon: '✨' },
  { value: 'marca',        label: 'Marca',        icon: '🎯' },
  { value: 'costos',       label: 'Costos',       icon: '📉' },
  { value: 'mantenimiento', label: 'Mantenimiento', icon: '🔧' },
  { value: 'innovacion',   label: 'Innovación',   icon: '🚀' },
] as const
