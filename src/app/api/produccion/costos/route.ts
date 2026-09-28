import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/produccion/costos?days=180
// ---------------------------------------------------------------------------
// Historial de costo por producto intermedio (milanesa cruda, albóndiga cruda…).
// Para cada producción COMPLETADA:
//   costo total = Σ (qty_used × costo congelado del insumo, o el actual si no
//                    quedó congelado — órdenes viejas)
//   costo por unidad = costo total / unidades producidas (no-merma)
// Agrupado por el producto de salida, ordenado por fecha.
// ---------------------------------------------------------------------------

type ProductionRun = {
  order_id: number
  name: string
  date: string
  output_qty: number
  output_unit: string
  total_cost: number
  cost_per_unit: number
  partial_cost: boolean // algún insumo sin costo → total subestimado
}

type IntermediateHistory = {
  stock_item_id: string | null
  name: string
  unit: string
  runs: ProductionRun[]
  latest_cost_per_unit: number | null
  avg_cost_per_unit: number | null
  min_cost_per_unit: number | null
  max_cost_per_unit: number | null
  total_produced: number
  run_count: number
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const admin = createAdminClient()
    const days = Math.min(Number(request.nextUrl.searchParams.get('days') ?? 180), 365)
    const since = new Date()
    since.setDate(since.getDate() - days)

    const { data: orders, error: ordersErr } = await admin
      .from('production_orders')
      .select('id, name, status, completed_at, reviewed_at, created_at')
      .eq('status', 'completed')
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })

    if (ordersErr) throw ordersErr
    const orderIds = (orders ?? []).map((o) => o.id)
    if (orderIds.length === 0) return NextResponse.json({ intermediates: [], total_runs: 0 })

    const [inputsRes, outputsRes] = await Promise.all([
      admin
        .from('production_inputs')
        .select('production_order_id, qty_used, cost_per_unit, stock_items(cost_per_unit)')
        .in('production_order_id', orderIds),
      admin
        .from('production_outputs')
        .select('production_order_id, output_name, qty_produced, unit, is_waste, stock_item_id, stock_items(name, unit)')
        .in('production_order_id', orderIds),
    ])

    if (inputsRes.error) throw inputsRes.error
    if (outputsRes.error) throw outputsRes.error

    // Costo total por orden (usa el costo congelado; si falta, el actual del stock)
    const costByOrder = new Map<number, { total: number; partial: boolean }>()
    for (const inp of inputsRes.data ?? []) {
      const frozen = (inp as { cost_per_unit?: number | null }).cost_per_unit
      const live = (inp.stock_items as { cost_per_unit?: number | null } | null)?.cost_per_unit
      const unitCost = frozen ?? live ?? 0
      const entry = costByOrder.get(inp.production_order_id) ?? { total: 0, partial: false }
      entry.total += Number(inp.qty_used) * unitCost
      if (unitCost <= 0) entry.partial = true
      costByOrder.set(inp.production_order_id, entry)
    }

    // Salida principal (no-merma) por orden
    const outputByOrder = new Map<number, { qty: number; unit: string; name: string; stock_item_id: string | null }>()
    for (const out of outputsRes.data ?? []) {
      if (out.is_waste) continue
      const stock = out.stock_items as { name?: string | null; unit?: string | null } | null
      const entry = outputByOrder.get(out.production_order_id) ?? {
        qty: 0,
        unit: out.unit || stock?.unit || 'u',
        name: stock?.name || out.output_name || 'Producto',
        stock_item_id: out.stock_item_id,
      }
      entry.qty += Number(out.qty_produced)
      outputByOrder.set(out.production_order_id, entry)
    }

    // Agrupar por producto intermedio
    const groups = new Map<string, IntermediateHistory>()
    for (const order of orders ?? []) {
      const output = outputByOrder.get(order.id)
      if (!output || output.qty <= 0) continue
      const cost = costByOrder.get(order.id) ?? { total: 0, partial: true }
      if (cost.total <= 0) continue

      const key = output.stock_item_id ?? output.name
      const run: ProductionRun = {
        order_id: order.id,
        name: order.name,
        date: order.reviewed_at ?? order.completed_at ?? order.created_at,
        output_qty: Math.round(output.qty * 1000) / 1000,
        output_unit: output.unit,
        total_cost: Math.round(cost.total),
        cost_per_unit: Math.round((cost.total / output.qty) * 100) / 100,
        partial_cost: cost.partial,
      }

      const group = groups.get(key) ?? {
        stock_item_id: output.stock_item_id,
        name: output.name,
        unit: output.unit,
        runs: [],
        latest_cost_per_unit: null,
        avg_cost_per_unit: null,
        min_cost_per_unit: null,
        max_cost_per_unit: null,
        total_produced: 0,
        run_count: 0,
      }
      group.runs.push(run)
      group.total_produced += output.qty
      groups.set(key, group)
    }

    // Estadísticas por grupo (runs ya vienen ordenados por fecha desc)
    const intermediates = [...groups.values()].map((g) => {
      const costs = g.runs.map((r) => r.cost_per_unit)
      g.run_count = g.runs.length
      g.latest_cost_per_unit = g.runs[0]?.cost_per_unit ?? null
      g.avg_cost_per_unit = costs.length ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length) * 100) / 100 : null
      g.min_cost_per_unit = costs.length ? Math.min(...costs) : null
      g.max_cost_per_unit = costs.length ? Math.max(...costs) : null
      g.total_produced = Math.round(g.total_produced * 1000) / 1000
      return g
    }).sort((a, b) => b.run_count - a.run_count)

    return NextResponse.json({
      intermediates,
      total_runs: intermediates.reduce((sum, g) => sum + g.run_count, 0),
    })
  } catch (err) {
    console.error('[GET /api/produccion/costos]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
