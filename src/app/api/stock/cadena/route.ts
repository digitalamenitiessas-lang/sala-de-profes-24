import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isKitchenRole } from '@/lib/roles'
import { costRecipes, canon, toStockUnit } from '@/lib/recipes/recipe-cost'
import { esCostoConfiable, esErrorColumnaFaltante } from '@/lib/costos/confiable'

// ---------------------------------------------------------------------------
// GET /api/stock/cadena?item=<stock_item_id>
// ---------------------------------------------------------------------------
// EL HILO DE TRAZABILIDAD de un insumo, en 3 eslabones:
//
//   1) COMPRA      de dónde viene. Si se compra: último precio real pagado
//                  (stock_receipts), promedio y proveedor. Si es ELABORADO:
//                  los insumos base que lo componen — primero por la receta
//                  que lo produce (recipes.output_stock_item_id, fallback por
//                  nombre), y si no hay receta, por los production_inputs
//                  reales de la última tanda producida.
//
//   2) PRODUCCIÓN  (solo elaborados) últimas tandas: cantidad producida,
//                  costo por unidad producida, eficiencia vs teórico, fecha.
//                  Más stock actual y lotes vigentes.
//
//   3) VENTA       platos terminados que consumen el insumo. Cadena directa
//                  (insumo → receta → menu_item) y de 2 niveles vía elaborado
//                  intermedio (insumo → intermedio → receta → menu_item),
//                  resuelta por receta o, si no hay, por production_inputs.
//                  Por plato: unidades 7d/28d (AR = UTC-3), precio promedio
//                  real de fudo_sales, costo por porción (costRecipes) y
//                  margen en $ y %.
//
//   RESUMEN        costo del insumo consumido en 28d vs facturación de esos
//                  platos, y dónde queda el margen.
//
// NADA ESTIMADO EN SILENCIO: cada eslabón incompleto viaja con su flag
// (sin_precio_compra, sin_receta, sin_produccion, sin_ventas) para que la UI
// diga la verdad en vez de mostrar ceros.
//
// Roles cocina/manager. Cache en memoria de módulo: 5 min por insumo.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000
const AR_OFFSET_MS = 3 * 60 * 60 * 1000
const WINDOW_LONG = 28
const WINDOW_SHORT = 7

