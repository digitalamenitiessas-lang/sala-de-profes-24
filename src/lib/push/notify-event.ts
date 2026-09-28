import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToUser } from './send'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// Notificaciones push por evento — configurable por el administrador (socio)
// ---------------------------------------------------------------------------
// Guarda la config en app_settings (key='notification_events', value=jsonb)
// para no requerir una migración nueva. Cada evento define: si está activo,
// qué roles lo reciben y qué usuarios puntuales lo reciben siempre.
// ---------------------------------------------------------------------------

export type NotificationEventConfig = {
  label: string
  description: string
  enabled: boolean
  target_roles: AppRole[]
  target_user_ids: string[]
}

export const DEFAULT_NOTIFICATION_EVENTS: Record<string, NotificationEventConfig> = {
  purchase_created: {
    label: 'Se genera un pedido/compra',
    description: 'Cuando cocina o barra crea un pedido a un proveedor.',
    enabled: true,
    target_roles: ['socio'],
    target_user_ids: [],
  },
  stock_adjusted: {
    label: 'Se modifica stock',
    description: 'Conteo físico (puesta a cero) o ajuste manual de un insumo.',
    enabled: true,
    target_roles: ['socio'],
    target_user_ids: [],
  },
  production_completed: {
    label: 'Se completa una producción',
    description: 'Cuando una orden de producción queda validada y descuenta stock.',
    enabled: true,
    target_roles: ['socio'],
    target_user_ids: [],
  },
  sales_summary_shift: {
    label: 'Resumen de lo más vendido por turno',
    description: 'A las 15hs (cierre de mañana) y 23hs (cierre de tarde/noche).',
    enabled: true,
    target_roles: ['socio'],
    target_user_ids: [],
  },
  business_alerts: {
    label: 'Alertas del negocio (parte semanal)',
    description: 'Food cost, insumos que se encarecieron y platos con mal margen, cada lunes.',
    enabled: true,
    target_roles: ['socio'],
    target_user_ids: [],
  },
  expiry_alerts: {
    label: 'Productos por vencer',
    description: 'Aviso diario cuando un lote está por vencer: promocionar, usar o descartar.',
    enabled: true,
    target_roles: ['socio', 'encargado'],
    target_user_ids: [],
  },
  parallel_drift: {
    label: 'Paralelo LVE vs Fudo',
    description: 'Divergencia diaria entre el motor de stock propio y Fudo.',
    enabled: true,
    target_roles: ['socio'],
    target_user_ids: [],
  },
  conteo_diario_hecho: {
    label: 'Conteo diario de elaborados',
    description: 'Cuando alguien carga el conteo del día: qué hay de cada elaborado y el comentario (reemplaza el mensaje del grupo).',
    enabled: true,
    target_roles: ['socio', 'encargado', 'chef'],
    target_user_ids: [],
  },
  fudo_problema: {
    label: 'Problemas con Fudo',
    description: 'Cuando Fudo no responde hace más de 30 minutos (y cuando vuelve), o cuando algo lleva una hora sin poder entrar a Fudo.',
    enabled: true,
    target_roles: ['socio'],
    target_user_ids: [],
  },
  conteo_diario_pendiente: {
    label: 'Falta el conteo diario de elaborados',
    description: 'A las 23 hs, si todavía no se contó ningún elaborado en el día.',
    enabled: true,
    target_roles: ['socio', 'encargado', 'chef'],
    target_user_ids: [],
  },
  sales_summary_daily: {
    label: 'Top 5 platos del día',
    description: 'Notificación a las 23:30 con los 5 platos más vendidos del día completo.',
    enabled: true,
    target_roles: ['socio', 'encargado', 'chef', 'barista', 'runner', 'cocina', 'bacha'],
    target_user_ids: [],
  },
}

export type NotificationEventKey = keyof typeof DEFAULT_NOTIFICATION_EVENTS

const SETTINGS_KEY = 'notification_events'

export async function getNotificationSettings(
  admin: SupabaseClient,
): Promise<Record<string, NotificationEventConfig>> {
  const { data } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', SETTINGS_KEY)
    .maybeSingle()

  const stored = (data?.value as Record<string, Partial<NotificationEventConfig>>) ?? {}

  // Merge defaults con lo guardado — así los eventos nuevos que se agreguen
  // en código aparecen con su default sin necesitar migrar el JSON guardado.
  const merged: Record<string, NotificationEventConfig> = {}
  for (const [key, def] of Object.entries(DEFAULT_NOTIFICATION_EVENTS)) {
    merged[key] = { ...def, ...(stored[key] ?? {}) }
  }
  return merged
}

export async function saveNotificationSetting(
  admin: SupabaseClient,
  eventKey: string,
  patch: Partial<Pick<NotificationEventConfig, 'enabled' | 'target_roles' | 'target_user_ids'>>,
  updatedBy: string | null,
): Promise<Record<string, NotificationEventConfig>> {
  const current = await getNotificationSettings(admin)
  if (!current[eventKey]) throw new Error(`Evento desconocido: ${eventKey}`)

  current[eventKey] = { ...current[eventKey], ...patch }

  await admin.from('app_settings').upsert({
    key: SETTINGS_KEY,
    value: current,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  })

  return current
}

/**
 * Dispara push real para un evento, respetando la config del administrador.
 * No hace nada si el evento está deshabilitado o sin destinatarios.
 */
export async function notifyEvent(
  admin: SupabaseClient,
  eventKey: NotificationEventKey,
  payload: { title: string; body: string; url?: string },
  options?: {
    /** Quien disparó el evento: se excluye del push (no se autonotifica) */
    excludeUserId?: string | null
  },
): Promise<void> {
  const settings = await getNotificationSettings(admin)
  const cfg = settings[eventKey]
  if (!cfg?.enabled) return

  const targetIds = new Set<string>(cfg.target_user_ids ?? [])

  if (cfg.target_roles?.length) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id')
      .in('role', cfg.target_roles)
      .eq('is_active', true)
    for (const p of profiles ?? []) targetIds.add(p.id)
  }

  if (options?.excludeUserId) targetIds.delete(options.excludeUserId)

  if (targetIds.size === 0) return

  await Promise.allSettled(
    [...targetIds].map((userId) => sendPushToUser(userId, payload)),
  )
}
