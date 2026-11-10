import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { crearCodigo, esSocioActivo, nombreDe, validarPedido, vieneDeLaApp } from '@/lib/mcp/oauth'
import { logAudit } from '@/lib/audit'

// POST /api/mcp/oauth/authorize — el botón de la pantalla /mcp/autorizar.
// Exige la sesión de un socio y que el pedido salga de nuestra propia página.
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!vieneDeLaApp(request)) {
    console.warn('[mcp] POST rechazado por origen', { origin: request.headers.get('origin'), secFetchSite: request.headers.get('sec-fetch-site') })
    return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 })
  }
  const form = await request.formData()
  const campos = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))
  const v = validarPedido(campos)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const destino = new URL(v.pedido.redirectUri)
  if (v.pedido.state) destino.searchParams.set('state', v.pedido.state)
  if (campos.decision !== 'permitir') {
    destino.searchParams.set('error', 'access_denied')
    return NextResponse.redirect(destino, 303)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const admin = createAdminClient() as unknown as SupabaseClient
  if (!user || !(await esSocioActivo(admin, user.id))) return NextResponse.json({ error: 'Solo los socios pueden conectar Fudo con Claude' }, { status: 403 })

  destino.searchParams.set('code', await crearCodigo(admin, user.id, v.pedido))
  await logAudit(admin, {
    userId: user.id, userName: await nombreDe(admin, user.id), action: 'mcp_fudo_autorizado', module: 'configuracion', entityType: 'mcp', entityId: 'fudo',
    description: `Autorizó a Claude (${destino.hostname}) a leer los datos de Fudo`,
  }).catch(() => {})
  return NextResponse.redirect(destino, 303)
}
