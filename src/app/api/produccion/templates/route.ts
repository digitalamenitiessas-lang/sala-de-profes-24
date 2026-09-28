import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

// ---------------------------------------------------------------------------
// GET /api/produccion/templates
// Lista todos los templates activos con sus salidas teóricas.
// ---------------------------------------------------------------------------
// POST /api/produccion/templates
// Crea un nuevo template.
// Body: { name, description?, input_stock_item_id?, input_unit?, outputs: [...] }
// ---------------------------------------------------------------------------

type TemplateOutputWithStock = Database['public']['Tables']['production_template_outputs']['Row'] & {
  stock_items?: { id: string; name: string; unit: string } | null
}
type TemplateOutputInsert = Database['public']['Tables']['production_template_outputs']['Insert']

async function authorize(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
    return { user: null, error: NextResponse.json({ error: 'Sin acceso' }, { status: 403 }) }
  }
  return { user, profile, error: null }
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { error: authErr } = await authorize(supabase)
    if (authErr) return authErr

    const admin = createAdminClient()

    const { data: templates, error } = await admin
      .from('production_templates')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (error) throw error

    // Fetch outputs for all templates in one query
    const ids = (templates ?? []).map((t) => t.id)
    const { data: outputs } = ids.length
      ? await admin
          .from('production_template_outputs')
          .select('*, stock_items(id, name, unit)')
          .in('template_id', ids)
          .order('sort_order')
      : { data: [] }

    // Fetch los múltiples insumos de cada plantilla
    const { data: tplInputs } = ids.length
      ? await admin
          .from('production_template_inputs')
          .select('*, stock_items(id, name, unit)')
          .in('template_id', ids)
          .order('sort_order')
      : { data: [] }

    // Fetch input stock item names (default input legacy)
    const inputItemIds = (templates ?? [])
      .map((t) => t.default_input_stock_item_id)
      .filter((id): id is string => Boolean(id))

    const { data: stockItems } = inputItemIds.length
      ? await admin
        .from('stock_items')
        .select('id, name, unit')
        .in('id', inputItemIds)
      : { data: [] }

    const stockMap = Object.fromEntries((stockItems ?? []).map((s) => [s.id, s]))
    const outputsByTemplate: Record<number, TemplateOutputWithStock[]> = {}
    for (const o of (outputs ?? []) as unknown as TemplateOutputWithStock[]) {
      if (!outputsByTemplate[o.template_id]) outputsByTemplate[o.template_id] = []
      outputsByTemplate[o.template_id]!.push(o)
    }
    type TplInput = { template_id: number; stock_item_id: string | null; qty: number | null; unit: string | null; stock_items?: { id: string; name: string; unit: string } | null }
    const inputsByTemplate: Record<number, TplInput[]> = {}
    for (const i of (tplInputs ?? []) as unknown as TplInput[]) {
      if (!inputsByTemplate[i.template_id]) inputsByTemplate[i.template_id] = []
      inputsByTemplate[i.template_id]!.push(i)
    }

    const result = (templates ?? []).map((t) => {
      const inputId = t.default_input_stock_item_id
      const inputUnit = t.default_input_unit ?? 'kg'
      return {
        ...t,
        input_stock_item_id: inputId,
        input_unit: inputUnit,
        input_stock_item: inputId ? stockMap[inputId] ?? null : null,
        inputs: inputsByTemplate[t.id] ?? [],
        outputs: outputsByTemplate[t.id] ?? [],
      }
    })

    return NextResponse.json({ templates: result, total: result.length })
  } catch (err) {
    console.error('[GET /api/produccion/templates]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { profile, error: authErr } = await authorize(supabase)
    if (authErr) return authErr
    if (!['socio', 'encargado', 'chef'].includes(profile!.role)) {
      return NextResponse.json({ error: 'Sin permisos para crear templates' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body?.name) {
      return NextResponse.json({ error: 'name es requerido' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: template, error: insertErr } = await admin
      .from('production_templates')
      .insert({
        name: body.name,
        description: body.description ?? null,
        default_input_stock_item_id: body.input_stock_item_id ?? body.default_input_stock_item_id ?? null,
        default_input_unit: body.input_unit ?? body.default_input_unit ?? 'kg',
        is_active: true,
      })
      .select()
      .single()

    if (insertErr) throw insertErr

    // Insert los insumos de referencia (N insumos → 1 elaborado)
    const inputs = Array.isArray(body.inputs) ? body.inputs : []
    if (inputs.length > 0) {
      const inputRows = inputs
        .filter((i: Record<string, unknown>) => typeof i.stock_item_id === 'string')
        .map((i: Record<string, unknown>, idx: number) => ({
          template_id: template.id,
          stock_item_id: i.stock_item_id as string,
          qty: i.qty != null && i.qty !== '' ? Number(i.qty) : null,
          unit: typeof i.unit === 'string' ? i.unit : null,
          sort_order: idx,
        }))
      if (inputRows.length > 0) {
        const { error: inputErr } = await admin.from('production_template_inputs').insert(inputRows)
        if (inputErr) throw inputErr
      }
    }

    // Insert outputs if provided (guarda cantidad absoluta de referencia)
    const outputs = Array.isArray(body.outputs) ? body.outputs : []
    if (outputs.length > 0) {
      const outputRows: TemplateOutputInsert[] = outputs.map((o: Record<string, unknown>, idx: number) => ({
        template_id: template.id,
        stock_item_id: typeof o.stock_item_id === 'string' ? o.stock_item_id : null,
        output_name: typeof o.output_name === 'string' ? o.output_name : `Salida ${idx + 1}`,
        theoretical_yield_pct: Number(o.theoretical_yield_pct ?? 0),
        default_qty: o.default_qty != null && o.default_qty !== '' ? Number(o.default_qty) : null,
        output_unit: typeof o.output_unit === 'string' ? o.output_unit : 'kg',
        is_waste: Boolean(o.is_waste),
        sort_order: idx,
        notes: typeof o.notes === 'string' ? o.notes : null,
      }))

      const { error: outputErr } = await admin
        .from('production_template_outputs')
        .insert(outputRows)

      if (outputErr) throw outputErr
    }

    return NextResponse.json({ template, success: true }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/produccion/templates]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
