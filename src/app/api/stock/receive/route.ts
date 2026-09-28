import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncToFudo } from '@/lib/fudo/stock-sync'
import { normalizeToStockUnit } from '@/lib/produccion/units'
import { esErrorColumnaFaltante } from '@/lib/costos/confiable'

// ---------------------------------------------------------------------------
// POST /api/stock/receive — Recepción de mercadería (encargado, teléfono en mano)
// Body: {
//   stock_item_id: string        item al que entra la mercadería
//   qty: number                  cantidad recibida (en `unit`)
//   unit?: string                default: unidad del item
//   cost_total?: number          lo pagado por esta entrada (opcional)
//   freeze_qty?: number          cuánto va al freezer (opcional)
//   freeze_days?: number         vencimiento del lote frizado (opcional)
//   order_source?: 'cocina'|'barra', order_id?: number   pedido que se recibe
//   supplier_id?: string, note?: string
// }
// Efectos: stock += qty (Fudo primero si está vinculado), registra la entrada
// en stock_receipts (costo/proveedor/fecha), lote de freezer opcional, y marca
// el pedido como recibido.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Solo encargado o socio pueden recibir mercadería' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const stockItemId = String(body.stock_item_id ?? '')
    const qtyRaw = Number(body.qty)
    if (!stockItemId || !Number.isFinite(qtyRaw) || qtyRaw <= 0) {
      return NextResponse.json({ error: 'Faltan stock_item_id o qty (> 0)' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: item } = await admin
      .from('stock_items')
      .select('id, name, unit, current_qty, cost_per_unit, supplier_id')
      .eq('id', stockItemId)
      .single()

    if (!item) return NextResponse.json({ error: 'Item de stock no encontrado' }, { status: 404 })

    // Normalizar unidad (ej: recibió en g y el stock está en kg)
    const unit = typeof body.unit === 'string' && body.unit ? body.unit : item.unit
    const normalized = normalizeToStockUnit(qtyRaw, unit, item)
    if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 409 })
    const qty = normalized.qty

    // 1) Subir stock — Fudo primero si está vinculado (misma vía que el conteo)
    const newQty = Math.round((Number(item.current_qty) + qty) * 100) / 100
    const write = await syncToFudo(admin, stockItemId, newQty, user.id, {
      reason: 'reception',
      note: `Recepción de mercadería: +${qty} ${item.unit}${body.note ? ` — ${body.note}` : ''}`,
    })
    if (!write.success) {
      return NextResponse.json({ error: write.error ?? 'No se pudo actualizar el stock' }, { status: 502 })
    }

    // 2) Registrar la entrada (la base de mermas y frecuencia de compra)
    const costTotal = Number.isFinite(Number(body.cost_total)) && Number(body.cost_total) > 0 ? Number(body.cost_total) : null
    const costPerUnit = costTotal != null ? Math.round((costTotal / qty) * 100) / 100 : null
    const receivedDate = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)

    const { error: receiptErr } = await admin.from('stock_receipts').insert({
      stock_item_id: stockItemId,
      supplier_id: body.supplier_id ?? item.supplier_id ?? null,
      order_source: body.order_source ?? null,
      order_id: body.order_id ?? null,
      qty,
      unit: item.unit,
      cost_total: costTotal,
      cost_per_unit: costPerUnit,
      freeze_qty: Number.isFinite(Number(body.freeze_qty)) && Number(body.freeze_qty) > 0 ? Number(body.freeze_qty) : null,
      expires_at: null,
      note: typeof body.note === 'string' ? body.note : null,
      received_by: user.id,
      received_date: receivedDate,
    })
    if (receiptErr) console.error('[stock/receive] receipt no registrado:', receiptErr.message)

    // 3) Actualizar costo unitario del item si vino el costo de compra.
    //    Precio de compra real → cost_source 'compra' (fuente CONFIABLE).
    if (costPerUnit != null) {
      const costUpdate = {
        cost_per_unit: costPerUnit,
        cost_source: 'compra',
        cost_updated_at: new Date().toISOString(),
      }
      const { error: costErr } = await admin.from('stock_items').update(costUpdate).eq('id', stockItemId)
      if (costErr && esErrorColumnaFaltante(costErr.message, ['cost_source', 'cost_updated_at'])) {
        // Migración pendiente: guardar al menos el costo
        await admin.from('stock_items').update({ cost_per_unit: costPerUnit }).eq('id', stockItemId)
      }
    }

    // 4) Lote de freezer opcional
    let lotCreated = false
    const freezeQty = Number(body.freeze_qty)
    const freezeDays = Number(body.freeze_days)
    if (Number.isFinite(freezeQty) && freezeQty > 0) {
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + (Number.isFinite(freezeDays) && freezeDays > 0 ? freezeDays : 90))
      const { error: lotErr } = await admin.from('stock_lots').insert({
        stock_item_id: stockItemId,
        lot_code: `REC-${receivedDate}-${item.name.slice(0, 12).replace(/\s+/g, '').toUpperCase()}`,
        qty_original: freezeQty,
        qty_remaining: freezeQty,
        unit: item.unit,
        produced_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        status: 'active',
        notes: 'Freezer — recepción de mercadería',
        created_by: user.id,
      })
      lotCreated = !lotErr
      if (lotErr) console.error('[stock/receive] lote no creado:', lotErr.message)
    }

    // 5) Marcar el pedido como recibido
    if (body.order_id && (body.order_source === 'cocina' || body.order_source === 'barra')) {
      const table = body.order_source === 'barra' ? 'bar_orders' : 'kitchen_orders'
      await admin.from(table).update({ status: 'received' }).eq('id', Number(body.order_id))
    }

    return NextResponse.json({
      success: true,
      item: item.name,
      new_qty: newQty,
      fudo_synced: write.fudoSynced,
      cost_per_unit: costPerUnit,
      lot_created: lotCreated,
    })
  } catch (error) {
    console.error('[POST /api/stock/receive]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
