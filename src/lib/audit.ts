// ---------------------------------------------------------------------------
// Centralized Audit Trail Logger
// ---------------------------------------------------------------------------
// Non-blocking, fire-and-forget. Works with both admin and user Supabase clients.
// Usage:
//   import { logAudit } from '@/lib/audit'
//   await logAudit(supabase, { ... })   // or just logAudit(supabase, { ... }) without await
// ---------------------------------------------------------------------------

import { SupabaseClient } from '@supabase/supabase-js'

export type AuditParams = {
  userId: string | null
  userName: string | null
  action: string
  module: 'stock' | 'barra' | 'cocina' | 'pedidos' | 'avisos' | 'expedientes' | 'vajilla' | 'asistencia' | 'equipo' | 'recetas' | 'proveedores' | 'auth' | 'produccion' | 'configuracion' | 'turnos'
  entityType?: string
  entityId?: string
  description: string
  metadata?: Record<string, unknown>
}

/**
 * Log an action to the audit_trail table.
 * Always non-blocking — errors are silently caught and logged to console.
 */
export async function logAudit(
  supabase: SupabaseClient,
  params: AuditParams,
): Promise<void> {
  try {
    await supabase.from('audit_trail').insert({
      user_id: params.userId,
      user_name: params.userName,
      action: params.action,
      module: params.module,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      description: params.description,
      metadata: params.metadata ?? null,
    })
  } catch (err) {
    console.error('[audit]', err)
  }
}

/**
 * Client-side audit — sends to /api/audit endpoint.
 * Use this from client components that don't have a server Supabase client.
 * Completely fire-and-forget.
 */
export function logAuditClient(params: AuditParams): void {
  fetch('/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => { /* silent */ })
}
