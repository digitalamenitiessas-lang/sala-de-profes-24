import type { SupabaseClient } from '@supabase/supabase-js'
import { fudoFetch } from '@/lib/fudoClient'
import { medioLveDesdeFudo } from '@/lib/fudo/expenses'
import { logAudit } from '@/lib/audit'
import { NOTA_DIFERENCIA_FUDO } from '@/lib/compras/datos-gasto'

// ---------------------------------------------------------------------------
// Pagos hechos en Fudo → Sala de Profes
// ---------------------------------------------------------------------------
// Las compras en cuenta corriente se pagan con la orden de pago a proveedores
// de Fudo. Sala de Profes no se enteraba: seguían "a pagar" en Cuentas por
// pagar. Esto revisa en Fudo los gastos de los recibos "a pagar":
//   · pagado en Fudo   → el recibo pasa a pagado (fecha y medio de Fudo)
//   · cancelado en Fudo → NO se toca: se devuelve para avisar (anular un
//     recibo mueve stock, eso lo decide una persona)
//   · sin pagar y con más monto en Fudo que en la app (ej. le agregaron el IVA
//     en Fudo) → la diferencia queda "a pagar" en un recibo NOTA_DIFERENCIA_FUDO
// Corre con el pulso de Fudo (una vez por hora) y al abrir Cuentas por pagar.
// ---------------------------------------------------------------------------

type Recibo = { id: number; fudo_expense_id: string; cost_total: number | null; supplier_id: string | null; suppliers: { name: string } | null }
type Res = { type: string; id: string; attributes?: Record<string, unknown>; relationships?: Record<string, { data: { id: string; type: string } | { id: string; type: string }[] | null }> }

export type CanceladoEnFudo = { expenseId: string; receiptIds: number[]; proveedor: string | null; total: number }
export type ResultadoPagosFudo = { revisados: number; pagados: number; recibosPagados: number; cancelados: CanceladoEnFudo[]; ajustados: number; errores: number }

const MAX_GASTOS = 150

export async function sincronizarPagosDesdeFudo(admin: SupabaseClient): Promise<ResultadoPagosFudo> {
  // fudo_expense_id no está en los tipos generados
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from('stock_receipts') as any)
    .select('id, fudo_expense_id, cost_total, supplier_id, suppliers:supplier_id(name)')
    .eq('payment_status', 'a_pagar')
    .not('fudo_expense_id', 'is', null)
    .order('id', { ascending: true })
    .limit(500)
  if (error) throw new Error(`No se pudieron leer los recibos a pagar: ${error.message}`)

  const porGasto = new Map<string, Recibo[]>()
  for (const r of (data ?? []) as Recibo[]) {
    const id = String(r.fudo_expense_id)
    porGasto.set(id, [...(porGasto.get(id) ?? []), r])
  }

  const res: ResultadoPagosFudo = { revisados: 0, pagados: 0, recibosPagados: 0, cancelados: [], ajustados: 0, errores: 0 }
  const pagadosDetalle: string[] = []

  for (const [expenseId, recibos] of [...porGasto].slice(0, MAX_GASTOS)) {
    res.revisados++
    let gasto: { data?: Res; included?: Res[] }
    try {
      gasto = await fudoFetch(
        // (sin fields[payment]: Fudo no acepta createdAt ahí y el include ya trae todo)
        `/expenses/${encodeURIComponent(expenseId)}?include=payments&fields[expense]=amount,status,canceled,paymentDate,payments`,
      )
    } catch {
      res.errores++
      continue
    }
    const attrs = gasto.data?.attributes ?? {}
    const proveedor = recibos[0]?.suppliers?.name?.trim() ?? null
    const total = Math.round(recibos.reduce((a, r) => a + (Number(r.cost_total) || 0), 0) * 100) / 100

    if (attrs.canceled === true) {
      res.cancelados.push({ expenseId, receiptIds: recibos.map((r) => r.id), proveedor, total })
      continue
    }
    if (attrs.status !== 'PAID') {
      if (await ajustarDiferencia(admin, expenseId, Number(attrs.amount ?? NaN))) res.ajustados++
      continue
    }

    // Medio y fecha: el último pago vigente; si no hay detalle, la fecha del gasto
    const pagos = (gasto.included ?? [])
      .filter((i) => i.type === 'Payment' && i.attributes?.canceled !== true)
      .sort((a, b) => String(a.attributes?.createdAt ?? '').localeCompare(String(b.attributes?.createdAt ?? '')))
    const ultimo = pagos[pagos.length - 1]
    const medioFudo = (ultimo?.relationships?.paymentMethod?.data as { id: string } | null | undefined)?.id ?? null
    const medio = medioFudo ? await medioLveDesdeFudo(medioFudo) : null
    const paidAt = typeof ultimo?.attributes?.createdAt === 'string'
      ? ultimo.attributes.createdAt
      : typeof attrs.paymentDate === 'string' ? `${attrs.paymentDate}T12:00:00-03:00` : new Date().toISOString()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: actualizados, error: upErr } = await (admin.from('stock_receipts') as any)
      .update({ payment_status: 'pagado', paid_at: paidAt, ...(medio ? { payment_method: medio } : {}) })
      .in('id', recibos.map((r) => r.id))
      .eq('payment_status', 'a_pagar')
      .select('id')
    if (upErr) { res.errores++; continue }
    const n = (actualizados ?? []).length
    if (n > 0) {
      res.pagados++
      res.recibosPagados += n
      pagadosDetalle.push(`${proveedor ?? 'Sin proveedor'} $${total.toLocaleString('es-AR')} (gasto #${expenseId})`)
    }
  }

  if (res.pagados > 0) {
    void logAudit(admin, {
      userId: null,
      userName: 'Sistema',
      action: 'receipts_paid_in_fudo',
      module: 'pedidos',
      entityType: 'stock_receipt',
      description: `Pagados en Fudo, marcados como pagados: ${pagadosDetalle.join('; ')}`.slice(0, 1000),
      metadata: { pagados: res.pagados, recibos: res.recibosPagados },
    })
  }
  return res
}

