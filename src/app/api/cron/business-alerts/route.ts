import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyEvent } from '@/lib/push/notify-event'
import { fetchFudoExpenses } from '@/lib/fudo/expenses'
import { costRecipes } from '@/lib/recipes/recipe-cost'

// ---------------------------------------------------------------------------
// GET /api/cron/business-alerts
// ---------------------------------------------------------------------------
// Cron semanal (lunes 14:00 UTC = 11:00 AR). "Parte de la semana": SOLO los
// desvíos que importan, no un dashboard. Calcula 3 bloques sobre la última
// semana (7d) vs la previa (días 8-14), fechas AR (UTC-3):
//
//   1) FOOD COST REAL = compras Fudo de la semana / ventas de la semana.
//      Semáforo: ok ≤35%, atención 35-42%, alerta >42%. Comparado vs previa.
//   2) INSUMOS QUE SE ENCARECIERON: gastos single-ingredient (~60d), último
//      precio vs promedio de los anteriores; top 3 con suba ≥15%.
//   3) PLATOS POPULARES CON MAL MARGEN: ventas 7d × costo de receta; de los
//      del top 25% por unidades vendidas, top 3 con food_cost_pct > 42%.
//
// Cada bloque se incluye sólo si dispara algo. Si NINGUNO dispara → semana
// sana, no se manda push. Se registra en audit_trail lo enviado.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const AR_OFFSET = '-03:00'

