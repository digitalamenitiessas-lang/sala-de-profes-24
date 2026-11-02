import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { canjearCodigo, canjearRefresh, MCP_URL } from '@/lib/mcp/oauth'

// POST /api/mcp/oauth/token — canje de código y renovación (form-urlencoded, RFC 6749)
export const dynamic = 'force-dynamic'
const SIN_CACHE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' }

export async function POST(request: Request) {
  const f = new URLSearchParams(await request.text())
  const error = (e: string, d: string, status = 400) => NextResponse.json({ error: e, error_description: d }, { status, headers: SIN_CACHE })
  const resource = f.get('resource')
  if (resource && resource !== MCP_URL) return error('invalid_target', 'El token es para otro servidor')
  const clientId = f.get('client_id') ?? undefined
  try {
    const admin = createAdminClient() as unknown as SupabaseClient
    const grant = f.get('grant_type')
    const r = grant === 'authorization_code'
      ? await canjearCodigo(admin, { code: f.get('code') ?? undefined, clientId, redirectUri: f.get('redirect_uri') ?? undefined, verifier: f.get('code_verifier') ?? undefined })
      : grant === 'refresh_token'
        ? await canjearRefresh(admin, { refresh: f.get('refresh_token') ?? undefined, clientId })
        : null
    if (!r) return error('unsupported_grant_type', 'Solo authorization_code y refresh_token')
    if (!r.ok) return error(r.error, r.descripcion)
    return NextResponse.json(r.tokens, { headers: SIN_CACHE })
  } catch (err) {
    console.error('[mcp/oauth/token]', err)
    return error('server_error', 'Error interno', 500)
  }
}
