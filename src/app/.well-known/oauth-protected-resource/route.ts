import { NextResponse } from 'next/server'
import { MCP_BASE, MCP_URL, SCOPE } from '@/lib/mcp/oauth'

// Metadatos del recurso (RFC 9728): dónde iniciar sesión para usar /api/mcp
export function GET() {
  return NextResponse.json({ resource: MCP_URL, authorization_servers: [MCP_BASE], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'Fudo · La Vieja Escuela 24' })
}
