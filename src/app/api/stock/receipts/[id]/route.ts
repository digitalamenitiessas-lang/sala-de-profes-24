import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { logAudit } from '@/lib/audit'
import { syncToFudo } from '@/lib/fudo/stock-sync'
import { anularEnGastoFudo, corregirMontoEnGastoFudo, fudoExpensePagado, postFudoPayment } from '@/lib/fudo/expenses'
import { asegurarGastoEnFudo, TEXTO_GASTO, type ResultadoGasto } from '@/lib/compras/gasto-fudo'
import { NOTA_IMPUESTOS } from '@/lib/compras/datos-gasto'

// ---------------------------------------------------------------------------
// PATCH /api/stock/receipts/[id]
// ---------------------------------------------------------------------------
// Edita un recibo de compra: monto, nota, medio de pago, cantidad.
// Si cambia la cantidad y el recibo tiene stock_item_id, aplica el delta a Fudo.
// Si cambia el monto y el gasto de Fudo lo creó la app, se corrige allá
// también (renglón, monto y pago o deuda): antes quedaba distinto (#175).
// Estado de pago:
//   'pagado'  → marca pagado (paid_at + paid_by) e intenta imputar en Fudo
//   'a_pagar' → deshace un pago marcado por error (limpia paid_at/paid_by);
//               un pago ya imputado en Fudo NO se revierte solo (se avisa).
// Manager-only. Usado desde /pedidos (pestaña Pagos) y /pedidos/cuentas.
//
// DELETE /api/stock/receipts/[id]
// ---------------------------------------------------------------------------
// Anula un recibo:
//   - Gasto de Fudo creado por la app: si era lo único de la factura se anula;
//     si no, sale el renglón y baja el monto. Si al anular Fudo ya devolvió el
//     stock, no se descuenta otra vez.
//   - Gasto cargado directo en Fudo (importado o "Ya está cargado en Fudo"):
//     la app no le sumó stock, así que no se revierte; el gasto se anula allá.
//   - Revierte el delta de stock en Fudo/LVE si el insumo está vinculado.
//   - Resetea el pedido a "ordered" para poder volver a recibirlo.
//   - Elimina el registro de stock_receipts.
// ---------------------------------------------------------------------------

type ReceiptRow = {
  id: number
  stock_item_id: string | null
  qty: number
  unit: string | null
  cost_total: number | null
  cost_per_unit: number | null
  note: string | null
  payment_status: string | null
  payment_method: string | null
  supplier_id: string | null
  order_id: number | null
  order_source: string | null
  received_date: string | null
  fudo_expense_id: string | null
}

/** Gasto que cargaron directo en Fudo: la app no lo creó ni le sumó stock (se corrige en Fudo) */
function cargadoEnFudo(note: string | null): boolean {
  return /Importado desde Fudo|cargado directo en Fudo/i.test(note ?? '')
}

/** Gasto de Fudo del recibo: el suyo o el del pedido ("Llegó todo": uno por factura) */
async function gastoDelRecibo(admin: ReturnType<typeof createAdminClient>, receipt: ReceiptRow): Promise<string | null> {
  if (receipt.fudo_expense_id) return receipt.fudo_expense_id
  if (!receipt.order_id || !receipt.order_source) return null
  const table = receipt.order_source === 'barra' ? 'bar_orders' : 'kitchen_orders'
  const { data: order } = await admin.from(table).select('fudo_expense_id').eq('id', receipt.order_id).maybeSingle()
  return (order as { fudo_expense_id?: string | null } | null)?.fudo_expense_id ?? null
}

