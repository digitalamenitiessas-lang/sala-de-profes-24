import type { SupabaseClient } from '@supabase/supabase-js'
import { computeConsumption } from '@/lib/compras/sugerencias'
import { cargarRecetasProduccion, type RecetaProduccion } from '@/lib/produccion/recetas'

// ---------------------------------------------------------------------------
// Elaborados de cocina: uso por día, stock, receta de producción, vida útil y
// última producción. Lo usan /api/produccion/elaborados y la pantalla.
// ---------------------------------------------------------------------------

const PRE_PRODUCTO = /\bpre\s*-?\s*producto\b/i

export type Elaborado = {
  id: string
  name: string
  unit: string
  current_qty: number
  shelf_life_days: number | null
  last_counted_at: string | null
  /** uso promedio por día (ventas de los últimos 28 días × recetas) */
  uso_diario: number
  ultima_produccion: string | null
  costo_actual: number | null
  receta: RecetaProduccion | null
}

export type ElaboradosPayload = {
  elaborados: Elaborado[]
  insumos: { id: string; name: string; unit: string }[]
  permisos: { receta: boolean; vida_util: boolean; cerrar_produccion: boolean }
}


export async function armarElaborados(admin: SupabaseClient): Promise<Omit<ElaboradosPayload, 'permisos'>> {
  const [{ data: items, error }, consumo, { data: producciones }] = await Promise.all([
    admin.from('stock_items').select('id, name, unit, current_qty, shelf_life_days, last_counted_at, cost_per_unit, is_produced').eq('is_active', true).order('name'),
    computeConsumption(admin, 28),
    admin.from('production_outputs').select('stock_item_id, production_orders!inner(status, completed_at)').eq('production_orders.status', 'completed'),
  ])
  if (error) throw new Error(error.message)
  const todos = (items ?? []) as { id: string; name: string; unit: string; current_qty: number; shelf_life_days: number | null; last_counted_at: string | null; cost_per_unit: number | null; is_produced: boolean | null }[]
  const producidos = todos.filter((i) => i.is_produced && !PRE_PRODUCTO.test(i.name))
  const recetas = await cargarRecetasProduccion(admin, producidos.map((p) => p.id))

  const ultima = new Map<string, string>()
  for (const p of (producciones ?? []) as unknown as { stock_item_id: string | null; production_orders: { completed_at: string | null } | null }[]) {
    const f = p.production_orders?.completed_at
    if (p.stock_item_id && f && (!ultima.has(p.stock_item_id) || f > ultima.get(p.stock_item_id)!)) ultima.set(p.stock_item_id, f)
  }

  const elaborados: Elaborado[] = producidos.map((p) => ({
    id: p.id,
    name: p.name,
    unit: p.unit,
    current_qty: Number(p.current_qty),
    shelf_life_days: p.shelf_life_days,
    last_counted_at: p.last_counted_at,
    uso_diario: Math.round(((consumo.byItem.get(p.id) ?? 0) / consumo.activeDays) * 10) / 10,
    ultima_produccion: ultima.get(p.id) ?? null,
    costo_actual: Number(p.cost_per_unit) > 0 ? Number(p.cost_per_unit) : null,
    receta: recetas.get(p.id) ?? null,
  }))
  // Lo más usado primero; lo que no se usa, al final por nombre
  elaborados.sort((a, b) => b.uso_diario - a.uso_diario || a.name.localeCompare(b.name, 'es'))

  return {
    elaborados,
    insumos: todos.map((i) => ({ id: i.id, name: i.name, unit: i.unit })),
  }
}

