import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { readFudoStock } from '@/lib/fudo/stock-sync'
import * as XLSX from 'xlsx'

export const maxDuration = 300

// ---------------------------------------------------------------------------
// POST /api/fudo/import-recetas — Importar recetas desde el export XLS de Fudo
// ---------------------------------------------------------------------------
// La API de Fudo NO expone recetas ni fichas técnicas. La única fuente de
// verdad es el export `productos.xls` que genera el panel de Fudo
// (Productos → Exportar). Este endpoint lo parsea y sincroniza:
//
//   Hoja "Productos"      → ID, Nombre, Categoría, ...   (mapa nombre → ID)
//   Hoja "Recetas"        → Producto, Ingrediente, Cantidad, Unidad
//   Hoja "Subproductos"   → Producto, Subproducto, Cantidad, Unidad
//
// Mapeo (SIEMPRE por ID, nunca sólo por nombre):
//   Productos.ID          → menu_items.fudo_product_id
//   Productos.ID          → stock_items.fudo_product_id   (para subproductos)
//   Recetas.Ingrediente   → catálogo /ingredients de Fudo → fudo_ingredient_id
//                           → stock_items.fudo_ingredient_id
//
// Parámetros: ?dry=1 (o campo dryRun=true) → no escribe, devuelve el plan.
// ---------------------------------------------------------------------------

type ProductoRow = {
  ID?: unknown
  Nombre?: unknown
  Categoría?: unknown
  Activo?: unknown
}

type RecetaRow = {
  Producto?: unknown
  Ingrediente?: unknown
  Cantidad?: unknown
  Unidad?: unknown
}

type SubproductoRow = {
  Producto?: unknown
  Subproducto?: unknown
  Cantidad?: unknown
  Unidad?: unknown
}

type PlanIngredient = {
  stockItemId: string
  qty: number
  unit: string
  sourceName: string
  kind: 'ingrediente' | 'subproducto'
}

type PlanRecipe = {
  fudoProductId: string
  productName: string
  category: string
  menuItemId: string | null
  recipeId: string | null
  action: 'crear' | 'actualizar'
  ingredients: PlanIngredient[]
  outputStockItemId: string | null
}

