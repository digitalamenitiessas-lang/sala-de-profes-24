import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// OAuth del conector de Fudo para claude.ai
// ---------------------------------------------------------------------------
// Authorization code + PKCE S256, como pide Claude
// (https://claude.com/docs/connectors/building/authentication):
//   · Entran solo SOCIOS activos, con su usuario de Sala de Profes. Se vuelve a
//     controlar en cada llamada: si alguien deja de ser socio, deja de entrar.
//   · El registro dinámico no guarda nada: lo que protege es que el redirect_uri
//     tiene que ser uno de los de Claude (lista cerrada).
//   · En la base solo queda el hash de cada código y token.
//   · Los refresh tokens se rotan. Reusar uno ya gastado corta toda la conexión
//     (salvo en los primeros 60 s: Claude puede renovar dos veces a la vez).
// Para desconectar a alguien: poner revoked_at en sus filas de mcp_oauth_tokens.
// ---------------------------------------------------------------------------

// Sala de Profes 24 (VPS). Santa Fe tiene su propio conector en su dominio.
export const MCP_BASE = 'https://lve24.com.ar'
export const MCP_URL = `${MCP_BASE}/api/mcp`
export const METADATA_RECURSO = `${MCP_BASE}/.well-known/oauth-protected-resource`
export const SCOPE = 'fudo.read'

const REDIRECTS_CLAUDE = new Set(['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'])
export const redirectValido = (uri: unknown): uri is string => typeof uri === 'string' && REDIRECTS_CLAUDE.has(uri)

const CODE_MIN = 5
const ACCESS_SEG = 3600
const REFRESH_DIAS = 30
const GRACIA_REUSO_SEG = 60

const hash = (t: string) => createHash('sha256').update(t).digest('hex')
const nuevoToken = (prefijo: string) => `${prefijo}_${randomBytes(32).toString('base64url')}`
const enSegundos = (s: number) => new Date(Date.now() + s * 1000).toISOString()

/** Parámetros del pedido de autorización, ya validados. */
export type PedidoAutorizacion = { clientId: string; redirectUri: string; codeChallenge: string; state: string | null; scope: string }

/**
 * Valida el pedido. Si el redirect_uri no es de Claude devuelve error SIN
 * redirigir: mandar a alguien a una dirección que no conocemos sería el agujero.
 */
export function validarPedido(p: Record<string, string | undefined>): { ok: true; pedido: PedidoAutorizacion } | { ok: false; error: string } {
  if (!redirectValido(p.redirect_uri)) return { ok: false, error: 'La aplicación que pide acceso no es Claude (dirección de retorno no permitida).' }
  if (!p.client_id || p.client_id.length > 200) return { ok: false, error: 'Falta el identificador de la aplicación.' }
  if (p.response_type !== 'code') return { ok: false, error: 'Tipo de respuesta no soportado.' }
  if (p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(p.code_challenge ?? '')) return { ok: false, error: 'Falta la protección PKCE (S256).' }
  if (p.resource && p.resource !== MCP_URL) return { ok: false, error: 'El pedido es para otro servidor.' }
  if ((p.state?.length ?? 0) > 2000) return { ok: false, error: 'Pedido inválido.' }
  return { ok: true, pedido: { clientId: p.client_id, redirectUri: p.redirect_uri, codeChallenge: p.code_challenge!, state: p.state || null, scope: SCOPE } }
}

/** Nombre para la auditoría */
export async function nombreDe(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('first_name, last_name').eq('id', userId).maybeSingle()
  return [data?.first_name, data?.last_name].filter(Boolean).join(' ') || null
}

/** ¿Es un socio activo? */
export async function esSocioActivo(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('role, is_active').eq('id', userId).maybeSingle()
  return data?.role === 'socio' && data?.is_active === true
}

export async function crearCodigo(admin: SupabaseClient, userId: string, p: PedidoAutorizacion): Promise<string> {
  const codigo = nuevoToken('lve_ac')
  const { error } = await admin.from('mcp_oauth_tokens').insert({
    token_hash: hash(codigo), kind: 'code', family_id: randomUUID(), user_id: userId, client_id: p.clientId,
    redirect_uri: p.redirectUri, code_challenge: p.codeChallenge, scope: p.scope, expires_at: enSegundos(CODE_MIN * 60),
  })
  if (error) throw new Error(error.message)
  // De paso, limpiar lo vencido hace más de una semana
  await admin.from('mcp_oauth_tokens').delete().lt('expires_at', new Date(Date.now() - 7 * 86_400_000).toISOString()).then(() => null, () => null)
  return codigo
}

