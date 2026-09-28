import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeToStockUnit } from '@/lib/produccion/units'
import type { Database } from '@/types/database'

type ProductionOutputInsert = Database['public']['Tables']['production_outputs']['Insert']
type ProductionOutputPayload = Omit<ProductionOutputInsert, 'production_order_id'>

// ---------------------------------------------------------------------------
// GET /api/produccion/orders/[id]
// Devuelve la orden completa con inputs, outputs y sub-órdenes.
// ---------------------------------------------------------------------------
// PATCH /api/produccion/orders/[id]
// Actualiza la orden. Permite:
//   - Cambiar name, notes, status (solo a 'in_progress' o 'cancelled')
//   - Agregar un input:  { action: 'add_input',  stock_item_id, qty_used, unit }
//   - Eliminar un input: { action: 'del_input',  input_id }
//   - Agregar un output: { action: 'add_output', stock_item_id?, output_name, qty_produced, unit, is_waste?, notes?, theoretical_qty?, lot_code?, produced_at?, expires_at? }
//   - Eliminar un output:{ action: 'del_output', output_id }
//   - Actualizar output: { action: 'upd_output', output_id, qty_produced, notes?, lot_code?, produced_at?, expires_at? }
// ---------------------------------------------------------------------------

async function authorize(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
    return { user: null, error: NextResponse.json({ error: 'Sin acceso' }, { status: 403 }) }
  }
  return { user, profile, error: null }
}

function isLotSchemaError(message: string | undefined) {
  if (!message) return false
  return (
    message.includes('lot_code')
    || message.includes('produced_at')
    || message.includes('expires_at')
    || message.includes('stock_lots')
  )
}

function buildOutputPayload(body: Record<string, unknown>, includeLotFields: boolean): ProductionOutputPayload {
  const payload: ProductionOutputPayload = {
    stock_item_id: typeof body.stock_item_id === 'string' ? body.stock_item_id : null,
    output_name: String(body.output_name ?? ''),
    qty_produced: Number(body.qty_produced),
    theoretical_qty: body.theoretical_qty != null ? Number(body.theoretical_qty) : null,
    unit: typeof body.unit === 'string' ? body.unit : 'kg',
    is_waste: Boolean(body.is_waste),
    notes: typeof body.notes === 'string' ? body.notes : null,
  }

  if (includeLotFields) {
    payload.lot_code = typeof body.lot_code === 'string' ? body.lot_code.trim() || null : null
    payload.produced_at = typeof body.produced_at === 'string' ? body.produced_at : null
    payload.expires_at = typeof body.expires_at === 'string' ? body.expires_at : null
  }

  return payload
}

type StockItemInfo = { id: string; name: string; unit: string; fudo_ingredient_id: string | null; fudo_product_id: string | null }

