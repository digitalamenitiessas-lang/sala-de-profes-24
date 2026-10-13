import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyEvent } from '@/lib/push/notify-event'
import { writeFudoStockDelta } from '@/lib/fudo/stock-sync'
import { parseDatosGasto, type DatosGasto } from '@/lib/compras/datos-gasto'

// ---------------------------------------------------------------------------
// Cola de reintentos hacia Fudo
// ---------------------------------------------------------------------------
// Antes, si Fudo fallaba al mandar una producción o una recepción, el
// movimiento se perdía (la producción incluso se borraba de LVE). Ahora:
//   1. El movimiento queda en LVE y se guarda acá como pendiente.
//   2. /api/cron/fudo-pulso lo reintenta cada 10 min, con espera creciente
//      (10, 20, 40, 80, 120 min…) hasta que Fudo lo acepte.
//   3. Si a la hora sigue fallando, avisa a socios (una vez).
//   4. Mientras está pendiente, la lectura de stock desde Fudo le suma el
//      pendiente, así el espejo nocturno no borra el movimiento.
//   5. A los 3 días sin poder entrar, un movimiento de STOCK se descarta (el
//      stock ya se habrá contado de nuevo). Gastos y pagos nunca se descartan
//      por tiempo: son plata y se reintentan hasta que entren.
// ---------------------------------------------------------------------------

export const ALERTA_MIN = 60
export const DESCARTE_HORAS = 72

export type Reintento = {
  id: string
  tipo: 'stock_delta' | 'pago_gasto' | 'crear_gasto'
  stock_item_id: string | null
  delta: number | null
  payload: Record<string, unknown>
  origen: string
  nota: string | null
  stock_movement_ids: string[]
  estado: 'pendiente' | 'hecho' | 'descartado'
  intentos: number
  ultimo_error: string | null
  proximo_intento_at: string
  alertado_at: string | null
  created_by: string | null
  created_at: string
}

const esperaMin = (intentos: number) => Math.min(10 * 2 ** Math.max(0, intentos - 1), 120)

/** Guarda un movimiento de stock que no pudo llegar a Fudo. */
export async function encolarDeltaStock(admin: SupabaseClient, input: {
  stockItemId: string
  delta: number
  origen: string
  error: string
  nota?: string | null
  movimientoIds?: string[]
  userId?: string | null
}): Promise<void> {
  if (!Number.isFinite(input.delta) || Math.abs(input.delta) < 0.0005) return
  const { error } = await admin.from('fudo_reintentos').insert({
    tipo: 'stock_delta',
    stock_item_id: input.stockItemId,
    delta: Math.round(input.delta * 1000) / 1000,
    origen: input.origen,
    nota: input.nota ?? null,
    stock_movement_ids: input.movimientoIds ?? [],
    ultimo_error: input.error.slice(0, 500),
    intentos: 1,
    proximo_intento_at: new Date(Date.now() + esperaMin(1) * 60_000).toISOString(),
    created_by: input.userId ?? null,
  })
  if (error) console.error('[fudo_reintentos] no se pudo encolar', error.message)
}

/** Guarda un pago de gasto que no pudo imputarse en Fudo. */
export async function encolarPagoGasto(admin: SupabaseClient, input: {
  fudoExpenseId: string
  monto: number
  receiptId: number | string
  error: string
  userId?: string | null
  /** efectivo | transferencia | tarjeta (sin dato: efectivo, como antes) */
  medio?: string | null
}): Promise<void> {
  const { error } = await admin.from('fudo_reintentos').insert({
    tipo: 'pago_gasto',
    payload: { fudo_expense_id: input.fudoExpenseId, monto: input.monto, receipt_id: String(input.receiptId), ...(input.medio ? { medio: input.medio } : {}) },
    origen: 'pago_gasto',
    ultimo_error: input.error.slice(0, 500),
    intentos: 1,
    proximo_intento_at: new Date(Date.now() + esperaMin(1) * 60_000).toISOString(),
    created_by: input.userId ?? null,
  })
  if (error) console.error('[fudo_reintentos] no se pudo encolar pago', error.message)
}

