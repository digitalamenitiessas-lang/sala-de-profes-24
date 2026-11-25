import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { agregarRegistro, borrarRegistro, controlHorneado, horneadoDeHoy } from '@/lib/horneado/datos'

// ---------------------------------------------------------------------------
// /api/horneado — tandas de medialunas, bollitos y tortillas
//   GET                 lo cargado hoy y cuántas conviene hornear hoy
//   GET ?vista=control  lo horneado contra lo vendido en Fudo, últimos 14
//                       días (encargados y socios)
//   POST  { accion: 'agregar', pieza, tipo, cantidad, nota? }
//         { accion: 'borrar', id }
// Carga cualquiera del equipo (quien hornea). Traído de Santa Fe (Marco,
// a39e324): allá el control está en el control interno de Joaquín, que la 24
// no tiene; acá es una pestaña de la misma pantalla.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const Accion = z.discriminatedUnion('accion', [
  z.object({
    accion: z.literal('agregar'),
    pieza: z.enum(['medialuna', 'bollito', 'tortilla']),
    tipo: z.enum(['tanda', 'sobrante', 'budin', 'tirado']),
    cantidad: z.number().int().min(0).max(500),
    nota: z.string().max(200).nullable().optional(),
  }),
  z.object({ accion: z.literal('borrar'), id: z.uuid() }),
])

const esGestion = (role: string) => role === 'socio' || role === 'encargado'

async function usuario(): Promise<{ id: string; role: string; admin: SupabaseClient } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as unknown as SupabaseClient
  const { data } = await admin.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle()
  const p = data as { role: string; is_active: boolean } | null
  return p?.is_active ? { id: user.id, role: p.role, admin } : null
}

export async function GET(request: NextRequest) {
  const u = await usuario()
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  if (request.nextUrl.searchParams.get('vista') === 'control') {
    if (!esGestion(u.role)) return NextResponse.json({ error: 'Solo encargados y socios' }, { status: 403 })
    try {
      return NextResponse.json(await controlHorneado(u.admin, 14))
    } catch (err) {
      console.error('[horneado] control', err)
      return NextResponse.json({ error: 'No se pudo armar el control de horneado' }, { status: 500 })
    }
  }

  try {
    const datos = await horneadoDeHoy(u.admin)
    const ids = [...new Set(datos.registros.map((r) => r.created_by).filter((x): x is string => !!x))]
    const nombres: Record<string, string> = {}
    if (ids.length) {
      const { data } = await u.admin.from('profiles').select('id, first_name').in('id', ids)
      for (const p of (data ?? []) as { id: string; first_name: string | null }[]) nombres[p.id] = p.first_name ?? ''
    }
    return NextResponse.json({ ...datos, nombres, yo: u.id, gestion: esGestion(u.role) })
  } catch (err) {
    console.error('[horneado] GET', err)
    return NextResponse.json({ error: 'No se pudo cargar el horneado' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const u = await usuario()
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const r = Accion.safeParse(await request.json().catch(() => null))
  if (!r.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const a = r.data
  if (a.accion === 'agregar' && a.tipo !== 'sobrante' && a.cantidad === 0) {
    return NextResponse.json({ error: 'Poné cuántas' }, { status: 400 })
  }
  const res = a.accion === 'agregar'
    ? await agregarRegistro(u.admin, u.id, { pieza: a.pieza, tipo: a.tipo, cantidad: a.cantidad, nota: a.nota ?? null })
    : await borrarRegistro(u.admin, u, a.id)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true })
}