async function validateStockMapping(
  admin: ReturnType<typeof createAdminClient>,
  stockItemId: string | null | undefined,
): Promise<{ error: string | null; item: StockItemInfo | null }> {
  if (!stockItemId) return { error: null, item: null }

  const { data: item, error } = await admin
    .from('stock_items')
    .select('id, name, unit, fudo_ingredient_id, fudo_product_id, fudo_skip')
    .eq('id', stockItemId)
    .single()

  if (error || !item) return { error: error?.message ?? 'Item de stock no encontrado', item: null }

  if (!item.fudo_ingredient_id && !item.fudo_product_id && !(item as { fudo_skip?: boolean | null }).fudo_skip) {
    return { error: `${item.name}: sin vínculo Fudo`, item: item as StockItemInfo }
  }

  return { error: null, item: item as StockItemInfo }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { error: authErr } = await authorize(supabase)
    if (authErr) return authErr

    const { id: idStr } = await params
    const id = Number(idStr)
    if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const admin = createAdminClient()

    const [orderRes, inputsRes, outputsRes, childRes] = await Promise.all([
      admin
        .from('production_orders')
        .select(`
          *,
          production_templates(name),
          profiles(first_name, last_name, role)
        `)
        .eq('id', id)
        .single(),
      admin
        .from('production_inputs')
        .select('*, stock_items(id, name, unit, current_qty, cost_per_unit)')
        .eq('production_order_id', id)
        .order('created_at'),
      admin
        .from('production_outputs')
        .select('*, stock_items(id, name, unit)')
        .eq('production_order_id', id)
        .order('is_waste, created_at'),
      admin
        .from('production_orders')
        .select('id, name, status, completed_at, created_at')
        .eq('parent_order_id', id)
        .order('created_at'),
    ])

    if (orderRes.error || !orderRes.data) {
      return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 })
    }

    const order = orderRes.data
    const inputs = inputsRes.data ?? []
    const outputs = outputsRes.data ?? []
    const children = childRes.data ?? []

    // Compute summary
    const totalInput = inputs.reduce((s, i) => s + i.qty_used, 0)
    const totalOutput = outputs.filter((o) => !o.is_waste).reduce((s, o) => s + o.qty_produced, 0)
    const totalWaste = outputs.filter((o) => o.is_waste).reduce((s, o) => s + o.qty_produced, 0)
    const efficiency = totalInput > 0 ? Math.round(((totalInput - totalWaste) / totalInput) * 1000) / 10 : null

    // Costo de producción: costo del insumo (usa el registrado en la orden, o el
    // costo actual del stock si no se cargó) × cantidad usada. El costo por unidad
    // producida = costo total de insumos ÷ unidades no-merma.
    const inputCost = (i: { qty_used: number; cost_per_unit: number | null; stock_items: unknown }) => {
      const stockCost = (i.stock_items as { cost_per_unit?: number | null } | null)?.cost_per_unit ?? null
      const unitCost = i.cost_per_unit ?? stockCost ?? 0
      return { unitCost, lineCost: Math.round(i.qty_used * unitCost * 100) / 100 }
    }
    const totalInputCost = Math.round(inputs.reduce((s, i) => s + inputCost(i).lineCost, 0) * 100) / 100
    const costPerOutputUnit = totalOutput > 0 ? Math.round((totalInputCost / totalOutput) * 100) / 100 : null

    return NextResponse.json({
      order: {
        ...order,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        template_name: (order.production_templates as any)?.name ?? null,
        chef_name: order.profiles
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? `${(order.profiles as any).first_name} ${(order.profiles as any).last_name}`.trim()
          : null,
        inputs: inputs.map((i) => ({
          ...i,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stock_item_name: (i.stock_items as any)?.name ?? '—',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stock_item_unit: (i.stock_items as any)?.unit ?? '',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stock_item_current_qty: (i.stock_items as any)?.current_qty ?? 0,
          line_cost: inputCost(i).lineCost,
          unit_cost: inputCost(i).unitCost,
        })),
        outputs: outputs.map((o) => ({
          ...o,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stock_item_name: (o.stock_items as any)?.name ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stock_item_unit: (o.stock_items as any)?.unit ?? null,
          // costo por unidad de esta salida (todas comparten el costo del lote)
          cost_per_unit: o.is_waste ? null : costPerOutputUnit,
        })),
        child_orders: children,
        summary: {
          total_input_qty: totalInput,
          total_output_qty: totalOutput,
          total_waste_qty: totalWaste,
          efficiency_pct: efficiency,
          total_input_cost: totalInputCost,
          cost_per_output_unit: costPerOutputUnit,
        },
      },
    })
  } catch (err) {
    console.error('[GET /api/produccion/orders/[id]]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { user, error: authErr } = await authorize(supabase)
    if (authErr || !user) return authErr!

    const { id: idStr } = await params
    const id = Number(idStr)
    if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const admin = createAdminClient()

    // Fetch order for validation
    const { data: order, error: fetchErr } = await admin
      .from('production_orders')
      .select('id, status')
      .eq('id', id)
      .single()

    if (fetchErr || !order) {
      return NextResponse.json({ error: 'Orden no encontrada' }, { status: 404 })
    }

    if (order.status === 'completed' || order.status === 'cancelled') {
      return NextResponse.json({ error: `No se puede modificar una orden ${order.status}` }, { status: 409 })
    }

    const action: string = body.action ?? 'update'

    // --- UPDATE fields ---
    if (action === 'update') {
      const patch: Record<string, unknown> = {}
      if (body.name !== undefined) patch.name = body.name
      if (body.notes !== undefined) patch.notes = body.notes
      if (body.status !== undefined) {
        if (!['in_progress', 'cancelled'].includes(body.status)) {
          return NextResponse.json({ error: 'status solo puede cambiarse a in_progress o cancelled' }, { status: 400 })
        }
        patch.status = body.status
      }
      if (Object.keys(patch).length === 0) {
        return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
      }
      const { error } = await admin.from('production_orders').update(patch).eq('id', id)
      if (error) throw error
      return NextResponse.json({ success: true, action })
    }

    // --- ADD INPUT ---
    if (action === 'add_input') {
      if (!body.stock_item_id || !body.qty_used || !body.unit) {
        return NextResponse.json({ error: 'add_input requiere: stock_item_id, qty_used, unit' }, { status: 400 })
      }
      const { error: mappingError, item } = await validateStockMapping(admin, String(body.stock_item_id))
      if (mappingError) {
        return NextResponse.json({ error: `Input bloqueado por mapeo Fudo: ${mappingError}` }, { status: 409 })
      }
      let qtyUsed = Number(body.qty_used)
      let unit = String(body.unit)
      if (item) {
        const normalized = normalizeToStockUnit(qtyUsed, unit, item)
        if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 409 })
        qtyUsed = normalized.qty
        unit = normalized.unit
      }
      const { data, error } = await admin
        .from('production_inputs')
        .insert({
          production_order_id: id,
          stock_item_id: body.stock_item_id,
          qty_used: qtyUsed,
          unit,
          cost_per_unit: body.cost_per_unit ? Number(body.cost_per_unit) : null,
        })
        .select()
        .single()
      if (error) throw error
      return NextResponse.json({ success: true, action, input: data })
    }

    // --- DEL INPUT ---
    if (action === 'del_input') {
      if (!body.input_id) return NextResponse.json({ error: 'del_input requiere: input_id' }, { status: 400 })
      const { error } = await admin
        .from('production_inputs')
        .delete()
        .eq('id', Number(body.input_id))
        .eq('production_order_id', id)
      if (error) throw error
      return NextResponse.json({ success: true, action })
    }

    // --- ADD OUTPUT ---
    if (action === 'add_output') {
      if (!body.output_name || body.qty_produced === undefined || !body.unit) {
        return NextResponse.json({ error: 'add_output requiere: output_name, qty_produced, unit' }, { status: 400 })
      }
      if (!body.is_waste && !body.stock_item_id) {
        return NextResponse.json({ error: 'Producto final bloqueado: elegí un item vinculado a Fudo' }, { status: 409 })
      }
      if (!body.is_waste && body.stock_item_id) {
        const { error: mappingError, item } = await validateStockMapping(admin, String(body.stock_item_id))
        if (mappingError) {
          return NextResponse.json({ error: `Output bloqueado por mapeo Fudo: ${mappingError}` }, { status: 409 })
        }
        if (item) {
          const normalized = normalizeToStockUnit(Number(body.qty_produced), String(body.unit), item)
          if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 409 })
          body.qty_produced = normalized.qty
          body.unit = normalized.unit
        }
      }
      const payload = buildOutputPayload(body as Record<string, unknown>, true)
      const insertWithLots = await admin
        .from('production_outputs')
        .insert({
          production_order_id: id,
          ...payload,
        })
        .select()
        .single()

      let data = insertWithLots.data
      let error = insertWithLots.error

      if (error && isLotSchemaError(error.message)) {
        const fallbackInsert = await admin
          .from('production_outputs')
          .insert({
            production_order_id: id,
            ...buildOutputPayload(body as Record<string, unknown>, false),
          })
          .select()
          .single()
        data = fallbackInsert.data
        error = fallbackInsert.error
      }

      if (error) throw error
      return NextResponse.json({ success: true, action, output: data })
    }

    // --- DEL OUTPUT ---
    if (action === 'del_output') {
      if (!body.output_id) return NextResponse.json({ error: 'del_output requiere: output_id' }, { status: 400 })
      const { error } = await admin
        .from('production_outputs')
        .delete()
        .eq('id', Number(body.output_id))
        .eq('production_order_id', id)
      if (error) throw error
      return NextResponse.json({ success: true, action })
    }

    // --- UPD OUTPUT ---
    if (action === 'upd_output') {
      if (!body.output_id || body.qty_produced === undefined) {
        return NextResponse.json({ error: 'upd_output requiere: output_id, qty_produced' }, { status: 400 })
      }
      const patch: Record<string, unknown> = { qty_produced: Number(body.qty_produced) }
      if (body.notes !== undefined) patch.notes = body.notes
      if (body.stock_item_id !== undefined) {
        if (body.stock_item_id) {
          const { error: mappingError, item } = await validateStockMapping(admin, String(body.stock_item_id))
          if (mappingError) {
            return NextResponse.json({ error: `Output bloqueado por mapeo Fudo: ${mappingError}` }, { status: 409 })
          }
          if (item && body.unit) {
            const normalized = normalizeToStockUnit(Number(body.qty_produced), String(body.unit), item)
            if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 409 })
            patch.qty_produced = normalized.qty
            patch.unit = normalized.unit
          }
        }
        patch.stock_item_id = body.stock_item_id || null
      }
      if (body.output_name !== undefined) patch.output_name = body.output_name
      if (body.lot_code !== undefined) patch.lot_code = typeof body.lot_code === 'string' ? body.lot_code.trim() || null : body.lot_code
      if (body.produced_at !== undefined) patch.produced_at = body.produced_at ?? null
      if (body.expires_at !== undefined) patch.expires_at = body.expires_at ?? null

      let { error } = await admin
        .from('production_outputs')
        .update(patch)
        .eq('id', Number(body.output_id))
        .eq('production_order_id', id)

      if (error && isLotSchemaError(error.message)) {
        const fallbackPatch: Record<string, unknown> = { ...patch }
        delete fallbackPatch.lot_code
        delete fallbackPatch.produced_at
        delete fallbackPatch.expires_at

        const fallbackUpdate = await admin
          .from('production_outputs')
          .update(fallbackPatch)
          .eq('id', Number(body.output_id))
          .eq('production_order_id', id)

        error = fallbackUpdate.error
      }

      if (error) throw error
      return NextResponse.json({ success: true, action })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (err) {
    console.error('[PATCH /api/produccion/orders/[id]]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
