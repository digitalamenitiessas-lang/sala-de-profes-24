import type { SupabaseClient } from '@supabase/supabase-js'
import type { ComprobanteTipo, DatosGasto } from '@/lib/compras/datos-gasto'

// ---------------------------------------------------------------------------
// Que cada compra recibida en la app tenga su gasto en Fudo (una sola vez)
// ---------------------------------------------------------------------------
// Las compras se cargan en la app ("Llegó"). Si en ese momento no se puso el
// precio, el gasto no se podía crear y la compra nunca llegaba a Fudo, aunque
// después se cargara el precio en Pagos → "Falta el precio". Ahora, cuando el
// recibo tiene monto y todavía no tiene gasto en Fudo, se crea: proveedor,
// monto, fecha de recepción, categoría, comprobante y medio de pago (y si ya
// está pagado, el pago). Si Fudo no responde, queda en la cola de reintentos.
// El stock NO se toca acá: ya lo sumó "Llegó".
// ---------------------------------------------------------------------------

export type ResultadoGasto = 'ya_estaba' | 'creado' | 'vinculado' | 'en_cola' | 'sin_proveedor' | 'sin_monto'

type Recibo = {
  id: number
  supplier_id: string | null
  cost_total: number | null
  received_date: string | null
  received_at: string | null
  payment_method: string | null
  payment_status: string | null
  fudo_expense_id: string | null
  order_id: number | null
  order_source: string | null
  expense_category_id: string | null
  expense_category_name: string | null
  comprobante_tipo: string | null
  comprobante_numero: string | null
  iva: number | null
  iibb: number | null
}

export async function asegurarGastoEnFudo(admin: SupabaseClient, receiptId: number, cargadoPor: string | null, userId: string | null): Promise<ResultadoGasto> {
  const { data } = await admin.from('stock_receipts')
    .select('id, supplier_id, cost_total, received_date, received_at, payment_method, payment_status, fudo_expense_id, order_id, order_source, expense_category_id, expense_category_name, comprobante_tipo, comprobante_numero, iva, iibb')
    .eq('id', receiptId).maybeSingle()
  const r = data as Recibo | null
  if (!r) return 'sin_monto'
  if (r.fudo_expense_id) return 'ya_estaba'

  // El pedido puede tener el gasto (ej. "Llegó todo": un gasto por factura para varios recibos)
  const tabla = r.order_source === 'barra' ? 'bar_orders' : 'kitchen_orders'
  if (r.order_id) {
    const { data: o } = await admin.from(tabla).select('fudo_expense_id').eq('id', r.order_id).maybeSingle()
    if ((o as { fudo_expense_id?: string | null } | null)?.fudo_expense_id) return 'ya_estaba'
  }
  // Ya está esperando para entrar a Fudo
  const { data: cola } = await admin.from('fudo_reintentos').select('id').eq('tipo', 'crear_gasto').eq('estado', 'pendiente').eq('payload->>receipt_id', String(r.id)).limit(1)
  if ((cola ?? []).length > 0) return 'en_cola'

  const monto = Number(r.cost_total ?? 0)
  if (!(monto > 0)) return 'sin_monto'
  const { data: sup } = r.supplier_id ? await admin.from('suppliers').select('fudo_provider_id').eq('id', r.supplier_id).maybeSingle() : { data: null }
  const fudoProviderId = (sup as { fudo_provider_id?: string | null } | null)?.fudo_provider_id ?? null
  if (!fudoProviderId) return 'sin_proveedor'

  const fecha = r.received_date ?? (r.received_at ? new Date(r.received_at).toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10) : new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10))
  const gasto: DatosGasto = {
    categoriaId: r.expense_category_id,
    categoriaNombre: r.expense_category_name,
    comprobante: (r.comprobante_tipo as ComprobanteTipo | null) ?? null,
    numero: r.comprobante_numero,
    iva: r.iva,
    iibb: r.iibb,
    cargadoPor,
  }
  const pagado = r.payment_status === 'pagado'

  const { postFudoExpense, postFudoPayment, fetchFudoExpenses } = await import('@/lib/fudo/expenses')

  // ¿Ya lo cargaron a mano en Fudo? (mismo proveedor y monto, ±5 días, sin
  // vincular a nada de la app) → se vincula ese en vez de crear otro
  try {
    const t = Date.parse(`${fecha}T12:00:00-03:00`)
    const candidatos = (await fetchFudoExpenses(new Date(t - 5 * 86_400_000).toISOString(), { force: true }))
      .filter((g) => g.providerId === fudoProviderId && Math.abs(g.amount - monto) <= Math.max(1, monto * 0.005) && Math.abs(Date.parse(g.date) - t) <= 5 * 86_400_000)
    for (const g of candidatos) {
      const [{ count: c1 }, { count: c2 }] = await Promise.all([
        admin.from('stock_receipts').select('id', { count: 'exact', head: true }).eq('fudo_expense_id', g.id),
        admin.from(tabla).select('id', { count: 'exact', head: true }).eq('fudo_expense_id', g.id),
      ])
      if ((c1 ?? 0) + (c2 ?? 0) > 0) continue
      await admin.from('stock_receipts').update({ fudo_expense_id: g.id }).eq('id', r.id)
      if (r.order_id) await admin.from(tabla).update({ fudo_expense_id: g.id, fudo_amount: g.amount }).eq('id', r.order_id)
      return 'vinculado'
    }
  } catch { /* si no se pudo leer Fudo, se sigue y se crea */ }

  const { encolarCrearGasto, encolarPagoGasto } = await import('@/lib/fudo/reintentos')
  let expenseId: string | null = null
  try {
    expenseId = await postFudoExpense({ fudoProviderId, amount: monto, date: fecha, gasto, medioPago: r.payment_method })
  } catch (err) {
    await encolarCrearGasto(admin, {
      fudoProviderId, amount: monto, date: fecha, receiptId: r.id, thenPay: pagado,
      error: err instanceof Error ? err.message : 'Fudo no respondió al crear el gasto', userId, gasto, medio: r.payment_method,
    })
    return 'en_cola'
  }
  if (!expenseId) {
    await encolarCrearGasto(admin, { fudoProviderId, amount: monto, date: fecha, receiptId: r.id, thenPay: pagado, error: 'Fudo no devolvió el gasto', userId, gasto, medio: r.payment_method })
    return 'en_cola'
  }

  await admin.from('stock_receipts').update({ fudo_expense_id: expenseId }).eq('id', r.id)
  if (r.order_id) await admin.from(tabla).update({ fudo_expense_id: expenseId, fudo_amount: monto }).eq('id', r.order_id)
  if (pagado) {
    try {
      await postFudoPayment({ expenseId, amount: monto, medio: r.payment_method })
    } catch (err) {
      await encolarPagoGasto(admin, { fudoExpenseId: expenseId, monto, receiptId: r.id, error: err instanceof Error ? err.message : 'Fudo no aceptó el pago', userId, medio: r.payment_method })
    }
  }
  return 'creado'
}

export const TEXTO_GASTO: Record<ResultadoGasto, string | null> = {
  ya_estaba: null,
  creado: 'El gasto ya está en Fudo.',
  vinculado: 'Ya estaba cargado en Fudo: se vinculó (no se duplicó).',
  en_cola: 'Fudo no respondió: el gasto queda esperando y entra solo.',
  sin_proveedor: 'Falta el proveedor (o no está vinculado a Fudo): el gasto no se pudo crear en Fudo.',
  sin_monto: null,
}
