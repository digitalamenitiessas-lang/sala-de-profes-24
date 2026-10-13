import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { logAudit } from '@/lib/audit'
import { sendPushToUser } from '@/lib/push/send'

// ---------------------------------------------------------------------------
// POST /api/produccion/orders/[id]/reject   body: { motivo: string }
// ---------------------------------------------------------------------------
// El socio/encargado rechaza una producción que todavía no validó (borrador,
// en curso o "a validar"). Como esas órdenes nunca movieron stock, rechazar no
// toca LVE ni Fudo: solo cierra la orden con el motivo y le avisa a quien la
// cargó.
//
// Una producción YA VALIDADA no se puede rechazar acá: ya descontó insumos,
// sumó el elaborado (con lote y costo promedio) y escribió Fudo. Deshacer eso
// solo no es seguro (el elaborado puede estar vendido o usado, los insumos
// pueden haberse contado de nuevo, el costo promedio no se recupera exacto).
// Para eso se corrige con un conteo o ajuste en Stock.
// ---------------------------------------------------------------------------

const ESTADOS_RECHAZABLES = ['draft', 'in_progress', 'pending_review']
const MOTIVO_MIN = 3
const MOTIVO_MAX = 500

function esErrorDeEstado(message: string | undefined, code: string | undefined) {
  // Sin la migración 20261012 aplicada, 'rejected' choca con el check.
  return code === '23514' || (message ?? '').includes('production_orders_status_check')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .single()
    if (!profile || !isManagerOrAbove(profile.role)) {
      return NextResponse.json({ error: 'Solo socio o encargado puede rechazar una producción' }, { status: 403 })
    }

    const { id: idStr } = await params
    const id = Number(idStr)
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const body = await request.json().catch(() => ({})) as { motivo?: unknown }
    const motivo = typeof body.motivo === 'string' ? body.motivo.trim().slice(0, MOTIVO_MAX) : ''
    if (motivo.length < MOTIVO_MIN) {
      return NextResponse.json({ error: 'Escribí el motivo del rechazo' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: order, error: orderErr } = await admin
      .from('production_orders')
      .select('id, name, status, chef_id')
      .eq('id', id)
      .single()
    if (orderErr || !order) {
      return NextResponse.json({ error: 'Producción no encontrada' }, { status: 404 })
    }

    if (order.status === 'completed') {
      return NextResponse.json({
        error: 'Esta producción ya se validó y movió stock en LVE y Fudo, así que no se puede rechazar. Si estaba mal, corregí el stock con un conteo o ajuste en Stock.',
      }, { status: 409 })
    }
    if (!ESTADOS_RECHAZABLES.includes(order.status)) {
      return NextResponse.json({ error: 'Esta producción ya estaba cerrada (rechazada o cancelada)' }, { status: 409 })
    }

    // Por las dudas: si por algún camino la orden ya tiene movimientos de
    // stock, no se rechaza (habría que revertirlos y eso no es automático).
    const { count: movimientos, error: movErr } = await admin
      .from('stock_movements')
      .select('id', { count: 'exact', head: true })
      .eq('production_order_id', id)
    if (movErr) {
      console.warn('[reject production] no pude revisar movimientos de stock', movErr.message)
    } else if ((movimientos ?? 0) > 0) {
      return NextResponse.json({
        error: 'Esta producción ya tiene movimientos de stock, así que no se puede rechazar. Corregí el stock con un conteo o ajuste en Stock.',
      }, { status: 409 })
    }

    const ahora = new Date().toISOString()
    const revision = { reviewed_by: user.id, reviewed_at: ahora, updated_at: ahora }

    // Update condicionado al estado: si otro la validó en el medio, no pisa nada.
    let estadoFinal: 'rejected' | 'cancelled' = 'rejected'
    let upd = await admin
      .from('production_orders')
      .update({ ...revision, status: 'rejected', review_notes: motivo })
      .eq('id', id)
      .in('status', ESTADOS_RECHAZABLES)
      .select('id')

    if (upd.error && esErrorDeEstado(upd.error.message, upd.error.code)) {
      // Migración 20261012 sin aplicar: queda como cancelada con el motivo.
      estadoFinal = 'cancelled'
      upd = await admin
        .from('production_orders')
        .update({ ...revision, status: 'cancelled', review_notes: `Rechazada: ${motivo}` })
        .eq('id', id)
        .in('status', ESTADOS_RECHAZABLES)
        .select('id')
    }

    if (upd.error) throw upd.error
    if (!upd.data || upd.data.length === 0) {
      return NextResponse.json({
        error: 'La producción cambió de estado mientras la rechazabas (puede que alguien la haya validado). Recargá y fijate.',
      }, { status: 409 })
    }

    const quienRechaza = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null

    logAudit(admin, {
      userId: user.id,
      userName: quienRechaza,
      action: 'reject_production_order',
      module: 'produccion',
      entityType: 'production_order',
      entityId: String(id),
      description: `${quienRechaza ?? 'Alguien'}: rechazó "${order.name}" — ${motivo}`,
      metadata: {
        motivo,
        estado_anterior: order.status,
        estado_final: estadoFinal,
        cargada_por: order.chef_id,
        stock_revertido: false, // nunca había movido stock
      },
    })

    // Aviso a quien la cargó (si no es la misma persona que rechaza).
    // after(): que Vercel no corte el aviso al responder
    if (order.chef_id && order.chef_id !== user.id) {
      const chefId = order.chef_id
      after(() => sendPushToUser(chefId, {
        title: '❌ Producción rechazada',
        body: `"${order.name}": ${motivo}`,
        url: `/cocina/produccion/${id}`,
      }).catch(() => {}))
    }

    return NextResponse.json({
      success: true,
      order_id: id,
      status: estadoFinal,
      message: 'Producción rechazada. No se tocó el stock.',
    })
  } catch (err) {
    console.error('[POST /api/produccion/orders/[id]/reject]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
