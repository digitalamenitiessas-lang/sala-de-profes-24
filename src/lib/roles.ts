import type { AppRole } from '@/types/database'

/**
 * Roles with full management access (socio = superadmin, encargado = manager).
 * Use this everywhere instead of checking `role === 'encargado'` individually.
 */
const MANAGER_ROLES: ReadonlySet<string> = new Set(['socio', 'encargado'])

/**
 * Socios que SÍ deben fichar (excepción a la regla general de que los socios no fichan).
 * Se listan por UUID para evitar colisiones por nombre.
 */
const SOCIOS_QUE_FICHAN: ReadonlySet<string> = new Set([
  'd058c880-9ec3-4205-be49-84476da0b2d6', // Ricardo Marquez
])

/** ¿Este perfil debe fichar ingreso/egreso? */
export function mustClockIn(
  profile: { id: string; role: string | AppRole | null | undefined } | null | undefined,
): boolean {
  if (!profile?.role) return false
  if (profile.role === 'socio') return SOCIOS_QUE_FICHAN.has(profile.id)
  return true
}

/** Can this role manage the business? (socio + encargado) */
export function isManagerOrAbove(role: string | AppRole | null | undefined): boolean {
  return !!role && MANAGER_ROLES.has(role)
}

/** Is this the highest role? (socio only) */
export function isSocio(role: string | AppRole | null | undefined): boolean {
  return role === 'socio'
}

/** Can this role access kitchen operations? */
export function isKitchenRole(role: string | AppRole | null | undefined): boolean {
  return !!role && (MANAGER_ROLES.has(role) || role === 'chef' || role === 'cocina')
}

/**
 * ¿Puede contar stock y registrar movimientos? Cocina cuenta su área y barra
 * cuenta la suya: si el barista no entra, el área "barra" no la cuenta nadie.
 */
export function canCountStock(role: string | AppRole | null | undefined): boolean {
  return !!role && (MANAGER_ROLES.has(role) || role === 'chef' || role === 'cocina' || role === 'barista')
}

/** Can this role create kitchen orders? */
export function canCreateKitchenOrders(role: string | AppRole | null | undefined): boolean {
  return !!role && (MANAGER_ROLES.has(role) || role === 'chef' || role === 'cocina')
}
