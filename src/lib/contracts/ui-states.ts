// ---------------------------------------------------------------------------
// UI States — Standard states for all modules
// ---------------------------------------------------------------------------
// Every data-fetching component MUST use these states explicitly.
// Never show stale data as current. Never show empty as error.
// ---------------------------------------------------------------------------

export type DataState = 'loading' | 'empty' | 'error' | 'success' | 'stale' | 'partial'

/**
 * Standard empty state messages by domain.
 * Use these instead of generic "No hay datos".
 * Each has: message (what happened) + hint (what to do).
 */
export const EMPTY_MESSAGES: Record<string, { message: string; hint: string }> = {
  // Stock
  stock: {
    message: 'No hay items de stock cargados',
    hint: 'Sincronizá con Fudo o agregá items manualmente.',
  },
  stock_critical: {
    message: 'Sin items críticos',
    hint: 'Todo el stock está dentro de los niveles esperados.',
  },

  // Ventas
  ventas: {
    message: 'Sin datos de ventas',
    hint: 'Fudo no devolvió ventas para hoy. Verificá la conexión.',
  },
  ventas_sync: {
    message: 'Sincronizando con Fudo...',
    hint: 'Los datos pueden tardar unos segundos en cargarse.',
  },

  // Expedientes
  expedientes: {
    message: 'No hay expedientes',
    hint: 'Creá el primer expediente tocando +.',
  },
  expedientes_filtered: {
    message: 'No hay expedientes con estos filtros',
    hint: 'Probá cambiando los filtros o buscando otro término.',
  },

  // Notificaciones
  notificaciones: {
    message: 'Sin avisos pendientes',
    hint: 'Cuando haya novedades, van a aparecer acá.',
  },

  // Turnos
  turnos: {
    message: 'Sin turnos programados',
    hint: 'El encargado puede cargar turnos manualmente o subir un Excel.',
  },
  turnos_week: {
    message: 'Sin turnos esta semana',
    hint: 'Consultá con tu encargado para que te asigne turno.',
  },

  // Proveedores
  proveedores: {
    message: 'Sin proveedores cargados',
    hint: 'Sincronizá con Fudo o agregá proveedores manualmente.',
  },

  // Recetas
  recetas: {
    message: 'Sin recetas cargadas',
    hint: 'Agregá la primera receta tocando +.',
  },

  // Pedidos
  pedidos: {
    message: 'Sin pedidos pendientes',
    hint: 'Los pedidos de cocina y barra aparecerán acá.',
  },

  // Vajilla
  vajilla: {
    message: 'Sin items de vajilla',
    hint: 'Agregá items con el botón +.',
  },

  // Equipo
  equipo: {
    message: 'Nadie registrado hoy',
    hint: 'El equipo aparecerá al marcar ingreso.',
  },
}

/**
 * Standard error messages.
 */
export const ERROR_MESSAGES: Record<string, string> = {
  network: 'Error de conexión. Verificá tu internet e intentá de nuevo.',
  auth: 'Tu sesión expiró. Volvé a iniciar sesión.',
  permission: 'No tenés permisos para ver esta información.',
  server: 'Error del servidor. Intentá de nuevo en unos minutos.',
  fudo: 'No se pudo conectar con Fudo. Los datos pueden estar desactualizados.',
  unknown: 'Ocurrió un error inesperado.',
}

/**
 * Classify a fetch error into a standard type.
 */
export function classifyError(error: unknown): { type: string; message: string } {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('network') || msg.includes('fetch')) return { type: 'network', message: ERROR_MESSAGES.network }
    if (msg.includes('401') || msg.includes('autenticado')) return { type: 'auth', message: ERROR_MESSAGES.auth }
    if (msg.includes('403') || msg.includes('permiso')) return { type: 'permission', message: ERROR_MESSAGES.permission }
    if (msg.includes('fudo') || msg.includes('rate')) return { type: 'fudo', message: ERROR_MESSAGES.fudo }
    return { type: 'server', message: error.message }
  }
  return { type: 'unknown', message: ERROR_MESSAGES.unknown }
}
