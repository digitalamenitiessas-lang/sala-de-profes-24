import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// WiFi del local
// ---------------------------------------------------------------------------
// Adentro del local el GPS del celular suele fallar (en LVE alguien fichó
// "a 1291 m" estando ahí). Si el celular está conectado al WiFi del local, sale a
// internet con la IP pública del local: con eso alcanza para fichar, sin GPS.
// Las IPs se guardan en attendance_config (key 'redes_local'); el encargado
// registra la red desde Mi turno si el proveedor la cambia.
// ---------------------------------------------------------------------------

const CLAVE = 'redes_local'

/** IP pública desde la que llega el pedido (Vercel la pone en x-forwarded-for). */
export function ipDelPedido(h: Headers): string | null {
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null
}

export async function ipsDelLocal(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.from('attendance_config').select('value').eq('key', CLAVE).maybeSingle()
  const ips = (data?.value as { ips?: unknown } | null)?.ips
  return Array.isArray(ips) ? ips.filter((x): x is string => typeof x === 'string') : []
}

export async function esRedDelLocal(admin: SupabaseClient, ip: string | null): Promise<boolean> {
  if (!ip) return false
  return (await ipsDelLocal(admin)).includes(ip)
}

/** Suma la IP a las redes del local (guarda las últimas 5: el proveedor puede rotarla). */
export async function registrarRedDelLocal(admin: SupabaseClient, ip: string): Promise<string[]> {
  const ips = [ip, ...(await ipsDelLocal(admin)).filter((x) => x !== ip)].slice(0, 5)
  const { error } = await admin.from('attendance_config').upsert({ key: CLAVE, value: { ips } }, { onConflict: 'key' })
  if (error) throw error
  return ips
}
