import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/supabase/require-role'
import { fechaOperativa } from '@/lib/attendance/jornada'

// ---------------------------------------------------------------------------
// GET /api/tolva/cruce?dias=14
// ---------------------------------------------------------------------------
// Para cada tolva_log del período devuelve el consumo real de la tolva y
// las ventas de café del mismo turno, para detectar desfasajes.
//
// Flujo de identificación de "café":
//   stock_items (name ILIKE '%café%' o '%cafe%', unit kg/g)
//     → recipe_ingredients (stock_item_id)
//     → menu_items (recipe_id → fudo_product_id)
//     → fudo_consumo (fudo_product_id, sold_at en ventana del turno)
//
// Si no se encuentran productos por receta, cae al fallback por nombre de
// menu_items (café, espresso, cortado, latte, cappuccino).
//
// Ventanas de turno en hora AR (UTC-3), por día operativo (corte 06:00):
//   TM: 06:00 – 16:00 (hora AR) → 09:00 – 19:00 UTC
//   TT: 16:00 – 06:00 siguiente  → 19:00 – 09:00 UTC next day
// Lo vendido entre 00:00 y 06:00 es TT del día anterior, no TM del día.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const GR_POR_CAFE_DEFAULT = 17

function calcConsumption(l: { start_gr: number | null; added_gr: number; end_gr: number | null }): number | null {
  if (l.start_gr == null || l.end_gr == null) return null
  return Math.round((Number(l.start_gr) + Number(l.added_gr) - Number(l.end_gr)) * 10) / 10
}

export type CruceRow = {
  log_date: string
  shift: 'TM' | 'TT'
  consumo_real_gr: number | null
  cafes_vendidos: number
  consumo_esperado_gr: number
  diferencia_gr: number | null
}

export type CruceResponse = {
  rows: CruceRow[]
  gr_por_cafe: number
  sin_vinculo?: boolean
}