/** Fecha AR (YYYY-MM-DD) de "ahora" menos N días. */
function arDateMinus(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return d.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

/** Instante UTC del inicio (00:00 AR) de una fecha AR. */
function arStartOfDayUTC(arDate: string): Date {
  return new Date(`${arDate}T00:00:00${AR_OFFSET}`)
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n)}`
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const admin = createAdminClient()

    // Ventanas (fechas AR). Semana = [d0, d7); previa = [d14, d7).
    const dToday = arDateMinus(0)
    const d7 = arDateMinus(7)
    const d14 = arDateMinus(14)
    const weekStartUTC = arStartOfDayUTC(d7)
    const prevStartUTC = arStartOfDayUTC(d14)
    const nowUTC = new Date()

    const debug: Record<string, unknown> = { windows: { d14, d7, today: dToday } }
    const blocks: string[] = []

    // =====================================================================
    // BLOQUE 1 + insumos: gastos Fudo (~60d de una sola llamada, se filtra)
    // =====================================================================
    const since60 = arStartOfDayUTC(arDateMinus(60)).toISOString()
    const expenses = await fetchFudoExpenses(since60)

    // --- Compras de cada ventana (todos los gastos, por fecha) ---
    const purchasesWeek = expenses
      .filter((e) => e.date >= weekStartUTC.toISOString() && e.date < nowUTC.toISOString())
      .reduce((s, e) => s + e.amount, 0)
    const purchasesPrev = expenses
      .filter((e) => e.date >= prevStartUTC.toISOString() && e.date < weekStartUTC.toISOString())
      .reduce((s, e) => s + e.amount, 0)

    // --- Ventas de cada ventana (Σ qty × price desde fudo_sales) ---
    async function salesTotal(fromUTC: Date, toUTC: Date): Promise<number> {
      let total = 0
      const PAGE = 1000
      for (let page = 0; page < 50; page++) {
        const from = page * PAGE
        const { data, error } = await admin
          .from('fudo_sales')
          .select('quantity, raw_payload')
          .gte('sold_at', fromUTC.toISOString())
          .lt('sold_at', toUTC.toISOString())
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) throw new Error(error.message)
        if (!data || data.length === 0) break
        for (const row of data) {
          const price = Number((row.raw_payload as Record<string, unknown> | null)?.price ?? 0)
          total += Number(row.quantity ?? 0) * price
        }
        if (data.length < PAGE) break
      }
      return total
    }

    const salesWeek = await salesTotal(weekStartUTC, nowUTC)
    const salesPrev = await salesTotal(prevStartUTC, weekStartUTC)

    const fcWeek = salesWeek > 0 ? (purchasesWeek / salesWeek) * 100 : null
    const fcPrev = salesPrev > 0 ? (purchasesPrev / salesPrev) * 100 : null

    debug.food_cost = {
      week: { purchases: purchasesWeek, sales: salesWeek, pct: fcWeek },
      prev: { purchases: purchasesPrev, sales: salesPrev, pct: fcPrev },
    }

    if (fcWeek != null) {
      const emoji = fcWeek <= 35 ? '🟢' : fcWeek <= 42 ? '🟡' : '🔴'
      let trend = ''
      if (fcPrev != null) {
        const diff = fcWeek - fcPrev
        const dir = diff > 0 ? 'subió' : diff < 0 ? 'bajó' : 'igual que'
        trend =
          Math.abs(diff) < 0.5
            ? ` (igual que la anterior)`
            : ` (${dir} ${Math.abs(diff).toFixed(0)} pts vs la anterior)`
      }
      // Se alerta siempre que haya dato (el semáforo comunica el estado). Pero
      // el "parte" debe traer solo lo que importa: incluimos food cost sólo si
      // no está OK, o si empeoró ≥2 pts respecto de la semana previa.
      const worsened = fcPrev != null && fcWeek - fcPrev >= 2
      if (fcWeek > 35 || worsened) {
        blocks.push(`${emoji} Food cost semana: ${fcWeek.toFixed(0)}%${trend}`)
      }
    }

    // =====================================================================
    // BLOQUE 2: insumos que se encarecieron (single-ingredient, ~60d)
    // =====================================================================
    // Por insumo: serie temporal de precios (gastos de 1 solo ingrediente).
    // Comparamos el ÚLTIMO precio contra el promedio de los anteriores.
    const single = expenses.filter((e) => e.itemCount === 1 && e.ingredientNames.length === 1)
    const byIngredient = new Map<string, { date: string; amount: number; provider: string | null }[]>()
    for (const e of single) {
      const name = e.ingredientNames[0]
      const arr = byIngredient.get(name) ?? []
      arr.push({ date: e.date, amount: e.amount, provider: e.provider })
      byIngredient.set(name, arr)
    }

    type PriceHike = { name: string; last: number; prevAvg: number; pct: number; provider: string | null }
    const hikes: PriceHike[] = []
    for (const [name, series] of byIngredient) {
      if (series.length < 3) continue // necesita ≥2 puntos previos + el último
      const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date))
      const last = sorted[sorted.length - 1]
      const prev = sorted.slice(0, -1)
      const prevAvg = prev.reduce((s, p) => s + p.amount, 0) / prev.length
      if (prevAvg <= 0) continue
      const pct = ((last.amount - prevAvg) / prevAvg) * 100
      if (pct >= 15) {
        hikes.push({ name, last: last.amount, prevAvg, pct, provider: last.provider })
      }
    }
    hikes.sort((a, b) => b.pct - a.pct)
    debug.price_hikes = hikes

    const topHikes = hikes.slice(0, 3)
    if (topHikes.length > 0) {
      const lines = topHikes.map((h) => {
        const prov = h.provider ? `, ${h.provider}` : ''
        return `• ${h.name} +${h.pct.toFixed(0)}% (${fmtMoney(h.prevAvg)}→${fmtMoney(h.last)}${prov})`
      })
      blocks.push(['💸 Insumos que se encarecieron:', ...lines].join('\n'))
    }

    // =====================================================================
    // BLOQUE 3: platos populares con mal margen
    // =====================================================================
    // Ventas 7d por plato con receta → food_cost_pct = costo receta / precio.
    // De los del top 25% por unidades vendidas, top 3 con food_cost_pct > 42%.
    const { data: menuItems, error: miErr } = await admin
      .from('menu_items')
      .select('name, recipe_id, fudo_product_id')
      .eq('is_active', true)
      .not('recipe_id', 'is', null)
      .not('fudo_product_id', 'is', null)
    if (miErr) throw new Error(miErr.message)

    const infoByFudoId = new Map<string, { name: string; recipeId: string }>()
    for (const mi of menuItems ?? []) {
      if (mi.fudo_product_id && mi.recipe_id) {
        infoByFudoId.set(mi.fudo_product_id, { name: mi.name as string, recipeId: mi.recipe_id as string })
      }
    }

    type DishAgg = { name: string; recipeId: string; units: number; revenue: number }
    const dishByFudoId = new Map<string, DishAgg>()

    if (infoByFudoId.size > 0) {
      const fudoIds = [...infoByFudoId.keys()]
      const PAGE = 1000
      for (let page = 0; page < 50; page++) {
        const from = page * PAGE
        const { data, error } = await admin
          .from('fudo_sales')
          .select('fudo_product_id, quantity, raw_payload')
          .in('fudo_product_id', fudoIds)
          .gte('sold_at', weekStartUTC.toISOString())
          .lt('sold_at', nowUTC.toISOString())
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) throw new Error(error.message)
        if (!data || data.length === 0) break
        for (const row of data) {
          const info = infoByFudoId.get(row.fudo_product_id as string)
          if (!info) continue
          const qty = Number(row.quantity ?? 0)
          const price = Number((row.raw_payload as Record<string, unknown> | null)?.price ?? 0)
          const agg = dishByFudoId.get(row.fudo_product_id as string) ?? {
            name: info.name,
            recipeId: info.recipeId,
            units: 0,
            revenue: 0,
          }
          agg.units += qty
          agg.revenue += qty * price
          dishByFudoId.set(row.fudo_product_id as string, agg)
        }
        if (data.length < PAGE) break
      }
    }

    const dishes = [...dishByFudoId.values()].filter((d) => d.units > 0)
    let badMargin: { name: string; pct: number; units: number }[] = []
    if (dishes.length > 0) {
      // Top 25% por unidades vendidas (populares)
      const sortedByUnits = [...dishes].sort((a, b) => b.units - a.units)
      const cutoffCount = Math.max(1, Math.ceil(sortedByUnits.length * 0.25))
      const popular = sortedByUnits.slice(0, cutoffCount)

      const costs = await costRecipes(admin, [...new Set(popular.map((d) => d.recipeId))])
      for (const d of popular) {
        const rc = costs.get(d.recipeId)
        // Solo platos con costo CONFIABLE completo — un food cost parcial
        // dispararía alertas con números fantasma.
        if (!rc || !rc.confiable || rc.cost <= 0) continue
        const avgPrice = d.revenue / d.units
        if (avgPrice <= 0) continue
        const pct = (rc.cost / avgPrice) * 100
        if (pct > 42) badMargin.push({ name: d.name, pct, units: d.units })
      }
      badMargin.sort((a, b) => b.pct - a.pct)
      badMargin = badMargin.slice(0, 3)
    }
    debug.bad_margin = badMargin

    if (badMargin.length > 0) {
      const lines = badMargin.map(
        (b) => `• ${b.name}: vendés mucho pero food cost ${b.pct.toFixed(0)}%`,
      )
      blocks.push(['📉 Platos populares con mal margen:', ...lines].join('\n'))
    }

    // =====================================================================
    // BLOQUE 4: desincronización de recetas (import del export de Fudo)
    // =====================================================================
    // (a) app_settings.fudo_recetas_import → cuándo fue el último import.
    // (b) menu_items activos con fudo_product_id, ventas 28d y SIN receta:
    //     si son ≥3, avisar que hay que subir el XLS.
    // (c) si el último import fue hace >45 días, avisar que está viejo.
    // No bloqueante: si algo falla acá, el parte sale igual.
    try {
      const { data: importSetting } = await admin
        .from('app_settings')
        .select('value')
        .eq('key', 'fudo_recetas_import')
        .maybeSingle()
      const lastImportAt = (importSetting?.value as Record<string, unknown> | null)
        ?.last_import_at

      const { data: noRecipeItems, error: nrErr } = await admin
        .from('menu_items')
        .select('id, fudo_product_id')
        .eq('is_active', true)
        .is('recipe_id', null)
        .not('fudo_product_id', 'is', null)
      if (nrErr) throw new Error(nrErr.message)

      let sinRecetaConVentas = 0
      const noRecipeFudoIds = (noRecipeItems ?? [])
        .map((mi) => mi.fudo_product_id as string | null)
        .filter((id): id is string => Boolean(id))

      if (noRecipeFudoIds.length > 0) {
        const since28 = arStartOfDayUTC(arDateMinus(28)).toISOString()
        const soldFudoIds = new Set<string>()
        const PAGE = 1000
        for (let page = 0; page < 50; page++) {
          const from = page * PAGE
          const { data, error } = await admin
            .from('fudo_sales')
            .select('fudo_product_id')
            .in('fudo_product_id', noRecipeFudoIds)
            .gte('sold_at', since28)
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1)
          if (error) throw new Error(error.message)
          if (!data || data.length === 0) break
          for (const row of data) {
            if (row.fudo_product_id) soldFudoIds.add(row.fudo_product_id as string)
          }
          if (data.length < PAGE) break
        }
        sinRecetaConVentas = soldFudoIds.size
      }

      const syncLines: string[] = []
      if (sinRecetaConVentas >= 3) {
        syncLines.push(
          `📥 ${sinRecetaConVentas} productos venden sin receta en la app — exportá el XLS de Fudo y subilo (2 min)`,
        )
      }
      if (typeof lastImportAt === 'string') {
        const daysSince = Math.floor(
          (Date.now() - new Date(lastImportAt).getTime()) / (24 * 60 * 60 * 1000),
        )
        if (daysSince > 45) {
          syncLines.push(`📥 Hace ${daysSince} días que no se importan las recetas de Fudo`)
        }
      }
      if (syncLines.length > 0) blocks.push(syncLines.join('\n'))

      debug.recipe_sync = {
        sin_receta_con_ventas_28d: sinRecetaConVentas,
        last_import_at: typeof lastImportAt === 'string' ? lastImportAt : null,
      }
    } catch (err) {
      debug.recipe_sync_error = err instanceof Error ? err.message : String(err)
    }

    // =====================================================================
    // Envío
    // =====================================================================
    let sent = false
    if (blocks.length > 0) {
      const body = blocks.join('\n\n')
      await notifyEvent(admin, 'business_alerts', {
        title: '📊 Parte de la semana',
        body,
        url: '/ventas?m=carta',
      })
      sent = true

      // audit_trail — insert directo (module 'ventas' no está en el helper tipado)
      try {
        await admin.from('audit_trail').insert({
          action: 'business_alert',
          module: 'ventas',
          entity_type: 'cron',
          entity_id: 'business-alerts',
          description: `Parte de la semana: ${blocks.length} bloque(s) enviado(s)`,
          metadata: JSON.parse(JSON.stringify({ body, debug })),
        })
      } catch {
        /* audit no bloqueante */
      }
    }

    return NextResponse.json({
      success: true,
      sent,
      blocks_sent: blocks.length,
      body: sent ? blocks.join('\n\n') : null,
      debug,
    })
  } catch (error) {
    console.error('[GET /api/cron/business-alerts]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
