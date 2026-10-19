import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// GET /api/tolva/cruce?dias=14
// ---------------------------------------------------------------------------
// Para cada tolva_log del período devuelve el consumo real de la tolva y
// las ventas de café del mismo turno, para detectar desfasajes.
//
// Flujo de identificación de "café":
//   stock_items (name ILIKE '%café%', unit kg/g)
//     → recipe_ingredients (stock_item_id)
//     → menu_items (recipe_id → fudo_product_id)
//     → fudo_consumo (fudo_product_id, sold_at en ventana del turno)
//
// Si no se encuentran productos por receta, cae al fallback por nombre de
// menu_items (café, espresso, cortado, latte, cappuccino).
//
// Ventanas de turno en hora AR (UTC-3):
//   TM: 06:00 – 16:00 (hora AR) → 09:00 – 19:00 UTC
//   TT: 16:00 – 06:00 siguiente  → 19:00 – 09:00 UTC next day
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const dias = Math.min(30, Math.max(1, Number(request.nextUrl.searchParams.get('dias') ?? 14)))

  const desdeAR = new Date()
  desdeAR.setDate(desdeAR.getDate() - dias)
  const desdeStr = desdeAR.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

  // ---- Tolva logs ----
  const { data: tolvaLogs } = await supabase
    .from('tolva_logs')
    .select('id, log_date, shift, start_gr, added_gr, end_gr')
    .gte('log_date', desdeStr)
    .order('log_date', { ascending: false })
    .order('shift', { ascending: false })

  if (!tolvaLogs?.length) return NextResponse.json({ rows: [], gr_por_cafe: GR_POR_CAFE_DEFAULT } satisfies CruceResponse)

  // ---- Identificar productos de café ----
  let cafeProductIds = new Set<string>()
  let grPorCafe = GR_POR_CAFE_DEFAULT

  // Primero: vía stock_item de café → recipe_ingredients → menu_items
  const { data: cafeItems } = await supabase
    .from('stock_items')
    .select('id, unit')
    .ilike('name', '%café%')
    .eq('is_active', true)

  const cafeItem = ((cafeItems ?? []) as { id: string; unit: string }[]).find((si) =>
    ['kg', 'g'].includes(si.unit),
  )

  if (cafeItem) {
    const { data: ris } = await supabase
      .from('recipe_ingredients')
      .select('recipe_id, qty_per_portion, ingredient_unit')
      .eq('stock_item_id', cafeItem.id)

    const recipeIds = [...new Set(((ris ?? []) as { recipe_id: number }[]).map((r) => r.recipe_id))]

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
      .or('name.ilike.%café%,name.ilike.%espresso%,name.ilike.%cortado%,name.ilike.%latte%,name.ilike.%cappuccino%')
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
  const { data: consumo } = await supabase
    .from('fudo_consumo')
    .select('fudo_product_id, quantity, sold_at')
    .in('fudo_product_id', [...cafeProductIds])
    .gte('sold_at', `${desdeStr}T09:00:00Z`) // desde el primer TM del período

  // Agrupar por (fecha AR, turno)
  const ventasByKey = new Map<string, number>()
  for (const c of (consumo ?? []) as { fudo_product_id: string; quantity: number | null; sold_at: string }[]) {
    const arDate = new Date(new Date(c.sold_at).toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
    const dateKey = arDate.toLocaleDateString('en-CA')
    const shift = arDate.getHours() < 16 ? 'TM' : 'TT'
    const key = `${dateKey}:${shift}`
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
