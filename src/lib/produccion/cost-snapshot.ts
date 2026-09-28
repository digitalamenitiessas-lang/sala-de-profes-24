import type { SupabaseClient } from '@supabase/supabase-js'
import { esErrorColumnaFaltante } from '@/lib/costos/confiable'

// ---------------------------------------------------------------------------
// Costo real de una producción — congelado y persistido.
// ---------------------------------------------------------------------------
// 1) snapshotProductionInputCosts: copia stock_items.cost_per_unit a
//    production_inputs.cost_per_unit (solo donde es NULL). Idempotente. Así la
//    milanesa de hoy conserva su costo aunque mañana suba la nalga.
//
// 2) persistProductionCost: total de la tanda = Σ qty_used × cost_per_unit;
//    costo por unidad = total / salida principal. Se guarda en
//    production_orders (efficiency_pct, total_cost, cost_per_output_unit,
//    main_output_stock_item_id) y, si el RPC vigente no lo hizo, en el
//    cost_per_unit del elaborado. Tolerante a que la migración 20260906 no
//    esté aplicada (entonces sólo devuelve los números).
// ---------------------------------------------------------------------------

export async function snapshotProductionInputCosts(
  admin: SupabaseClient,
  orderId: number,
): Promise<void> {
  const { data: inputs } = await admin
    .from('production_inputs')
    .select('id, cost_per_unit, stock_items(cost_per_unit)')
    .eq('production_order_id', orderId)

  for (const input of inputs ?? []) {
    if (input.cost_per_unit != null) continue
    const stockCost = (input.stock_items as { cost_per_unit?: number | null } | null)?.cost_per_unit
    if (stockCost == null || stockCost <= 0) continue
    await admin
      .from('production_inputs')
      .update({ cost_per_unit: stockCost })
      .eq('id', input.id)
  }
}

export type ProductionCostSummary = {
  total_cost: number
  main_output_stock_item_id: string | null
  main_output_qty: number
  cost_per_output_unit: number | null
  persisted: boolean
}

export async function persistProductionCost(
  admin: SupabaseClient,
  orderId: number,
  options: { rpcAlreadyPersisted?: boolean } = {},
): Promise<ProductionCostSummary> {
  const [{ data: inputs }, { data: outputs }] = await Promise.all([
    admin
      .from('production_inputs')
      .select('qty_used, cost_per_unit, stock_items(cost_per_unit)')
      .eq('production_order_id', orderId),
    admin
      .from('production_outputs')
      .select('stock_item_id, qty_produced, is_waste')
      .eq('production_order_id', orderId)
      .eq('is_waste', false),
  ])

  let total = 0
  for (const i of inputs ?? []) {
    const unit = i.cost_per_unit ?? (i.stock_items as { cost_per_unit?: number | null } | null)?.cost_per_unit ?? 0
    total += Number(i.qty_used ?? 0) * Number(unit)
  }
  total = Math.round(total * 100) / 100

  const main = (outputs ?? [])
    .filter((o) => o.stock_item_id)
    .sort((a, b) => Number(b.qty_produced) - Number(a.qty_produced))[0] ?? null
  const mainQty = main ? Number(main.qty_produced) : 0
  const costPerUnit = main && mainQty > 0 && total > 0 ? Math.round((total / mainQty) * 100) / 100 : null

  let persisted = false
  if (!options.rpcAlreadyPersisted) {
    const { error } = await admin
      .from('production_orders')
      .update({
        total_cost: total,
        cost_per_output_unit: costPerUnit,
        main_output_stock_item_id: main?.stock_item_id ?? null,
      })
      .eq('id', orderId)
    persisted = !error

    // RPC viejo: actualizar el costo del elaborado acá (promedio simple con lo previo)
    if (main?.stock_item_id && costPerUnit) {
      const { data: item } = await admin
        .from('stock_items')
        .select('current_qty, cost_per_unit')
        .eq('id', main.stock_item_id)
        .single()
      if (item) {
        const prevQty = Math.max(Number(item.current_qty ?? 0) - mainQty, 0)
        const prevCost = Number(item.cost_per_unit ?? 0)
        const blended = prevQty > 0 && prevCost > 0
          ? Math.round(((prevQty * prevCost + mainQty * costPerUnit) / (prevQty + mainQty)) * 100) / 100
          : costPerUnit
        // Fallback del RPC viejo: los insumos no pasaron el chequeo de fuentes
        // del v7, así que este número es 'estimado' (NO confiable).
        const { error: costErr } = await admin
          .from('stock_items')
          .update({ cost_per_unit: blended, cost_source: 'estimado', cost_updated_at: new Date().toISOString() })
          .eq('id', main.stock_item_id)
        if (costErr && esErrorColumnaFaltante(costErr.message, ['cost_source', 'cost_updated_at'])) {
          await admin.from('stock_items').update({ cost_per_unit: blended }).eq('id', main.stock_item_id)
        }
      }
    }
  } else {
    persisted = true
  }

  return {
    total_cost: total,
    main_output_stock_item_id: main?.stock_item_id ?? null,
    main_output_qty: mainQty,
    cost_per_output_unit: costPerUnit,
    persisted,
  }
}
