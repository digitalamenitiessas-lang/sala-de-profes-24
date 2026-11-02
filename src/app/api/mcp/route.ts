import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createAdminClient } from '@/lib/supabase/admin'
import { autenticarBearer, METADATA_RECURSO, nombreDe, SCOPE } from '@/lib/mcp/oauth'
import { crearServidorFudo } from '@/lib/mcp/fudo-servidor'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// /api/mcp — Conector de Fudo para claude.ai (Streamable HTTP, sin estado).
// Sin token válido responde 401 con el puntero a los metadatos: así Claude
// arranca el inicio de sesión. Solo socios; solo lectura; cada consulta queda
// en la auditoría. Las credenciales de Fudo no salen nunca del servidor.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 230 // Claude espera hasta 240 s por llamada

const noAutorizado = () => NextResponse.json({ error: 'unauthorized' }, {
  status: 401,
  headers: { 'WWW-Authenticate': `Bearer resource_metadata="${METADATA_RECURSO}", scope="${SCOPE}"` },
})

export async function POST(request: Request) {
  const admin = createAdminClient() as unknown as SupabaseClient
  const userId = await autenticarBearer(admin, request.headers.get('authorization'))
  if (!userId) return noAutorizado()

  const server = crearServidorFudo(async (herramienta, args) => {
    await logAudit(admin, {
      userId, userName: await nombreDe(admin, userId), action: 'mcp_fudo_consulta', module: 'configuracion', entityType: 'mcp', entityId: herramienta,
      description: `Claude consultó Fudo: ${herramienta}`, metadata: { args },
    }).catch(() => {})
  })
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  return transport.handleRequest(request)
}

// Sin sesiones ni canal de eventos: solo POST
async function soloPost(request: Request) {
  const admin = createAdminClient() as unknown as SupabaseClient
  if (!(await autenticarBearer(admin, request.headers.get('authorization')))) return noAutorizado()
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } })
}
export const GET = soloPost
export const DELETE = soloPost