async function loadReceipt(admin: ReturnType<typeof createAdminClient>, receiptId: number): Promise<ReceiptRow | null> {
  const { data } = await admin
    .from('stock_receipts')
    .select('id, stock_item_id, qty, unit, cost_total, cost_per_unit, note, payment_status, payment_method, supplier_id, order_id, order_source, received_date, fudo_expense_id')
    .eq('id', receiptId)
    .maybeSingle()
  return (data as ReceiptRow | null) ?? null
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
    if (!isManagerOrAbove(profile?.role)) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

    const { id } = await context.params
    const receiptId = Number(id)
    if (!Number.isInteger(receiptId) || receiptId <= 0) return NextResponse.json({ error: 'Recibo inválido' }, { status: 400 })

    const receipt = await loadReceipt(admin, receiptId)
    if (!receipt) return NextResponse.json({ error: 'Recibo no encontrado' }, { status: 404 })

    const body = await request.json().catch(() => ({})) as Record<string, unknown>

    // Marcar como pagado
    if (body.payment_status === 'pagado') {
      if (receipt.payment_status === 'pagado') return NextResponse.json({ error: 'Ya está pagado' }, { status: 409 })
      const paidAt = new Date().toISOString()
      const newPaidMethod = typeof body.payment_method === 'string' && body.payment_method ? body.payment_method : null
      const update: Record<string, unknown> = { payment_status: 'pagado', paid_at: paidAt, paid_by: user.id }
      if (newPaidMethod) update.payment_method = newPaidMethod
      const { error: upErr } = await admin.from('stock_receipts').update(update).eq('id', receiptId)
      if (upErr) throw upErr

      // Intentar imputar en Fudo: primero el fudo_expense_id del recibo (directo),
      // luego fallback al pedido vinculado (para recibos creados antes de esta columna).
      let fudoSynced = false
      if (receipt.cost_total && receipt.cost_total > 0) {
        let fudoExpenseId = receipt.fudo_expense_id ?? null
        if (!fudoExpenseId && receipt.order_id && receipt.order_source) {
          const table = receipt.order_source === 'barra' ? 'bar_orders' : 'kitchen_orders'
          const { data: order } = await admin.from(table).select('fudo_expense_id').eq('id', receipt.order_id).maybeSingle()
          fudoExpenseId = (order as { fudo_expense_id?: string | null } | null)?.fudo_expense_id ?? null
        }
        if (fudoExpenseId) {
          try {
            // Si ya se pagó en Fudo (orden de pago a proveedores), no se manda
            // otro pago: quedaría pagado dos veces.
            if (!(await fudoExpensePagado(fudoExpenseId))) {
              await postFudoPayment({ expenseId: fudoExpenseId, amount: receipt.cost_total, medio: newPaidMethod ?? receipt.payment_method })
            }
            fudoSynced = true
          } catch (fudoErr) {
            console.warn('[PATCH receipt] Fudo payment post failed (queda en cola):', fudoErr instanceof Error ? fudoErr.message : fudoErr)
            const { encolarPagoGasto } = await import('@/lib/fudo/reintentos')
            await encolarPagoGasto(admin, {
              fudoExpenseId, monto: receipt.cost_total, receiptId,
              error: fudoErr instanceof Error ? fudoErr.message : 'Fudo no aceptó el pago', userId: user.id,
              medio: newPaidMethod ?? receipt.payment_method,
            })
          }
        }
      }

      const userName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || null
      logAudit(admin, { userId: user.id, userName, action: 'receipt_payment', module: 'pedidos', entityType: 'stock_receipt', entityId: String(receiptId), description: `Recibo #${receiptId} marcado como pagado${newPaidMethod ? ` (${newPaidMethod})` : ''}${fudoSynced ? ' — imputado en Fudo' : ''}`, metadata: { receiptId, cost_total: receipt.cost_total, payment_method: newPaidMethod, fudoSynced } }).catch(() => {})
      return NextResponse.json({ success: true, paid_at: paidAt, fudoSynced })
    }

    // Deshacer un pago (volver a "a pagar") — gesto puro, sin editar campos.
    // Si el pago se había imputado en Fudo (POST /expenses/{id}/payments), esa
    // imputación NO se revierte sola: devolvemos fudoPaymentLinked para que la
    // UI lo avise en el toast.
    if (body.payment_status === 'a_pagar' && body.qty === undefined && body.cost_total === undefined && body.note === undefined) {
      if (receipt.payment_status !== 'pagado') return NextResponse.json({ error: 'El recibo ya está a pagar' }, { status: 409 })
      const { error: upErr } = await admin
        .from('stock_receipts')
        .update({ payment_status: 'a_pagar', paid_at: null, paid_by: null })
        .eq('id', receiptId)
      if (upErr) throw upErr
      // Si el pago estaba esperando para entrar a Fudo, ya no hay que mandarlo
      const { cancelarPagoPendiente } = await import('@/lib/fudo/reintentos')
      await cancelarPagoPendiente(admin, receiptId)

      let fudoPaymentLinked = Boolean(receipt.fudo_expense_id)
      if (!fudoPaymentLinked && receipt.order_id && receipt.order_source) {
        const table = receipt.order_source === 'barra' ? 'bar_orders' : 'kitchen_orders'
        const { data: order } = await admin.from(table).select('fudo_expense_id').eq('id', receipt.order_id).maybeSingle()
        fudoPaymentLinked = Boolean((order as { fudo_expense_id?: string | null } | null)?.fudo_expense_id)
      }

      const userName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || null
      logAudit(admin, { userId: user.id, userName, action: 'receipt_payment', module: 'pedidos', entityType: 'stock_receipt', entityId: String(receiptId), description: `Recibo #${receiptId} devuelto a "a pagar"${fudoPaymentLinked ? ' — ojo: el pago imputado en Fudo no se revierte solo' : ''}`, metadata: { receiptId, payment_status: 'a_pagar', cost_total: receipt.cost_total, supplier_id: receipt.supplier_id, fudoPaymentLinked } }).catch(() => {})
      return NextResponse.json({ success: true, paid_at: null, fudoPaymentLinked })
    }

    // Edición de campos
    const newQty = typeof body.qty === 'number' && body.qty > 0 ? body.qty : null
    const newCostTotal = typeof body.cost_total === 'number' ? body.cost_total : undefined
    const newNote = typeof body.note === 'string' ? body.note.trim() || null : undefined
    const newPaymentMethod = typeof body.payment_method === 'string' ? body.payment_method || null : undefined
    const newPaymentStatus = body.payment_status === 'a_pagar' ? 'a_pagar' : undefined
    const newSupplierId = typeof body.supplier_id === 'string' ? body.supplier_id : undefined

    // Si cambia la cantidad y hay insumo vinculado → aplicar delta al stock
    let fudoSynced = false
    if (newQty !== null && newQty !== receipt.qty && receipt.stock_item_id) {
      const qtyDiff = newQty - receipt.qty
      const { data: si } = await admin.from('stock_items').select('id, name, unit, current_qty, fudo_ingredient_id, fudo_product_id, fudo_skip').eq('id', receipt.stock_item_id).single()
      if (si) {
        const write = await syncToFudo(admin, receipt.stock_item_id, Number(si.current_qty) + qtyDiff, user.id, {
          reason: 'reception',
          deltaOverride: qtyDiff,
          note: `Corrección de recibo #${receiptId}: ${qtyDiff > 0 ? '+' : ''}${qtyDiff} ${si.unit}`,
        })
        if (!write.success) return NextResponse.json({ error: write.error ?? 'No se pudo ajustar el stock' }, { status: 502 })
        fudoSynced = write.fudoSynced
      }
    }

    // Actualizar el recibo
    const update: Record<string, unknown> = {}
    if (newQty !== null && newQty !== receipt.qty) {
      update.qty = newQty
      if (newCostTotal !== undefined) {
        update.cost_total = newCostTotal
        update.cost_per_unit = newQty > 0 ? Math.round((newCostTotal / newQty) * 100) / 100 : null
      } else if (receipt.cost_per_unit != null) {
        update.cost_total = Math.round(newQty * receipt.cost_per_unit * 100) / 100
      }
    } else if (newCostTotal !== undefined) {
      update.cost_total = newCostTotal
      update.cost_per_unit = newQty != null && newQty > 0 ? Math.round((newCostTotal / newQty) * 100) / 100 : receipt.qty > 0 ? Math.round((newCostTotal / receipt.qty) * 100) / 100 : null
    }
    if (newNote !== undefined) update.note = newNote
    if (newPaymentMethod !== undefined) update.payment_method = newPaymentMethod
    if (newSupplierId !== undefined) update.supplier_id = newSupplierId
    if (newPaymentStatus !== undefined) {
      update.payment_status = newPaymentStatus
      update.paid_at = null
      update.paid_by = null
    }

    if (Object.keys(update).length > 0) {
      const { error: upErr } = await admin.from('stock_receipts').update(update).eq('id', receiptId)
      if (upErr) throw upErr
    }

    const userName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || null

    // Precio cargado después ("Falta el precio"): si la compra todavía no está
    // en Fudo como gasto, se crea ahora (antes quedaba solo en la app).
    // Monto corregido de una compra que ya tiene gasto: se corrige en Fudo.
    let gastoFudo: ResultadoGasto | null = null
    let montoFudo: { corregido: boolean; aviso: string | null } | null = null
    if (update.cost_total !== undefined) {
      const gastoId = await gastoDelRecibo(admin, receipt)
      const delta = Math.round((Number(update.cost_total) - Number(receipt.cost_total ?? 0)) * 100) / 100
      if (gastoId && Math.abs(delta) >= 0.01) {
        if (cargadoEnFudo(receipt.note)) {
          montoFudo = { corregido: false, aviso: `Este gasto lo cargaron en Fudo (#${gastoId}): corregí el monto allá también` }
        } else {
          const { data: ids } = receipt.stock_item_id
            ? await admin.from('stock_items').select('fudo_ingredient_id, fudo_product_id').eq('id', receipt.stock_item_id).maybeSingle()
            : { data: null }
          // Ya con el monto nuevo guardado: la suma de antes es sin la diferencia
          const { data: hermanos } = await admin.from('stock_receipts').select('cost_total').eq('fudo_expense_id', gastoId)
          const sumaDespues = ((hermanos ?? []) as { cost_total: number | null }[]).reduce((t, h) => t + Number(h.cost_total ?? 0), 0)
          const r = await corregirMontoEnGastoFudo({
            expenseId: gastoId, deltaMonto: delta, nuevoTotalLinea: Number(update.cost_total),
            sumaRecibosAntes: Math.round((sumaDespues - (receipt.fudo_expense_id ? delta : 0)) * 100) / 100,
            fudoIngredientId: ids?.fudo_ingredient_id, fudoProductId: ids?.fudo_product_id, medio: receipt.payment_method,
          })
          montoFudo = { corregido: r.ok, aviso: r.aviso ?? null }
        }
      } else if (!gastoId && Number(update.cost_total) > 0) {
        gastoFudo = await asegurarGastoEnFudo(admin, receiptId, userName, user.id)
      }
    }

    logAudit(admin, { userId: user.id, userName, action: 'edit_receipt', module: 'pedidos', entityType: 'stock_receipt', entityId: String(receiptId), description: `Recibo #${receiptId} editado${gastoFudo === 'creado' ? ' · gasto creado en Fudo' : ''}${montoFudo?.corregido ? ' · monto corregido en Fudo' : ''}${montoFudo?.aviso ? ` · ${montoFudo.aviso}` : ''}`, metadata: { receiptId, changes: update, fudoSynced, gastoFudo, montoFudo } }).catch(() => {})

    return NextResponse.json({
      success: true, fudoSynced, gastoFudo,
      gastoFudoTexto: gastoFudo ? TEXTO_GASTO[gastoFudo] : montoFudo?.corregido ? 'Corregido también en Fudo.' : null,
      avisoFudo: montoFudo?.aviso ?? null,
    })
  } catch (error) {
    console.error('[PATCH /api/stock/receipts/[id]]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
    if (!isManagerOrAbove(profile?.role)) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

    const { id } = await context.params
    const receiptId = Number(id)
    if (!Number.isInteger(receiptId) || receiptId <= 0) return NextResponse.json({ error: 'Recibo inválido' }, { status: 400 })

    const receipt = await loadReceipt(admin, receiptId)
    if (!receipt) return NextResponse.json({ error: 'Recibo no encontrado' }, { status: 404 })

    const { data: si } = receipt.stock_item_id
      ? await admin.from('stock_items').select('id, name, unit, current_qty, fudo_ingredient_id, fudo_product_id, fudo_skip').eq('id', receipt.stock_item_id).single()
      : { data: null }

    // 0) El gasto de Fudo. Antes de tocar el stock: si al anularlo Fudo
    //    devuelve el stock, la app no lo descuenta otra vez.
    const gastoId = await gastoDelRecibo(admin, receipt)
    const deFudo = cargadoEnFudo(receipt.note)
    let gastoFudo: { anulado: boolean; ajustado: boolean; aviso: string | null } | null = null
    let fudoYaDevolvio: { fudoAfter: number | null } | null = null
    if (gastoId && deFudo) {
      gastoFudo = { anulado: false, ajustado: false, aviso: `Este gasto lo cargaron en Fudo (#${gastoId}): si la compra no fue, anulalo allá (si no, la app lo vuelve a traer)` }
    } else if (gastoId) {
      const { data: hermanos } = await admin.from('stock_receipts').select('id, note').eq('fudo_expense_id', gastoId).neq('id', receiptId)
      const quedanOtros = ((hermanos ?? []) as { id: number; note: string | null }[]).some((r) => !(r.note ?? '').startsWith(NOTA_IMPUESTOS))
      const r = await anularEnGastoFudo({
        expenseId: gastoId, monto: Number(receipt.cost_total ?? 0), qty: receipt.qty, quedanOtros,
        fudoIngredientId: si?.fudo_ingredient_id, fudoProductId: si?.fudo_product_id, medio: receipt.payment_method,
      })
      if (!r.ok) {
        // Sin anular en Fudo no se borra: quedaría el gasto allá y nada acá
        return NextResponse.json({ error: `${r.aviso ?? 'Fudo no respondió'}. El recibo NO se anuló: probá de nuevo.` }, { status: 502 })
      }
      gastoFudo = { anulado: !quedanOtros, ajustado: quedanOtros, aviso: r.aviso ?? null }
      if (r.fudoDevolvioStock) fudoYaDevolvio = { fudoAfter: r.fudoAfter }
    }

    // 1) Revertir stock en Fudo/LVE si corresponde (no si lo cargaron directo
    //    en Fudo: la app nunca se lo sumó)
    let stockReversed = false
    let fudoReversed = false
    if (receipt.stock_item_id && receipt.qty > 0 && !deFudo) {
      if (si) {
        const write = await syncToFudo(admin, receipt.stock_item_id, Math.max(0, Number(si.current_qty) - receipt.qty), user.id, {
          reason: 'reception',
          deltaOverride: -receipt.qty,
          note: `Anulación de recibo #${receiptId}: -${receipt.qty} ${si.unit}${fudoYaDevolvio ? ' (Fudo lo devolvió al anular el gasto)' : ''}`,
          fudoSumadoPorGasto: fudoYaDevolvio,
        })
        // Si Fudo falla, la reversión queda en la cola de reintentos (no se pierde)
        if (!write.success) {
          // Antes se borraba igual y el stock quedaba mal en los dos lados sin
          // registro para corregirlo. Ahora no se borra hasta poder revertir.
          console.warn('[DELETE receipt] Stock reversal failed:', write.error)
          return NextResponse.json({ error: `No se pudo revertir el stock (${write.error ?? 'error'}). El recibo NO se borró.` }, { status: 409 })
        }
        stockReversed = true
        fudoReversed = write.fudoSynced
      }
    }

    // 1b) Si la recepción creó un lote por vencimiento (lot_code 'REC-…'),
    //     eliminarlo también — best-effort: si stock_lots no existe o no hay
    //     match exacto, la anulación sigue igual. El cost_source sellado por
    //     la compra NO se revierte: el precio pagado fue real de todos modos.
    if (receipt.stock_item_id && receipt.qty > 0) {
      try {
        const { data: lots } = await admin
          .from('stock_lots')
          .select('id, lot_code, qty_original, qty_remaining, created_at')
          .eq('stock_item_id', receipt.stock_item_id)
          .like('lot_code', receipt.received_date ? `REC-${receipt.received_date}-%` : 'REC-%')
          .eq('qty_original', receipt.qty)
          .is('production_output_id', null)
          .order('created_at', { ascending: false })
          .limit(1)
        const lot = (lots ?? [])[0] as { id: number } | undefined
        if (lot) {
          const { error: lotErr } = await admin.from('stock_lots').delete().eq('id', lot.id)
          if (lotErr) console.warn('[DELETE receipt] Lote de recepción no eliminado:', lotErr.message)
        }
      } catch (lotErr) {
        console.warn('[DELETE receipt] stock_lots no disponible:', lotErr instanceof Error ? lotErr.message : lotErr)
      }
    }

    // 2) Resetear el pedido a "ordered" para que se pueda volver a recibir
    if (receipt.order_id && receipt.order_source) {
      const table = receipt.order_source === 'barra' ? 'bar_orders' : 'kitchen_orders'
      const resetFields: Record<string, unknown> = {
        status: 'ordered',
        received_by: null,
        received_at: null,
        received_qty: null,
        received_mode: null,
        received_note: null,
        fudo_expense_id: null,
        fudo_amount: null,
      }
      let { error: resetErr } = await admin.from(table).update(resetFields).eq('id', receipt.order_id).eq('status', 'received')
      if (resetErr && /received_mode|fudo_expense_id|fudo_amount/.test(resetErr.message)) {
        ;({ error: resetErr } = await admin.from(table).update({ status: 'ordered', received_by: null, received_at: null, received_qty: null }).eq('id', receipt.order_id).eq('status', 'received'))
      }
      if (resetErr) console.warn('[DELETE receipt] Order reset failed:', resetErr.message)
    }

    // 3) Eliminar el recibo
    const { error: delErr } = await admin.from('stock_receipts').delete().eq('id', receiptId)
    if (delErr) throw delErr

    // 3b) Si de esa factura quedó solo el recibo de impuestos (IVA/IIBB), se va
    // con ella: no queda deuda ni pago de una factura que ya no está
    let impuestosBorrados = 0
    if (receipt.fudo_expense_id && !(receipt.note ?? '').startsWith(NOTA_IMPUESTOS)) {
      const { data: restantes } = await admin.from('stock_receipts').select('id, note').eq('fudo_expense_id', receipt.fudo_expense_id)
      const filas = (restantes ?? []) as { id: number; note: string | null }[]
      if (filas.length > 0 && filas.every((r) => (r.note ?? '').startsWith(NOTA_IMPUESTOS))) {
        const { error: impErr } = await admin.from('stock_receipts').delete().in('id', filas.map((r) => r.id))
        if (impErr) console.warn('[DELETE receipt] recibo de impuestos no borrado:', impErr.message)
        else impuestosBorrados = filas.length
      }
    }

    const userName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || null
    const textoGasto = gastoFudo?.anulado ? `gasto #${gastoId} anulado en Fudo` : gastoFudo?.ajustado ? `gasto #${gastoId} corregido en Fudo` : null
    logAudit(admin, { userId: user.id, userName, action: 'delete_receipt', module: 'pedidos', entityType: 'stock_receipt', entityId: String(receiptId), description: `Recibo #${receiptId} eliminado${stockReversed ? ` (stock revertido${fudoReversed ? ' en Fudo' : ' solo en LVE'})` : ''}${impuestosBorrados ? ' y su recibo de impuestos' : ''}${textoGasto ? ` · ${textoGasto}` : ''}${gastoFudo?.aviso ? ` · ${gastoFudo.aviso}` : ''}`, metadata: { receiptId, qty: receipt.qty, cost_total: receipt.cost_total, stock_item_id: receipt.stock_item_id, stockReversed, fudoReversed, impuestosBorrados, fudo_expense_id: gastoId, gastoFudo, fudoYaDevolvio: Boolean(fudoYaDevolvio) } }).catch(() => {})

    return NextResponse.json({ success: true, stockReversed, fudoReversed, gastoFudoTexto: textoGasto, avisoFudo: gastoFudo?.aviso ?? null })
  } catch (error) {
    console.error('[DELETE /api/stock/receipts/[id]]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
