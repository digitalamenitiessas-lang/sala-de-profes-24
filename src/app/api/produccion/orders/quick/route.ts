import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeToStockUnit } from '@/lib/produccion/units'
import { isManagerOrAbove } from '@/lib/roles'
import { logAudit } from '@/lib/audit'
import { notifyEvent } from '@/lib/push/notify-event'
import { snapshotProductionInputCosts, persistProductionCost } from '@/lib/produccion/cost-snapshot'
import type { Database } from '@/types/database'

type ProductionOutputInsert = Database['public']['Tables']['production_outputs']['Insert']
type ProductionInputInsert = Database['public']['Tables']['production_inputs']['Insert']

type QuickInputPayload = {
  stock_item_id?: string | null
  qty_used: number
  unit?: string
  cost_per_unit?: number | null
}

type QuickOutputPayload = {
  stock_item_id?: string | null
  output_name: string
  qty_produced: number
  theoretical_qty?: number | null
  unit?: string
  is_waste?: boolean
  notes?: string | null
  lot_code?: string | null
  produced_at?: string | null
  expires_at?: string | null
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

async function authorize(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, first_name, last_name')
    .eq('id', user.id)
    .single()

  if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
    return { user: null, error: NextResponse.json({ error: 'Sin acceso' }, { status: 403 }) }
  }

  return { user, profile, error: null }
}

function buildOutputRows(orderId: number, outputs: QuickOutputPayload[], includeLotFields: boolean): ProductionOutputInsert[] {
  return outputs
    .filter((output) => output.output_name && output.qty_produced !== undefined)
    .map((output) => {
      const row: ProductionOutputInsert = {
        production_order_id: orderId,
        stock_item_id: output.stock_item_id || null,
        output_name: output.output_name,
        qty_produced: Number(output.qty_produced),
        theoretical_qty: output.theoretical_qty != null ? Number(output.theoretical_qty) : null,
        unit: output.unit ?? 'kg',
        is_waste: Boolean(output.is_waste),
        notes: output.notes ?? null,
      }

      if (includeLotFields) {
        row.lot_code = output.lot_code?.trim() || null
        row.produced_at = output.produced_at ?? null
        row.expires_at = output.expires_at ?? null
      }

      return row
    })
}

async function realignStockFromFudo(admin: ReturnType<typeof createAdminClient>) {
  try {
    const { syncFromFudo } = await import('@/lib/fudo/stock-sync')
    const read = await syncFromFudo(admin)
    return { success: true, synced: read.synced, errors: read.errors }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Error al re-sincronizar desde Fudo' }
  }
}

type StockMappingRow = { id: string; name: string; unit: string; fudo_ingredient_id: string | null; fudo_product_id: string | null; fudo_skip: boolean | null }

