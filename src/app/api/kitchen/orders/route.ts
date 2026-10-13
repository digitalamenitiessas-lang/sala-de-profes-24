import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyOrderToEncargados } from '@/lib/email/send'
import { logAudit } from '@/lib/audit'
import { syncToFudo } from '@/lib/fudo/stock-sync'
import { normalizeToStockUnit, parseTypedUnit } from '@/lib/produccion/units'
import { esErrorColumnaFaltante } from '@/lib/costos/confiable'
import { notifyEvent } from '@/lib/push/notify-event'
import { getConsumptionContextWithTimeout } from '@/lib/stock/consumption'
import { conCargadoPor, parseDatosGasto, type DatosGasto } from '@/lib/compras/datos-gasto'
import type { KitchenOrderCategoryValue, KitchenOrderUrgencyValue, PriorityValue } from '@/types/database'

// ---------------------------------------------------------------------------
// POST /api/kitchen/orders
// ---------------------------------------------------------------------------
// Operaciones de pedidos de cocina: crear pedido, listar, cambiar estado.
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body || !body.action) {
      return NextResponse.json({ success: false, error: 'Acción requerida' }, { status: 400 })
    }

    const admin = createAdminClient()

    // ----- CREATE ORDER (single or batch) -----
    if (body.action === 'create_order') {
      const { items, urgency, note, supplier_id, initial_status } = body as {
        items: { product_name: string; quantity: string; category?: string; stock_item_id?: string | null; detalle?: string | null }[]
        urgency?: string
        note?: string
        supplier_id?: string | number | null
        /** 'ordered' cuando el pedido ya se le mandó al proveedor en el mismo gesto */
        initial_status?: 'pending' | 'ordered'
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ success: false, error: 'Se requiere al menos un producto' }, { status: 400 })
      }

      // Get user profile
      const { data: profile } = await admin
        .from('profiles')
        .select('first_name, last_name, role')
        .eq('id', user.id)
        .single()

      // Cualquier empleado puede SUGERIR (queda 'pending' = sin enviar); solo
      // encargados y socios lo pasan a pedido (update_status) o lo crean ya enviado
      if (!profile) {
        return NextResponse.json({ success: false, error: 'No tenés permiso para crear pedidos' }, { status: 403 })
      }
      const esSugerencia = !['encargado', 'socio'].includes(profile.role)

      const orderUrgency = urgency || 'normal'
      const startOrdered = initial_status === 'ordered' && ['encargado', 'socio'].includes(profile.role)
      const nowIso = new Date().toISOString()

      // Sin proveedor elegido (pedido de cocina): cada insumo va con su
      // proveedor habitual, así el encargado lo ve agrupado y lo manda junto
      const proveedorDe = new Map<string, string>()
      if (!supplier_id) {
        const ids = items.map((i) => i.stock_item_id).filter((x): x is string => Boolean(x))
        if (ids.length > 0) {
          const { data: sis } = await admin.from('stock_items').select('id, supplier_id').in('id', ids)
          for (const r of (sis ?? []) as { id: string; supplier_id: string | null }[]) if (r.supplier_id) proveedorDe.set(r.id, r.supplier_id)
        }
      }

      // Insert all items
      const inserts = items.map((item) => ({
        product_name: item.product_name,
        quantity: item.quantity,
        category: (item.category || 'otros') as KitchenOrderCategoryValue,
        urgency: orderUrgency as KitchenOrderUrgencyValue,
        note: [item.detalle?.trim().slice(0, 120), note].filter(Boolean).join(' · ') || null,
        created_by: user.id,
        stock_item_id: item.stock_item_id ?? null,
        ...(supplier_id ? { supplier_id } : item.stock_item_id && proveedorDe.has(item.stock_item_id) ? { supplier_id: proveedorDe.get(item.stock_item_id) } : {}),
        ...(startOrdered ? { status: 'ordered', ordered_at: nowIso } : {}),
      }))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let { error: orderError } = await admin.from('kitchen_orders').insert(inserts as any)
      if (orderError && /ordered_at|stock_item_id/.test(orderError.message)) {
        // Migración pendiente: insertar sin las columnas nuevas
        const legacy = inserts.map((row) => {
          const { ordered_at: _o, stock_item_id: _s, ...rest } = row as Record<string, unknown>
          void _o; void _s
          return rest
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;({ error: orderError } = await admin.from('kitchen_orders').insert(legacy as any))
      }
      if (orderError) throw orderError

      // Pedido enviado en el mismo gesto: fecha de "última vez pedido" del insumo
      if (startOrdered) {
        const linkedIds = items.map((i) => i.stock_item_id).filter((x): x is string => Boolean(x))
        if (linkedIds.length > 0) {
          await admin.from('stock_items').update({ last_ordered_at: nowIso }).in('id', linkedIds).then(() => null, () => null)
        }
      }

      const creatorName = profile
        ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Cocina'
        : 'Cocina'
      const itemsSummary = items.map((i) => `${i.product_name} x ${i.quantity}`).join(', ')
      logAudit(admin, {
        userId: user.id,
        userName: creatorName,
        action: 'create_kitchen_order',
        module: 'pedidos',
        entityType: 'kitchen_order',
        description: `${creatorName} creó pedido de cocina: ${itemsSummary}`,
        metadata: { items, urgency: orderUrgency, note },
      }).catch(() => {})

      // Avisar a los encargados. El announcement es un FEED compartido: queda
      // siempre (aunque el pedido lo cree un encargado/socio, el resto lo ve).
      // Lo único que se evita es autonotificar al CREADOR por email/push.
      {
        // Contexto de consumo semanal por insumo (best-effort: si falla o
        // tarda, las notificaciones salen igual sin esa línea — jamás bloquea)
        let consumptionByName = new Map<string, string>()
        try {
          consumptionByName = await getConsumptionContextWithTimeout(
            admin,
            items.map((i) => i.product_name),
          )
        } catch { /* notificación normal sin contexto */ }

        // Create announcement for encargados
        const authorName = creatorName

        const priorityMap: Record<string, string> = {
          normal: 'media',
          alta: 'alta',
          urgente: 'critica',
        }
        const urgencyLabels: Record<string, string> = {
          normal: 'Normal',
          alta: 'Alta',
          urgente: 'Urgente',
        }

        const itemsList = items
          .map((i) => {
            const ctx = consumptionByName.get(i.product_name)
            return `• ${i.product_name} — ${i.quantity}${ctx ? ` · ${ctx}` : ''}`
          })
          .join('\n')

        await admin.from('announcements').insert({
          author_id: user.id,
          type: 'operativo',
          priority: (priorityMap[orderUrgency] || 'media') as PriorityValue,
          title: esSugerencia
            ? `💡 Sugerencia de compra — ${urgencyLabels[orderUrgency] || 'Normal'}`
            : `🛒 Pedido — ${urgencyLabels[orderUrgency] || 'Normal'}`,
          body: `${authorName} ${esSugerencia ? 'sugiere pedir' : 'pidió'}:\n${itemsList}${note ? `\n\nNota: ${note}` : ''}`,
          scope: 'role',
          target_role: 'encargado',
          is_active: true,
        })

        // Email to encargados + socios (sin el creador: no se autonotifica).
        // after(): los avisos corren después de responder sin que Vercel los corte.
        after(() => notifyOrderToEncargados({
          type: 'cocina',
          authorName,
          items: items.map((i) => ({ name: i.product_name, quantity: i.quantity })),
          urgency: orderUrgency,
          note,
          excludeUserId: user.id,
          sugerencia: esSugerencia,
        }).catch(() => {}))

        const pushSummary = items
          .map((i) => {
            const ctx = consumptionByName.get(i.product_name)
            return `${i.product_name} x ${i.quantity}${ctx ? ` · ${ctx}` : ''}`
          })
          .join(', ')

        after(() => notifyEvent(admin, 'purchase_created', {
          title: esSugerencia ? '💡 Sugerencia de compra: hay que pedir' : '🛒 Nuevo pedido',
          body: `${authorName}: ${pushSummary}`,
          url: '/pedidos',
        }, { excludeUserId: user.id }).catch(() => {}))
      }

      return NextResponse.json({ success: true, count: items.length })
    }

    // ----- LIST ORDERS -----
    if (body.action === 'list_orders') {
      const { status: filterStatus } = body
      let query = admin
        .from('kitchen_orders')
        .select('*, profiles:created_by(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(50)

      if (filterStatus) {
        query = query.eq('status', filterStatus)
      }

      const { data, error } = await query
      if (error) throw error
      return NextResponse.json({ success: true, orders: data })
    }

    // ----- UPDATE ORDER STATUS (encargado only) -----
    if (body.action === 'update_status') {
      const { orderId, status } = body
      if (typeof orderId !== 'number' || !status) {
        return NextResponse.json({ success: false, error: 'orderId y status requeridos' }, { status: 400 })
      }

      // Check encargado role
      const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (!profile || (profile.role !== 'encargado' && profile.role !== 'socio')) {
        return NextResponse.json({ success: false, error: 'Solo encargados pueden cambiar estado' }, { status: 403 })
      }

      const statusUpdate: Record<string, unknown> = { status }
      if (status === 'ordered') statusUpdate.ordered_at = new Date().toISOString()
      let { error } = await admin
        .from('kitchen_orders')
        .update(statusUpdate)
        .eq('id', orderId)
      if (error && /ordered_at/.test(error.message)) {
        ({ error } = await admin.from('kitchen_orders').update({ status }).eq('id', orderId))
      }

      if (error) throw error

      // El insumo vinculado queda con fecha de "última vez pedido" también
      // cuando el pedido pasa pending→ordered acá (flujo chef propone →
      // encargado envía); antes solo se estampaba al crear ya-enviado.
      // Best-effort y tolerante a migración pendiente de stock_item_id.
      if (status === 'ordered') {
        const { data: ord } = await admin
          .from('kitchen_orders')
          .select('stock_item_id')
          .eq('id', orderId)
          .maybeSingle()
        const sid = (ord as { stock_item_id?: string | null } | null)?.stock_item_id
        if (sid) {
          await admin.from('stock_items').update({ last_ordered_at: new Date().toISOString() }).eq('id', sid).then(() => null, () => null)
        }
      }

      logAudit(admin, {
        userId: user.id,
        userName: null,
        action: 'update_kitchen_order_status',
        module: 'pedidos',
        entityType: 'kitchen_order',
        entityId: String(orderId),
        description: `Pedido de cocina #${orderId} cambiado a "${status}"`,
        metadata: { orderId, status },
      }).catch(() => {})

      // Notify the order creator about status change
      if (status === 'ordered' || status === 'received' || status === 'cancelled') {
        const { data: order } = await admin
          .from('kitchen_orders')
          .select('created_by, product_name, quantity')
          .eq('id', orderId)
          .single()

        if (order?.created_by) {
          const titleMap: Record<string, string> = {
            ordered: '✅ Pedido enviado al proveedor',
            received: '📦 Pedido recibido',
            cancelled: '❌ Pedido cancelado',
          }
          const bodyMap: Record<string, string> = {
            ordered: `${order.product_name} (${order.quantity}) — tu pedido fue enviado al proveedor`,
            received: `${order.product_name} (${order.quantity}) — ya llegó, stock actualizado`,
            cancelled: `${order.product_name} (${order.quantity}) — fue cancelado`,
          }
          await admin.from('announcements').insert({
            author_id: user.id,
            type: 'operativo',
            priority: 'baja',
            title: titleMap[status] ?? `Pedido ${status}`,
            body: bodyMap[status] ?? `${order.product_name} — ${status}`,
            scope: 'user',
            target_user_id: order.created_by,
            is_active: true,
          })

          // Email to order creator
          try {
            const { notifyOrderStatusChange } = await import('@/lib/email/send')
            const creadorId = order.created_by // const: dentro del callback se pierde el narrowing
            after(() => notifyOrderStatusChange({
              userId: creadorId,
              productName: order.product_name,
              quantity: order.quantity,
              newStatus: status as 'ordered' | 'received' | 'cancelled',
            }).catch(() => {}))
          } catch { /* email optional */ }
        }

      }

      return NextResponse.json({ success: true })
    }

    // ----- CONFIRM ARRIVAL (encargado/socio) — cierre del ciclo sin duplicar Fudo -----
    // La compra se carga UNA vez, en Fudo (Gastos). Acá el pedido se cierra:
    //   mode 'fudo_expense': la compra ya está en Fudo → LVE NO toca stock, sólo
    //                        vincula el gasto (proveedor, monto, fecha) al pedido.
    //   mode 'lve_stock':    la compra NO se cargó en Fudo → LVE suma la cantidad
    //                        recibida como DELTA sobre el stock actual de Fudo
    //                        (nunca pisa ventas) y deja kardex + recibo con precio.
    //   mode 'sin_stock':    sólo cerrar el pedido (ej. se recibió algo que no es stock).
    if (body.action === 'confirm_arrival') {
      const r = await confirmarLlegada(admin, user, body)
      return NextResponse.json(r.json, { status: r.status })
    }

    // ----- LLEGÓ TODO: varios productos del mismo proveedor de una vez -----
    // Cada producto se confirma con la MISMA lógica que "Llegó" (stock, Fudo,
    // recibo, pago). Lo que se marca "no llegó" queda en camino. Si viene el
    // total de la factura y supera lo cargado por producto, la diferencia
    // queda como gasto del proveedor (para Pagos) sin inventar costos.
    if (body.action === 'confirm_arrival_batch') {
      let gasto = parseDatosGasto(body.gasto)
      const { items, paymentMethod, invoiceTotal, note } = body as {
        items: {
          orderId: number
          source: 'cocina' | 'barra'
          llego: boolean
          /** solo si llego=false: true = no va a venir (se cierra ese producto); false = sigue en camino */
          noVino?: boolean
          receivedQty?: string | null
          stockItemId?: string | null
          totalCost?: number | null
          expiresAt?: string | null
          note?: string | null
        }[]
        paymentMethod?: string | null
        invoiceTotal?: number | null
        note?: string | null
      }
      const { data: profile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
      if (!profile || (profile.role !== 'encargado' && profile.role !== 'socio')) {
        return NextResponse.json({ success: false, error: 'Solo encargados y socios pueden confirmar recepciones' }, { status: 403 })
      }
      gasto = conCargadoPor(gasto, [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null)
      if (!Array.isArray(items) || items.length === 0 || items.length > 60) {
        return NextResponse.json({ success: false, error: 'Entre 1 y 60 productos' }, { status: 400 })
      }
      const llegan = items.filter((i) => i.llego)
      const noVienen = items.filter((i) => !i.llego && i.noVino === true)
      if (llegan.length === 0 && noVienen.length === 0) {
        return NextResponse.json({ success: false, error: 'Marcá al menos un producto que llegó' }, { status: 400 })
      }
      // El medio de pago hace falta solo si algo llegó (lo que no vino no se paga)
      if (llegan.length > 0 && !paymentMethod) {
        return NextResponse.json({ success: false, error: 'Elegí cómo se paga' }, { status: 400 })
      }

      // Lo que no vino se cierra primero, producto por producto: sin stock,
      // sin recibo y sin gasto. No entra en el total que va a Fudo.
      let noVinoOk = 0
      {
        const who = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null
        for (const it of noVienen) {
          const r = await marcarNoVino(admin, user, who, { orderId: it.orderId, source: it.source, note: it.note ?? null, avisar: true })
          if (r.status < 300 && r.json.success === true) noVinoOk++
          else console.warn('[confirm_arrival_batch] no vino no registrado:', it.orderId, r.json.error)
        }
      }

      const resultados: { orderId: number; ok: boolean; error?: string; stockUpdated?: boolean }[] = []
      const receiptIds: number[] = []
      let supplierId: string | null = null
      let cargadoPorProducto = 0
      for (const it of llegan) {
        const total = typeof it.totalCost === 'number' && it.totalCost > 0 ? it.totalCost : null
        const nota = [note, it.note].map((x) => (x ?? '').trim()).filter(Boolean).join(' — ') || null
        try {
          const r = await confirmarLlegada(admin, user, {
            orderId: it.orderId,
            source: it.source,
            mode: it.stockItemId ? 'lve_stock' : 'sin_stock',
            expense: null,
            receivedQty: it.stockItemId ? it.receivedQty : null,
            totalCost: it.stockItemId ? total : null,
            amount: it.stockItemId ? null : total,
            stockItemId: it.stockItemId ?? null,
            expiresAt: it.stockItemId ? it.expiresAt ?? null : null,
            note: nota,
            paymentMethod,
            skipFudoExpense: true,
          })
          const ok = r.status < 300 && r.json.success === true
          resultados.push({ orderId: it.orderId, ok, error: ok ? undefined : String(r.json.error ?? 'Error'), stockUpdated: Boolean(r.json.stockUpdated) })
          if (ok) {
            cargadoPorProducto += Number(r.json.costTotal ?? 0) || 0
            const rid = typeof r.json.receiptId === 'number' ? r.json.receiptId as number : null
            if (rid) receiptIds.push(rid)
          }
        } catch (err) {
          resultados.push({ orderId: it.orderId, ok: false, error: err instanceof Error ? err.message : 'Error' })
        }
        if (!supplierId) {
          const table = it.source === 'barra' ? 'bar_orders' : 'kitchen_orders'
          const { data: o } = await admin.from(table).select('supplier_id').eq('id', it.orderId).maybeSingle()
          supplierId = (o as { supplier_id?: string | null } | null)?.supplier_id ?? null
        }
      }

      // Resto de la factura sin detallar por producto → recibo en LVE para cuentas
      // (no genera gasto separado en Fudo: el gasto único del proveedor ya cubre todo)
      let resto: number | null = null
      const factura = typeof invoiceTotal === 'number' && invoiceTotal > 0 ? invoiceTotal : null
      const batchPaymentStatus = paymentMethod === 'cuenta_corriente' ? 'a_pagar' : 'pagado'
      if (factura && resultados.some((r) => r.ok) && factura - cargadoPorProducto >= 1) {
        resto = Math.round((factura - cargadoPorProducto) * 100) / 100
        const restoDate = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
        const { data: restoInserted, error: restoErr } = await admin.from('stock_receipts').insert({
          stock_item_id: null,
          supplier_id: supplierId,
          order_source: llegan[0].source,
          order_id: null,
          qty: 1,
          unit: null,
          cost_total: resto,
          cost_per_unit: null,
          note: `Factura del proveedor — importe sin detallar por producto${note ? ` — ${note}` : ''}`,
          received_by: user.id,
          received_date: restoDate,
          payment_status: batchPaymentStatus,
          paid_at: batchPaymentStatus === 'pagado' ? new Date().toISOString() : null,
          paid_by: batchPaymentStatus === 'pagado' ? user.id : null,
          payment_method: paymentMethod,
        }).select('id').single()
        if (restoErr) console.warn('[confirm_arrival_batch] resto de factura no registrado:', restoErr.message)
        const restoReceiptId = (restoInserted as { id?: number } | null)?.id ?? null
        if (restoReceiptId) receiptIds.push(restoReceiptId)
      }

      // Categoría y comprobante en los recibos del lote (IVA/IIBB una sola vez)
      await guardarDatosGasto(admin, receiptIds, gasto)

      // UN SOLO gasto en Fudo para toda la compra del proveedor.
      // Si vino invoiceTotal lo usamos (cubre ítems + importe sin detallar).
      // Si no, usamos la suma de los costos recibidos.
      const totalParaFudo = factura ?? (cargadoPorProducto > 0 ? Math.round(cargadoPorProducto * 100) / 100 : null)
      if (totalParaFudo && supplierId && resultados.some((r) => r.ok)) {
        const fudoDate = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
        const { data: batchSupp } = await admin.from('suppliers').select('fudo_provider_id').eq('id', supplierId).single()
        if (batchSupp?.fudo_provider_id) {
          const { createFudoExpenseForReceipt } = await import('@/lib/fudo/expenses')
          const batchExpense = await createFudoExpenseForReceipt({
            fudoProviderId: batchSupp.fudo_provider_id,
            qty: 1,
            costTotal: totalParaFudo,
            costPerUnit: null,
            receivedDate: fudoDate,
            gasto,
            medioPago: paymentMethod,
          })
          if (batchExpense) {
            // Vincular el gasto único a todos los recibos del lote
            if (receiptIds.length > 0) {
              await admin.from('stock_receipts').update({ fudo_expense_id: batchExpense.id }).in('id', receiptIds)
            }
            if (batchPaymentStatus === 'pagado') {
              const { postFudoPayment } = await import('@/lib/fudo/expenses')
              try {
                await postFudoPayment({ expenseId: batchExpense.id, amount: batchExpense.amount, medio: paymentMethod })
              } catch (payErr) {
                console.warn('[confirm_arrival_batch] Fudo payment failed (encolando):', payErr instanceof Error ? payErr.message : payErr)
                const firstReceiptId = receiptIds[0] ?? null
                if (firstReceiptId) {
                  const { encolarPagoGasto } = await import('@/lib/fudo/reintentos')
                  await encolarPagoGasto(admin, {
                    fudoExpenseId: batchExpense.id,
                    monto: batchExpense.amount,
                    receiptId: firstReceiptId,
                    error: payErr instanceof Error ? payErr.message : 'Fudo no aceptó el pago',
                    userId: user.id,
                    medio: paymentMethod,
                  })
                }
              }
            }
          } else {
            const firstReceiptId = receiptIds[0] ?? null
            if (firstReceiptId) {
              const { encolarCrearGasto } = await import('@/lib/fudo/reintentos')
              await encolarCrearGasto(admin, {
                fudoProviderId: batchSupp.fudo_provider_id,
                amount: totalParaFudo,
                date: fudoDate,
                receiptId: firstReceiptId,
                thenPay: batchPaymentStatus === 'pagado',
                error: 'Fudo no respondió al crear el gasto (batch)',
                userId: user.id,
                gasto,
                medio: paymentMethod,
              })
            }
          }
        }
      }

      const okCount = resultados.filter((r) => r.ok).length
      const who = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null
      logAudit(admin, {
        userId: user.id,
        userName: who,
        action: 'confirm_arrival_batch',
        module: 'pedidos',
        entityType: 'supplier',
        entityId: supplierId ?? undefined,
        description: `${who ?? 'Alguien'}: llegaron ${okCount} de ${llegan.length} productos juntos${noVinoOk ? ` · ${noVinoOk} no vinieron` : ''}${items.length - llegan.length - noVienen.length > 0 ? ` (${items.length - llegan.length - noVienen.length} quedan en camino)` : ''}${factura ? ` · factura $${factura.toLocaleString('es-AR')}` : ''} · ${paymentMethod}`,
        metadata: { resultados, invoiceTotal: factura, resto, paymentMethod, noVinieron: noVienen.map((i) => i.orderId), siguenEnCamino: items.filter((i) => !i.llego && i.noVino !== true).map((i) => i.orderId) },
      }).catch(() => {})

      return NextResponse.json({ success: okCount > 0 || noVinoOk > 0, resultados, recibidos: okCount, fallidos: llegan.length - okCount, resto, noVinieron: noVinoOk })
    }

    // ----- NO VINO: UN producto del pedido no llegó (cocina o barra) -----
    // Marca SOLO ese producto: no suma stock, no genera recibo ni gasto en
    // Fudo. El resto del pedido sigue en camino. Antes "No vino" usaba el
    // mismo 'cancelled' que "Cancelar" y avisaba "❌ Pedido cancelado".
    if (body.action === 'marcar_no_vino') {
      const { orderId, source, note } = body as { orderId?: unknown; source?: unknown; note?: unknown }
      if (typeof orderId !== 'number' || (source !== 'cocina' && source !== 'barra')) {
        return NextResponse.json({ success: false, error: 'orderId y source requeridos' }, { status: 400 })
      }
      const { data: profile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
      if (!profile || (profile.role !== 'encargado' && profile.role !== 'socio')) {
        return NextResponse.json({ success: false, error: 'Solo encargados y socios pueden marcar lo que no vino' }, { status: 403 })
      }
      const who = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null
      const r = await marcarNoVino(admin, user, who, { orderId, source, note: typeof note === 'string' ? note : null })
      return NextResponse.json(r.json, { status: r.status })
    }

    // ----- DESHACER "NO VINO" (se tocó por error): vuelve a en camino -----
    if (body.action === 'deshacer_no_vino') {
      const { orderId, source } = body as { orderId?: unknown; source?: unknown }
      if (typeof orderId !== 'number' || (source !== 'cocina' && source !== 'barra')) {
        return NextResponse.json({ success: false, error: 'orderId y source requeridos' }, { status: 400 })
      }
      const { data: profile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
      if (!profile || (profile.role !== 'encargado' && profile.role !== 'socio')) {
        return NextResponse.json({ success: false, error: 'Solo encargados y socios pueden cambiar esto' }, { status: 403 })
      }
      const table = source === 'barra' ? 'bar_orders' : 'kitchen_orders'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: vuelto, error } = await (admin.from(table) as any)
        .update({ status: 'ordered', received_mode: null, received_by: null, received_at: null, received_note: null })
        .eq('id', orderId)
        .eq('status', 'cancelled')
        .eq('received_mode', 'no_vino')
        .select('id, product_name')
      if (error) throw error
      if (!vuelto || vuelto.length === 0) {
        return NextResponse.json({ success: false, error: 'Ese producto ya no está marcado como "no vino"' }, { status: 409 })
      }
      const who = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null
      logAudit(admin, {
        userId: user.id,
        userName: who,
        action: 'deshacer_no_vino',
        module: 'pedidos',
        entityType: table,
        entityId: String(orderId),
        description: `${who ?? 'Alguien'} deshizo "no vino" de ${(vuelto[0] as { product_name?: string }).product_name ?? `#${orderId}`}: vuelve a en camino`,
        metadata: { orderId, source },
      }).catch(() => {})
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: false, error: 'Acción no reconocida' }, { status: 400 })
  } catch (error) {
    console.error('[/api/kitchen/orders] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// Confirmar la llegada de UN pedido (lo usan "Llegó" y "Llegó todo").
// Devuelve { status, json } en vez de la respuesta HTTP para poder usarse en
// lote: cada producto se procesa igual que si se confirmara solo.
// ---------------------------------------------------------------------------

type Resultado = { status: number; json: Record<string, unknown> }

/**
 * Guarda categoría y comprobante en los recibos. IVA e IIBB son de la factura
 * entera: van solo en el primero (si no, al sumar recibos se multiplicarían).
 * Las columnas las agrega supabase/migrations/20261005_stock_receipts_gasto_columns.sql:
 * si todavía no se corrió, no se guarda (en Fudo igual queda) y nada se corta.
 */
async function guardarDatosGasto(admin: ReturnType<typeof createAdminClient>, receiptIds: number[], gasto: DatosGasto | null) {
  if (!gasto || receiptIds.length === 0) return
  const comunes = {
    expense_category_id: gasto.categoriaId,
    expense_category_name: gasto.categoriaNombre,
    comprobante_tipo: gasto.comprobante,
    comprobante_numero: gasto.numero,
  }
  const [primero, ...resto] = receiptIds
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recibos = admin.from('stock_receipts') as any
  const { error } = await recibos.update({ ...comunes, iva: gasto.iva, iibb: gasto.iibb }).eq('id', primero)
  if (!error && resto.length > 0) await recibos.update(comunes).in('id', resto)
  if (error) console.warn('[datos del gasto] no se guardaron en el recibo (¿falta la migración?):', error.message)
}
const respuesta = (json: Record<string, unknown>, init?: { status?: number }): Resultado => ({ json, status: init?.status ?? 200 })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function confirmarLlegada(admin: ReturnType<typeof createAdminClient>, user: { id: string }, body: any): Promise<Resultado> {
  const { orderId, source, mode, expense, receivedQty, unitCost, totalCost, amount, note, paymentMethod, expiresAt, skipFudoExpense } = body as {
    orderId: number
    source: 'cocina' | 'barra'
    mode: 'fudo_expense' | 'lve_stock' | 'sin_stock'
    expense?: { id: string; amount: number } | null
    receivedQty?: string | null
    unitCost?: number | null
    /** lve_stock: total pagado del ticket — si viene, el precio unitario lo deriva el SERVER con la cantidad normalizada */
    totalCost?: number | null
    /** sin_stock: monto del gasto (no es un precio unitario) */
    amount?: number | null
    note?: string | null
    /** efectivo | transferencia | tarjeta | cuenta_corriente */
    paymentMethod?: string | null
    /** solo lve_stock: fecha de vencimiento del lote recibido (YYYY-MM-DD) */
    expiresAt?: string | null
    /** batch: si true, no crea gasto en Fudo (el batch handler lo hace una sola vez) */
    skipFudoExpense?: boolean
  }
  // Categoría y comprobante (en lote los guarda el batch, una vez por factura)
  let gasto = skipFudoExpense ? null : parseDatosGasto((body as { gasto?: unknown }).gasto)
  // cuenta_corriente → queda en cuentas a pagar; el resto → pagado de contado
  const paymentStatus: 'pagado' | 'a_pagar' = paymentMethod === 'cuenta_corriente' ? 'a_pagar' : 'pagado'
  if (typeof orderId !== 'number' || !source || !mode) {
    return respuesta({ success: false, error: 'Faltan datos requeridos' }, { status: 400 })
  }
  // sin_stock tiene su propio campo de monto: unitCost/totalCost se ignoran
  // en ese modo (eran estado compartido del diálogo y llegaban de más).
  const sinStockAmount = mode === 'sin_stock' && typeof amount === 'number' && amount > 0 ? amount : null
  // Devueltos al batch handler para que vincule el gasto único de Fudo a este recibo
  let batchReceiptId: number | null = null
  let batchCostTotal: number | null = null
  // Con monto en juego, el medio de pago es OBLIGATORIO: sin él, el gasto
  // no deja rastro en cuentas (ni "pagado" ni "a pagar").
  if (mode === 'fudo_expense' && expense && !paymentMethod) {
    return respuesta({ success: false, error: 'Elegí el medio de pago: sin él, el monto no queda en cuentas' }, { status: 400 })
  }
  if (mode === 'sin_stock' && sinStockAmount != null && !paymentMethod) {
    return respuesta({ success: false, error: 'Elegí el medio de pago: sin él, el monto no queda en cuentas' }, { status: 400 })
  }
  const { data: profile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
  if (!profile || (profile.role !== 'encargado' && profile.role !== 'socio')) {
    return respuesta({ success: false, error: 'Solo encargados pueden confirmar recepciones' }, { status: 403 })
  }
  if (!skipFudoExpense) gasto = conCargadoPor(gasto, [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null)
  const table = source === 'barra' ? 'bar_orders' : 'kitchen_orders'
  const { data: order, error: fetchErr } = await admin
    .from(table)
    .select('id, product_name, quantity, status, stock_item_id, supplier_id')
    .eq('id', orderId)
    .single()
  if (fetchErr || !order) return respuesta({ success: false, error: 'Pedido no encontrado' }, { status: 404 })
  if (order.status === 'received') return respuesta({ success: false, error: 'El pedido ya fue recibido' }, { status: 409 })

  // Un gasto de Fudo explica UN pedido: si ya está vinculado a otro
  // (cocina o barra), rechazar antes de tocar nada. Tolerante a migración
  // pendiente de fudo_expense_id (sin la columna no hay nada que chequear).
  if (mode === 'fudo_expense' && expense) {
    for (const t of ['kitchen_orders', 'bar_orders'] as const) {
      const dup = await admin.from(t).select('id').eq('fudo_expense_id', expense.id).limit(1)
      if (dup.error) continue
      if ((dup.data ?? []).length > 0) {
        return respuesta({ success: false, error: 'Ese gasto ya está vinculado a otro pedido' }, { status: 409 })
      }
    }
  }

  let stockUpdated = false
  let fudoSynced = false
  let lveExpense: { id: string; amount: number } | null = null
  if (mode === 'lve_stock') {
    // Manda lo que eligió la persona en el diálogo: puede corregir el
    // insumo pre-vinculado del pedido (si no, la entrada caía en el item
    // equivocado, en LVE y en Fudo).
    const stockItemId = (body.stockItemId as string | undefined)
      ?? (order as { stock_item_id?: string | null }).stock_item_id
      ?? null
    const numericQty = parseFloat(String(receivedQty ?? '').replace(',', '.'))
    if (!stockItemId || isNaN(numericQty) || numericQty <= 0) {
      return respuesta({ success: false, error: 'Para cargar stock desde acá hace falta el insumo y la cantidad recibida' }, { status: 400 })
    }
    const { data: si } = await admin
      .from('stock_items')
      .select('id, name, unit, current_qty, cost_per_unit, supplier_id, fudo_ingredient_id')
      .eq('id', stockItemId)
      .single()
    if (!si) return respuesta({ success: false, error: 'Insumo no encontrado' }, { status: 404 })
    const receivedUnit = parseTypedUnit(receivedQty) ?? si.unit
    const normalized = normalizeToStockUnit(numericQty, receivedUnit, si)
    if (!normalized.ok) return respuesta({ success: false, error: normalized.error }, { status: 409 })
    const qty = normalized.qty
    // El TOTAL pagado manda: si vino, el precio unitario lo deriva el
    // SERVER con la cantidad YA normalizada (ignorando el unitCost del
    // cliente). Así el sellado cost_source='compra' nunca depende de la
    // conversión de unidades del navegador ('500 g' → $/kg reales).
    const totalNum = typeof totalCost === 'number' && totalCost > 0 ? totalCost : null
    const costPerUnit = totalNum != null
      ? Math.round((totalNum / qty) * 10000) / 10000
      : (typeof unitCost === 'number' && unitCost > 0 ? unitCost : null)
    if (costPerUnit != null && costPerUnit > 2_000_000) {
      return respuesta({
        success: false,
        error: `El precio unitario ($${Math.round(costPerUnit).toLocaleString('es-AR')}/${si.unit}) parece un error de carga. Verificá el monto antes de continuar.`,
      }, { status: 422 })
    }
    // syncToFudo con reason 'reception' escribe por DELTA sobre Fudo y deja kardex
    const write = await syncToFudo(admin, stockItemId, Math.round((Number(si.current_qty ?? 0) + qty) * 100) / 100, user.id, {
      reason: 'reception',
      note: `Recepción: ${order.product_name} (+${qty} ${si.unit})${note ? ` — ${note}` : ''}`,
      costPerUnit,
    })
    if (!write.success) {
      return respuesta({ success: false, error: write.error ?? 'No se pudo actualizar el stock' }, { status: 502 })
    }
    stockUpdated = true
    fudoSynced = write.fudoSynced
    // Recibo (precio de compra) — base del historial de precios + cuentas a pagar
    const receivedDate = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
    // El proveedor del PEDIDO toma prioridad (el encargado lo asignó explícitamente);
    // el proveedor del insumo es solo el default para órdenes nuevas, no para el recibo.
    const effectiveSupplierId = (order as { supplier_id?: string | null }).supplier_id ?? si.supplier_id ?? null
    const receiptBase = {
      stock_item_id: stockItemId,
      supplier_id: effectiveSupplierId,
      order_source: source,
      order_id: orderId,
      qty,
      unit: si.unit,
      cost_total: totalNum ?? (costPerUnit != null ? Math.round(costPerUnit * qty * 100) / 100 : null),
      cost_per_unit: costPerUnit,
      note: `Pedido: ${order.product_name} (${order.quantity})`,
      received_by: user.id,
      received_date: receivedDate,
    }
    let lveReceiptId: number | null = null
    const { data: receiptInserted, error: lveReceiptErr } = await admin.from('stock_receipts').insert({
      ...receiptBase,
      payment_status: paymentStatus,
      paid_at: paymentStatus === 'pagado' ? new Date().toISOString() : null,
      paid_by: paymentStatus === 'pagado' ? user.id : null,
      payment_method: paymentMethod ?? null,
    }).select('id').single()
    if (lveReceiptErr) console.warn('[confirm_arrival] lve_stock receipt no registrado:', lveReceiptErr.message)
    lveReceiptId = (receiptInserted as { id?: number } | null)?.id ?? null
    if (lveReceiptId) await guardarDatosGasto(admin, [lveReceiptId], gasto)
    batchReceiptId = lveReceiptId
    batchCostTotal = receiptBase.cost_total

    if (!skipFudoExpense) {
      // Crear gasto en Fudo si el proveedor y el monto están disponibles.
      // Usa receiptBase.cost_total que ya tiene el fallback unitCost × qty,
      // por si el encargado cargó solo el precio unitario y no el total.
      const receiptCostTotal = receiptBase.cost_total
      let lveExpenseFudoProviderId: string | null = null
      if (receiptCostTotal != null && receiptCostTotal > 0 && effectiveSupplierId) {
        const { data: suppRow } = await admin
          .from('suppliers')
          .select('fudo_provider_id')
          .eq('id', effectiveSupplierId)
          .single()
        if (suppRow?.fudo_provider_id) {
          lveExpenseFudoProviderId = suppRow.fudo_provider_id
          const { createFudoExpenseForReceipt } = await import('@/lib/fudo/expenses')
          lveExpense = await createFudoExpenseForReceipt({
            fudoProviderId: suppRow.fudo_provider_id,
            fudoIngredientId: si.fudo_ingredient_id ?? null,
            qty,
            costTotal: receiptCostTotal,
            costPerUnit,
            receivedDate,
            gasto,
            medioPago: paymentMethod,
          })
        }
      }

      // Guardar fudo_expense_id en el recibo, o encolar para reintento si Fudo falló
      if (lveExpense && lveReceiptId) {
        await admin.from('stock_receipts').update({ fudo_expense_id: lveExpense.id }).eq('id', lveReceiptId)
      } else if (!lveExpense && lveExpenseFudoProviderId && receiptCostTotal != null && receiptCostTotal > 0 && lveReceiptId) {
        const { encolarCrearGasto } = await import('@/lib/fudo/reintentos')
        await encolarCrearGasto(admin, {
          fudoProviderId: lveExpenseFudoProviderId,
          amount: receiptCostTotal,
          date: receivedDate,
          receiptId: lveReceiptId,
          thenPay: paymentStatus === 'pagado',
          error: 'Fudo no respondió al crear el gasto (lve_stock)',
          userId: user.id,
          gasto,
          medio: paymentMethod,
        })
      }

      // Si el gasto se creó en Fudo y el pago fue de contado, imputar el payment
      if (lveExpense && paymentStatus === 'pagado') {
        const { postFudoPayment } = await import('@/lib/fudo/expenses')
        try {
          await postFudoPayment({ expenseId: lveExpense.id, amount: lveExpense.amount, medio: paymentMethod })
        } catch (payErr) {
          console.warn('[confirm_arrival] Fudo payment post failed (encolando):', payErr instanceof Error ? payErr.message : payErr)
          if (lveReceiptId) {
            const { encolarPagoGasto } = await import('@/lib/fudo/reintentos')
            await encolarPagoGasto(admin, {
              fudoExpenseId: lveExpense.id,
              monto: lveExpense.amount,
              receiptId: lveReceiptId,
              error: payErr instanceof Error ? payErr.message : 'Fudo no aceptó el pago',
              userId: user.id,
              medio: paymentMethod,
            })
          }
        }
      }
    }

    // Vencimiento informado → lote para el radar de vencimientos
    if (expiresAt) {
      await admin.from('stock_lots').insert({
        stock_item_id: stockItemId,
        lot_code: `REC-${receivedDate}-${si.name.slice(0, 12).replace(/\s+/g, '').toUpperCase()}`,
        qty_original: qty,
        qty_remaining: qty,
        unit: si.unit,
        produced_at: new Date().toISOString(),
        expires_at: expiresAt,
        status: 'active',
        notes: 'Recepción de mercadería',
        created_by: user.id,
      }).then(({ error }) => { if (error) console.warn('[confirm_arrival] lote no creado:', error.message) })
    }
  }

  // fudo_expense: la compra ya existe en Fudo — LVE NO toca stock, pero
  // crea el recibo (historial de precios + cuentas a pagar) y, si el
  // diálogo dedujo un precio unitario (gasto mono-insumo / cantidad
  // parseable), lo sella como costo REAL del insumo (cost_source 'compra').
  if (mode === 'fudo_expense' && paymentMethod) {
    const supplierId = (order as { supplier_id?: string | null }).supplier_id ?? null
    const receivedDate = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
    const feStockItemId = (body.stockItemId as string | undefined)
      ?? (order as { stock_item_id?: string | null }).stock_item_id
      ?? null
    const feUnitCost = typeof unitCost === 'number' && unitCost > 0 ? unitCost : null
    let feQty = 1
    let feUnit: string | null = null
    if (feStockItemId) {
      const { data: si } = await admin.from('stock_items').select('id, name, unit').eq('id', feStockItemId).single()
      if (si) {
        feUnit = si.unit
        const parsedQty = parseFloat(String(order.quantity ?? '').replace(',', '.'))
        if (Number.isFinite(parsedQty) && parsedQty > 0) {
          // Misma normalización que lve_stock: '500 g' en un item en kg
          // queda 0.5 kg en el recibo. Si la unidad tipeada no es
          // convertible, el recibo guarda la cantidad EN ESA unidad.
          const typedUnit = parseTypedUnit(order.quantity)
          const norm = normalizeToStockUnit(parsedQty, typedUnit ?? si.unit, si)
          if (norm.ok) {
            feQty = norm.qty
          } else {
            feQty = parsedQty
            feUnit = typedUnit
          }
        }
        if (feUnitCost != null) {
          const { error: costErr } = await admin.from('stock_items').update({
            cost_per_unit: feUnitCost,
            cost_source: 'compra',
            cost_updated_at: new Date().toISOString(),
          }).eq('id', feStockItemId)
          if (costErr && esErrorColumnaFaltante(costErr.message, ['cost_source', 'cost_updated_at'])) {
            await admin.from('stock_items').update({ cost_per_unit: feUnitCost }).eq('id', feStockItemId)
          }
        }
      }
    }
    const receiptBase = {
      stock_item_id: feStockItemId,
      supplier_id: supplierId,
      order_source: source,
      order_id: orderId,
      qty: feQty,
      unit: feUnit,
      cost_total: expense?.amount ?? (feUnitCost != null ? Math.round(feUnitCost * feQty * 100) / 100 : null),
      cost_per_unit: feUnitCost,
      note: `Pedido: ${order.product_name} (${order.quantity})${expense ? ` — Fudo gasto #${expense.id}` : ''}`,
      received_by: user.id,
      received_date: receivedDate,
    }
    let { error: feReceiptErr } = await admin.from('stock_receipts').insert({
      ...receiptBase,
      payment_status: paymentStatus,
      paid_at: paymentStatus === 'pagado' ? new Date().toISOString() : null,
      paid_by: paymentStatus === 'pagado' ? user.id : null,
      payment_method: paymentMethod,
    })
    if (feReceiptErr && /payment_method|payment_status|paid_at|paid_by/.test(feReceiptErr.message)) {
      ;({ error: feReceiptErr } = await admin.from('stock_receipts').insert(receiptBase))
    }
    if (feReceiptErr) console.warn('[confirm_arrival] fudo_expense receipt no registrado:', feReceiptErr.message)
  }

  // sin_stock con monto: dejar registro de gasto para cuentas a pagar
  if (mode === 'sin_stock' && paymentMethod && sinStockAmount != null) {
    const sinStockSupplierId = (order as { supplier_id?: string | null }).supplier_id ?? null
    const receivedDate = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
    const { data: ssReceiptInserted, error: ssReceiptErr } = await admin.from('stock_receipts').insert({
      stock_item_id: null as string | null,
      supplier_id: sinStockSupplierId,
      order_source: source,
      order_id: orderId,
      qty: 1,
      unit: null as string | null,
      cost_total: sinStockAmount,
      cost_per_unit: null as number | null,
      note: `Pedido: ${order.product_name} (${order.quantity})`,
      received_by: user.id,
      received_date: receivedDate,
      payment_status: paymentStatus,
      paid_at: paymentStatus === 'pagado' ? new Date().toISOString() : null,
      paid_by: paymentStatus === 'pagado' ? user.id : null,
      payment_method: paymentMethod,
    }).select('id').single()
    if (ssReceiptErr) console.warn('[confirm_arrival] sin_stock receipt no registrado:', ssReceiptErr.message)

    const ssReceiptId = (ssReceiptInserted as { id?: number } | null)?.id ?? null
    if (ssReceiptId) await guardarDatosGasto(admin, [ssReceiptId], gasto)
    batchReceiptId = ssReceiptId
    batchCostTotal = sinStockAmount

    if (!skipFudoExpense) {
      // Crear gasto en Fudo si el proveedor tiene fudo_provider_id
      if (ssReceiptId && sinStockSupplierId && sinStockAmount > 0) {
        const { data: sinStockSupp } = await admin.from('suppliers').select('fudo_provider_id').eq('id', sinStockSupplierId).single()
        if (sinStockSupp?.fudo_provider_id) {
          const { createFudoExpenseForReceipt } = await import('@/lib/fudo/expenses')
          const sinStockFudoExpense = await createFudoExpenseForReceipt({
            fudoProviderId: sinStockSupp.fudo_provider_id,
            qty: 1,
            costTotal: sinStockAmount,
            costPerUnit: null,
            receivedDate,
            gasto,
            medioPago: paymentMethod,
          })
          if (sinStockFudoExpense) {
            lveExpense = sinStockFudoExpense
            await admin.from('stock_receipts').update({ fudo_expense_id: sinStockFudoExpense.id }).eq('id', ssReceiptId)
            if (paymentStatus === 'pagado') {
              const { postFudoPayment } = await import('@/lib/fudo/expenses')
              try {
                await postFudoPayment({ expenseId: sinStockFudoExpense.id, amount: sinStockFudoExpense.amount, medio: paymentMethod })
              } catch (payErr) {
                console.warn('[confirm_arrival] sin_stock Fudo payment post failed (encolando):', payErr instanceof Error ? payErr.message : payErr)
                const { encolarPagoGasto } = await import('@/lib/fudo/reintentos')
                await encolarPagoGasto(admin, {
                  fudoExpenseId: sinStockFudoExpense.id,
                  monto: sinStockFudoExpense.amount,
                  receiptId: ssReceiptId,
                  error: payErr instanceof Error ? payErr.message : 'Fudo no aceptó el pago',
                  userId: user.id,
                  medio: paymentMethod,
                })
              }
            }
          } else {
            const { encolarCrearGasto } = await import('@/lib/fudo/reintentos')
            await encolarCrearGasto(admin, {
              fudoProviderId: sinStockSupp.fudo_provider_id,
              amount: sinStockAmount,
              date: receivedDate,
              receiptId: ssReceiptId,
              thenPay: paymentStatus === 'pagado',
              error: 'Fudo no respondió al crear el gasto (sin_stock)',
              userId: user.id,
              gasto,
              medio: paymentMethod,
            })
          }
        }
      }
    }
  }

  const { closeOrderWithExpense } = await import('@/lib/compras/conciliar')
  const closed = await closeOrderWithExpense(admin, {
    orderId,
    source,
    userId: user.id,
    expense: mode === 'fudo_expense' ? (expense ?? null) : (mode === 'lve_stock' || mode === 'sin_stock') ? (lveExpense ?? null) : null,
    mode,
    note: note ?? null,
    receivedQty: receivedQty ?? null,
  })
  if (!closed.success) throw new Error(closed.error)

  const who = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null
  logAudit(admin, {
    userId: user.id,
    userName: who,
    action: 'confirm_arrival',
    module: 'pedidos',
    entityType: table,
    entityId: String(orderId),
    description: mode === 'fudo_expense'
      ? `Llegó pedido #${orderId} (${order.product_name}) — compra cargada en Fudo${expense ? ` ($${expense.amount.toLocaleString('es-AR')}, gasto #${expense.id})` : ''}${paymentMethod ? ` · ${paymentMethod}` : ''}`
      : mode === 'lve_stock'
        ? `Llegó pedido #${orderId} (${order.product_name}) — stock cargado desde LVE (${receivedQty})${paymentMethod ? ` · ${paymentMethod}` : ''}`
        : `Llegó pedido #${orderId} (${order.product_name}) — sin movimiento de stock`,
    metadata: { orderId, source, mode, expense: expense ?? null, receivedQty: receivedQty ?? null, unitCost: unitCost ?? null, totalCost: totalCost ?? null, amount: sinStockAmount, expiresAt: expiresAt ?? null, note: note ?? null, stockUpdated, paymentMethod: paymentMethod ?? null },
  }).catch(() => {})

  return respuesta({ success: true, stockUpdated, fudoSynced, mode, receiptId: batchReceiptId, costTotal: batchCostTotal })
}

// ---------------------------------------------------------------------------
// "No vino": cierra UN producto del pedido sin recibirlo.
// ---------------------------------------------------------------------------
// - Queda status 'cancelled' + received_mode 'no_vino' (así se distingue de
//   "Cancelar", que es no pedirlo). received_by/received_at = quién y cuándo
//   lo marcó. No toca stock, no crea recibo, no crea gasto ni pago en Fudo.
// - El resto del pedido (mismo proveedor, mismo envío) sigue en camino.
// - El "pedido" no tiene cabecera propia: es el grupo de productos enviados
//   juntos (mismo proveedor + mismo ordered_at). Se cierra solo cuando no le
//   queda nada en camino; si NINGUNO vino, ese pedido quedó cancelado.
// - Como el stock no subió, el insumo vuelve a aparecer en "Pedir" con la
//   marca "no vino en el último pedido" (ver lib/compras/sugerencias.ts).
// ---------------------------------------------------------------------------

async function marcarNoVino(
  admin: ReturnType<typeof createAdminClient>,
  user: { id: string },
  who: string | null,
  params: { orderId: number; source: 'cocina' | 'barra'; note?: string | null; avisar?: boolean },
): Promise<Resultado> {
  const { orderId, source } = params
  const note = (params.note ?? '').trim().slice(0, 300) || null
  const table = source === 'barra' ? 'bar_orders' : 'kitchen_orders'
  const authorCol = source === 'barra' ? 'requested_by' : 'created_by'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabla = () => admin.from(table) as any
  const { data: order, error: fetchErr } = await tabla()
    .select(`id, product_name, quantity, status, supplier_id, ordered_at, received_mode, ${authorCol}`)
    .eq('id', orderId)
    .maybeSingle()
  if (fetchErr) return respuesta({ success: false, error: fetchErr.message }, { status: 500 })
  if (!order) return respuesta({ success: false, error: 'Pedido no encontrado' }, { status: 404 })
  const o = order as { id: number; product_name: string; quantity: string; status: string; supplier_id: string | null; ordered_at: string | null; received_mode: string | null } & Record<string, unknown>

  // Doble toque o pantalla vieja: ya estaba marcado, no se repite nada
  if (o.status === 'cancelled' && o.received_mode === 'no_vino') {
    return respuesta({ success: true, yaEstaba: true, ...(await estadoDelPedido(tabla, o)) })
  }
  if (o.status !== 'ordered') {
    const estado = o.status === 'received' ? 'ya fue recibido' : o.status === 'pending' ? 'todavía no se pidió al proveedor' : 'ya estaba cancelado'
    return respuesta({ success: false, error: `${o.product_name} ${estado}` }, { status: 409 })
  }

  // Solo si sigue en camino (si otro lo recibió recién, no lo pisamos)
  const { data: upd, error: upErr } = await tabla()
    .update({ status: 'cancelled', received_mode: 'no_vino', received_by: user.id, received_at: new Date().toISOString(), received_note: note })
    .eq('id', orderId)
    .eq('status', 'ordered')
    .select('id')
  if (upErr) return respuesta({ success: false, error: upErr.message }, { status: 500 })
  if (!upd || upd.length === 0) {
    return respuesta({ success: false, error: `${o.product_name} cambió recién (¿lo recibió otra persona?). Actualizá la pantalla.` }, { status: 409 })
  }

  const estado = await estadoDelPedido(tabla, o)

  logAudit(admin, {
    userId: user.id,
    userName: who,
    action: 'order_no_vino',
    module: 'pedidos',
    entityType: table,
    entityId: String(orderId),
    description: `${who ?? 'Alguien'}: no vino ${o.product_name} (${o.quantity})${estado.siguenEnCamino > 0 ? ` · ${estado.siguenEnCamino} del mismo pedido siguen en camino` : estado.ningunoVino ? ' · no vino nada de ese pedido: quedó cancelado' : ' · el pedido quedó cerrado'}`,
    metadata: { orderId, source, note, ...estado },
  }).catch(() => {})

  // Aviso a quien lo pidió: que no vino ESTE producto (no "pedido cancelado")
  const autor = (o[authorCol] as string | null | undefined) ?? null
  if (autor && params.avisar !== false) {
    await admin.from('announcements').insert({
      author_id: user.id,
      type: 'operativo',
      priority: 'baja',
      title: `🚫 No vino: ${o.product_name}`,
      body: `${o.product_name} (${o.quantity}) — el proveedor no lo trajo. El resto del pedido sigue su curso; si hace falta, se vuelve a pedir.`,
      scope: 'user',
      target_user_id: autor,
      is_active: true,
    }).then(() => null, () => null)
    try {
      const { notifyOrderStatusChange } = await import('@/lib/email/send')
      // after(): igual que los otros avisos, que Vercel no corte el mail al responder
      after(() => notifyOrderStatusChange({ userId: autor, productName: o.product_name, quantity: o.quantity, newStatus: 'no_vino' }).catch(() => {}))
    } catch { /* email opcional */ }
  }

  return respuesta({ success: true, ...estado })
}

/**
 * Cómo quedó el pedido al que pertenece el producto: los enviados juntos
 * (mismo proveedor + mismo ordered_at, así los crea create_order).
 */
async function estadoDelPedido(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tabla: () => any,
  o: { id: number; supplier_id: string | null; ordered_at: string | null },
): Promise<{ siguenEnCamino: number; recibidos: number; noVinieron: number; pedidoCerrado: boolean; ningunoVino: boolean }> {
  const solo = { siguenEnCamino: 0, recibidos: 0, noVinieron: 1, pedidoCerrado: true, ningunoVino: true }
  if (!o.ordered_at) return solo
  let q = tabla().select('id, status, received_mode').eq('ordered_at', o.ordered_at)
  q = o.supplier_id ? q.eq('supplier_id', o.supplier_id) : q.is('supplier_id', null)
  const { data, error } = await q
  if (error || !data) return solo
  const filas = data as { id: number; status: string; received_mode: string | null }[]
  const siguenEnCamino = filas.filter((f) => f.status === 'ordered').length
  const recibidos = filas.filter((f) => f.status === 'received').length
  const noVinieron = filas.filter((f) => f.status === 'cancelled' && f.received_mode === 'no_vino').length
  return {
    siguenEnCamino,
    recibidos,
    noVinieron,
    pedidoCerrado: siguenEnCamino === 0,
    ningunoVino: siguenEnCamino === 0 && recibidos === 0,
  }
}
