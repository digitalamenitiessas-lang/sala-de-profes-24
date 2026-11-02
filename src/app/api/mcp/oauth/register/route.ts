import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { redirectValido } from '@/lib/mcp/oauth'

// POST /api/mcp/oauth/register — registro dinámico (RFC 7591). No guarda nada:
// cualquiera puede registrarse, pero solo se aceptan los redirect_uri de Claude
// y después hay que iniciar sesión como socio. Cliente público con PKCE.
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const b = await request.json().catch(() => null) as { redirect_uris?: unknown; client_name?: unknown } | null
  const uris = Array.isArray(b?.redirect_uris) ? b.redirect_uris : []
  if (uris.length === 0 || !uris.every(redirectValido)) {
    return NextResponse.json({ error: 'invalid_redirect_uri', error_description: 'Este servidor solo acepta los redirect_uri de Claude' }, { status: 400 })
  }
  return NextResponse.json({
    client_id: `lve_${randomBytes(16).toString('hex')}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: typeof b?.client_name === 'string' ? b.client_name.slice(0, 100) : 'Claude',
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
}