export async function GET(request: NextRequest) {
  // Solo socios: es info de gestión (la pantalla ya lo limita, la API también)
  const auth = await requireRole(['socio'])
  if (auth.response) return auth.response
  const supabase = await createClient()

  const dias = Math.min(30, Math.max(1, Number(request.nextUrl.searchParams.get('dias') ?? 14)))

  // Día operativo AR de hace `dias` días (corte 06:00, como los turnos)
  const desdeStr = fechaOperativa(new Date(Date.now() - dias * 86_400_000))

  // ---- Tolva logs ----
  const { data: tolvaLogs } = await supabase
    .from('tolva_logs')
    .select('id, log_date, shift, start_gr, added_gr, end_gr')
    .gte('log_date', desdeStr)
    .order('log_date', { ascending: false })
    .order('shift', { ascending: false })

  if (!tolvaLogs?.length) return NextResponse.json({ rows: [], gr_por_cafe: GR_POR_CAFE_DEFAULT } satisfies CruceResponse)

  // ---- Identificar productos de café ----
  const cafeProductIds = new Set<string>()
  let grPorCafe = GR_POR_CAFE_DEFAULT

  // Primero: vía stock_item de café → recipe_ingredients → menu_items
  const { data: cafeItems } = await supabase
    .from('stock_items')
    .select('id, name, unit')
    .or('name.ilike.%café%,name.ilike.%cafe%') // con y sin tilde
    .eq('is_active', true)
    .order('name')

  // Primero los que empiezan con "café" (no "Azúcar para café")
  const empiezaConCafe = (n: string) => /^caf[eé]/i.test(n.trim()) ? 0 : 1
  const cafeItem = ((cafeItems ?? []) as { id: string; name: string; unit: string }[])
    .filter((si) => ['kg', 'g'].includes(si.unit))
    .sort((a, b) => empiezaConCafe(a.name) - empiezaConCafe(b.name))[0]

  if (cafeItem) {
    const { data: ris } = await supabase
      .from('recipe_ingredients')
      .select('recipe_id, qty_per_portion, ingredient_unit')
      .eq('stock_item_id', cafeItem.id)

    const recipeIds = [...new Set(((ris ?? []) as { recipe_id: string }[]).map((r) => r.recipe_id))]

    // Calcular gramos promedio por porción desde la receta
    const qtysGr = ((ris ?? []) as { qty_per_portion: number | null; ingredient_unit: string | null }[])
      .map((ri) => {
        const q = Number(ri.qty_per_portion ?? 0)
        const u = ri.ingredient_unit ?? cafeItem.unit
        return u === 'g' ? q : q * 1000 // kg → g
      })
      .filter((q) => q > 1 && q < 200) // sanity: entre 1 y 200g
    if (qtysGr.length) {
      grPorCafe = Math.round(qtysGr.reduce((s, v) => s + v, 0) / qtysGr.length)
    }

    if (recipeIds.length) {
      const { data: mis } = await supabase
        .from('menu_items')
        .select('fudo_product_id')
        .in('recipe_id', recipeIds)
        .not('fudo_product_id', 'is', null)
      for (const mi of (mis ?? []) as { fudo_product_id: string }[]) {
        cafeProductIds.add(mi.fudo_product_id)
      }
    }
  }

  // Fallback: por nombre de producto en menu_items
  if (cafeProductIds.size === 0) {
    const { data: mis } = await supabase
      .from('menu_items')
      .select('fudo_product_id')
      .or('name.ilike.%café%,name.ilike.%cafe%,name.ilike.%espresso%,name.ilike.%cortado%,name.ilike.%latte%,name.ilike.%cappuccino%')
      .not('fudo_product_id', 'is', null)
    for (const mi of (mis ?? []) as { fudo_product_id: string }[]) {
      cafeProductIds.add(mi.fudo_product_id)
    }
  }

  if (cafeProductIds.size === 0) {
    return NextResponse.json({
      rows: (tolvaLogs as { log_date: string; shift: 'TM' | 'TT'; start_gr: number | null; added_gr: number; end_gr: number | null }[]).map((l) => ({
        log_date: l.log_date,
        shift: l.shift,
        consumo_real_gr: calcConsumption(l),
        cafes_vendidos: 0,
        consumo_esperado_gr: 0,
        diferencia_gr: null,
      })),
      gr_por_cafe: grPorCafe,
      sin_vinculo: true,
    } satisfies CruceResponse)
  }

  // ---- Ventas de café en el período ----
  // Paginado: PostgREST corta en 1000 filas sin avisar (orden estable sold_at + id)
  type ConsumoRow = { fudo_product_id: string; quantity: number | null; sold_at: string }
  const consumo: ConsumoRow[] = []
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from('fudo_consumo')
      .select('fudo_product_id, quantity, sold_at')
      .in('fudo_product_id', [...cafeProductIds])
      .gte('sold_at', `${desdeStr}T09:00:00Z`) // desde el primer TM del período (06:00 AR)
      .order('sold_at', { ascending: true })
      .order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    consumo.push(...(data as ConsumoRow[]))
    if (data.length < 1000) break
  }

  // Agrupar por (día operativo AR, turno): TM = 06:00–16:00 AR, TT = el resto
  const ventasByKey = new Map<string, number>()
  for (const c of consumo) {
    const d = new Date(c.sold_at)
    const horaAR = new Date(d.getTime() - 3 * 3_600_000).getUTCHours() // AR = UTC-3, sin horario de verano
    const shift = horaAR >= 6 && horaAR < 16 ? 'TM' : 'TT'
    const key = `${fechaOperativa(d)}:${shift}`
    ventasByKey.set(key, (ventasByKey.get(key) ?? 0) + Number(c.quantity ?? 1))
  }

  // ---- Cruzar tolva + ventas ----
  const rows: CruceRow[] = (tolvaLogs as { log_date: string; shift: 'TM' | 'TT'; start_gr: number | null; added_gr: number; end_gr: number | null }[]).map((l) => {
    const cafes = Math.round(ventasByKey.get(`${l.log_date}:${l.shift}`) ?? 0)
    const esperado = Math.round(cafes * grPorCafe)
    const real = calcConsumption(l)
    return {
      log_date: l.log_date,
      shift: l.shift,
      consumo_real_gr: real,
      cafes_vendidos: cafes,
      consumo_esperado_gr: esperado,
      diferencia_gr: real != null && cafes > 0 ? Math.round(real - esperado) : null,
    }
  })

  return NextResponse.json({ rows, gr_por_cafe: grPorCafe } satisfies CruceResponse)
}
