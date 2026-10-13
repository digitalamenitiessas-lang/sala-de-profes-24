import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyEvent } from '@/lib/push/notify-event'

// ---------------------------------------------------------------------------
// GET /api/cron/stock-preclose — 7hs, 15hs y 23hs Argentina (10, 18, 02 UTC)
//
// Detecta insumos que no alcanzan para el día/turno siguiente y:
//   1. Crea/mantiene alertas activas en stock_alerts (visibles en /control)
//   2. Resuelve alertas de items que ya dejaron de ser críticos
//   3. Manda push a socios y encargados si hay items críticos NUEVOS o urgentes
//
// Un item es crítico si:
//   - current_qty < 0 (ya está en quiebre)
//   - days_of_stock < 1.5 (menos de 1.5 días según historial de 21 días)
//   - min_qty > 0 y current_qty <= min_qty
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type CriticalItem = {
  stock_item_id: string
  name: string
  unit: string
  current_qty: number
  min_qty: number
  consumed_21d: number
  daily_rate: number
  days_of_stock: number | null
}

/** Hora actual en Argentina (UTC-3, sin DST). */
function horaAR(): number {
  return (new Date().getUTCHours() - 3 + 24) % 24
}

function buildPushPayload(items: CriticalItem[], hora: number) {
  const partes = items.slice(0, 5).map((i) => {
    if (i.current_qty < 0) return `${i.name} (negativo)`
    if (i.days_of_stock !== null) return `${i.name} (${i.days_of_stock}d)`
    return i.name
  })
  const resto = items.length > 5 ? ` y ${items.length - 5} más` : ''
  const lista = partes.join(', ') + resto

  if (hora < 11) {
    return {
      title: `⚠️ Stock bajo para hoy — ${items.length} insumo${items.length !== 1 ? 's' : ''}`,
      body: `Antes de abrir verificá: ${lista}. Pedí lo que falte.`,
      url: '/control',
    }
  }
  if (hora < 19) {
    return {
      title: `⚠️ ${items.length} insumo${items.length !== 1 ? 's' : ''} no llegan al cierre`,
      body: `Con el ritmo actual no alcanza: ${lista}. Avisá si hay que reponer.`,
      url: '/control',
    }
  }
  return {
    title: `⚠️ Para mañana falta stock — ${items.length} insumo${items.length !== 1 ? 's' : ''}`,
    body: `Pedí antes de cerrar: ${lista}.`,
    url: '/control',
  }
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (
    process.env.NODE_ENV === 'production'
    && (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = createAdminClient()

    // 1. Calcular items críticos via función SQL
    const { data: rawItems, error: rpcError } = await admin.rpc('fn_stock_critico_manana')
    if (rpcError) throw rpcError
    const items = (rawItems ?? []) as CriticalItem[]

    // 2. Leer alertas low_stock activas actuales
    const { data: activeAlerts } = await admin
      .from('stock_alerts')
      .select('id, stock_item_id')
      .eq('status', 'active')
      .eq('alert_type', 'low_stock')

    const activeAlertsByItemId = new Map(
      (activeAlerts ?? []).map((a) => [String(a.stock_item_id), String(a.id)]),
    )
    const criticalIds = new Set(items.map((i) => i.stock_item_id))

    // 3. Resolver alertas de items que ya no son críticos
    const toResolve = [...activeAlertsByItemId.entries()]
      .filter(([itemId]) => !criticalIds.has(itemId))
      .map(([, alertId]) => alertId)

    if (toResolve.length > 0) {
      await admin
        .from('stock_alerts')
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .in('id', toResolve)
    }

    // 4. Insertar alertas para items críticos sin alerta activa
    const newItems = items.filter((i) => !activeAlertsByItemId.has(i.stock_item_id))

    if (newItems.length > 0) {
      await admin.from('stock_alerts').insert(
        newItems.map((i) => ({
          stock_item_id: i.stock_item_id,
          alert_type: 'low_stock',
          priority:
            i.current_qty < 0 || (i.days_of_stock !== null && i.days_of_stock < 0.5)
              ? 'critical'
              : 'high',
          message:
            i.current_qty < 0
              ? `${i.name} en negativo (${Number(i.current_qty).toFixed(1)} ${i.unit}). Conteo urgente.`
              : `${i.name}: queda para ${i.days_of_stock !== null ? Number(i.days_of_stock).toFixed(1) : '?'} días según el ritmo de los últimos 21 días.`,
          status: 'active',
          triggered_at: new Date().toISOString(),
        })),
      )
    }

    // 5. Enviar push si hay items nuevos o con menos de 12hs de stock
    const urgentes = items.filter(
      (i) => i.current_qty < 0 || (i.days_of_stock !== null && i.days_of_stock < 0.5),
    )
    const shouldPush = newItems.length > 0 || urgentes.length > 0

    if (items.length > 0 && shouldPush) {
      const hora = horaAR()
      const payload = buildPushPayload(items, hora)
      await notifyEvent(admin, 'stock_bajo_critico', payload)
    }

    return NextResponse.json({
      ok: true,
      critical: items.length,
      new_alerts: newItems.length,
      resolved: toResolve.length,
      push_sent: items.length > 0 && shouldPush,
      items: items.map((i) => ({ name: i.name, qty: i.current_qty, days: i.days_of_stock })),
    })
  } catch (err) {
    console.error('[cron/stock-preclose]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error' },
      { status: 500 },
    )
  }
}