async function validateStockMappings(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<{ errors: string[]; itemsById: Map<string, StockMappingRow> }> {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  const itemsById = new Map<string, StockMappingRow>()
  if (uniqueIds.length === 0) return { errors: [], itemsById }

  const { data, error } = await admin
    .from('stock_items')
    .select('id, name, unit, fudo_ingredient_id, fudo_product_id, fudo_skip')
    .in('id', uniqueIds)

  if (error) return { errors: [`No pude validar mapeos Fudo: ${error.message}`], itemsById }

  for (const row of (data ?? []) as StockMappingRow[]) itemsById.set(String(row.id), row)
  const errors: string[] = []

  for (const id of uniqueIds) {
    const row = itemsById.get(id)
    if (!row) {
      errors.push(`${id}: item de stock no encontrado`)
      continue
    }
    // fudo_skip = semielaborado local intencional (ej. milanesa cruda): válido.
    if (!row.fudo_ingredient_id && !row.fudo_product_id && !row.fudo_skip) {
      errors.push(`${row.name}: sin vínculo Fudo`)
    }
  }

  return { errors, itemsById }
}

export async function POST(request: NextRequest) {
  let orderId: number | null = null

  try {
    const supabase = await createClient()
    const { user, profile, error: authErr } = await authorize(supabase)
    if (authErr || !user) return authErr!

    const body = await request.json().catch(() => null)
    if (!body?.name || !body?.outputs?.length || (!body?.input && !body?.inputs?.length)) {
      return NextResponse.json({
        error: 'Campos requeridos: name, inputs[] (stock_item_id, qty_used, unit), outputs[]',
      }, { status: 400 })
    }

    const admin = createAdminClient()
    const autoComplete = body.auto_complete === true

    // Cerrar producción sin pasar por la cola de validación impacta stock y
    // Fudo directo: solo socio o encargado. Chef/cocina siempre envían a validar.
    if (autoComplete && !isManagerOrAbove(profile?.role)) {
      return NextResponse.json({
        error: 'Solo socio o encargado puede completar producción sin validación. Enviala a validar.',
      }, { status: 403 })
    }
    const warnings: string[] = []
    const inputs = (Array.isArray(body.inputs) ? body.inputs : [body.input]) as QuickInputPayload[]
    const outputs = body.outputs as QuickOutputPayload[]

    const invalidInputs = inputs
      .filter((input) => !input.stock_item_id || Number(input.qty_used) <= 0)
      .map((input) => input.stock_item_id ?? 'materia prima sin item')

    if (invalidInputs.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Producción bloqueada: materias primas inválidas o sin item Fudo: ${invalidInputs.join(', ')}`,
      }, { status: 409 })
    }

    const outputsWithoutFudoItem = outputs
      .filter((output) => !output.is_waste && !output.stock_item_id)
      .map((output) => output.output_name)

    if (outputsWithoutFudoItem.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Producción bloqueada: estos productos finales no tienen item Fudo seleccionado: ${outputsWithoutFudoItem.join(', ')}`,
      }, { status: 409 })
    }

    const { errors: mappingErrors, itemsById } = await validateStockMappings(admin, [
      ...inputs.map((input) => String(input.stock_item_id)),
      ...(outputs
        .filter((output) => !output.is_waste && output.stock_item_id)
        .map((output) => String(output.stock_item_id))),
    ])

    if (mappingErrors.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Producción bloqueada por mapeo Fudo: ${mappingErrors.join('; ')}`,
      }, { status: 409 })
    }

    // Normalizar cantidades a la unidad de cada item de stock (el RPC opera
    // sobre stock_items.current_qty sin convertir unidades).
    const unitErrors: string[] = []
    for (const input of inputs) {
      const item = itemsById.get(String(input.stock_item_id))
      if (!item) continue
      const normalized = normalizeToStockUnit(Number(input.qty_used), input.unit ?? item.unit, item)
      if (!normalized.ok) { unitErrors.push(normalized.error); continue }
      input.qty_used = normalized.qty
      input.unit = normalized.unit
    }
    for (const output of outputs) {
      if (output.is_waste || !output.stock_item_id) continue
      const item = itemsById.get(String(output.stock_item_id))
      if (!item) continue
      const normalized = normalizeToStockUnit(Number(output.qty_produced), output.unit ?? item.unit, item)
      if (!normalized.ok) { unitErrors.push(normalized.error); continue }
      output.qty_produced = normalized.qty
      if (output.theoretical_qty != null) {
        const theo = normalizeToStockUnit(Number(output.theoretical_qty), output.unit ?? item.unit, item)
        if (theo.ok) output.theoretical_qty = theo.qty
      }
      output.unit = normalized.unit
    }

    if (unitErrors.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Producción bloqueada por unidades incompatibles: ${unitErrors.join('; ')}`,
      }, { status: 409 })
    }

    const { data: order, error: orderErr } = await admin
      .from('production_orders')
      .insert({
        name: body.name,
        template_id: body.template_id ?? null,
        status: autoComplete ? 'draft' : 'pending_review',
        chef_id: user.id,
        notes: body.notes ?? null,
        submitted_at: autoComplete ? null : new Date().toISOString(),
      })
      .select('id')
      .single()

    if (orderErr || !order) {
      throw new Error(orderErr?.message ?? 'Error al crear la orden')
    }

    orderId = order.id

    const inputRows: ProductionInputInsert[] = inputs.map((input) => ({
      production_order_id: orderId!,
      stock_item_id: input.stock_item_id!,
      qty_used: Number(input.qty_used),
      unit: input.unit ?? 'kg',
      cost_per_unit: input.cost_per_unit != null ? Number(input.cost_per_unit) : null,
    }))

    const { error: inputErr } = await admin
      .from('production_inputs')
      .insert(inputRows)

    if (inputErr) {
      throw new Error(`Error al agregar insumo: ${inputErr.message}`)
    }

    const outputRowsWithLots = buildOutputRows(orderId, outputs, true)
    if (outputRowsWithLots.length === 0) {
      throw new Error('Se requiere al menos una salida')
    }

    let lotSupport = true
    let { error: outputErr } = await admin
      .from('production_outputs')
      .insert(outputRowsWithLots)

    if (outputErr && isLotSchemaError(outputErr.message)) {
      lotSupport = false
      warnings.push('La migración de lotes todavía no está aplicada. La producción se guardó sin vencimientos por lote.')
      const fallbackRows = buildOutputRows(orderId, outputs, false)
      const fallbackInsert = await admin.from('production_outputs').insert(fallbackRows)
      outputErr = fallbackInsert.error
    }

    if (outputErr) {
      throw new Error(`Error al agregar salidas: ${outputErr.message}`)
    }

    const authorName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || 'Cocina'
    const inputSummary = inputs
      .map((input) => `${input.qty_used}${input.unit ?? 'kg'}`)
      .join(' + ')
    const outputSummary = outputs
      .filter((output) => !output.is_waste)
      .map((output) => `${output.output_name} ${output.qty_produced}${output.unit ?? 'kg'}`)
      .join(', ')

    logAudit(admin, {
      userId: user.id,
      userName: authorName || null,
      action: 'create_production_order',
      module: 'produccion',
      entityType: 'production_order',
      entityId: String(orderId),
      description: `${authorName}: produjo "${body.name}" — entradas ${inputSummary || 'sin detalle'}, salidas ${outputSummary || 'sin detalle'}`,
      metadata: {
        status: autoComplete ? 'completed' : 'pending_review',
        inputs: inputs.map((i) => ({ stock_item_id: i.stock_item_id, qty: i.qty_used, unit: i.unit })),
        outputs: outputs.map((o) => ({ output_name: o.output_name, qty: o.qty_produced, unit: o.unit, is_waste: Boolean(o.is_waste) })),
      },
    })

    if (!autoComplete) {
      await admin.from('announcements').insert({
        author_id: user.id,
        type: 'operativo',
        priority: 'alta',
        title: `Producción enviada a validar: ${body.name}`,
        body: [
          `${authorName} cargó una producción y espera validación.`,
          `Entradas: ${inputSummary || 'sin detalle'}.`,
          `Salidas: ${outputSummary || 'sin detalle'}.`,
          'Revisar si la producción responde a venta real, reposición necesaria o pedido pendiente antes de aprobar.',
        ].join('\n'),
        scope: 'role',
        target_role: 'encargado',
        target_user_id: null,
        is_active: true,
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      })

      return NextResponse.json({
        success: true,
        order_id: orderId,
        status: 'pending_review',
        warnings,
        message: 'Producción enviada a validación. Stock y Fudo todavía no fueron modificados.',
      }, { status: 201 })
    }

    // Si no se puede cerrar ahora, la producción NO queda como borrador que
    // nadie ve: pasa a la cola de validación con el motivo, para resolverla.
    const pasarAValidar = async (motivo: string) => {
      await admin.from('production_orders')
        .update({ status: 'pending_review', submitted_at: new Date().toISOString(), review_notes: `No se pudo cerrar: ${motivo}` })
        .eq('id', orderId!).eq('status', 'draft')
    }

    const { fudo } = await import('@/lib/fudoClient')
    const fudoConnection = await fudo.testConnection()
    if (!fudoConnection.ok) {
      await pasarAValidar(`Fudo no disponible (${fudoConnection.error})`)
      return NextResponse.json({
        success: false,
        order_id: orderId,
        status: 'pending_review',
        error: `Fudo no está disponible. La producción quedó en Validar para cerrarla después: ${fudoConnection.error}`,
      }, { status: 502 })
    }

    const { data: result, error: completeErr } = await admin.rpc(
      'complete_production_order',
      { p_order_id: orderId, p_user_id: user.id },
    )

    if (completeErr) {
      throw new Error(`Error al completar: ${completeErr.message}`)
    }

    const rpcResult = result as {
      success: boolean
      error?: string
      total_input_qty?: number
      total_output_qty?: number
      waste_qty?: number
      efficiency_pct?: number | null
      total_cost?: number
      cost_per_output_unit?: number | null
      movements?: { stock_item_id: number | string; change: number; movement_id?: string | null }[]
    }

    if (!rpcResult.success) {
      await pasarAValidar(rpcResult.error ?? 'error al completar')
      return NextResponse.json({
        error: `${rpcResult.error ?? 'No se pudo completar'}. La producción quedó en Validar para corregirla y cerrarla.`,
        order_id: orderId,
        status: 'pending_review',
      }, { status: 400 })
    }

    // Congelar el costo de los insumos y persistir el costo real de la tanda
    // (el RPC v5 ya lo hace; con el RPC viejo lo calcula acá).
    await snapshotProductionInputCosts(admin, orderId)
    const costSummary = await persistProductionCost(admin, orderId, {
      rpcAlreadyPersisted: typeof rpcResult.cost_per_output_unit === 'number',
    }).catch(() => null)
    const costPerOutputUnit = rpcResult.cost_per_output_unit ?? costSummary?.cost_per_output_unit ?? null
    const totalCost = rpcResult.total_cost ?? costSummary?.total_cost ?? null

    const movements = rpcResult.movements ?? []
    let fudoSummary: { synced: number; errors: string[]; encolados: string[] } | null = null

    if (movements.length > 0) {
      try {
        const { syncProductionToFudo } = await import('@/lib/fudo/stock-sync')
        fudoSummary = await syncProductionToFudo(admin, movements, user.id)
        if (fudoSummary.encolados.length > 0) warnings.push(`${fudoSummary.encolados.length === 1 ? 'Un insumo no entró' : `${fudoSummary.encolados.length} insumos no entraron`} a Fudo todavía (queda registrado y se reintenta solo): ${fudoSummary.encolados.map((e) => e.split(':')[0]).join(', ')}`)
        if (fudoSummary.errors.length > 0) {
          const realignment = await realignStockFromFudo(admin)
          return NextResponse.json({
            success: false,
            order_id: orderId,
            status: 'completed_local_fudo_failed',
            error: 'La producción se cerró en LVE pero no quedó sincronizada completa con Fudo',
            fudo: fudoSummary,
            realignment,
            warnings,
          }, { status: 502 })
        }
      } catch (err) {
        const realignment = await realignStockFromFudo(admin)
        return NextResponse.json({
          success: false,
          order_id: orderId,
          status: 'completed_local_fudo_failed',
          error: `No se pudo sincronizar producción a Fudo: ${err instanceof Error ? err.message : 'error desconocido'}`,
          realignment,
          warnings,
        }, { status: 502 })
      }
    }

    if (!lotSupport) {
      warnings.push('Aplicá la migración `20260507_stock_lots.sql` para registrar lote, elaboración y vencimiento en LVE.')
    }

    logAudit(admin, {
      userId: user.id,
      userName: authorName || null,
      action: 'complete_production_order',
      module: 'produccion',
      entityType: 'production_order',
      entityId: String(orderId),
      description: `${authorName}: completó "${body.name}"${costPerOutputUnit ? ` — $${costPerOutputUnit}/u` : ''}${rpcResult.efficiency_pct != null ? ` — eficiencia ${rpcResult.efficiency_pct}%` : ''}`,
      metadata: {
        total_input_qty: rpcResult.total_input_qty,
        total_output_qty: rpcResult.total_output_qty,
        waste_qty: rpcResult.waste_qty,
        efficiency_pct: rpcResult.efficiency_pct,
        total_cost: totalCost,
        cost_per_output_unit: costPerOutputUnit,
        movements: rpcResult.movements,
        fudo_synced: fudoSummary ? fudoSummary.errors.length === 0 : true,
      },
    })

    notifyEvent(admin, 'production_completed', {
      title: '👨‍🍳 Producción completada',
      body: `${authorName}: "${body.name}" — ${outputSummary || 'ver detalle'}${costPerOutputUnit ? ` · $${Math.round(costPerOutputUnit).toLocaleString('es-AR')}/u` : ''}`,
      url: '/stock/produccion',
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      order_id: orderId,
      status: 'completed',
      total_input_qty: rpcResult.total_input_qty,
      total_output_qty: rpcResult.total_output_qty,
      waste_qty: rpcResult.waste_qty,
      efficiency_pct: rpcResult.efficiency_pct,
      total_cost: totalCost,
      cost_per_output_unit: costPerOutputUnit,
      warnings,
      fudo: fudoSummary,
      message: costPerOutputUnit
        ? `Producción completada — $${Math.round(costPerOutputUnit).toLocaleString('es-AR')} por unidad`
        : 'Producción completada',
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/produccion/orders/quick]', err)
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Error interno',
      order_id: orderId,
      status: orderId ? 'draft' : null,
    }, { status: orderId ? 400 : 500 })
  }
}
