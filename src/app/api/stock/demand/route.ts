import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { sumSaleMovements, stockDropConsumption } from '@/lib/stock/consumption'

// GET /api/stock/demand?stock_item_id=UUID&days=14
//
// Encuentra qué platos del menú consumen este insumo y cuánto se vendió.
// Cuatro rutas, de más precisa a más aproximada:
//
// Ruta A  — recipe directo: stock_item → recipe_ingredients → menu_items (recipe_id) → fudo_sales
//
// Ruta A2 — cadena de dos niveles via elaborado intermedio:
//            stock_item (nalga) → recipe L1 ("Milanesa cruda")
//            → stock_item "Milanesa cruda" (match por nombre de receta)
//            → recipe L2 ("Milanesa napolitana") → menu_item → fudo_sales
//            Calcula qty compuesta: qty_L1 × qty_L2 (ej: 150g nalga × 1 milanesa = 150g/plato)
//
// Ruta B  — name match: stock_item.name → menu_items ILIKE → fudo_sales
//            (fallback cuando no hay recetas vinculadas)
//
// Ruta C  — fudo ingredient sync: stock_movements[reason='sale'] (consumo real registrado)

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!isManagerOrAbove(profile?.role)) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const stockItemId = searchParams.get('stock_item_id')
  const days = Math.min(parseInt(searchParams.get('days') ?? '14'), 90)

  if (!stockItemId) return NextResponse.json({ error: 'stock_item_id requerido' }, { status: 400 })

  const admin = createAdminClient()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffISO = cutoff.toISOString()

  const { data: stockItem } = await admin
    .from('stock_items')
    .select('id, name, unit, current_qty, min_qty, fudo_ingredient_id')
    .eq('id', stockItemId)
    .single()

  if (!stockItem) return NextResponse.json({ error: 'Item no encontrado' }, { status: 404 })

  // -------------------------------------------------------------------------
  // RUTA A — directo: stock_item → recipe_ingredients → menu_items
  // -------------------------------------------------------------------------
  type SaleRow = { menu_item: string; fudo_product_id: string; units_sold: number; via: 'recipe' | 'name' }
  let salesRows: SaleRow[] = []
  let effectiveQtyPerPortion: number | null = null
  let effectivePortionUnit: string = stockItem.unit

  const { data: riRows } = await admin
    .from('recipe_ingredients')
    .select('recipe_id, qty_per_portion, ingredient_unit')
    .eq('stock_item_id', stockItemId)

  const recipeIds = (riRows ?? []).map(r => r.recipe_id)

  // Mapa recipe_id → qty del insumo por porción (para cálculos de cadena L2)
  const qtyByRecipeId: Record<string, number> = {}
  for (const ri of riRows ?? []) {
    qtyByRecipeId[ri.recipe_id] = ri.qty_per_portion
  }

  if (recipeIds.length > 0) {
    const { data: menuItemsViaRecipe } = await admin
      .from('menu_items')
      .select('id, name, recipe_id, fudo_product_id')
      .in('recipe_id', recipeIds)
      .eq('is_active', true)
      .not('fudo_product_id', 'is', null)

    const fudoIds = (menuItemsViaRecipe ?? []).map(m => m.fudo_product_id as string).filter(Boolean)
    if (fudoIds.length > 0) {
      const { data: fudoSales } = await admin
        .from('fudo_consumo') // ítems vendidos + opciones elegidas
        .select('fudo_product_id, quantity')
        .in('fudo_product_id', fudoIds)
        .gte('sold_at', cutoffISO)

      const totals: Record<string, number> = {}
      for (const s of fudoSales ?? []) {
        totals[s.fudo_product_id] = (totals[s.fudo_product_id] ?? 0) + s.quantity
      }

      salesRows = (menuItemsViaRecipe ?? [])
        .filter(m => m.fudo_product_id && totals[m.fudo_product_id as string] > 0)
        .map(m => ({
          menu_item: m.name,
          fudo_product_id: m.fudo_product_id as string,
          units_sold: Math.round(totals[m.fudo_product_id as string] ?? 0),
          via: 'recipe' as const,
        }))

      if (salesRows.length > 0) {
        const riForItem = riRows?.find(r => r.qty_per_portion > 0)
        effectiveQtyPerPortion = riForItem?.qty_per_portion ?? null
        effectivePortionUnit = riForItem?.ingredient_unit ?? stockItem.unit
      }
    }
  }

  // -------------------------------------------------------------------------
  // RUTA A2 — cadena de dos niveles via elaborado intermedio
  //
  // Ejemplo: nalga → "Milanesa cruda" (recipe L1) → "Milanesa cruda" (stock_item)
  //          → "Milanesa napolitana" (recipe L2) → menu_item → fudo_sales
  //
  // El vínculo entre recipe L1 y stock_item intermedio se resuelve PRIMERO por
  // recipes.output_stock_item_id (explícito, robusto a renombres) y, para las
  // recetas sin vincular, cae al match por nombre exacto (case-insensitive).
  //
  // Qty compuesta = qty_L1 (nalga por milanesa cruda) × qty_L2 (milanesas por plato)
  // -------------------------------------------------------------------------
  if (salesRows.length === 0 && recipeIds.length > 0) {
    type RecipeL1Row = { id: string; name: string; output_stock_item_id?: string | null }
    let recipesL1: RecipeL1Row[] = []
    {
      const res = await admin
        .from('recipes')
        .select('id, name, output_stock_item_id')
        .in('id', recipeIds)
      if (res.error) {
        // Fallback: columna output_stock_item_id todavía no migrada
        const legacy = await admin.from('recipes').select('id, name').in('id', recipeIds)
        recipesL1 = (legacy.data ?? []) as RecipeL1Row[]
      } else {
        recipesL1 = (res.data ?? []) as RecipeL1Row[]
      }
    }

    if (recipesL1.length) {
      // 1. Vínculo explícito: stock_item.id ← recipes.output_stock_item_id
      const explicitRecipeByItemId: Record<string, string> = {}
      for (const r of recipesL1) {
        if (r.output_stock_item_id) explicitRecipeByItemId[r.output_stock_item_id] = r.id
      }
      const explicitItemIds = Object.keys(explicitRecipeByItemId)
      const unlinkedRecipes = recipesL1.filter(r => !r.output_stock_item_id)

      const [explicitRes, byNameRes] = await Promise.all([
        explicitItemIds.length > 0
          ? admin.from('stock_items').select('id, name').in('id', explicitItemIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
        unlinkedRecipes.length > 0
          ? admin
              .from('stock_items')
              .select('id, name')
              .or(unlinkedRecipes.map(r => `name.ilike.${r.name}`).join(','))
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ])

      // Unificar (el explícito manda si un item aparece por las dos vías)
      const semiFinishedById = new Map<string, { id: string; name: string }>()
      for (const sf of [...(explicitRes.data ?? []), ...(byNameRes.data ?? [])]) {
        if (!semiFinishedById.has(sf.id)) semiFinishedById.set(sf.id, sf)
      }
      const semiFinished = [...semiFinishedById.values()]

      if (semiFinished.length) {
        // Mapa: sf stock_item.id → qty L1 (cuánto insumo raw por unidad de elaborado)
        const recipeLowerToId: Record<string, string> = {}
        for (const r of unlinkedRecipes) {
          recipeLowerToId[r.name.toLowerCase()] = r.id
        }
        const sfIdToL1Qty: Record<string, number> = {}
        for (const sf of semiFinished) {
          const matchingRecipeId = explicitRecipeByItemId[sf.id] ?? recipeLowerToId[sf.name.toLowerCase()]
          if (matchingRecipeId && qtyByRecipeId[matchingRecipeId] != null) {
            sfIdToL1Qty[sf.id] = qtyByRecipeId[matchingRecipeId]
          }
        }

        const sfIds = semiFinished.map(s => s.id)

        const { data: l2Ris } = await admin
          .from('recipe_ingredients')
          .select('recipe_id, stock_item_id, qty_per_portion')
          .in('stock_item_id', sfIds)

        const l2RecipeIds = [...new Set((l2Ris ?? []).map(r => r.recipe_id))]

        if (l2RecipeIds.length > 0) {
          const { data: menuItemsChain } = await admin
            .from('menu_items')
            .select('id, name, recipe_id, fudo_product_id')
            .in('recipe_id', l2RecipeIds)
            .eq('is_active', true)
            .not('fudo_product_id', 'is', null)

          const fudoIds = (menuItemsChain ?? []).map(m => m.fudo_product_id as string).filter(Boolean)

          if (fudoIds.length > 0) {
            const { data: fudoSales } = await admin
              .from('fudo_consumo') // ítems vendidos + opciones elegidas
              .select('fudo_product_id, quantity')
              .in('fudo_product_id', fudoIds)
              .gte('sold_at', cutoffISO)

            const totals: Record<string, number> = {}
            for (const s of fudoSales ?? []) {
              totals[s.fudo_product_id] = (totals[s.fudo_product_id] ?? 0) + s.quantity
            }

            salesRows = (menuItemsChain ?? [])
              .filter(m => m.fudo_product_id && (totals[m.fudo_product_id as string] ?? 0) > 0)
              .map(m => ({
                menu_item: m.name,
                fudo_product_id: m.fudo_product_id as string,
                units_sold: Math.round(totals[m.fudo_product_id as string] ?? 0),
                via: 'recipe' as const,
              }))

            // Qty compuesta ponderada por ventas:
            // compound = qty_L1 (insumo/elaborado) × qty_L2 (elaborado/plato)
            if (salesRows.length > 0) {
              let totalWeightedQty = 0
              let totalUnits = 0

              for (const row of salesRows) {
                const mi = menuItemsChain?.find(m => m.fudo_product_id === row.fudo_product_id)
                if (!mi) continue
                const l2RisForRecipe = (l2Ris ?? []).filter(ri => ri.recipe_id === mi.recipe_id)
                for (const l2ri of l2RisForRecipe) {
                  const l1Qty = sfIdToL1Qty[l2ri.stock_item_id]
                  if (l1Qty != null) {
                    totalWeightedQty += l1Qty * l2ri.qty_per_portion * row.units_sold
                    totalUnits += row.units_sold
                  }
                }
              }

              if (totalUnits > 0 && totalWeightedQty > 0) {
                effectiveQtyPerPortion = totalWeightedQty / totalUnits
                effectivePortionUnit = riRows?.find(r => r.ingredient_unit)?.ingredient_unit ?? stockItem.unit
              }
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // RUTA B — name match cuando las rutas de receta no encontraron nada
  // -------------------------------------------------------------------------
  if (salesRows.length === 0) {
    const words = stockItem.name
      .split(/\s+/)
      .filter(w => w.length >= 3)
      .map(w => w.toLowerCase())

    if (words.length > 0) {
      const keyWords = words.slice(0, 2)
      const conditions = keyWords.map(w => `name.ilike.%${w}%`).join(',')

      const { data: menuItemsByName } = await admin
        .from('menu_items')
        .select('id, name, fudo_product_id')
        .or(conditions)
        .eq('is_active', true)
        .not('fudo_product_id', 'is', null)

      const fudoIds = (menuItemsByName ?? []).map(m => m.fudo_product_id as string).filter(Boolean)
      if (fudoIds.length > 0) {
        const { data: fudoSales } = await admin
          .from('fudo_consumo') // ítems vendidos + opciones elegidas
          .select('fudo_product_id, quantity')
          .in('fudo_product_id', fudoIds)
          .gte('sold_at', cutoffISO)

        const totals: Record<string, number> = {}
        for (const s of fudoSales ?? []) {
          totals[s.fudo_product_id] = (totals[s.fudo_product_id] ?? 0) + s.quantity
        }

        salesRows = (menuItemsByName ?? [])
          .filter(m => m.fudo_product_id && (totals[m.fudo_product_id as string] ?? 0) > 0)
          .map(m => ({
            menu_item: m.name,
            fudo_product_id: m.fudo_product_id as string,
            units_sold: Math.round(totals[m.fudo_product_id as string] ?? 0),
            via: 'name' as const,
          }))
      }
    }
  }

  salesRows.sort((a, b) => b.units_sold - a.units_sold)

  // -------------------------------------------------------------------------
  // RUTA C — consumo real de Fudo sync en stock_movements
  // -------------------------------------------------------------------------
  const consumedFromSync = await sumSaleMovements(admin, stockItemId, cutoffISO)

  // -------------------------------------------------------------------------
  // Respuesta
  // -------------------------------------------------------------------------
  const totalUnitsSold = salesRows.reduce((s, r) => s + r.units_sold, 0)

  const estimatedConsumed = effectiveQtyPerPortion
    ? Math.round(totalUnitsSold * effectiveQtyPerPortion * 100) / 100
    : null

  // -------------------------------------------------------------------------
  // Última compra (recepción) y último pedido — para controlar cada cuánto se pide
  // -------------------------------------------------------------------------
  const cutoffDateStr = cutoffISO.slice(0, 10)

  const { data: receipts } = await admin
    .from('stock_receipts')
    .select('qty, unit, received_date')
    .eq('stock_item_id', stockItemId)
    .order('received_date', { ascending: false })
    .limit(30)

  const receivedInWindow = (receipts ?? [])
    .filter(r => r.received_date >= cutoffDateStr)
    .reduce((s, r) => s + Number(r.qty), 0)
  const lastReceipt = (receipts ?? [])[0]
    ? { date: (receipts ?? [])[0].received_date, qty: Number((receipts ?? [])[0].qty), unit: (receipts ?? [])[0].unit }
    : null

  // Último pedido creado (cocina/barra) que mencione este insumo por nombre
  const keyWord = stockItem.name.split(/\s+/).find((w: string) => w.length >= 3) ?? stockItem.name
  const [lastKitchen, lastBar] = await Promise.all([
    admin.from('kitchen_orders').select('quantity, created_at, status').ilike('product_name', `%${keyWord}%`).order('created_at', { ascending: false }).limit(1),
    admin.from('bar_orders').select('quantity, created_at, status').ilike('product_name', `%${keyWord}%`).order('created_at', { ascending: false }).limit(1),
  ])
  const lastOrder = [...(lastKitchen.data ?? []), ...(lastBar.data ?? [])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null

  // -------------------------------------------------------------------------
  // Consumo por caída de stock (fallback para insumos Fudo sin receta, como
  // el lomo): cuánto bajó el stock en la ventana + lo que entró = lo consumido.
  // -------------------------------------------------------------------------
  let consumedFromStock: number | null = null
  let stockWindowDays: number | null = null
  if (estimatedConsumed == null && consumedFromSync === 0) {
    const drop = await stockDropConsumption(
      admin,
      { id: stockItemId, current_qty: Number(stockItem.current_qty) },
      cutoffDateStr,
      receivedInWindow,
    )
    if (drop) {
      consumedFromStock = drop.consumed
      stockWindowDays = drop.windowDays
    }
  }

  const totalConsumed = consumedFromSync > 0
    ? consumedFromSync
    : estimatedConsumed ?? consumedFromStock ?? 0

  // El consumo por stock se midió sobre su propia ventana (snapshots disponibles),
  // no sobre los 14 días — dividir por la ventana correcta para la tasa diaria.
  const consumedWindowDays = (consumedFromSync === 0 && estimatedConsumed == null && consumedFromStock != null)
    ? (stockWindowDays ?? days)
    : days
  const dailyRate = totalConsumed > 0
    ? Math.round((totalConsumed / consumedWindowDays) * 100) / 100
    : null

  const daysOfStock = dailyRate && dailyRate > 0
    ? Math.round((Number(stockItem.current_qty) / dailyRate) * 10) / 10
    : null

  const dataSource: 'recipe' | 'name' | 'sync' | 'stock' | 'none' =
    consumedFromSync > 0 ? 'sync'
    : estimatedConsumed != null && salesRows[0]?.via === 'recipe' ? 'recipe'
    : consumedFromStock != null ? 'stock'
    : salesRows[0]?.via === 'name' ? 'name'
    : 'none'

  return NextResponse.json({
    stock_item: {
      id: stockItem.id,
      name: stockItem.name,
      unit: stockItem.unit,
      current_qty: Number(stockItem.current_qty),
      min_qty: Number(stockItem.min_qty),
    },
    days,
    sales: salesRows,
    total_units_sold: totalUnitsSold,
    qty_per_portion: effectiveQtyPerPortion,
    portion_unit: effectivePortionUnit,
    estimated_consumed: estimatedConsumed,
    consumed_from_sync: consumedFromSync,
    consumed_from_stock: consumedFromStock,
    stock_window_days: stockWindowDays,
    total_consumed: totalConsumed,
    daily_rate: dailyRate,
    days_of_stock: daysOfStock,
    data_source: dataSource,
    last_received: lastReceipt,
    last_order: lastOrder ? { date: lastOrder.created_at, quantity: lastOrder.quantity, status: lastOrder.status } : null,
  })
}