type Fila = {
  id: string; family_id: string; user_id: string; client_id: string; redirect_uri: string | null
  code_challenge: string | null; scope: string; expires_at: string; used_at: string | null; revoked_at: string | null
}
const COLUMNAS = 'id, family_id, user_id, client_id, redirect_uri, code_challenge, scope, expires_at, used_at, revoked_at'
const revocarFamilia = (admin: SupabaseClient, familia: string) =>
  admin.from('mcp_oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('family_id', familia).is('revoked_at', null)

/** Marca la fila como usada. false = otro proceso la gastó primero. */
async function gastar(admin: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await admin.from('mcp_oauth_tokens').update({ used_at: new Date().toISOString() }).eq('id', id).is('used_at', null).select('id')
  return (data ?? []).length > 0
}

async function emitirTokens(admin: SupabaseClient, f: Pick<Fila, 'family_id' | 'user_id' | 'client_id' | 'scope'>) {
  const access = nuevoToken('lve_at')
  const refresh = nuevoToken('lve_rt')
  const comun = { family_id: f.family_id, user_id: f.user_id, client_id: f.client_id, scope: f.scope }
  const { error } = await admin.from('mcp_oauth_tokens').insert([
    { ...comun, token_hash: hash(access), kind: 'access', expires_at: enSegundos(ACCESS_SEG) },
    { ...comun, token_hash: hash(refresh), kind: 'refresh', expires_at: enSegundos(REFRESH_DIAS * 86_400) },
  ])
  if (error) throw new Error(error.message)
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_SEG, refresh_token: refresh, scope: f.scope }
}

export type RespuestaToken = { ok: true; tokens: Awaited<ReturnType<typeof emitirTokens>> } | { ok: false; error: string; descripcion: string }
const rechazo = (descripcion: string, error = 'invalid_grant'): RespuestaToken => ({ ok: false, error, descripcion })

export async function canjearCodigo(admin: SupabaseClient, p: { code?: string; clientId?: string; redirectUri?: string; verifier?: string }): Promise<RespuestaToken> {
  if (!p.code || !p.verifier || !p.redirectUri || !p.clientId) return rechazo('Faltan datos', 'invalid_request')
  const { data } = await admin.from('mcp_oauth_tokens').select(COLUMNAS).eq('token_hash', hash(p.code)).eq('kind', 'code').maybeSingle()
  const f = data as Fila | null
  if (!f) return rechazo('Código inválido')
  // Un código usado dos veces puede ser robado: se corta todo lo que salió de él
  if (f.used_at) { await revocarFamilia(admin, f.family_id); return rechazo('Código ya usado') }
  if (f.revoked_at || Date.parse(f.expires_at) < Date.now()) return rechazo('Código vencido')
  if (f.client_id !== p.clientId || f.redirect_uri !== p.redirectUri) return rechazo('El código es de otra aplicación')
  const calculado = Buffer.from(createHash('sha256').update(p.verifier).digest('base64url'))
  const esperado = Buffer.from(f.code_challenge ?? '')
  if (calculado.length !== esperado.length || !timingSafeEqual(calculado, esperado)) return rechazo('PKCE inválido')
  if (!(await esSocioActivo(admin, f.user_id))) return rechazo('Solo los socios pueden conectarse')
  if (!(await gastar(admin, f.id))) return rechazo('Código ya usado')
  return { ok: true, tokens: await emitirTokens(admin, f) }
}

export async function canjearRefresh(admin: SupabaseClient, p: { refresh?: string; clientId?: string }): Promise<RespuestaToken> {
  if (!p.refresh) return rechazo('Falta el refresh token', 'invalid_request')
  const { data } = await admin.from('mcp_oauth_tokens').select(COLUMNAS).eq('token_hash', hash(p.refresh)).eq('kind', 'refresh').maybeSingle()
  const f = data as Fila | null
  if (!f) return rechazo('Refresh token inválido')
  if (f.revoked_at || Date.parse(f.expires_at) < Date.now()) return rechazo('Refresh token vencido')
  if (p.clientId && f.client_id !== p.clientId) return rechazo('El token es de otra aplicación')
  if (f.used_at) {
    if (Date.now() - Date.parse(f.used_at) > GRACIA_REUSO_SEG * 1000) await revocarFamilia(admin, f.family_id)
    return rechazo('Refresh token ya usado')
  }
  if (!(await esSocioActivo(admin, f.user_id))) { await revocarFamilia(admin, f.family_id); return rechazo('Solo los socios pueden conectarse') }
  if (!(await gastar(admin, f.id))) return rechazo('Refresh token ya usado')
  return { ok: true, tokens: await emitirTokens(admin, f) }
}

/** Devuelve el id del socio dueño del token, o null si no vale. */
export async function autenticarBearer(admin: SupabaseClient, authorization: string | null): Promise<string | null> {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!token) return null
  const { data } = await admin.from('mcp_oauth_tokens').select('user_id, expires_at, revoked_at').eq('token_hash', hash(token)).eq('kind', 'access').maybeSingle()
  if (!data || data.revoked_at || Date.parse(data.expires_at) < Date.now()) return null
  return (await esSocioActivo(admin, data.user_id)) ? data.user_id : null
}
