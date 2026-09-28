import { NextRequest, NextResponse } from 'next/server'
import { asignarStockALotes } from '@/lib/stock/lotes'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyEvent } from '@/lib/push/notify-event'

// ---------------------------------------------------------------------------
// GET /api/cron/expiry-alerts
// ---------------------------------------------------------------------------
// Cron diario (11:00 UTC = 8:00 AR). Alertas proactivas de vida útil: busca
// lotes ACTIVOS con cantidad restante > 0 que vencen en ≤3 días (o ya
// vencidos con resto) y manda UN push agrupado con la acción sugerida por
// lote: vencido → descartar y registrar merma; vence hoy/mañana → promo HOY
// o usar en producción; 2-3 días → planificar promo. Fechas en día AR.
// Si no hay nada por vencer, no se manda push. Registra en audit_trail.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const AR_TZ = 'America/Argentina/Buenos_Aires'

/** Fecha AR (YYYY-MM-DD) de un instante. */
function arDate(d: Date): string {
  return d.toLocaleString('en-CA', { timeZone: AR_TZ }).slice(0, 10)
}

/** Días (en calendario AR) desde hoy hasta la fecha de vencimiento. */
function daysUntilAR(expiresAt: Date, now: Date): number {
  const today = new Date(`${arDate(now)}T00:00:00Z`)
  const expiry = new Date(`${arDate(expiresAt)}T00:00:00Z`)
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000)
}

function formatQty(qty: number): string {
  if (Number.isInteger(qty)) return String(qty)
  return qty.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

function countdownLabel(days: number): string {
  if (days < 0) return days === -1 ? 'venció ayer' : `vencido hace ${Math.abs(days)}d`
  if (days === 0) return 'vence hoy'
  if (days === 1) return 'vence mañana'
  return `vence en ${days}d`
}

function suggestedAction(days: number): string {
  if (days < 0) return 'descartá y registrá la merma'
  if (days <= 1) return 'sacá promo HOY o usalo en producción'
  return 'planificá promo'
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const admin = createAdminClient()
    const now = new Date()

    const { data, error } = await admin
      .from('stock_lots')
      .select(`
        id,
        stock_item_id,
        lot_code,
        qty_remaining,
        unit,
        expires_at,
        produced_at,
        created_at,
        status,
        stock_items(name, current_qty)
      `)
      .not('expires_at', 'is', null)
      .in('status', ['active', 'expired'])
      .gt('qty_remaining', 0)
      .order('expires_at', { ascending: true })
      .limit(1000)

    if (error) {
      // Tolerante a schema faltante (migración de lotes sin aplicar)
      if (error.message.includes('stock_lots')) {
        return NextResponse.json({ success: true, sent: false, lots: [], reason: 'stock_lots no existe (migración pendiente)' })
      }
      throw new Error(error.message)
    }

    type AlertLot = {
      id: number
      name: string
      lot_code: string
      qty_remaining: number
      unit: string
      expires_at: string
      expires_in_days: number
      countdown: string
      action: string
    }

    // qty_remaining nunca se descuenta al vender/usar: se reparte el stock
    // actual entre los lotes más nuevos y solo se avisa lo que puede quedar.
    type LotRow = NonNullable<typeof data>[number]
    const stockPorItem = new Map<string, number>()
    const lotesPorItem = new Map<string, LotRow[]>()
    for (const lot of data ?? []) {
      const si = lot.stock_items as { current_qty?: number } | null
      stockPorItem.set(lot.stock_item_id as string, Number(si?.current_qty ?? 0))
      lotesPorItem.set(lot.stock_item_id as string, [...(lotesPorItem.get(lot.stock_item_id as string) ?? []), lot])
    }
    const vigentes = [...lotesPorItem.entries()].flatMap(([itemId, ls]) =>
      asignarStockALotes(ls.map((l) => ({ ...l, stock_item_id: itemId, qty_remaining: Number(l.qty_remaining ?? 0), expires_at: l.expires_at as string | null, produced_at: l.produced_at as string | null, created_at: l.created_at as string | null })), stockPorItem.get(itemId) ?? 0)
        .filter((l) => l.restante > 0))

    const alertLots: AlertLot[] = vigentes
      .map((lot) => {
        const expiresAt = lot.expires_at ? new Date(lot.expires_at) : null
        if (!expiresAt || Number.isNaN(expiresAt.getTime())) return null
        const days = daysUntilAR(expiresAt, now)
        if (days > 3) return null
        const stockItem = lot.stock_items as { name?: string } | null
        return {
          id: lot.id as number,
          name: stockItem?.name ?? 'Sin item',
          lot_code: lot.lot_code as string,
          qty_remaining: lot.restante,
          unit: (lot.unit as string) ?? 'unidad',
          expires_at: lot.expires_at as string,
          expires_in_days: days,
          countdown: countdownLabel(days),
          action: suggestedAction(days),
        }
      })
      .filter((lot): lot is AlertLot => lot !== null)
      .sort((a, b) => a.expires_in_days - b.expires_in_days)

    let sent = false
    let body: string | null = null

    if (alertLots.length > 0) {
      const lines = alertLots.slice(0, 6).map(
        (l) => `• ${l.name} — ${l.countdown} (quedan ${formatQty(l.qty_remaining)}) → ${l.action}`,
      )
      if (alertLots.length > 6) {
        lines.push(`… y ${alertLots.length - 6} lote(s) más`)
      }
      body = lines.join('\n')
      const title = `⏰ ${alertLots.length} producto${alertLots.length === 1 ? '' : 's'} por vencer`

      await notifyEvent(admin, 'expiry_alerts', {
        title,
        body,
        url: '/control',
      })
      sent = true

      // audit_trail — insert directo, no bloqueante
      try {
        await admin.from('audit_trail').insert({
          action: 'expiry_alert',
          module: 'stock',
          entity_type: 'cron',
          entity_id: 'expiry-alerts',
          description: `Alerta de vida útil: ${alertLots.length} lote(s) por vencer`,
          metadata: JSON.parse(JSON.stringify({ body, lots: alertLots })),
        })
      } catch {
        /* audit no bloqueante */
      }
    }

    return NextResponse.json({
      success: true,
      sent,
      lots_alerted: alertLots.length,
      body,
      lots: alertLots,
      checked_at_ar: arDate(now),
    })
  } catch (error) {
    console.error('[GET /api/cron/expiry-alerts]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
