import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fudoHttp } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// GET /api/bar/consumption
// Cruza ventas de Fudo HOY con recetas de barra para estimar consumo.
// Devuelve por cada insumo de barra: stock actual, consumo estimado, restante.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    // 1. Get bar product recipes (product_id → insumo mapping)
    const { data: recipes } = await admin
      .from('bar_product_recipes')
      .select('fudo_product_id, fudo_product_name, bar_stock_item_id, qty_per_unit, unit')

    if (!recipes?.length) {
      return NextResponse.json({ consumption: [], message: 'Sin recetas de barra configuradas' })
    }

    // 2. Get today's sales from Fudo
    let todaySales: { productId: string; qty: number }[] = []
    let fudoError: string | null = null
    try {
      // Fetch sales with items
      let allItems: { productId: string; qty: number }[] = []
      let page = 1
      while (page <= 5) {
        const res = await fudoHttp(
          `https://api.fu.do/v1alpha1/sales?include=items&sort=-createdAt&page[size]=100&page[number]=${page}`,
        )
        if (!res.ok) throw new Error(`Fudo ${res.status}`)
        const d = await res.json()
        const sales = d.data || []
        const included = d.included || []

        // Filter today (Argentina time)
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })

        const itemMap = new Map<string, { qty: number; productId: string | null }>()
        for (const inc of included) {
          if (inc.type === 'Item') {
            itemMap.set(inc.id, {
              qty: Number(inc.attributes?.quantity || 1),
              productId: inc.relationships?.product?.data?.id || null,
            })
          }
        }

        for (const sale of sales) {
          const created = String(sale.attributes.createdAt || '')
          const argDate = new Date(created).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
          if (argDate !== today) continue
          // Skip cancelled
          if (sale.attributes.saleState === 'CANCELLED') continue

          const saleItems = sale.relationships?.items?.data || []
          for (const ref of saleItems) {
            const item = itemMap.get(ref.id)
            if (item?.productId) {
              allItems.push({ productId: item.productId, qty: item.qty })
            }
          }
        }

        if (sales.length < 100) break
        const oldest = sales[sales.length - 1]
        const oldestArg = new Date(String(oldest.attributes.createdAt)).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
        if (oldestArg < today) break
        page++
      }

      todaySales = allItems
    } catch (err) {
      console.error('[bar/consumption] Fudo error:', err)
      // Se sigue sin ventas, pero avisando que Fudo no respondió (antes
      // mostraba "0 consumo" como si no se hubiera vendido nada)
      fudoError = err instanceof Error ? err.message : 'Fudo no respondió'
    }

    // 3. Calculate consumption per bar_stock_item
    const consumptionMap = new Map<number, { itemName: string; consumed: number; unit: string }>()

    for (const sale of todaySales) {
      // Find recipes for this product
      const productRecipes = recipes.filter(r => r.fudo_product_id === sale.productId)
      for (const recipe of productRecipes) {
        const existing = consumptionMap.get(recipe.bar_stock_item_id)
        if (existing) {
          existing.consumed += recipe.qty_per_unit * sale.qty
        } else {
          consumptionMap.set(recipe.bar_stock_item_id, {
            itemName: '',
            consumed: recipe.qty_per_unit * sale.qty,
            unit: recipe.unit,
          })
        }
      }
    }

    // 4. Get current bar stock
    const { data: barItems } = await admin
      .from('bar_stock_items')
      .select('id, name, current_qty, unit, min_level, is_urgent, category')
      .eq('is_active', true)
      .order('sort_order')

    // 5. Build response
    const consumption = (barItems ?? []).map(item => {
      const cons = consumptionMap.get(item.id)
      const consumed = cons?.consumed ?? 0

      // Convert units if needed (e.g., café consumed in gr, stock in kg)
      let consumedConverted = consumed
      let consumedUnit = cons?.unit ?? item.unit ?? ''
      if (item.unit === 'kg' && consumedUnit === 'gr') {
        consumedConverted = consumed / 1000
        consumedUnit = 'kg'
      }

      const remaining = item.current_qty - consumedConverted
      const pctUsed = item.current_qty > 0 ? Math.round((consumedConverted / item.current_qty) * 100) : 0

      return {
        id: item.id,
        name: item.name,
        category: item.category,
        currentQty: item.current_qty,
        unit: item.unit,
        consumed: Math.round(consumedConverted * 100) / 100,
        consumedRaw: Math.round(consumed * 100) / 100,
        consumedUnit,
        remaining: Math.round(remaining * 100) / 100,
        pctUsed,
        isLow: remaining <= (item.min_level ?? 0),
        isUrgent: item.is_urgent || remaining <= 0,
      }
    })

    // Sort: most consumed first
    const withConsumption = consumption.filter(c => c.consumed > 0)
      .sort((a, b) => b.pctUsed - a.pctUsed)
    const withoutConsumption = consumption.filter(c => c.consumed === 0)

    return NextResponse.json({
      consumption: [...withConsumption, ...withoutConsumption],
      totalProducts: todaySales.length,
      mappedProducts: new Set(todaySales.filter(s => recipes.some(r => r.fudo_product_id === s.productId)).map(s => s.productId)).size,
      fudo_error: fudoError,
    })
  } catch (error) {
    console.error('[bar/consumption]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