/**
 * Guarda un gasto de Fudo que no se pudo crear (Fudo estaba caído o rechazó
 * la llamada). Cuando el cron lo reintente, creará el gasto y, si `thenPay`
 * es true, también el pago correspondiente.
 */
export async function encolarCrearGasto(admin: SupabaseClient, input: {
  fudoProviderId: string
  amount: number
  date: string
  receiptId: number
  thenPay: boolean
  error: string
  userId?: string | null
  /** Categoría y comprobante: el gasto reintentado sale igual que el original */
  gasto?: DatosGasto | null
  /** efectivo | transferencia | tarjeta | cuenta_corriente */
  medio?: string | null
}): Promise<void> {
  const { error } = await admin.from('fudo_reintentos').insert({
    tipo: 'crear_gasto',
    payload: {
      fudo_provider_id: input.fudoProviderId,
      amount: input.amount,
      date: input.date,
      receipt_id: String(input.receiptId),
      then_pay: input.thenPay,
      ...(input.gasto ? { gasto: input.gasto } : {}),
      ...(input.medio ? { medio: input.medio } : {}),
    },
    origen: 'crear_gasto',
    ultimo_error: input.error.slice(0, 500),
    intentos: 1,
    proximo_intento_at: new Date(Date.now() + esperaMin(1) * 60_000).toISOString(),
    created_by: input.userId ?? null,
  })
  if (error) console.error('[fudo_reintentos] no se pudo encolar crear_gasto', error.message)
}

/** Cancela el pago pendiente de un recibo (se desmarcó como pagado). */
export async function cancelarPagoPendiente(admin: SupabaseClient, receiptId: number | string): Promise<void> {
  await admin.from('fudo_reintentos')
    .update({ estado: 'descartado', ultimo_error: 'El recibo volvió a "a pagar"', updated_at: new Date().toISOString() })
    .eq('tipo', 'pago_gasto').eq('estado', 'pendiente').eq('payload->>receipt_id', String(receiptId))
}

/** Suma de movimientos pendientes por insumo (para no borrarlos al espejar Fudo). */
export async function deltasPendientes(admin: SupabaseClient): Promise<Map<string, number>> {
  const { data } = await admin.from('fudo_reintentos').select('stock_item_id, delta').eq('estado', 'pendiente').eq('tipo', 'stock_delta')
  const m = new Map<string, number>()
  for (const r of (data ?? []) as { stock_item_id: string | null; delta: number | null }[]) {
    if (!r.stock_item_id || r.delta == null) continue
    m.set(r.stock_item_id, Math.round(((m.get(r.stock_item_id) ?? 0) + Number(r.delta)) * 1000) / 1000)
  }
  return m
}

