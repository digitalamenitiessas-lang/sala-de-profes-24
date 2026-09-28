import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { canon } from '@/lib/recipes/recipe-cost'

// GET /api/stock/consumo?days=7|14|30|60|90
//
// Calcula el consumo real de cada insumo en el período, derivado de las
// ventas de Fudo × las recetas cargadas.
//
// Para cada fudo_sale en la ventana:
//   1. Encuentra el menu_item por fudo_product_id
//   2. Toma su recipe_id
//   3. Para cada recipe_ingredient: consumo += qty_per_portion × units_sold
// Agrega por stock_item_id y devuelve ordenado por consumo desc.

export type ConsumoItem = {
  stock_item_id: string
  name: string
  unit: string
  consumed: number
  from_dishes: string[]
}

export type ConsumoPayload = {
  days: number
  from: string
  to: string
  items: ConsumoItem[]
  generated_at: string
}

const CACHE_TTL_MS = 5 * 60 * 1000
const VALID_DAYS = new Set([7, 14, 30, 60, 90])
const cache = new Map<number, { at: number; payload: ConsumoPayload }>()

function arToday(): string {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!isManagerOrAbove(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const rawDays = Number(request.nextUrl.searchParams.get('days') ?? 30) || 30
    const days = VALID_DAYS.has(rawDays) ? rawDays : 30

    const cached = cache.get(days)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload)
    }

    const admin = createAdminClient()
    const todayAR = arToday()
    const sinceDate = new Date(new Date(`${todayAR}T12:00:00Z`).getTime() - (days - 1) * 86_400_000)
      .toISOString().slice(0, 10)
    const sinceUTC = new Date(`${sinceDate}T00:00:00-03:00`).toISOString()

    // 1. Ventas del período — paginado: hasta 90 días superan por mucho el
    // tope silencioso de 1000 filas de Supabase
    type SaleRow = { fudo_product_id: string | null; quantity: number }
    const sales: SaleRow[] = []
    for (let page = 0; page < 50; page++) {
      const { data: salesData, error: salesError } = await admin
        .from('fudo_consumo') // ítems vendidos + opciones elegidas
        .select('fudo_product_id, quantity')
        .gte('sold_at', sinceUTC)
        .order('id', { ascending: true })
        .range(page * 1000, page * 1000 + 999)
      if (salesError) throw new Error(salesError.message)
      if (!salesData || salesData.length === 0) break
      sales.push(...(salesData as SaleRow[]))
      if (salesData.length < 1000) break
    }

    // Agregar por fudo_product_id
    const unitsByProduct = new Map<string, number>()
    for (const s of sales) {
      if (!s.fudo_product_id) continue
      unitsByProduct.set(s.fudo_product_id, (unitsByProduct.get(s.fudo_product_id) ?? 0) + Number(s.quantity))
    }

    if (unitsByProduct.size === 0) {
      const payload: ConsumoPayload = { days, from: sinceDate, to: todayAR, items: [], generated_at: new Date().toISOString() }
      return NextResponse.json(payload)
    }

    // 2. Menu items con receta
    const { data: menuItems } = await admin
      .from('menu_items')
      .select('id, name, recipe_id, fudo_product_id')
      .eq('is_active', true)
      .not('recipe_id', 'is', null)
      .not('fudo_product_id', 'is', null)

    // Mapa fudo_product_id → { recipe_id, name }
    type MenuRow = { id: string; name: string; recipe_id: string; fudo_product_id: string }
    const menuByFudo = new Map<string, MenuRow>()
    for (const mi of (menuItems ?? []) as MenuRow[]) {
      menuByFudo.set(mi.fudo_product_id, mi)
    }

    // 3. Recipe ingredients para las recetas relevantes
    const recipeIds = [...new Set(
      [...unitsByProduct.keys()]
        .map(fid => menuByFudo.get(fid)?.recipe_id)
        .filter(Boolean) as string[]
    )]

    if (recipeIds.length === 0) {
      const payload: ConsumoPayload = { days, from: sinceDate, to: todayAR, items: [], generated_at: new Date().toISOString() }
      return NextResponse.json(payload)
    }

    const { data: riData } = await admin
      .from('recipe_ingredients')
      .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit')
      .in('recipe_id', recipeIds)

    type RIRow = { recipe_id: string; stock_item_id: string; qty_per_portion: number | null; ingredient_unit: string | null }
    const riRows = (riData ?? []) as RIRow[]

    // 4. Stock items para resolución de unidades
    const stockItemIds = [...new Set(riRows.map(r => r.stock_item_id))]
    const { data: stockData } = await admin
      .from('stock_items')
      .select('id, name, unit')
      .in('id', stockItemIds)

    type StockRow = { id: string; name: string; unit: string }
    const stockById = new Map<string, StockRow>()
    for (const si of (stockData ?? []) as StockRow[]) stockById.set(si.id, si)

    // Agrupar recipe_ingredients por recipe_id
    const riByRecipe = new Map<string, RIRow[]>()
    for (const ri of riRows) {
      const list = riByRecipe.get(ri.recipe_id) ?? []
      list.push(ri)
      riByRecipe.set(ri.recipe_id, list)
    }

    // 5. Calcular consumo: para cada producto vendido, sumar ingredientes × unidades
    // consumed: stock_item_id → { qty en unidad canónica del stock_item, dishes }
    const consumoMap = new Map<string, { qty: number; dishes: Set<string> }>()

    for (const [fudoId, unitsSold] of unitsByProduct) {
      const mi = menuByFudo.get(fudoId)
      if (!mi) continue
      const ingredients = riByRecipe.get(mi.recipe_id) ?? []
      for (const ri of ingredients) {
        const si = stockById.get(ri.stock_item_id)
        if (!si) continue
        const c = canon(Number(ri.qty_per_portion ?? 0), ri.ingredient_unit)
        // Convertir a unidad del stock_item si difieren
        let qty = c.qty
        const fromUnit = c.unit?.toLowerCase() ?? ''
        const toUnit = si.unit.toLowerCase()
        if (fromUnit === 'g' && toUnit === 'kg') qty = qty / 1000
        else if (fromUnit === 'kg' && toUnit === 'g') qty = qty * 1000
        else if (fromUnit === 'ml' && toUnit === 'l') qty = qty / 1000
        else if (fromUnit === 'l' && toUnit === 'ml') qty = qty * 1000

        const total = qty * unitsSold
        const existing = consumoMap.get(ri.stock_item_id) ?? { qty: 0, dishes: new Set() }
        existing.qty += total
        existing.dishes.add(mi.name)
        consumoMap.set(ri.stock_item_id, existing)
      }
    }

    // 6. Construir resultado
    const items: ConsumoItem[] = []
    for (const [siId, { qty, dishes }] of consumoMap) {
      const si = stockById.get(siId)
      if (!si || qty <= 0) continue
      items.push({
        stock_item_id: siId,
        name: si.name,
        unit: si.unit,
        consumed: Math.round(qty * 100) / 100,
        from_dishes: [...dishes].sort(),
      })
    }
    items.sort((a, b) => b.consumed - a.consumed)

    const payload: ConsumoPayload = {
      days,
      from: sinceDate,
      to: todayAR,
      items,
      generated_at: new Date().toISOString(),
    }
    cache.set(days, { at: Date.now(), payload })
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[GET /api/stock/consumo]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
