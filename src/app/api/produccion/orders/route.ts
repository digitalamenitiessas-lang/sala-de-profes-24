import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import type { Database } from '@/types/database'

type ProductionOrderStatus = Database['public']['Tables']['production_orders']['Row']['status']
const PRODUCTION_STATUSES: ProductionOrderStatus[] = ['draft', 'in_progress', 'pending_review', 'completed', 'cancelled']

// ---------------------------------------------------------------------------
// GET /api/produccion/orders
// Lista órdenes de producción con resumen.
// Query params:
//   status  — 'draft'|'in_progress'|'completed'|'cancelled'|'all' (default: all)
//   chef_id — filtrar por chef
//   days    — últimos N días (default: 30)
//   parent  — 'only_root' (sin parent) | 'all' (default: all)
// ---------------------------------------------------------------------------
// POST /api/produccion/orders
// Crea una nueva orden de producción (status: draft).
// Body: { name, template_id?, parent_order_id?, notes? }
// ---------------------------------------------------------------------------

async function authorize(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, profile: null, error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
  if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
    return { user: null, profile: null, error: NextResponse.json({ error: 'Sin acceso' }, { status: 403 }) }
  }
  return { user, profile, error: null }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { error: authErr } = await authorize(supabase)
    if (authErr) return authErr

    const admin = createAdminClient()
    const params = request.nextUrl.searchParams
    const status = params.get('status') ?? 'all'
    const chefId = params.get('chef_id')
    const days = Number(params.get('days') ?? 30)
    const parentFilter = params.get('parent') ?? 'all'

    const since = new Date()
    since.setDate(since.getDate() - days)

    let query = admin
      .from('production_orders')
      .select(`
        id, name, status, parent_order_id, template_id, chef_id,
        notes, started_at, completed_at, submitted_at, reviewed_at, created_at, updated_at,
        production_templates(name),
        profiles(first_name, last_name, role)
      `)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })

    if (status !== 'all') {
      if (!PRODUCTION_STATUSES.includes(status as ProductionOrderStatus)) {
        return NextResponse.json({ error: 'Estado de producción inválido' }, { status: 400 })
      }
      query = query.eq('status', status as ProductionOrderStatus)
    }
    if (chefId) query = query.eq('chef_id', chefId)
    if (parentFilter === 'only_root') query = query.is('parent_order_id', null)

    const { data: orders, error } = await query
    if (error) throw error

    // For each order, compute input/output/waste totals
    const orderIds = (orders ?? []).map((o) => o.id)

    const [inputsRes, outputsRes] = await Promise.all([
      orderIds.length
        ? admin
          .from('production_inputs')
          .select('production_order_id, qty_used, unit, cost_per_unit, stock_items(name, unit, cost_per_unit)')
          .in('production_order_id', orderIds)
        : { data: [] },
      orderIds.length
        ? admin
          .from('production_outputs')
          .select('production_order_id, output_name, qty_produced, unit, is_waste, stock_items(name, unit)')
          .in('production_order_id', orderIds)
        : { data: [] },
    ])

    const inputTotals: Record<number, number> = {}
    const inputCostTotals: Record<number, number> = {}
    const outputTotals: Record<number, number> = {}
    const wasteTotals: Record<number, number> = {}
    const inputItems: Record<number, { name: string; qty: number; unit: string }[]> = {}
    const outputItems: Record<number, { name: string; qty: number; unit: string; is_waste: boolean }[]> = {}

    for (const inp of inputsRes.data ?? []) {
      inputTotals[inp.production_order_id] = (inputTotals[inp.production_order_id] ?? 0) + inp.qty_used
      const stockItem = inp.stock_items as unknown as { name?: string | null; unit?: string | null; cost_per_unit?: number | null } | null
      const unitCost = (inp as { cost_per_unit?: number | null }).cost_per_unit ?? stockItem?.cost_per_unit ?? 0
      inputCostTotals[inp.production_order_id] = (inputCostTotals[inp.production_order_id] ?? 0) + inp.qty_used * unitCost
      inputItems[inp.production_order_id] = [
        ...(inputItems[inp.production_order_id] ?? []),
        {
          name: stockItem?.name ?? 'Insumo sin nombre',
          qty: inp.qty_used,
          unit: inp.unit || stockItem?.unit || '',
        },
      ]
    }
    for (const out of outputsRes.data ?? []) {
      if (out.is_waste) {
        wasteTotals[out.production_order_id] = (wasteTotals[out.production_order_id] ?? 0) + out.qty_produced
      } else {
        outputTotals[out.production_order_id] = (outputTotals[out.production_order_id] ?? 0) + out.qty_produced
      }
      const stockItem = out.stock_items as unknown as { name?: string | null; unit?: string | null } | null
      outputItems[out.production_order_id] = [
        ...(outputItems[out.production_order_id] ?? []),
        {
          name: out.output_name || stockItem?.name || 'Salida sin nombre',
          qty: out.qty_produced,
          unit: out.unit || stockItem?.unit || '',
          is_waste: Boolean(out.is_waste),
        },
      ]
    }

    const result = (orders ?? []).map((o) => {
      const inp = inputTotals[o.id] ?? 0
      const waste = wasteTotals[o.id] ?? 0
      const efficiency = inp > 0 ? Math.round(((inp - waste) / inp) * 1000) / 10 : null
      const outQty = outputTotals[o.id] ?? 0
      const inputCost = Math.round((inputCostTotals[o.id] ?? 0) * 100) / 100
      const costPerUnit = outQty > 0 && inputCost > 0 ? Math.round((inputCost / outQty) * 100) / 100 : null
      return {
        id: o.id,
        name: o.name,
        status: o.status,
        parent_order_id: o.parent_order_id,
        template_id: o.template_id,
        chef_id: o.chef_id,
        notes: o.notes,
        started_at: o.started_at,
        completed_at: o.completed_at,
        submitted_at: o.submitted_at ?? null,
        reviewed_at: o.reviewed_at ?? null,
        created_at: o.created_at,
        updated_at: o.updated_at,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        template_name: (o.production_templates as any)?.name ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chef_name: o.profiles ? `${(o.profiles as any).first_name} ${(o.profiles as any).last_name}`.trim() : null,
        inputs: inputItems[o.id] ?? [],
        outputs: outputItems[o.id] ?? [],
        summary: {
          total_input_qty: inp,
          total_output_qty: outQty,
          total_waste_qty: waste,
          efficiency_pct: efficiency,
          total_input_cost: inputCost,
          cost_per_output_unit: costPerUnit,
        },
      }
    })

    return NextResponse.json({ orders: result, total: result.length })
  } catch (err) {
    console.error('[GET /api/produccion/orders]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { user, profile, error: authErr } = await authorize(supabase)
    if (authErr || !user) return authErr!

    const body = await request.json().catch(() => null)
    if (!body?.name) {
      return NextResponse.json({ error: 'name es requerido' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: order, error } = await admin
      .from('production_orders')
      .insert({
        name: body.name,
        template_id: body.template_id ?? null,
        parent_order_id: body.parent_order_id ?? null,
        status: 'draft',
        chef_id: user.id,
        notes: body.notes ?? null,
      })
      .select()
      .single()

    if (error) throw error

    const authorName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || null
    logAudit(admin, {
      userId: user.id,
      userName: authorName,
      action: 'create_production_order',
      module: 'produccion',
      entityType: 'production_order',
      entityId: String(order.id),
      description: `${authorName ?? 'Alguien'}: creó la orden de producción "${order.name}"`,
      metadata: { status: order.status, template_id: order.template_id, input_qty: body.input_qty ?? null, input_stock_item_id: body.input_stock_item_id ?? null },
    })

    // If template_id provided, pre-populate inputs/outputs from template
    if (body.template_id && body.input_qty && body.input_stock_item_id) {
      const inputQty = Number(body.input_qty)
      const inputUnit = body.input_unit ?? 'kg'

      // Add input
      await admin.from('production_inputs').insert({
        production_order_id: order.id,
        stock_item_id: body.input_stock_item_id,
        qty_used: inputQty,
        unit: inputUnit,
      })

      // Fetch template outputs to pre-populate theoretical qtys
      const { data: tmplOutputs } = await admin
        .from('production_template_outputs')
        .select('*')
        .eq('template_id', body.template_id)
        .order('sort_order')

      if (tmplOutputs && tmplOutputs.length > 0) {
        const outputRows = tmplOutputs.map((to) => ({
          production_order_id: order.id,
          stock_item_id: to.stock_item_id,
          output_name: to.output_name,
          qty_produced: 0,
          theoretical_qty: Math.round(inputQty * (to.theoretical_yield_pct / 100) * 1000) / 1000,
          unit: to.output_unit,
          is_waste: to.is_waste,
          notes: to.notes,
        }))
        await admin.from('production_outputs').insert(outputRows)
      }
    }

    return NextResponse.json({ order, success: true }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/produccion/orders]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
