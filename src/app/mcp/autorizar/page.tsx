import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { esSocioActivo, validarPedido } from '@/lib/mcp/oauth'
import { ROLES } from '@/lib/constants'

// ---------------------------------------------------------------------------
// /mcp/autorizar — pantalla de permiso del conector de Fudo para Claude.
// Sin sesión, el middleware manda al login y vuelve acá.
// ---------------------------------------------------------------------------

export const metadata: Metadata = { title: 'Conectar Fudo con Claude', robots: { index: false } }

/** Cierra esta sesión y vuelve al login, para elegir otra cuenta (ej. la tablet del local con otro usuario abierto) */
function OtraCuenta({ volver }: { volver: string }) {
  return (
    <form method="post" action="/api/mcp/oauth/cambiar-cuenta" className="mt-3">
      <input type="hidden" name="next" value={volver} />
      <button className="w-full rounded-xl bg-[#f3efe9] py-2.5 text-sm font-semibold text-[#3d2c24]">Entrar con otra cuenta</button>
    </form>
  )
}

function Tarjeta({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-[#f7f3ec] p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-[#ebe6df]">{children}</div>
    </main>
  )
}

export default async function AutorizarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const crudo = await searchParams
  const p = Object.fromEntries(Object.entries(crudo).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
  const v = validarPedido(p)
  if (!v.ok) {
    return <Tarjeta><h1 className="font-display text-xl font-semibold text-[#3d2c24]">No se puede conectar</h1><p className="mt-2 text-sm text-[#4a3a33]">{v.error}</p></Tarjeta>
  }

  const qs = new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => typeof e[1] === 'string')).toString()
  const volver = `/mcp/autorizar?${qs}`
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(volver)}`)
  const admin = createAdminClient() as unknown as SupabaseClient
  if (!(await esSocioActivo(admin, user.id))) {
    // Decir con qué cuenta está la sesión: si es la de otra persona, no hay forma de darse cuenta
    const { data: perfil } = await admin.from('profiles').select('first_name, last_name, role, is_active').eq('id', user.id).maybeSingle()
    const nombre = [perfil?.first_name, perfil?.last_name].filter(Boolean).join(' ') || 'sin nombre'
    const rol = perfil?.role && perfil.role in ROLES ? ROLES[perfil.role as keyof typeof ROLES].label : perfil?.role ?? 'sin rol'
    return (
      <Tarjeta>
        <h1 className="font-display text-xl font-semibold text-[#3d2c24]">Solo para socios</h1>
        <p className="mt-2 text-sm text-[#4a3a33]">Estás con la cuenta de <b>{nombre}</b> ({user.email}), que figura como <b>{perfil?.is_active === false ? `${rol}, desactivado` : rol}</b>.</p>
        <p className="mt-2 text-sm text-[#4a3a33]">Si no es tu cuenta, entrá con la tuya. Si es la tuya, pedile a un socio que te dé el rol de socio en Equipo y probá de nuevo.</p>
        <OtraCuenta volver={volver} />
      </Tarjeta>
    )
  }

  const destino = new URL(v.pedido.redirectUri).hostname
  const campos = { client_id: v.pedido.clientId, redirect_uri: v.pedido.redirectUri, response_type: 'code', code_challenge: v.pedido.codeChallenge, code_challenge_method: 'S256', state: v.pedido.state ?? '' }
  return (
    <Tarjeta>
      <h1 className="font-display text-xl font-semibold text-[#3d2c24]">Conectar Fudo con Claude</h1>
      <p className="mt-2 text-sm text-[#4a3a33]"><b>{destino}</b> pide permiso para <b>leer</b> los datos de Fudo de La Vieja Escuela 24 y Maipú, con tu usuario <b>{user.email}</b>.</p>
      <div className="mt-4 rounded-xl bg-[#e8f5f1] p-3 text-[13px] text-[#004d40]">
        <p className="font-semibold">Va a poder ver:</p>
        <p className="mt-1">Ventas y pagos, carta y precios, stock de ingredientes, gastos y proveedores, y datos de clientes y usuarios de Fudo.</p>
      </div>
      <div className="mt-2 rounded-xl bg-[#faf8f5] p-3 text-[13px] text-[#4a3a33]">
        <p className="font-semibold">No va a poder:</p>
        <p className="mt-1">Cambiar nada en Fudo, ni ver tu contraseña ni las claves de Fudo.</p>
      </div>
      <p className="mt-3 text-[12px] text-[#7d6c64]">¿No sos {user.email}? Usá el botón de abajo para entrar con tu cuenta.</p>
      <form method="post" action="/api/mcp/oauth/authorize" className="mt-3 flex gap-2">
        {Object.entries(campos).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
        <button name="decision" value="rechazar" className="flex-1 rounded-xl bg-[#f3efe9] py-3 text-sm font-semibold text-[#3d2c24]">Cancelar</button>
        <button name="decision" value="permitir" className="flex-1 rounded-xl bg-[#006d5a] py-3 text-sm font-bold text-white">Permitir</button>
      </form>
      <OtraCuenta volver={volver} />
    </Tarjeta>
  )
}