/**
 * Gasto sin pagar cuyo monto en Fudo es mayor que la suma de sus recibos (le
 * agregaron el IVA u otro renglón en Fudo): la diferencia queda "a pagar" en
 * un recibo sin producto, que se ajusta si vuelve a cambiar. Si Fudo tiene
 * menos, no se toca nada solo (lo corrige una persona).
 */
async function ajustarDiferencia(admin: SupabaseClient, expenseId: string, montoFudo: number): Promise<boolean> {
  if (!Number.isFinite(montoFudo) || montoFudo <= 0) return false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin.from('stock_receipts') as any)
    .select('id, cost_total, payment_status, note, supplier_id, received_date')
    .eq('fudo_expense_id', expenseId)
    .order('id', { ascending: true })
  const filas = (data ?? []) as { id: number; cost_total: number | null; payment_status: string; note: string | null; supplier_id: string | null; received_date: string | null }[]
  if (filas.length === 0) return false
  const ajuste = filas.find((f) => (f.note ?? '').startsWith(NOTA_DIFERENCIA_FUDO))
  const enApp = filas.filter((f) => f !== ajuste).reduce((t, f) => t + (Number(f.cost_total) || 0), 0)
  const dif = Math.round((montoFudo - enApp) * 100) / 100
  if (ajuste) {
    if (ajuste.payment_status !== 'a_pagar') return false
    if (dif <= 1) {
      await admin.from('stock_receipts').delete().eq('id', ajuste.id)
      return true
    }
    if (Math.abs((Number(ajuste.cost_total) || 0) - dif) < 0.01) return false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin.from('stock_receipts') as any).update({ cost_total: dif }).eq('id', ajuste.id)
    return !error
  }
  if (dif <= 1) return false
  const base = filas[0]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from('stock_receipts') as any).insert({
    stock_item_id: null,
    supplier_id: base.supplier_id,
    qty: 1,
    unit: null,
    cost_total: dif,
    cost_per_unit: null,
    received_date: base.received_date ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }),
    fudo_expense_id: expenseId,
    payment_status: 'a_pagar',
    payment_method: 'cuenta_corriente',
    note: `${NOTA_DIFERENCIA_FUDO} (gasto #${expenseId}): en Fudo el total es mayor (por ejemplo, le sumaron el IVA)`,
  })
  if (error) console.warn('[pagos-fudo] diferencia no registrada:', expenseId, error.message)
  return !error
}