function arToday(): string {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

/** Inicio (en UTC) del día AR que está `days - 1` días antes de hoy. */
function arWindowStartUTC(days: number): string {
  const today = arToday()
  const since = new Date(new Date(`${today}T12:00:00Z`).getTime() - (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10)
  return new Date(`${since}T00:00:00-03:00`).toISOString()
}

function round(n: number, decimals = 2): number {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

// --- Shape público -------------------------------------------------------

export type CadenaFlags = {
  /** Elaborado sin receta que lo produzca (no se puede desglosar su costo teórico). */
  sin_receta: boolean
  /** Comprado sin ningún recibo con precio (solo el costo cargado a mano, si hay). */
  sin_precio_compra: boolean
  /** Elaborado sin tandas de producción registradas. */
  sin_produccion: boolean
  /** Ningún plato vendido en la ventana larga consume este insumo. */
  sin_ventas: boolean
  /** El insumo no tiene costo unitario cargado → los costos por porción lo ignoran. */
  costo_propio_ausente: boolean
}

export type CadenaInsumoBase = {
  stock_item_id: string
  name: string
  qty: number
  unit: string
  cost_per_unit: number | null
  costo: number | null
  /** La unidad cargada no se puede convertir a la del insumo — cifra dudosa. */
  unidad_dudosa: boolean
}

export type CadenaCompra = {
  tipo: 'comprado' | 'elaborado'
  /** Costo unitario cargado en la ficha del insumo (referencia siempre presente). */
  costo_cargado: number | null
  unit: string
  // --- comprado ---
  ultima_compra: {
    fecha: string
    qty: number
    unit: string
    cost_per_unit: number
    cost_total: number | null
    proveedor: string | null
  } | null
  precio_promedio: number | null
  precio_min: number | null
  precio_max: number | null
  compras_count: number
  proveedor: string | null
  // --- elaborado ---
  receta: { id: string; name: string; yield_portions: number | null } | null
  /** De dónde salen los insumos base listados. */
  origen_insumos: 'receta' | 'produccion' | null
  insumos: CadenaInsumoBase[]
  costo_insumos: number | null
}

export type CadenaTanda = {
  order_id: number
  name: string
  fecha: string
  status: string
  qty_producida: number
  qty_teorica: number | null
  eficiencia_pct: number | null
  unit: string
  costo_total: number | null
  costo_por_unidad: number | null
  /** Algún insumo sin costo conocido → el total está subestimado. */
  costo_parcial: boolean
}

export type CadenaLote = {
  id: number
  lot_code: string
  qty_remaining: number
  unit: string
  produced_at: string
  expires_at: string | null
  status: string
}

export type CadenaProduccion = {
  tandas: CadenaTanda[]
  total_producido: number
  unit: string
  ultimo_costo_por_unidad: number | null
  costo_por_unidad_promedio: number | null
  eficiencia_promedio_pct: number | null
  stock_actual: number
  lotes: CadenaLote[]
}

export type CadenaPlato = {
  menu_item_id: string
  name: string
  fudo_product_id: string
  /** 'directo' = el plato usa el insumo. 'intermedio' = lo usa vía un elaborado. */
  via: 'directo' | 'intermedio'
  intermedio: string | null
  /** Cuánto insumo se va por unidad vendida, en la unidad del insumo. */
  qty_por_porcion: number | null
  unit: string
  units_7d: number
  units_28d: number
  precio_promedio: number | null
  costo_porcion: number | null
  margen_unit: number | null
  margen_pct: number | null
  facturacion_28d: number
  /** Motivo por el que no se puede calcular margen (null si está completo). */
  motivo: string | null
  /** El costo del propio insumo no está cargado → este margen se ve mejor de lo real. */
  margen_inflado: boolean
}

export type CadenaResumen = {
  ventana_dias: number
  /** Insumo consumido en la ventana, en su unidad (solo platos con qty conocida). */
  insumo_consumido: number | null
  insumo_consumido_costo: number | null
  /** Σ costo por porción × unidades, de los platos costeados. */
  costo_platos: number | null
  facturacion: number
  margen: number | null
  margen_pct: number | null
  /** Cuánto del precio de venta se lleva este insumo. */
  peso_insumo_pct: number | null
  platos_costeados: number
  platos_totales: number
  notas: string[]
}

export type CadenaPayload = {
  item: {
    id: string
    name: string
    unit: string
    category: string | null
    current_qty: number
    cost_per_unit: number | null
    is_produced: boolean
  }
  flags: CadenaFlags
  compra: CadenaCompra
  produccion: CadenaProduccion | null
  venta: { platos: CadenaPlato[]; nivel_max: 1 | 2 }
  resumen: CadenaResumen
  generated_at: string
}

const cache = new Map<string, { at: number; payload: CadenaPayload }>()

// --- Helpers de dominio --------------------------------------------------

type StockItemLite = { id: string; name: string; unit: string; cost_per_unit: number | null; cost_source?: string | null }

/**
 * Costo en $ de `qty` de un insumo, convirtiendo unidades.
 * `usable` = el costo del item pasó el gating de fuente confiable
 * (compra/manual/producción); si es false la línea no se valoriza.
 */
function lineCost(
  qty: number,
  unit: string | null,
  item: StockItemLite | undefined,
  usable: boolean,
): { costo: number | null; qtyEnUnidadItem: number; dudosa: boolean } {
  if (!item) return { costo: null, qtyEnUnidadItem: qty, dudosa: true }
  const c = canon(qty, unit)
  const qtyItem = toStockUnit(c.qty, c.unit, item.unit)
  // Unidad dudosa: no coincide con la del insumo y la conversión la dejó igual
  const dudosa = !!c.unit && c.unit !== item.unit.trim().toLowerCase() && qtyItem === c.qty
  if (!usable || item.cost_per_unit == null) return { costo: null, qtyEnUnidadItem: qtyItem, dudosa }
  return { costo: round(qtyItem * Number(item.cost_per_unit)), qtyEnUnidadItem: qtyItem, dudosa }
}

/**
 * Núcleo del hilo: arma los 3 eslabones para un insumo.
 * Separado del handler para poder ejercitarlo con un admin client directo.
 * Devuelve null si el insumo no existe.
 */
export async function buildCadena(
  admin: ReturnType<typeof createAdminClient>,
  itemId: string,
): Promise<CadenaPayload | null> {
  {
    // Select tolerante a la migración de costo confiable (20260909) pendiente
    let hasCostSource = true
    let itemRes = await admin
      .from('stock_items')
      .select('id, name, unit, category, current_qty, cost_per_unit, cost_source, is_produced')
      .eq('id', itemId)
      .single()
    if (itemRes.error && esErrorColumnaFaltante(itemRes.error.message, ['cost_source'])) {
      hasCostSource = false
      itemRes = await admin
        .from('stock_items')
        .select('id, name, unit, category, current_qty, cost_per_unit, is_produced')
        .eq('id', itemId)
        .single() as typeof itemRes
    }
    const { data: itemRow, error: itemErr } = itemRes
    if (itemErr || !itemRow) return null

    /** Gating único: ¿el cost_per_unit de este item es un costo REAL usable? */
    const costoUsable = (i: { cost_per_unit: number | null; cost_source?: string | null } | undefined | null): boolean => {
      if (!i) return false
      return hasCostSource
        ? esCostoConfiable(i.cost_source ?? null, i.cost_per_unit)
        : Number(i.cost_per_unit ?? 0) > 0 // columna aún no migrada → criterio legacy
    }

    const item = {
      id: itemRow.id,
      name: itemRow.name,
      unit: itemRow.unit,
      category: itemRow.category ?? null,
      current_qty: Number(itemRow.current_qty ?? 0),
      cost_per_unit: itemRow.cost_per_unit != null ? Number(itemRow.cost_per_unit) : null,
      is_produced: !!itemRow.is_produced,
    }
    const itemCostConfiable = costoUsable(itemRow as { cost_per_unit: number | null; cost_source?: string | null })

    const sinceLong = arWindowStartUTC(WINDOW_LONG)
    const sinceShort = arWindowStartUTC(WINDOW_SHORT)

    // =====================================================================
    // Datos base en paralelo
    // =====================================================================
    const [receiptsRes, recipesRes, riDirectRes, outputsRes, inputsRes] = await Promise.all([
      // Compras reales del insumo
      admin
        .from('stock_receipts')
        .select('id, qty, unit, cost_per_unit, cost_total, received_date, suppliers(name)')
        .eq('stock_item_id', itemId)
        .not('cost_per_unit', 'is', null)
        .order('received_date', { ascending: false })
        .limit(60),
      // Catálogo de recetas (para resolver vínculos receta↔stock_item)
      admin.from('recipes').select('id, name, yield_portions, output_stock_item_id'),
      // Recetas que usan DIRECTAMENTE este insumo
      admin
        .from('recipe_ingredients')
        .select('recipe_id, qty_per_portion, ingredient_unit')
        .eq('stock_item_id', itemId),
      // Tandas producidas de este insumo
      admin
        .from('production_outputs')
        .select('id, production_order_id, qty_produced, theoretical_qty, unit, produced_at, is_waste')
        .eq('stock_item_id', itemId)
        .order('id', { ascending: false })
        .limit(40),
      // Este insumo usado como entrada de producción (para la cadena vía elaborado)
      admin
        .from('production_inputs')
        .select('production_order_id, qty_used, unit, cost_per_unit')
        .eq('stock_item_id', itemId)
        .order('id', { ascending: false })
        .limit(60),
    ])

    type RecipeRow = { id: string; name: string; yield_portions: number | null; output_stock_item_id: string | null }
    const allRecipes: RecipeRow[] = (recipesRes.data ?? []) as RecipeRow[]
    const recipeById = new Map(allRecipes.map(r => [r.id, r]))
    const recipeByName = new Map(allRecipes.map(r => [r.name.trim().toLowerCase(), r]))
    const recipeByOutput = new Map(
      allRecipes.filter(r => r.output_stock_item_id).map(r => [r.output_stock_item_id as string, r]),
    )

    // =====================================================================
    // ESLABÓN 1 — COMPRA (o insumos base si es elaborado)
    // =====================================================================
    type ReceiptRow = {
      id: number
      qty: number
      unit: string | null
      cost_per_unit: number
      cost_total: number | null
      received_date: string
      suppliers: { name: string | null } | null
    }
    const receipts = ((receiptsRes.data ?? []) as unknown as ReceiptRow[])
      .filter(r => Number(r.cost_per_unit) > 0)
    const precios = receipts.map(r => Number(r.cost_per_unit))

    // ¿Qué receta produce este insumo? Explícito primero, nombre como fallback.
    const recetaProductora = recipeByOutput.get(item.id) ?? recipeByName.get(item.name.trim().toLowerCase()) ?? null

    type OutputRow = {
      id: number
      production_order_id: number
      qty_produced: number
      theoretical_qty: number | null
      unit: string
      produced_at: string | null
      is_waste: boolean | null
    }
    const outputs = ((outputsRes.data ?? []) as OutputRow[]).filter(o => !o.is_waste)
    const esElaborado = item.is_produced || !!recetaProductora || outputs.length > 0

    const compra: CadenaCompra = {
      tipo: esElaborado ? 'elaborado' : 'comprado',
      costo_cargado: item.cost_per_unit,
      unit: item.unit,
      ultima_compra: null,
      precio_promedio: null,
      precio_min: null,
      precio_max: null,
      compras_count: receipts.length,
      proveedor: null,
      receta: recetaProductora
        ? { id: recetaProductora.id, name: recetaProductora.name, yield_portions: recetaProductora.yield_portions }
        : null,
      origen_insumos: null,
      insumos: [],
      costo_insumos: null,
    }

    if (receipts.length > 0) {
      const last = receipts[0]
      compra.ultima_compra = {
        fecha: last.received_date,
        qty: round(Number(last.qty), 3),
        unit: last.unit ?? item.unit,
        cost_per_unit: round(Number(last.cost_per_unit)),
        cost_total: last.cost_total != null ? Math.round(Number(last.cost_total)) : null,
        proveedor: last.suppliers?.name ?? null,
      }
      compra.proveedor = last.suppliers?.name ?? null
      compra.precio_promedio = round(precios.reduce((a, b) => a + b, 0) / precios.length)
      compra.precio_min = round(Math.min(...precios))
      compra.precio_max = round(Math.max(...precios))
    }

    // Órdenes de producción involucradas (para tandas y para insumos base)
    const orderIds = [...new Set(outputs.map(o => o.production_order_id))]
    type InputRow = {
      production_order_id: number
      qty_used: number
      unit: string
      cost_per_unit: number | null
      stock_item_id: string | null
    }
    let ordersById = new Map<number, { id: string | number; name: string; status: string; fecha: string }>()
    let inputsDeOrdenes: InputRow[] = []

    if (orderIds.length > 0) {
      const [ordersRes, prodInputsRes] = await Promise.all([
        admin
          .from('production_orders')
          .select('id, name, status, completed_at, reviewed_at, created_at')
          .in('id', orderIds),
        admin
          .from('production_inputs')
          .select('production_order_id, qty_used, unit, cost_per_unit, stock_item_id')
          .in('production_order_id', orderIds),
      ])
      ordersById = new Map(
        (ordersRes.data ?? []).map(o => [
          o.id,
          {
            id: o.id,
            name: o.name,
            status: o.status,
            fecha: o.reviewed_at ?? o.completed_at ?? o.created_at,
          },
        ]),
      )
      inputsDeOrdenes = (prodInputsRes.data ?? []) as InputRow[]
    }

    // Insumos base del elaborado: receta primero, producción real como fallback
    let insumosIds: string[] = []
    let insumosRows: { stock_item_id: string; qty: number; unit: string | null }[] = []
    let origenInsumos: 'receta' | 'produccion' | null = null

    if (esElaborado) {
      if (recetaProductora) {
        const { data: riProd } = await admin
          .from('recipe_ingredients')
          .select('stock_item_id, qty_per_portion, ingredient_unit')
          .eq('recipe_id', recetaProductora.id)
        if ((riProd ?? []).length > 0) {
          origenInsumos = 'receta'
          insumosRows = (riProd ?? []).map(r => ({
            stock_item_id: r.stock_item_id,
            qty: Number(r.qty_per_portion ?? 0),
            unit: r.ingredient_unit,
          }))
        }
      }
      if (origenInsumos === null && orderIds.length > 0) {
        // Última tanda con insumos cargados → desglose real de lo que entró
        const ultimaOrden = outputs[0]?.production_order_id
        const filas = inputsDeOrdenes.filter(i => i.production_order_id === ultimaOrden && i.stock_item_id)
        if (filas.length > 0) {
          origenInsumos = 'produccion'
          insumosRows = filas.map(f => ({
            stock_item_id: f.stock_item_id as string,
            qty: Number(f.qty_used ?? 0),
            unit: f.unit,
          }))
        }
      }
      insumosIds = [...new Set(insumosRows.map(r => r.stock_item_id))]
    }

    // =====================================================================
    // ESLABÓN 3 — VENTA: armar el mapa insumo → platos
    // =====================================================================

    // (a) Directo: recetas que usan este insumo
    type RiRow = { recipe_id: string; qty_per_portion: number | null; ingredient_unit: string | null }
    const riDirect = (riDirectRes.data ?? []) as RiRow[]
    // recipe_id → qty del insumo por porción, en unidad del insumo
    const qtyDirectByRecipe = new Map<string, number>()
    for (const ri of riDirect) {
      const c = canon(Number(ri.qty_per_portion ?? 0), ri.ingredient_unit)
      qtyDirectByRecipe.set(ri.recipe_id, toStockUnit(c.qty, c.unit, item.unit))
    }

    // (b) Nivel 2: intermedios que se fabrican CON este insumo
    //     b1) por receta: recetas que usan el insumo y tienen output_stock_item_id
    //     b2) por producción: production_inputs del insumo → outputs de esa orden
    type Intermedio = { stock_item_id: string; name: string; qtyPorUnidad: number }
    const intermedios = new Map<string, Intermedio>()

    for (const ri of riDirect) {
      const rec = recipeById.get(ri.recipe_id)
      const outId = rec?.output_stock_item_id
      if (!rec || !outId || outId === item.id) continue
      const porPorcion = qtyDirectByRecipe.get(ri.recipe_id) ?? 0
      if (porPorcion <= 0) continue
      intermedios.set(outId, { stock_item_id: outId, name: rec.name, qtyPorUnidad: porPorcion })
    }

    type ProdInputRow = { production_order_id: number; qty_used: number; unit: string }
    const misInputs = (inputsRes.data ?? []) as ProdInputRow[]
    if (misInputs.length > 0) {
      const inputOrderIds = [...new Set(misInputs.map(i => i.production_order_id))]
      const { data: outsDeMisOrdenes } = await admin
        .from('production_outputs')
        .select('production_order_id, stock_item_id, qty_produced, is_waste, output_name')
        .in('production_order_id', inputOrderIds)
      // Por orden: cuánto insumo entró vs cuántas unidades salieron
      for (const out of outsDeMisOrdenes ?? []) {
        if (out.is_waste || !out.stock_item_id || out.stock_item_id === item.id) continue
        if (intermedios.has(out.stock_item_id)) continue
        const usados = misInputs
          .filter(i => i.production_order_id === out.production_order_id)
          .reduce((acc, i) => {
            const c = canon(Number(i.qty_used ?? 0), i.unit)
            return acc + toStockUnit(c.qty, c.unit, item.unit)
          }, 0)
        const producidas = Number(out.qty_produced ?? 0)
        if (usados <= 0 || producidas <= 0) continue
        intermedios.set(out.stock_item_id, {
          stock_item_id: out.stock_item_id,
          name: out.output_name ?? 'Elaborado',
          qtyPorUnidad: usados / producidas,
        })
      }
    }

    // Recetas que usan alguno de esos intermedios
    type RiL2 = { recipe_id: string; stock_item_id: string; qty_per_portion: number | null; ingredient_unit: string | null }
    let riL2: RiL2[] = []
    const intermedioIds = [...intermedios.keys()]
    let intermedioItems = new Map<string, StockItemLite>()
    if (intermedioIds.length > 0) {
      const [riL2Res, intItemsRes] = await Promise.all([
        admin
          .from('recipe_ingredients')
          .select('recipe_id, stock_item_id, qty_per_portion, ingredient_unit')
          .in('stock_item_id', intermedioIds),
        admin.from('stock_items')
          .select(hasCostSource ? 'id, name, unit, cost_per_unit, cost_source' : 'id, name, unit, cost_per_unit')
          .in('id', intermedioIds),
      ])
      riL2 = (riL2Res.data ?? []) as RiL2[]
      intermedioItems = new Map(((intItemsRes.data ?? []) as unknown as StockItemLite[]).map(i => [i.id, i]))
    }

    // recipe_id → { qty insumo por porción, vía, nombre del intermedio }
    type RecipeLink = { qty: number | null; via: 'directo' | 'intermedio'; intermedio: string | null }
    const linkByRecipe = new Map<string, RecipeLink>()
    for (const [recipeId, qty] of qtyDirectByRecipe) {
      linkByRecipe.set(recipeId, { qty: qty > 0 ? qty : null, via: 'directo', intermedio: null })
    }
    for (const ri of riL2) {
      if (linkByRecipe.has(ri.recipe_id)) continue
      const inter = intermedios.get(ri.stock_item_id)
      if (!inter) continue
      const interItem = intermedioItems.get(ri.stock_item_id)
      const c = canon(Number(ri.qty_per_portion ?? 0), ri.ingredient_unit)
      const qtyInter = interItem ? toStockUnit(c.qty, c.unit, interItem.unit) : c.qty
      linkByRecipe.set(ri.recipe_id, {
        qty: qtyInter > 0 ? round(qtyInter * inter.qtyPorUnidad, 4) : null,
        via: 'intermedio',
        intermedio: interItem?.name ?? inter.name,
      })
    }

    // Intermedios sin costo REAL ni receta propia: los platos que pasan por
    // ahí tienen el costo por porción subestimado. Se avisa con nombre y apellido.
    const intermediosMudos = [...intermedios.keys()]
      .map(id => intermedioItems.get(id))
      .filter((i): i is StockItemLite => !!i && !costoUsable(i))
      .filter(i => !recipeByOutput.has(i.id) && !recipeByName.has(i.name.trim().toLowerCase()))

    const recipeIdsVenta = [...linkByRecipe.keys()]
    let platos: CadenaPlato[] = []
    let nivelMax: 1 | 2 = 1

    if (recipeIdsVenta.length > 0) {
      const { data: menuItems } = await admin
        .from('menu_items')
        .select('id, name, recipe_id, fudo_product_id, sale_price')
        .in('recipe_id', recipeIdsVenta)
        .eq('is_active', true)
        .not('fudo_product_id', 'is', null)

      const fudoIds = [...new Set((menuItems ?? []).map(m => m.fudo_product_id as string).filter(Boolean))]

      type SaleRow = { fudo_product_id: string | null; quantity: number; sold_at: string; price: number | null }
      let sales: SaleRow[] = []
      if (fudoIds.length > 0) {
        const { data } = await admin
          .from('fudo_sales')
          .select('fudo_product_id, quantity, sold_at, price:raw_payload->price')
          .in('fudo_product_id', fudoIds)
          .gte('sold_at', sinceLong)
          .limit(20000)
        sales = (data ?? []) as unknown as SaleRow[]
      }

      type Agg = { units28: number; units7: number; pricedUnits: number; pricedRevenue: number }
      const byProduct = new Map<string, Agg>()
      for (const s of sales) {
        if (!s.fudo_product_id) continue
        const qty = Number(s.quantity ?? 0)
        const price = s.price != null ? Number(s.price) : null
        const agg = byProduct.get(s.fudo_product_id) ?? { units28: 0, units7: 0, pricedUnits: 0, pricedRevenue: 0 }
        agg.units28 += qty
        if (s.sold_at >= sinceShort) agg.units7 += qty
        if (price != null && price > 0) {
          agg.pricedUnits += qty
          agg.pricedRevenue += qty * price
        }
        byProduct.set(s.fudo_product_id, agg)
      }

      const recipeCosts = await costRecipes(admin, [...new Set((menuItems ?? []).map(m => m.recipe_id as string))])
      // Si el insumo no tiene costo REAL propio, costRecipes lo cuenta como
      // missing y el margen de cada plato queda inflado. Lo decimos en vez de callarlo.
      const costoPropioAusente = !itemCostConfiable

      platos = (menuItems ?? []).map(mi => {
        const link = linkByRecipe.get(mi.recipe_id as string)
        const agg = byProduct.get(mi.fudo_product_id as string)
        const rc = mi.recipe_id ? recipeCosts.get(mi.recipe_id) : undefined
        const precio = agg && agg.pricedUnits > 0
          ? round(agg.pricedRevenue / agg.pricedUnits)
          : (mi.sale_price != null && Number(mi.sale_price) > 0 ? Number(mi.sale_price) : null)
        // Solo se muestra costo cuando TODAS las líneas son confiables
        const costo = rc && rc.confiable && rc.cost > 0 ? rc.cost : null
        const margen = precio != null && costo != null ? round(precio - costo) : null
        let motivo: string | null = null
        if (costo == null) {
          motivo = rc && rc.missingNames.length > 0
            ? `Sin costo real — faltan precios de: ${rc.missingNames.join(', ')}`
            : 'Receta sin costo real — falta precio en sus ingredientes'
        } else if (precio == null) motivo = 'Sin precio de venta registrado'
        return {
          menu_item_id: mi.id,
          name: mi.name,
          fudo_product_id: mi.fudo_product_id as string,
          via: link?.via ?? 'directo',
          intermedio: link?.intermedio ?? null,
          qty_por_porcion: link?.qty ?? null,
          unit: item.unit,
          units_7d: Math.round(agg?.units7 ?? 0),
          units_28d: Math.round(agg?.units28 ?? 0),
          precio_promedio: precio,
          costo_porcion: costo,
          margen_unit: margen,
          margen_pct: margen != null && precio ? round((margen / precio) * 100, 1) : null,
          facturacion_28d: Math.round((agg?.units28 ?? 0) * (precio ?? 0)),
          motivo,
          margen_inflado: costo != null
            && (costoPropioAusente || (link?.via === 'intermedio' && intermediosMudos.length > 0)),
        }
      })
        .sort((a, b) => b.units_28d - a.units_28d || b.facturacion_28d - a.facturacion_28d)

      if (platos.some(p => p.via === 'intermedio')) nivelMax = 2
    }

    // =====================================================================
    // ESLABÓN 2 — PRODUCCIÓN
    // =====================================================================
    let produccion: CadenaProduccion | null = null
    if (esElaborado) {
      // Catálogo de costos para insumos de producción + insumos base del eslabón 1
      const allInputIds = [
        ...new Set([
          ...insumosIds,
          ...inputsDeOrdenes.map(i => i.stock_item_id).filter((v): v is string => !!v),
        ]),
      ]
      let catalogo = new Map<string, StockItemLite>()
      if (allInputIds.length > 0) {
        const { data: catRows } = await admin
          .from('stock_items')
          .select(hasCostSource ? 'id, name, unit, cost_per_unit, cost_source' : 'id, name, unit, cost_per_unit')
          .in('id', allInputIds)
        catalogo = new Map(((catRows ?? []) as unknown as StockItemLite[]).map(i => [i.id, i]))
      }

      // Insumos base del eslabón 1 (ahora que tenemos el catálogo)
      if (insumosRows.length > 0) {
        let totalInsumos = 0
        let algunoSinCosto = false
        compra.insumos = insumosRows.map(r => {
          const base = catalogo.get(r.stock_item_id)
          const { costo, dudosa } = lineCost(r.qty, r.unit, base, costoUsable(base))
          if (costo == null) algunoSinCosto = true
          else totalInsumos += costo
          return {
            stock_item_id: r.stock_item_id,
            name: base?.name ?? 'Insumo',
            qty: round(r.qty, 3),
            unit: r.unit ?? base?.unit ?? '',
            cost_per_unit: base?.cost_per_unit != null ? Number(base.cost_per_unit) : null,
            costo,
            unidad_dudosa: dudosa,
          }
        }).sort((a, b) => (b.costo ?? 0) - (a.costo ?? 0))
        compra.origen_insumos = origenInsumos
        compra.costo_insumos = compra.insumos.length > 0 && !(algunoSinCosto && totalInsumos === 0)
          ? round(totalInsumos)
          : null
      }

      // Costo por orden (congelado si existe, si no el actual)
      const costoPorOrden = new Map<number, { total: number; parcial: boolean }>()
      for (const inp of inputsDeOrdenes) {
        const base = inp.stock_item_id ? catalogo.get(inp.stock_item_id) : undefined
        // Congelado por la tanda primero; el costo vigente solo si es REAL
        const frozen = inp.cost_per_unit != null ? Number(inp.cost_per_unit) : null
        const unitCost = frozen ?? (costoUsable(base) && base?.cost_per_unit != null ? Number(base.cost_per_unit) : null)
        const entry = costoPorOrden.get(inp.production_order_id) ?? { total: 0, parcial: false }
        if (unitCost == null || unitCost <= 0) {
          entry.parcial = true
        } else {
          const c = canon(Number(inp.qty_used ?? 0), inp.unit)
          const qtyItem = base ? toStockUnit(c.qty, c.unit, base.unit) : c.qty
          entry.total += qtyItem * unitCost
        }
        costoPorOrden.set(inp.production_order_id, entry)
      }

      // Agrupar outputs por orden (una tanda puede tener varias filas)
      const porOrden = new Map<number, { qty: number; teorica: number; unit: string; fecha: string | null }>()
      for (const o of outputs) {
        const e = porOrden.get(o.production_order_id) ?? { qty: 0, teorica: 0, unit: o.unit || item.unit, fecha: o.produced_at }
        e.qty += Number(o.qty_produced ?? 0)
        e.teorica += Number(o.theoretical_qty ?? 0)
        e.fecha = e.fecha ?? o.produced_at
        porOrden.set(o.production_order_id, e)
      }

      const tandas: CadenaTanda[] = [...porOrden.entries()].map(([oid, e]) => {
        const orden = ordersById.get(oid)
        const costo = costoPorOrden.get(oid)
        const total = costo && costo.total > 0 ? round(costo.total) : null
        return {
          order_id: oid,
          name: orden?.name ?? `Producción #${oid}`,
          fecha: e.fecha ?? orden?.fecha ?? new Date().toISOString(),
          status: orden?.status ?? 'desconocido',
          qty_producida: round(e.qty, 3),
          qty_teorica: e.teorica > 0 ? round(e.teorica, 3) : null,
          eficiencia_pct: e.teorica > 0 ? round((e.qty / e.teorica) * 100, 1) : null,
          unit: e.unit,
          costo_total: total,
          costo_por_unidad: total != null && e.qty > 0 ? round(total / e.qty) : null,
          costo_parcial: costo?.parcial ?? true,
        }
      }).sort((a, b) => (a.fecha < b.fecha ? 1 : -1))

      const { data: lotesRows } = await admin
        .from('stock_lots')
        .select('id, lot_code, qty_remaining, unit, produced_at, expires_at, status')
        .eq('stock_item_id', item.id)
        .gt('qty_remaining', 0)
        .order('produced_at', { ascending: true })
        .limit(20)

      const conCosto = tandas.filter(t => t.costo_por_unidad != null)
      const conEficiencia = tandas.filter(t => t.eficiencia_pct != null)

      produccion = {
        tandas,
        total_producido: round(tandas.reduce((a, t) => a + t.qty_producida, 0), 3),
        unit: tandas[0]?.unit ?? item.unit,
        ultimo_costo_por_unidad: conCosto[0]?.costo_por_unidad ?? null,
        costo_por_unidad_promedio: conCosto.length
          ? round(conCosto.reduce((a, t) => a + (t.costo_por_unidad ?? 0), 0) / conCosto.length)
          : null,
        eficiencia_promedio_pct: conEficiencia.length
          ? round(conEficiencia.reduce((a, t) => a + (t.eficiencia_pct ?? 0), 0) / conEficiencia.length, 1)
          : null,
        stock_actual: item.current_qty,
        lotes: (lotesRows ?? []).map(l => ({
          id: l.id,
          lot_code: l.lot_code,
          qty_remaining: round(Number(l.qty_remaining), 3),
          unit: l.unit ?? item.unit,
          produced_at: l.produced_at,
          expires_at: l.expires_at,
          status: l.status,
        })),
      }
    }

    // =====================================================================
    // RESUMEN del hilo
    // =====================================================================
    const notas: string[] = []
    let insumoConsumido: number | null = null
    let costoPlatos: number | null = null
    let facturacion = 0
    let platosCosteados = 0

    // Costo unitario de referencia del insumo, en orden de confianza.
    // El costo cargado en la ficha solo cuenta si su fuente es REAL.
    const costoUnitarioRef = compra.ultima_compra?.cost_per_unit
      ?? produccion?.ultimo_costo_por_unidad
      ?? (itemCostConfiable ? item.cost_per_unit : null)
      ?? null

    for (const p of platos) {
      facturacion += p.facturacion_28d
      if (p.qty_por_porcion != null && p.units_28d > 0) {
        insumoConsumido = (insumoConsumido ?? 0) + p.qty_por_porcion * p.units_28d
      }
      if (p.costo_porcion != null && p.units_28d > 0) {
        costoPlatos = (costoPlatos ?? 0) + p.costo_porcion * p.units_28d
        platosCosteados += 1
      }
    }

    const insumoConsumidoCosto = insumoConsumido != null && costoUnitarioRef != null
      ? Math.round(insumoConsumido * costoUnitarioRef)
      : null
    const margen = costoPlatos != null ? Math.round(facturacion - costoPlatos) : null

    if (platos.length === 0) notas.push('Ningún plato activo con producto Fudo consume este insumo.')
    if (platos.length > 0 && platosCosteados < platos.length) {
      notas.push(`${platos.length - platosCosteados} de ${platos.length} platos sin costo real de receta — el margen mostrado es parcial.`)
    }
    if (insumoConsumido != null && costoUnitarioRef == null) {
      notas.push('Sin precio real de referencia del insumo — no se valoriza lo consumido (el costo de Fudo no cuenta).')
    }
    if (compra.tipo === 'comprado' && receipts.length === 0) {
      notas.push(itemCostConfiable
        ? 'Sin compras registradas con precio: se usa el costo real cargado en la ficha.'
        : 'Sin compras registradas con precio ni costo real en la ficha: nada se valoriza.')
    }
    if (compra.tipo === 'elaborado' && !recetaProductora) {
      notas.push('No hay receta que produzca este elaborado — el desglose sale de la última producción real.')
    }

    if (intermediosMudos.length > 0 && platos.some(p => p.via === 'intermedio')) {
      notas.push(`El elaborado ${intermediosMudos.map(i => `«${i.name}»`).join(', ')} no tiene costo ni receta cargada: el costo por porción de los platos que lo usan queda subestimado.`)
    }

    const costoPropioAusenteFlag = !itemCostConfiable
    if (costoPropioAusenteFlag && platos.some(p => p.margen_inflado)) {
      const sugerencia = produccion?.ultimo_costo_por_unidad != null
        ? ` La última producción salió $${Math.round(produccion.ultimo_costo_por_unidad).toLocaleString('es-AR')} por ${item.unit}.`
        : ''
      notas.push(`«${item.name}» no tiene costo cargado en su ficha: los costos por porción no lo incluyen y el margen se ve más alto de lo real.${sugerencia}`)
    }

    const flags: CadenaFlags = {
      sin_receta: compra.tipo === 'elaborado' ? !recetaProductora : riDirect.length === 0,
      sin_precio_compra: compra.tipo === 'comprado' && receipts.length === 0,
      sin_produccion: compra.tipo === 'elaborado' && (produccion?.tandas.length ?? 0) === 0,
      sin_ventas: platos.every(p => p.units_28d === 0),
      costo_propio_ausente: costoPropioAusenteFlag,
    }

    const payload: CadenaPayload = {
      item,
      flags,
      compra,
      produccion,
      venta: { platos, nivel_max: nivelMax },
      resumen: {
        ventana_dias: WINDOW_LONG,
        insumo_consumido: insumoConsumido != null ? round(insumoConsumido, 3) : null,
        insumo_consumido_costo: insumoConsumidoCosto,
        costo_platos: costoPlatos != null ? Math.round(costoPlatos) : null,
        facturacion: Math.round(facturacion),
        margen,
        margen_pct: margen != null && facturacion > 0 ? round((margen / facturacion) * 100, 1) : null,
        peso_insumo_pct: insumoConsumidoCosto != null && facturacion > 0
          ? round((insumoConsumidoCosto / facturacion) * 100, 1)
          : null,
        platos_costeados: platosCosteados,
        platos_totales: platos.length,
        notas,
      },
      generated_at: new Date().toISOString(),
    }

    return payload
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!isKitchenRole(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const itemId = request.nextUrl.searchParams.get('item')
    if (!itemId) return NextResponse.json({ error: 'Falta el parámetro item' }, { status: 400 })

    const cached = cache.get(itemId)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload)
    }

    const payload = await buildCadena(createAdminClient(), itemId)
    if (!payload) return NextResponse.json({ error: 'Insumo no encontrado' }, { status: 404 })

    cache.set(itemId, { at: Date.now(), payload })
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[GET /api/stock/cadena]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