type UnmappedEntry = { name: string; uses: number; detail?: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function norm(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function asText(value: unknown): string {
  return String(value ?? '').trim()
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Unidades del export de Fudo: 'kg', 'L', 'unid.' → unidades de la app. */
function normalizeUnit(raw: unknown): string {
  const u = norm(raw).replace(/\.$/, '')
  if (u === 'kg' || u === 'kilo' || u === 'kilos' || u === 'kilogramo') return 'kg'
  if (u === 'l' || u === 'lt' || u === 'lts' || u === 'litro' || u === 'litros') return 'l'
  if (u === 'g' || u === 'gr' || u === 'gramo' || u === 'gramos') return 'g'
  return 'unidad'
}

/** Categoría de Fudo → categoría de `recipes` (sólo al crear recetas nuevas). */
function mapCategory(fudoCategory: string): string {
  const c = norm(fudoCategory)
  if (c.includes('pizza')) return 'pizzas'
  if (c.includes('postre') || c.includes('dulce')) return 'postres'
  if (c.includes('sandw') || c.includes('sangu') || c.includes('burger') || c.includes('hamburg') || c.includes('pan')) return 'entre_panes'
  if (c.includes('ensalada')) return 'ensaladas'
  if (c.includes('entrada') || c.includes('picada')) return 'entradas'
  if (c.includes('desayuno') || c.includes('merienda') || c.includes('cafeteria')) return 'desayunos_meriendas'
  if (c.includes('toston')) return 'tostones'
  if (c.includes('plato') || c.includes('principal') || c.includes('pasta') || c.includes('carne')) return 'platos'
  if (c.includes('bebida') || c.includes('trago') || c.includes('cerveza') || c.includes('vino')) return 'bebidas'
  return 'especialidades'
}

function bump(map: Map<string, UnmappedEntry>, name: string, detail?: string) {
  const key = norm(name)
  const existing = map.get(key)
  if (existing) existing.uses += 1
  else map.set(key, { name, uses: 1, detail })
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // --- Auth: sólo socio ---
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, first_name, last_name')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'socio') {
    return NextResponse.json({ success: false, error: 'Sólo un socio puede importar recetas' }, { status: 403 })
  }

  const userName = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Socio'

  // --- Archivo ---
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ success: false, error: 'Se esperaba multipart/form-data con el archivo' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ success: false, error: 'Falta el archivo (campo "file")' }, { status: 400 })
  }

  const dryRun =
    request.nextUrl.searchParams.get('dry') === '1' ||
    formData.get('dryRun') === 'true' ||
    formData.get('dryRun') === '1'

  // --- Parseo del XLS ---
  let productos: ProductoRow[] = []
  let recetas: RecetaRow[] = []
  let subproductos: SubproductoRow[] = []

  try {
    const buffer = Buffer.from(await (file as File).arrayBuffer())
    const wb = XLSX.read(buffer, { type: 'buffer' })

    const sheetName = (wanted: string) =>
      wb.SheetNames.find(n => norm(n) === norm(wanted)) ?? null

    const productosSheet = sheetName('Productos')
    const recetasSheet = sheetName('Recetas')
    const subSheet = sheetName('Subproductos')

    if (!productosSheet || !recetasSheet) {
      return NextResponse.json({
        success: false,
        error: `El archivo no tiene las hojas esperadas. Encontradas: ${wb.SheetNames.join(', ')}`,
      }, { status: 400 })
    }

    productos = XLSX.utils.sheet_to_json<ProductoRow>(wb.Sheets[productosSheet], { defval: null })
    recetas = XLSX.utils.sheet_to_json<RecetaRow>(wb.Sheets[recetasSheet], { defval: null })
    subproductos = subSheet
      ? XLSX.utils.sheet_to_json<SubproductoRow>(wb.Sheets[subSheet], { defval: null })
      : []
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: `No se pudo leer el archivo: ${err instanceof Error ? err.message : 'formato inválido'}`,
    }, { status: 400 })
  }

  if (productos.length === 0 || recetas.length === 0) {
    return NextResponse.json({
      success: false,
      error: 'El export no trae productos o recetas. Verificá que sea el archivo productos.xls de Fudo.',
    }, { status: 400 })
  }

  // --- Índice de productos del export: nombre normalizado → { id, nombre, categoría } ---
  const productByName = new Map<string, { fudoId: string; name: string; category: string; active: boolean }>()
  for (const row of productos) {
    const id = asText(row.ID)
    const name = asText(row.Nombre)
    if (!id || !name) continue
    productByName.set(norm(name), {
      fudoId: id,
      name,
      category: asText(row['Categoría']),
      active: norm(row.Activo) !== 'no',
    })
  }

  const admin = createAdminClient()

  // --- Estado actual de la app ---
  const [menuRes, stockRes, recipesRes] = await Promise.all([
    admin.from('menu_items').select('id, name, fudo_product_id, recipe_id'),
    admin.from('stock_items').select('id, name, unit, fudo_ingredient_id, fudo_product_id'),
    admin.from('recipes').select('id, name, category, output_stock_item_id'),
  ])

  if (menuRes.error || stockRes.error || recipesRes.error) {
    return NextResponse.json({
      success: false,
      error: `Error leyendo la base: ${menuRes.error?.message ?? stockRes.error?.message ?? recipesRes.error?.message}`,
    }, { status: 500 })
  }

  const menuByFudoId = new Map<string, { id: string; name: string; recipeId: string | null }>()
  for (const mi of menuRes.data ?? []) {
    if (!mi.fudo_product_id) continue
    if (!menuByFudoId.has(mi.fudo_product_id)) {
      menuByFudoId.set(mi.fudo_product_id, { id: mi.id, name: mi.name, recipeId: mi.recipe_id })
    }
  }

  const stockByFudoIngredientId = new Map<string, { id: string; name: string }>()
  const stockByFudoProductId = new Map<string, { id: string; name: string }>()
  for (const si of stockRes.data ?? []) {
    if (si.fudo_ingredient_id && !stockByFudoIngredientId.has(si.fudo_ingredient_id)) {
      stockByFudoIngredientId.set(si.fudo_ingredient_id, { id: si.id, name: si.name })
    }
    if (si.fudo_product_id && !stockByFudoProductId.has(si.fudo_product_id)) {
      stockByFudoProductId.set(si.fudo_product_id, { id: si.id, name: si.name })
    }
  }

  const recipeByName = new Map<string, { id: string; category: string; outputStockItemId: string | null }>()
  for (const r of recipesRes.data ?? []) {
    const key = norm(r.name)
    if (!recipeByName.has(key)) {
      recipeByName.set(key, { id: r.id, category: r.category, outputStockItemId: r.output_stock_item_id })
    }
  }

  // --- Catálogo de ingredientes de Fudo (nombre → fudo_ingredient_id) ---
  let fudoIngredientIdByName = new Map<string, string>()
  let fudoCatalogError: string | null = null
  try {
    const fudoIngredients = await readFudoStock()
    for (const ing of fudoIngredients) {
      const key = norm(ing.name)
      if (key && !fudoIngredientIdByName.has(key)) fudoIngredientIdByName.set(key, ing.id)
    }
  } catch (err) {
    fudoCatalogError = err instanceof Error ? err.message : 'error desconocido'
    fudoIngredientIdByName = new Map()
  }

  if (fudoIngredientIdByName.size === 0) {
    return NextResponse.json({
      success: false,
      error: `No se pudo leer el catálogo de ingredientes de Fudo (necesario para mapear por ID): ${fudoCatalogError ?? 'catálogo vacío'}`,
    }, { status: 502 })
  }

  // --- Agrupar filas del export por producto ---
  const recetasByProduct = new Map<string, RecetaRow[]>()
  for (const row of recetas) {
    const key = norm(row.Producto)
    if (!key) continue
    const list = recetasByProduct.get(key)
    if (list) list.push(row)
    else recetasByProduct.set(key, [row])
  }

  const subsByProduct = new Map<string, SubproductoRow[]>()
  for (const row of subproductos) {
    const key = norm(row.Producto)
    if (!key) continue
    const list = subsByProduct.get(key)
    if (list) list.push(row)
    else subsByProduct.set(key, [row])
  }

  // --- Construir el plan ---
  const productKeys = new Set<string>([...recetasByProduct.keys(), ...subsByProduct.keys()])

  const plan: PlanRecipe[] = []
  const productosSinEnExport = new Map<string, UnmappedEntry>()
  const productosSinMenuItem = new Map<string, UnmappedEntry>()
  const ingredientesSinFudo = new Map<string, UnmappedEntry>()
  const ingredientesSinStockItem = new Map<string, UnmappedEntry>()
  const subproductosSinStockItem = new Map<string, UnmappedEntry>()
  const productosSinIngredientes = new Map<string, UnmappedEntry>()

  let ingredientRowsSeen = 0

  for (const key of productKeys) {
    const producto = productByName.get(key)
    const rawName = asText(
      recetasByProduct.get(key)?.[0]?.Producto ?? subsByProduct.get(key)?.[0]?.Producto,
    )

    if (!producto) {
      bump(productosSinEnExport, rawName || key, 'no figura en la hoja Productos')
      continue
    }

    const ingredients = new Map<string, PlanIngredient>()

    // Ingredientes directos
    for (const row of recetasByProduct.get(key) ?? []) {
      ingredientRowsSeen++
      const ingName = asText(row.Ingrediente)
      const qty = asNumber(row.Cantidad)
      if (!ingName || qty === null) continue

      const fudoIngId = fudoIngredientIdByName.get(norm(ingName))
      if (!fudoIngId) {
        bump(ingredientesSinFudo, ingName, 'no existe en el catálogo de ingredientes de Fudo')
        continue
      }

      const stockItem = stockByFudoIngredientId.get(fudoIngId)
      if (!stockItem) {
        bump(ingredientesSinStockItem, ingName, `fudo_ingredient_id ${fudoIngId} sin insumo vinculado`)
        continue
      }

      const existing = ingredients.get(stockItem.id)
      if (existing) existing.qty += qty
      else ingredients.set(stockItem.id, {
        stockItemId: stockItem.id,
        qty,
        unit: normalizeUnit(row.Unidad),
        sourceName: ingName,
        kind: 'ingrediente',
      })
    }

    // Subproductos (otros productos de Fudo usados como insumo)
    for (const row of subsByProduct.get(key) ?? []) {
      ingredientRowsSeen++
      const subName = asText(row.Subproducto)
      const qty = asNumber(row.Cantidad)
      if (!subName || qty === null) continue

      const subProducto = productByName.get(norm(subName))
      if (!subProducto) {
        bump(productosSinEnExport, subName, 'subproducto sin fila en la hoja Productos')
        continue
      }

      const stockItem = stockByFudoProductId.get(subProducto.fudoId)
      if (!stockItem) {
        bump(subproductosSinStockItem, subName, `fudo_product_id ${subProducto.fudoId} sin insumo vinculado`)
        continue
      }

      const existing = ingredients.get(stockItem.id)
      if (existing) existing.qty += qty
      else ingredients.set(stockItem.id, {
        stockItemId: stockItem.id,
        qty,
        unit: normalizeUnit(row.Unidad),
        sourceName: subName,
        kind: 'subproducto',
      })
    }

    if (ingredients.size === 0) {
      const rows = (recetasByProduct.get(key)?.length ?? 0) + (subsByProduct.get(key)?.length ?? 0)
      productosSinIngredientes.set(key, {
        name: producto.name,
        uses: rows,
        detail: 'ninguna de sus líneas pudo mapearse a un insumo',
      })
      continue
    }

    const menuItem = menuByFudoId.get(producto.fudoId) ?? null
    if (!menuItem) bump(productosSinMenuItem, producto.name, `fudo_product_id ${producto.fudoId}`)

    const existingRecipe = recipeByName.get(norm(producto.name)) ?? null
    const recipeId = menuItem?.recipeId ?? existingRecipe?.id ?? null

    plan.push({
      fudoProductId: producto.fudoId,
      productName: producto.name,
      category: existingRecipe?.category ?? mapCategory(producto.category),
      menuItemId: menuItem?.id ?? null,
      recipeId,
      action: recipeId ? 'actualizar' : 'crear',
      ingredients: [...ingredients.values()],
      // Si este producto es a su vez un insumo producido (tiene stock_item propio
      // por fudo_product_id), su receta produce ese insumo → costeo nivel-2.
      outputStockItemId: stockByFudoProductId.get(producto.fudoId)?.id ?? null,
    })
  }

  plan.sort((a, b) => a.productName.localeCompare(b.productName, 'es'))

  const toCreate = plan.filter(p => p.action === 'crear')
  const toUpdate = plan.filter(p => p.action === 'actualizar')
  const totalIngredients = plan.reduce((acc, p) => acc + p.ingredients.length, 0)
  const totalSubproductLinks = plan.reduce(
    (acc, p) => acc + p.ingredients.filter(i => i.kind === 'subproducto').length, 0,
  )
  const outputsToLink = plan.filter(p => p.outputStockItemId).length
  const menuLinksToSet = plan.filter(p => p.menuItemId).length

  const summary = {
    dryRun,
    archivo: {
      productos: productos.length,
      filasRecetas: recetas.length,
      filasSubproductos: subproductos.length,
      productosConReceta: productKeys.size,
    },
    recetas: {
      creadas: toCreate.length,
      actualizadas: toUpdate.length,
      total: plan.length,
    },
    ingredientes: {
      vinculados: totalIngredients,
      desdeSubproductos: totalSubproductLinks,
      filasProcesadas: ingredientRowsSeen,
    },
    vinculos: {
      menuItems: menuLinksToSet,
      insumosProducidos: outputsToLink,
    },
    noMapeados: {
      productosSinMenuItem: [...productosSinMenuItem.values()].sort((a, b) => b.uses - a.uses),
      ingredientesSinStockItem: [...ingredientesSinStockItem.values()].sort((a, b) => b.uses - a.uses),
      ingredientesSinFudo: [...ingredientesSinFudo.values()].sort((a, b) => b.uses - a.uses),
      subproductosSinStockItem: [...subproductosSinStockItem.values()].sort((a, b) => b.uses - a.uses),
      productosDesconocidos: [...productosSinEnExport.values()].sort((a, b) => b.uses - a.uses),
      productosSinIngredientes: [...productosSinIngredientes.values()].sort((a, b) => b.uses - a.uses),
    },
    muestra: plan.slice(0, 15).map(p => ({
      producto: p.productName,
      accion: p.action,
      ingredientes: p.ingredients.length,
    })),
  }

  if (dryRun) {
    return NextResponse.json({ success: true, ...summary })
  }

  // -------------------------------------------------------------------------
  // Escritura
  // -------------------------------------------------------------------------
  const errors: string[] = []

  // 1. Crear recetas nuevas (en lote)
  if (toCreate.length > 0) {
    for (const batch of chunk(toCreate, 100)) {
      const { data, error } = await admin
        .from('recipes')
        .insert(batch.map(p => ({
          name: p.productName,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          category: p.category as any,
          is_active: true,
          yield_portions: 1,
          notes: 'Importada desde el export de Fudo',
          created_by: user.id,
        })))
        .select('id, name')

      if (error || !data) {
        errors.push(`Creando recetas: ${error?.message ?? 'sin respuesta'}`)
        continue
      }

      const idByName = new Map(data.map(r => [norm(r.name), r.id]))
      for (const p of batch) {
        p.recipeId = idByName.get(norm(p.productName)) ?? null
      }
    }
  }

  // 2. Reactivar / marcar actualizadas las existentes
  const updatedIds = toUpdate.map(p => p.recipeId).filter((id): id is string => Boolean(id))
  for (const batch of chunk(updatedIds, 200)) {
    const { error } = await admin
      .from('recipes')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .in('id', batch)
    if (error) errors.push(`Actualizando recetas: ${error.message}`)
  }

  const written = plan.filter(p => p.recipeId)
  const writtenIds = written.map(p => p.recipeId as string)

  // 2b. Marcar las recetas escritas como espejo de Fudo (fudo_synced_at).
  //     Tolerante: si la columna todavía no existe en la base, el import
  //     no debe fallar por eso.
  const syncedAtIso = new Date().toISOString()
  try {
    for (const batch of chunk(writtenIds, 200)) {
      const { error } = await admin
        .from('recipes')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ fudo_synced_at: syncedAtIso } as any)
        .in('id', batch)
      if (error) throw new Error(error.message)
    }
  } catch (err) {
    console.warn(
      '[import-recetas] No se pudo marcar fudo_synced_at (¿columna sin migrar?):',
      err instanceof Error ? err.message : err,
    )
  }

  // 3. Reemplazar ingredientes: borrar los viejos e insertar los del export
  for (const batch of chunk(writtenIds, 200)) {
    const { error } = await admin.from('recipe_ingredients').delete().in('recipe_id', batch)
    if (error) errors.push(`Limpiando ingredientes: ${error.message}`)
  }

  const ingredientRows = written.flatMap(p =>
    p.ingredients.map(i => ({
      recipe_id: p.recipeId as string,
      stock_item_id: i.stockItemId,
      qty_per_portion: i.qty,
      ingredient_unit: i.unit,
      notes: i.kind === 'subproducto' ? `Subproducto Fudo: ${i.sourceName}` : null,
    })),
  )

  let insertedIngredients = 0
  for (const batch of chunk(ingredientRows, 500)) {
    const { error } = await admin.from('recipe_ingredients').insert(batch)
    if (error) errors.push(`Insertando ingredientes: ${error.message}`)
    else insertedIngredients += batch.length
  }

  // 4. Vincular menu_items.recipe_id (sólo los que cambian)
  let menuLinked = 0
  for (const p of written) {
    if (!p.menuItemId) continue
    const current = menuByFudoId.get(p.fudoProductId)
    if (current?.recipeId === p.recipeId) continue
    const { error } = await admin
      .from('menu_items')
      .update({ recipe_id: p.recipeId })
      .eq('id', p.menuItemId)
    if (error) errors.push(`Vinculando ${p.productName}: ${error.message}`)
    else menuLinked++
  }

  // 5. Vincular recipes.output_stock_item_id para los productos que son insumo
  let outputsLinked = 0
  for (const p of written) {
    if (!p.outputStockItemId) continue
    const existing = recipeByName.get(norm(p.productName))
    if (existing?.outputStockItemId === p.outputStockItemId) continue
    const { error } = await admin
      .from('recipes')
      .update({ output_stock_item_id: p.outputStockItemId })
      .eq('id', p.recipeId as string)
    if (error) errors.push(`Vinculando insumo producido ${p.productName}: ${error.message}`)
    else outputsLinked++
  }

  // 6. Registrar el último import en app_settings (para el parte semanal)
  try {
    await admin.from('app_settings').upsert({
      key: 'fudo_recetas_import',
      value: {
        last_import_at: syncedAtIso,
        recetas: written.length,
        filas: recetas.length + subproductos.length,
      },
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
  } catch (err) {
    console.warn(
      '[import-recetas] No se pudo guardar app_settings.fudo_recetas_import:',
      err instanceof Error ? err.message : err,
    )
  }

  // --- Auditoría ---
  await logAudit(admin, {
    userId: user.id,
    userName,
    action: 'fudo_import_recetas',
    module: 'stock',
    entityType: 'recipes',
    description: `${userName} importó recetas desde el export de Fudo: ${toCreate.length} creadas, ${toUpdate.length} actualizadas, ${insertedIngredients} ingredientes vinculados`,
    metadata: {
      recetas_creadas: toCreate.length,
      recetas_actualizadas: toUpdate.length,
      ingredientes_insertados: insertedIngredients,
      menu_items_vinculados: menuLinked,
      insumos_producidos_vinculados: outputsLinked,
      productos_sin_menu_item: summary.noMapeados.productosSinMenuItem.length,
      ingredientes_sin_stock_item: summary.noMapeados.ingredientesSinStockItem.length,
      ingredientes_sin_fudo: summary.noMapeados.ingredientesSinFudo.length,
      subproductos_sin_stock_item: summary.noMapeados.subproductosSinStockItem.length,
      productos_sin_ingredientes: summary.noMapeados.productosSinIngredientes.length,
      errores: errors.slice(0, 20),
    },
  })

  return NextResponse.json({
    success: errors.length === 0,
    ...summary,
    aplicado: {
      recetasEscritas: written.length,
      ingredientesInsertados: insertedIngredients,
      menuItemsVinculados: menuLinked,
      insumosProducidosVinculados: outputsLinked,
    },
    errores: errors.slice(0, 20),
  })
}