async function reintentarUno(admin: SupabaseClient, r: Reintento): Promise<{ ok: boolean; error?: string; descartar?: string }> {
  if (r.tipo === 'pago_gasto') {
    const { fudo_expense_id, monto, medio } = r.payload as { fudo_expense_id?: string; monto?: number; medio?: string }
    if (!fudo_expense_id || !monto) return { ok: false, descartar: 'Datos del pago incompletos' }
    try {
      const { postFudoPayment, fudoExpensePagado } = await import('@/lib/fudo/expenses')
      // Mientras estaba en cola pudo pagarse en Fudo (orden de pago): no duplicar
      if (await fudoExpensePagado(fudo_expense_id)) return { ok: true }
      await postFudoPayment({ expenseId: fudo_expense_id, amount: monto, medio })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Error' }
    }
  }

  if (r.tipo === 'crear_gasto') {
    const { fudo_provider_id, amount, date, receipt_id, then_pay, gasto, medio } = r.payload as {
      fudo_provider_id?: string; amount?: number; date?: string; receipt_id?: string; then_pay?: boolean; gasto?: unknown; medio?: string
    }
    if (!fudo_provider_id || !amount || !date || !receipt_id) return { ok: false, descartar: 'Datos del gasto incompletos' }
    try {
      const { postFudoExpense, postFudoPayment } = await import('@/lib/fudo/expenses')
      const expenseId = await postFudoExpense({ fudoProviderId: fudo_provider_id, amount, date, gasto: parseDatosGasto(gasto, { confiable: true }), medioPago: medio })
      if (!expenseId) return { ok: false, error: 'Fudo no devolvió ID de gasto' }
      // Guardar el ID en el recibo para que el PATCH de pago lo encuentre directamente
      await admin.from('stock_receipts').update({ fudo_expense_id: expenseId }).eq('id', Number(receipt_id))
      if (then_pay) {
        try {
          await postFudoPayment({ expenseId, amount, medio })
        } catch (payErr) {
          // El gasto existe: solo reencolar el pago
          await encolarPagoGasto(admin, {
            fudoExpenseId: expenseId,
            monto: amount,
            receiptId: Number(receipt_id),
            error: payErr instanceof Error ? payErr.message : 'Error al pagar',
            userId: r.created_by ?? null,
            medio,
          })
        }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Error' }
    }
  }

  // stock_delta
  if (!r.stock_item_id || r.delta == null) return { ok: false, descartar: 'Datos incompletos' }
  const { data: item } = await admin.from('stock_items')
    .select('id, name, fudo_ingredient_id, fudo_product_id, fudo_skip, is_active')
    .eq('id', r.stock_item_id).maybeSingle()
  if (!item) return { ok: false, descartar: 'El insumo ya no existe' }
  if (item.fudo_skip) return { ok: false, descartar: 'El insumo se marcó como "solo en la app"' }
  if (!item.fudo_ingredient_id && !item.fudo_product_id) return { ok: false, error: 'El insumo no está vinculado a Fudo' }

  const res = await writeFudoStockDelta(
    { fudoIngredientId: item.fudo_ingredient_id, fudoProductId: item.fudo_product_id },
    Number(r.delta),
    {
      admin,
      operation: `reintento_${r.origen}`,
      stockItemId: item.id,
      userId: r.created_by ?? undefined,
      entityType: 'fudo_reintento',
      entityId: r.id,
      reason: r.origen === 'produccion' ? 'production' : r.origen === 'merma' ? 'waste' : 'reception',
      note: r.nota ?? `Reintento automático (${r.origen})`,
    },
  )
  if (!res.success) return { ok: false, error: res.error ?? 'Fudo no aceptó el movimiento' }

  // Espejar LVE al número de Fudo + lo que todavía quede pendiente de ese insumo
  if (typeof res.fudoAfter === 'number') {
    const { data: otros } = await admin.from('fudo_reintentos').select('delta')
      .eq('estado', 'pendiente').eq('tipo', 'stock_delta').eq('stock_item_id', item.id).neq('id', r.id)
    const resto = (otros ?? []).reduce((a, o: { delta: number | null }) => a + Number(o.delta ?? 0), 0)
    await admin.from('stock_items').update({ current_qty: Math.round((res.fudoAfter + resto) * 1000) / 1000, updated_at: new Date().toISOString() }).eq('id', item.id)
  }
  if (r.stock_movement_ids.length > 0) {
    await admin.from('stock_movements').update({ fudo_synced: true }).in('id', r.stock_movement_ids).then(() => null, () => null)
  }
  return { ok: true }
}

/** Reintenta lo pendiente que ya toca. Idempotente y seguro de correr en paralelo. */
export async function procesarReintentos(admin: SupabaseClient, limite = 25): Promise<{ hechos: number; fallidos: number; descartados: number; alertas: number }> {
  const out = { hechos: 0, fallidos: 0, descartados: 0, alertas: 0 }
  const ahora = new Date()
  const { data } = await admin.from('fudo_reintentos').select('*')
    .eq('estado', 'pendiente').lte('proximo_intento_at', ahora.toISOString())
    .order('created_at').limit(limite)

  for (const r of (data ?? []) as Reintento[]) {
    // Reservar: correr cada uno una sola vez aunque haya dos procesos
    const siguiente = new Date(Date.now() + esperaMin(r.intentos + 1) * 60_000).toISOString()
    const { data: tomado } = await admin.from('fudo_reintentos')
      .update({ proximo_intento_at: siguiente, updated_at: ahora.toISOString() })
      .eq('id', r.id).eq('proximo_intento_at', r.proximo_intento_at).eq('estado', 'pendiente').select('id')
    if (!tomado?.length) continue

    const edadHoras = (Date.now() - Date.parse(r.created_at)) / 3_600_000
    const res = await reintentarUno(admin, r)
    if (res.ok) {
      await admin.from('fudo_reintentos').update({ estado: 'hecho', hecho_at: new Date().toISOString(), intentos: r.intentos + 1, ultimo_error: null, updated_at: new Date().toISOString() }).eq('id', r.id)
      out.hechos++
    } else if (res.descartar || (edadHoras >= DESCARTE_HORAS && r.tipo === 'stock_delta')) {
      // Plata (crear un gasto, imputar un pago) NO se descarta por tiempo: se
      // sigue reintentando hasta que Fudo lo acepte (el aviso a socios sale igual)
      await admin.from('fudo_reintentos').update({ estado: 'descartado', intentos: r.intentos + 1, ultimo_error: res.descartar ?? `Sin poder entrar a Fudo en ${DESCARTE_HORAS} h: ${res.error ?? ''}`.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', r.id)
      out.descartados++
    } else {
      await admin.from('fudo_reintentos').update({ intentos: r.intentos + 1, ultimo_error: (res.error ?? 'Error').slice(0, 500), updated_at: new Date().toISOString() }).eq('id', r.id)
      out.fallidos++
    }
  }

  // Aviso (una vez) de lo que lleva más de una hora sin poder entrar
  const limiteAlerta = new Date(Date.now() - ALERTA_MIN * 60_000).toISOString()
  const { data: viejos } = await admin.from('fudo_reintentos')
    .select('id, origen, ultimo_error, stock_items(name)')
    .eq('estado', 'pendiente').is('alertado_at', null).lte('created_at', limiteAlerta).limit(50)
  const sinAvisar = (viejos ?? []) as unknown as { id: string; origen: string; ultimo_error: string | null; stock_items: { name: string } | null }[]
  if (sinAvisar.length > 0) {
    const { data: marcados } = await admin.from('fudo_reintentos').update({ alertado_at: new Date().toISOString() })
      .in('id', sinAvisar.map((v) => v.id)).is('alertado_at', null).select('id')
    const ids = new Set((marcados ?? []).map((m: { id: string }) => m.id))
    const nuevos = sinAvisar.filter((v) => ids.has(v.id))
    if (nuevos.length > 0) {
      const nombres = [...new Set(nuevos.map((v) => v.stock_items?.name ?? (v.origen === 'pago_gasto' ? 'un pago de gasto' : v.origen === 'crear_gasto' ? 'un gasto sin crear' : 'un movimiento')))]
      await notifyEvent(admin, 'fudo_problema', {
        title: `⚠️ ${nuevos.length === 1 ? 'Un movimiento no entra' : `${nuevos.length} movimientos no entran`} a Fudo`,
        body: `${nombres.slice(0, 4).join(', ')}${nombres.length > 4 ? '…' : ''}. Motivo: ${(nuevos[0].ultimo_error ?? '').slice(0, 110)}. Se sigue reintentando solo.`,
        url: '/admin/fudo/salud',
      }).catch(() => {})
      out.alertas = nuevos.length
    }
  }
  return out
}
