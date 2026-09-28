import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { syncToFudo } from '@/lib/fudo/stock-sync'
import { notifyEvent } from '@/lib/push/notify-event'
import { conteosDeHoy, estadoConteoHoy, resumenParaNotificacion, type LineaConteoDia } from '@/lib/stock/conteo-diario'

// ---------------------------------------------------------------------------
// /api/stock/conteo-diario — el conteo diario de elaborados, en la app
//   GET  → { estado: { contados, total, ultimo }, conteos: [...] } de hoy
//   POST { conteos: [{ stock_item_id, qty, nota? }], comentario? }
//        → cada producto se guarda como conteo físico (mismo camino que el
//          conteo normal: actualiza Fudo, nota obligatoria en diferencias
//          grandes) y se avisa por notificación a socios/encargados/chef.
// Pueden contar: socio, encargado, chef, cocina y barista.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROLES = ['socio', 'encargado', 'chef', 'cocina', 'barista']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const auth = await requireRole(ROLES)
  if (auth.response) return auth.response
  const admin = createAdminClient()
  const [estado, conteos] = await Promise.all([estadoConteoHoy(admin), conteosDeHoy(admin)])
  return NextResponse.json({ estado, conteos })
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(ROLES)
    if (auth.response) return auth.response
    const body = await request.json().catch(() => null) as { conteos?: { stock_item_id?: string; qty?: number; nota?: string | null }[]; comentario?: string | null } | null
    const conteos = (body?.conteos ?? []).slice(0, 200)
    const comentario = (body?.comentario ?? '').trim().slice(0, 1000) || null
    if (conteos.length === 0) return NextResponse.json({ error: 'No hay nada para guardar' }, { status: 400 })
    for (const c of conteos) {
      if (!UUID.test(String(c.stock_item_id)) || !Number.isFinite(Number(c.qty)) || Number(c.qty) < 0) {
        return NextResponse.json({ error: 'Hay una cantidad inválida' }, { status: 400 })
      }
    }

    const admin = createAdminClient()
    const { data: items } = await admin.from('stock_items').select('id, name, unit, current_qty').in('id', conteos.map((c) => c.stock_item_id!))
    const porId = new Map((items ?? []).map((i) => [i.id, i]))

    const lineas: LineaConteoDia[] = []
    const resultados: { stock_item_id: string; ok: boolean; error?: string }[] = []
    for (const c of conteos) {
      const it = porId.get(c.stock_item_id!)
      if (!it) { resultados.push({ stock_item_id: c.stock_item_id!, ok: false, error: 'No existe' }); continue }
      const qty = Math.round(Number(c.qty) * 1000) / 1000
      const nota = (c.nota ?? '').trim() || comentario
      const r = await syncToFudo(admin, it.id, qty, auth.user.id, {
        reason: 'physical_count',
        note: nota ? `Conteo diario: ${nota}`.slice(0, 500) : 'Conteo diario',
      })
      resultados.push({ stock_item_id: it.id, ok: r.success, error: r.success ? undefined : r.error })
      if (r.success) lineas.push({ stock_item_id: it.id, name: it.name, unit: it.unit, qty, antes: Number(it.current_qty) })
    }

    if (lineas.length > 0) {
      const { data: perfil } = await admin.from('profiles').select('first_name, last_name').eq('id', auth.user.id).maybeSingle()
      const quien = [perfil?.first_name, perfil?.last_name].filter(Boolean).join(' ') || null
      await admin.from('audit_trail').insert({
        user_id: auth.user.id, user_name: quien, action: 'conteo_diario', module: 'stock', entity_type: 'stock_count',
        description: `${quien ?? 'Alguien'} contó ${lineas.length} elaborado${lineas.length === 1 ? '' : 's'}`,
        metadata: { comentario, lineas },
      })
      // Lo que antes era el mensaje al grupo de WhatsApp
      await notifyEvent(admin, 'conteo_diario_hecho', {
        title: `📋 Conteo de elaborados${quien ? ` — ${quien.split(' ')[0]}` : ''}`,
        body: resumenParaNotificacion(lineas, comentario),
        url: '/cocina/elaborados?tab=contar',
      }, { excludeUserId: auth.user.id }).catch((err) => console.warn('[conteo-diario] push', err))
    }

    return NextResponse.json({
      success: lineas.length > 0,
      guardados: lineas.length,
      resultados,
      estado: await estadoConteoHoy(admin),
    })
  } catch (err) {
    console.error('[POST /api/stock/conteo-diario]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
