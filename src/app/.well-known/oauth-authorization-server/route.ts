import { NextResponse } from 'next/server'
import { MCP_BASE, SCOPE } from '@/lib/mcp/oauth'

// Metadatos del servidor de autorización (RFC 8414)
export function GET() {
  return NextResponse.json({
    issuer: MCP_BASE,
    authorization_endpoint: `${MCP_BASE}/mcp/autorizar`,
    token_endpoint: `${MCP_BASE}/api/mcp/oauth/token`,
    registration_endpoint: `${MCP_BASE}/api/mcp/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE, 'offline_access'],
  })
}
