import { SupabaseClient } from '@supabase/supabase-js'

export type FudoSyncStatus = 'pending' | 'success' | 'failed' | 'skipped'
export type FudoSyncDirection = 'fudo_to_lve' | 'lve_to_fudo' | 'read'
export type FudoEntityType = 'ingredient' | 'product' | 'sale' | 'provider'
export type FudoIncidentSeverity = 'low' | 'medium' | 'high' | 'critical'

type SyncEventInput = {
  operation: string
  direction: FudoSyncDirection
  entityType?: string | null
  entityId?: string | number | null
  stockItemId?: string | number | null
  fudoType?: FudoEntityType | null
  fudoId?: string | number | null
  idempotencyKey?: string | null
  requestPayload?: Record<string, unknown>
  createdBy?: string | null
}

type IncidentInput = {
  source: string
  code: string
  severity: FudoIncidentSeverity
  entityType?: string | null
  entityId?: string | number | null
  stockItemId?: string | number | null
  fudoType?: FudoEntityType | null
  fudoId?: string | number | null
  title: string
  detail?: string | null
  payload?: Record<string, unknown>
}

function stringifyId(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

export async function createFudoSyncEvent(
  admin: SupabaseClient,
  input: SyncEventInput,
): Promise<string | null> {
  const payload = {
    operation: input.operation,
    direction: input.direction,
    status: 'pending' as FudoSyncStatus,
    entity_type: input.entityType ?? null,
    entity_id: stringifyId(input.entityId),
    stock_item_id: stringifyId(input.stockItemId),
    fudo_type: input.fudoType ?? null,
    fudo_id: stringifyId(input.fudoId),
    idempotency_key: input.idempotencyKey ?? null,
    request_payload: input.requestPayload ?? {},
    created_by: input.createdBy ?? null,
    updated_at: new Date().toISOString(),
  }

  const query = input.idempotencyKey
    ? admin.from('fudo_sync_events').upsert(payload, { onConflict: 'idempotency_key' })
    : admin.from('fudo_sync_events').insert(payload)

  const { data, error } = await query.select('id').single()
  if (error) {
    console.warn('[fudo_sync_events] create failed', error.message)
    return null
  }

  return (data as { id: string }).id
}

export async function finishFudoSyncEvent(
  admin: SupabaseClient,
  eventId: string | null,
  status: FudoSyncStatus,
  options: {
    responsePayload?: Record<string, unknown> | null
    errorMessage?: string | null
  } = {},
) {
  if (!eventId) return

  const { error } = await admin
    .from('fudo_sync_events')
    .update({
      status,
      response_payload: options.responsePayload ?? null,
      error_message: options.errorMessage ?? null,
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq('id', eventId)

  if (error) {
    console.warn('[fudo_sync_events] finish failed', error.message)
  }
}

export async function recordFudoIncident(
  admin: SupabaseClient,
  input: IncidentInput,
) {
  const key = incidentKey({
    source: input.source,
    code: input.code,
    entity_type: input.entityType,
    entity_id: input.entityId,
    stock_item_id: input.stockItemId,
    fudo_type: input.fudoType,
    fudo_id: input.fudoId,
  })

  const payload = {
    source: input.source,
    code: input.code,
    severity: input.severity,
    status: 'open',
    entity_type: input.entityType ?? null,
    entity_id: stringifyId(input.entityId),
    stock_item_id: stringifyId(input.stockItemId),
    fudo_type: input.fudoType ?? null,
    fudo_id: stringifyId(input.fudoId),
    incident_key: key,
    title: input.title,
    detail: input.detail ?? null,
    payload: input.payload ?? {},
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { error } = await admin
    .from('fudo_sync_incidents')
    .upsert(payload, {
      onConflict: 'incident_key',
    })

  if (error) {
    console.warn('[fudo_sync_incidents] upsert failed', error.message)
  }
}

/**
 * Resuelve todos los incidentes abiertos de escritura para un stock_item específico.
 * Llamar después de una escritura exitosa en Fudo para limpiar failures previos del item.
 */
export async function resolveItemIncidents(
  admin: SupabaseClient,
  stockItemId: string,
) {
  const { error } = await admin
    .from('fudo_sync_incidents')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('stock_item_id', stockItemId)
    .eq('status', 'open')

  if (error) {
    console.warn('[fudo_sync_incidents] resolveItemIncidents failed', error.message)
  }
}

/**
 * Resuelve todos los incidentes abiertos de un source dado (sin distinción de item).
 * Útil cuando una operación a nivel global tuvo éxito (ej: sync de lectura exitosa
 * después de un fallo previo).
 */
export async function resolveSourceIncidents(
  admin: SupabaseClient,
  source: string,
) {
  const { error } = await admin
    .from('fudo_sync_incidents')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('source', source)
    .eq('status', 'open')

  if (error) {
    console.warn('[fudo_sync_incidents] resolveSourceIncidents failed', error.message)
  }
}

export async function resolveMissingFudoIncidents(
  admin: SupabaseClient,
  source: string,
  activeKeys: Set<string>,
) {
  const { data, error } = await admin
    .from('fudo_sync_incidents')
    .select('id, incident_key, source, code, entity_type, entity_id, stock_item_id, fudo_type, fudo_id')
    .eq('source', source)
    .eq('status', 'open')

  if (error) {
    console.warn('[fudo_sync_incidents] read failed', error.message)
    return
  }

  // Comparar por la clave guardada. Antes se recalculaba sin `source`, nunca
  // coincidía y la auditoría cerraba TODOS sus incidentes al terminar.
  const staleIds = (data ?? [])
    .filter((row) => !activeKeys.has(row.incident_key ?? incidentKey(row)))
    .map((row) => row.id)

  if (staleIds.length === 0) return

  const { error: updateError } = await admin
    .from('fudo_sync_incidents')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', staleIds)

  if (updateError) {
    console.warn('[fudo_sync_incidents] resolve failed', updateError.message)
  }
}

export function incidentKey(input: {
  source?: string | null
  code: string
  entity_type?: string | null
  entity_id?: string | number | null
  stock_item_id?: string | number | null
  fudo_type?: string | null
  fudo_id?: string | number | null
}) {
  return [
    input.source ?? '',
    input.code,
    input.entity_type ?? '',
    stringifyId(input.entity_id) ?? '',
    stringifyId(input.stock_item_id) ?? '',
    input.fudo_type ?? '',
    stringifyId(input.fudo_id) ?? '',
  ].join('|')
}
