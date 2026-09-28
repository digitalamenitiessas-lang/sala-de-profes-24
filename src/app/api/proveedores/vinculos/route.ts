import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { logAudit } from '@/lib/audit'
import { buildVinculosPayload } from '@/lib/proveedores/vinculos'
import { bumpLinksVersion } from '@/lib/proveedores/fudo-links'

// ---------------------------------------------------------------------------
// /api/proveedores/vinculos — vínculos insumo↔proveedor (encargados y socios)
//   GET  → estado completo + cola de revisión + ritmo de compra en Fudo
//   POST → { changes: [{ item_id, supplier_id, op }] }  vía set_supplier_links
//          { calendar: { supplier_id, order_days, lead_time_days } }
// Las escrituras usan la sesión del usuario: la base valida el rol
// (is_encargado) además de este guard.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const OPS = new Set(['primary', 'add', 'confirm', 'remove'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response
    const payload = await buildVinculosPayload(createAdminClient())
    if (new URL(request.url).searchParams.get('resumen') === '1') {
      // Para el aviso de /proveedores: solo aparece si hay algo por revisar
      return NextResponse.json({
        conflictos: payload.review.conflicts.length,
        sin_proveedor: payload.review.unlinked.length,
        calendario: payload.review.calendar.length,
      })
    }
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[GET /api/proveedores/vinculos]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}

type Change = { item_id: string; supplier_id: string; op: string }

export async function POST(request: Request) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response

    const body = await request.json().catch(() => null)
    const supabase = await createClient()

    if (Array.isArray(body?.changes)) {
      const changes = body.changes as Change[]
      if (changes.length === 0 || changes.length > 500) {
        return NextResponse.json({ error: 'Entre 1 y 500 cambios' }, { status: 400 })
      }
      for (const c of changes) {
        if (!UUID.test(String(c?.item_id)) || !UUID.test(String(c?.supplier_id)) || !OPS.has(String(c?.op))) {
          return NextResponse.json({ error: 'Cambio inválido' }, { status: 400 })
        }
      }
      const clean = changes.map((c) => ({ item_id: c.item_id, supplier_id: c.supplier_id, op: c.op }))
      // set_supplier_links no está en los tipos generados. Ojo: rpc usa `this`,
      // hay que llamarlo sobre el cliente (sacarlo suelto rompía con
      // "Cannot read properties of undefined (reading 'rest')").
      type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: { applied: number } | null; error: { message: string; code?: string } | null }>
      const { data, error } = await (supabase.rpc as unknown as Rpc).call(supabase, 'set_supplier_links', { p_changes: clean })
      if (error) {
        const status = error.code === '42501' ? 403 : error.code === '22023' ? 400 : 500
        return NextResponse.json({ error: error.message }, { status })
      }
      bumpLinksVersion()
      return NextResponse.json({ success: true, applied: data?.applied ?? clean.length })
    }

    if (body?.calendar) {
      const { supplier_id, order_days, lead_time_days } = body.calendar as { supplier_id: string; order_days: unknown; lead_time_days: unknown }
      const days = Array.isArray(order_days) ? [...new Set(order_days.map(Number))].sort() : null
      const lead = lead_time_days === null || lead_time_days === '' || lead_time_days === undefined ? null : Number(lead_time_days)
      if (!UUID.test(String(supplier_id)) || !days || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
        || (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 30))) {
        return NextResponse.json({ error: 'Calendario inválido' }, { status: 400 })
      }
      // RLS (suppliers_update → is_encargado) valida de nuevo con la sesión del usuario
      const { data: updated, error } = await supabase.from('suppliers')
        .update({ order_days: days, lead_time_days: lead, updated_at: new Date().toISOString() })
        .eq('id', supplier_id).select('name').maybeSingle()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!updated) return NextResponse.json({ error: 'Proveedor no encontrado' }, { status: 404 })
      const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
      void logAudit(supabase, {
        userId: auth.user.id, userName: null, action: 'update_supplier_calendar', module: 'proveedores',
        entityType: 'supplier', entityId: supplier_id,
        description: `Calendario de ${updated.name}: ${days.length ? days.map((d) => DOW[d]).join('/') : 'sin días'}${lead !== null ? ` · entrega en ${lead}d` : ''}`,
        metadata: { order_days: days, lead_time_days: lead },
      })
      bumpLinksVersion()
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
  } catch (err) {
    console.error('[POST /api/proveedores/vinculos]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
