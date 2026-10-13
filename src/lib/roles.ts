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
  // '<uuid del perfil>', // Nombre Apellido
])

/** ¿Este perfil debe fichar ingreso/egreso? */
export function mustClockIn(
  profile: { id: string; role: string | AppRole | null | undefined } | null | undefined,
): boolean {
  if (!profile?.role) return false
  if (profile.role === 'socio') return SOCIOS_QUE_FICHAN.has(profile.id)
  return true
}

/**
 * Roles que un encargado puede crear y administrar: de encargado para abajo.
 * A un socio solo lo crea o administra otro socio.
 */
export const ENCARGADO_MANAGED_ROLES: readonly AppRole[] = ['encargado', 'cajero', 'chef', 'cocina', 'barista', 'runner', 'bacha']

/**
 * Puesto que se muestra y que se usa por defecto en los turnos. El cajero
 * tiene permisos de encargado (profiles.role = 'encargado') y su puesto queda
 * en profiles.puesto = 'cajero' (la base lo convierte al elegir "cajero").
 */
export function puestoDe(p: { role: AppRole | string; puesto?: AppRole | string | null }): AppRole {
  return (p.puesto ?? p.role) as AppRole
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
