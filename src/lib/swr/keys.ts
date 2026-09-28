// ---------------------------------------------------------------------------
// Centralized SWR cache keys — prevents key drift and makes invalidation safe
// ---------------------------------------------------------------------------

export const SWR_KEYS = {
  // Profile
  profile: (userId: string) => ['profile', userId] as const,

  // Attendance
  attendance: (userId: string, date: string) => ['attendance', userId, date] as const,
  attendanceTeam: (date: string) => ['attendance_team', date] as const,
  attendanceHistory: (userId: string, limit: number) => ['attendance_history', userId, limit] as const,

  // Shifts
  nextShift: (userId: string) => ['next_shift', userId] as const,

  // Announcements
  announcements: () => ['announcements'] as const,

  // Stock
  stockItems: (active?: boolean) => ['stock_items', { active }] as const,
  barStock: () => ['bar_stock'] as const,
  barOrders: () => ['bar_orders'] as const,

  // Orders
  pendingOrders: () => ['pending_orders'] as const,

  // Expedientes
  expedientes: (params: Record<string, string>) => ['expedientes', params] as const,

  // Dashboard
  dashboardKpis: (userId: string, date: string) => ['dashboard_kpis', userId, date] as const,
  adminKpis: (date: string) => ['admin_kpis', date] as const,

  // Ventas
  ventasHoy: () => ['ventas_hoy'] as const,

  // Producción
  produccionOrders: (days: number) => ['produccion_orders', days] as const,

  // Fudo
  fudoSync: () => ['fudo_sync'] as const,

  // Profiles list (for equipo)
  profilesList: (includeInactive: boolean) => ['profiles_list', { includeInactive }] as const,

  // Bar
  barConsumption: () => ['bar_consumption'] as const,
  barHandover: () => ['bar_handover'] as const,
}
