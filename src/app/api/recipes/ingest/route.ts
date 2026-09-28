import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { RECIPE_CORPUS, IMPLICIT_SUB_RECIPES, normalizeIngredient, getCorpusStats } from '@/lib/recipes/corpus'
import { matchIngredientToStock } from '@/lib/recipes/stock-match'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StockItemForMatch = { id: string; name: string; category: string; unit: string }

type IngestResult = {
  recipe_slug: string
  recipe_name: string
  recipe_id: string | null
  action: 'created' | 'found' | 'error'
  ingredients_inserted: number
  ingredients_pending: number
  ingredients_skipped: number
  details: IngredientDetail[]
}

type IngredientDetail = {
  name: string
  confidence: string
  score: number
  stock_item_name: string | null
  qty_per_portion: number | null
  unit: string | null
  action: 'inserted' | 'pending' | 'skipped' | 'no_qty'
  reason: string
  converted: boolean
}

// ---------------------------------------------------------------------------
// Unit conversion
// Normalizes corpus ingredient quantity to match stock_items.unit
// Returns null if conversion is not possible (manual review needed)
// ---------------------------------------------------------------------------

function convertQtyToStockUnit(
  corpusQty: number | null,
  corpusUnit: string | null,
  stockUnit: string,
): { qty: number; unit: string; converted: boolean } | null {
  if (corpusQty === null || corpusUnit === null) return null

  const cu = corpusUnit.toLowerCase().trim()
  const su = stockUnit.toLowerCase().trim()

  // Same unit — no conversion
  if (cu === su) return { qty: corpusQty, unit: su, converted: false }

  // gr / g → kg
  if ((cu === 'gr' || cu === 'g') && (su === 'kg' || su === 'kilo' || su === 'kilogramo' || su === 'kilogramos')) {
    return { qty: corpusQty / 1000, unit: su, converted: true }
  }
  // kg → gr (edge case)
  if (cu === 'kg' && (su === 'gr' || su === 'g')) {
    return { qty: corpusQty * 1000, unit: su, converted: true }
  }
  // ml → lt / litro / l
  if (cu === 'ml' && (su === 'lt' || su === 'l' || su === 'litro' || su === 'litros')) {
    return { qty: corpusQty / 1000, unit: su, converted: true }
  }
  // lt / litro → ml
  if ((cu === 'lt' || cu === 'l' || cu === 'litro' || cu === 'litros') && su === 'ml') {
    return { qty: corpusQty * 1000, unit: su, converted: true }
  }
  // gr → gr (same family, different spelling)
  if ((cu === 'gr' || cu === 'g') && (su === 'gr' || su === 'g')) {
    return { qty: corpusQty, unit: su, converted: false }
  }
  // lt → lt
  if ((cu === 'lt' || cu === 'l' || cu === 'litro') && (su === 'lt' || su === 'l' || su === 'litro')) {
    return { qty: corpusQty, unit: su, converted: false }
  }
  // unidad / unidades — store as-is, ignore stock unit
  if (cu === 'unidad' || cu === 'unidades' || cu === 'u') {
    return { qty: corpusQty, unit: 'unidad', converted: false }
  }
  // feta, fetas → unidad (close enough for counting)
  if (cu === 'feta' || cu === 'fetas') {
    return { qty: corpusQty, unit: 'unidad', converted: false }
  }

  // Cannot convert: different unit families (e.g. cucharada vs kg)
  return null
}

// ---------------------------------------------------------------------------
// GET /api/recipes/ingest — corpus analysis (existing, unchanged)
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const admin = createAdminClient()

    const { data: stockItems } = await admin
      .from('stock_items')
      .select('id, name, category, unit')
      .eq('is_active', true)

    const { data: menuItems } = await admin
      .from('menu_items')
      .select('id, name, fudo_product_id, recipe_id')

    const items: StockItemForMatch[] = (stockItems ?? []).map(s => ({
      id: String(s.id),
      name: s.name,
      category: s.category ?? '',
      unit: s.unit ?? '',
    }))
    const stats = getCorpusStats()

    const allMatches = RECIPE_CORPUS.flatMap(recipe => {
      const allIngredients = [
        ...recipe.ingredientes,
        ...recipe.variantes.flatMap(v => v.ingredientes_extra ?? []),
      ]
      return allIngredients.map(ing => {
        const normalized = normalizeIngredient(ing, recipe.slug)
        const match = matchIngredientToStock(ing.producto, normalized.normalized_name, recipe.slug, items)
        return { ...normalized, stock_match: match }
      })
    })

    const uniqueIngredients = new Map<string, typeof allMatches[0]>()
    allMatches.forEach(m => {
      const key = m.normalized_name
      if (!uniqueIngredients.has(key) || (m.stock_match.confidence_score > (uniqueIngredients.get(key)!.stock_match.confidence_score))) {
        uniqueIngredients.set(key, m)
      }
    })

    const fudoBridge = RECIPE_CORPUS.map(recipe => {
      const match = (menuItems ?? []).find(mi => {
        const rNorm = recipe.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const mNorm = mi.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        return rNorm === mNorm || mNorm.includes(rNorm) || rNorm.includes(mNorm)
      })
      return {
        recipe_slug: recipe.slug,
        recipe_name: recipe.nombre,
        fudo_match: match ? { id: match.id, name: match.name, fudo_product_id: match.fudo_product_id, already_linked: !!match.recipe_id } : null,
      }
    })

    const matchStats = {
      total: uniqueIngredients.size,
      exacto: [...uniqueIngredients.values()].filter(m => m.stock_match.confidence === 'exacto').length,
      probable: [...uniqueIngredients.values()].filter(m => m.stock_match.confidence === 'probable').length,
      ambiguo: [...uniqueIngredients.values()].filter(m => m.stock_match.confidence === 'ambiguo').length,
      sin_match: [...uniqueIngredients.values()].filter(m => m.stock_match.confidence === 'sin_match').length,
    }

    return NextResponse.json({
      stats,
      recipes: RECIPE_CORPUS.map(r => ({
        slug: r.slug,
        nombre: r.nombre,
        categoria: r.categoria,
        estado: r.estado,
        ingredientes_count: r.ingredientes.length,
        variantes_count: r.variantes.length,
        depends_on: r.depends_on ?? [],
        is_base: r.is_base_preparation ?? false,
        guarnicion: r.guarnicion,
      })),
      implicit_sub_recipes: IMPLICIT_SUB_RECIPES,
      ingredients: [...uniqueIngredients.values()].sort((a, b) =>
        a.stock_match.confidence_score - b.stock_match.confidence_score
      ),
      match_stats: matchStats,
      fudo_bridge: fudoBridge,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/recipes/ingest GET]', error)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/recipes/ingest
// ---------------------------------------------------------------------------
// Ingesta real del corpus a la base de datos.
//
// Por cada receta del corpus:
//   1. Upsert en `recipes` (match por slug; crea si no existe)
//   2. Por cada ingrediente, corre fuzzy match contra stock_items
//   3. Confidence exacto/probable + conversión de unidades OK → INSERT recipe_ingredients
//   4. Confidence ambiguo/sin_match, o conversión imposible → INSERT pending_links
//
// Parámetros body (todos opcionales):
//   dry_run      (bool, default false) — analiza pero NO escribe en BD
//   min_confidence ('exacto' | 'probable', default 'probable') — umbral para insertar
//   overwrite    (bool, default false) — si true, borra recipe_ingredients existentes antes de insertar
//
// Retorna: informe detallado por receta + totales.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    // --- Auth ---
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    // --- Params ---
    const body = await request.json().catch(() => ({}))
    const dryRun: boolean = body?.dry_run ?? false
    const minConfidence: 'exacto' | 'probable' = body?.min_confidence ?? 'probable'
    const overwrite: boolean = body?.overwrite ?? false

    const admin = createAdminClient()

    // --- Fetch stock items ---
    const { data: stockItemsRaw } = await admin
      .from('stock_items')
      .select('id, name, category, unit')
      .eq('is_active', true)

    const stockItems: StockItemForMatch[] = (stockItemsRaw ?? []).map(s => ({
      id: String(s.id),
      name: s.name,
      category: s.category ?? '',
      unit: s.unit ?? 'unidad',
    }))

    if (stockItems.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No hay stock_items activos. Ejecutá primero el sync de Fudo stock.',
      }, { status: 400 })
    }

    // --- Process each corpus recipe ---
    const results: IngestResult[] = []
    let totalInserted = 0
    let totalPending = 0
    let totalSkipped = 0
    let totalErrors = 0

    const confidenceThresholds: Record<typeof minConfidence, string[]> = {
      exacto: ['exacto'],
      probable: ['exacto', 'probable'],
    }
    const allowedConfidences = confidenceThresholds[minConfidence]

    for (const corpusRecipe of RECIPE_CORPUS) {
      const result: IngestResult = {
        recipe_slug: corpusRecipe.slug,
        recipe_name: corpusRecipe.nombre,
        recipe_id: null,
        action: 'found',
        ingredients_inserted: 0,
        ingredients_pending: 0,
        ingredients_skipped: 0,
        details: [],
      }

      try {
        // --- 1. Find or create recipe in DB ---
        const { data: existingRecipe } = await admin
          .from('recipes')
          .select('id, slug')
          .eq('slug', corpusRecipe.slug)
          .single()

        let recipeId: string

        if (existingRecipe) {
          recipeId = existingRecipe.id
          result.recipe_id = recipeId
          result.action = 'found'
        } else {
          // Try also by name (in case slug was not set before)
          const { data: byName } = await admin
            .from('recipes')
            .select('id')
            .ilike('name', corpusRecipe.nombre)
            .is('slug', null)
            .limit(1)
            .single()

          if (byName) {
            // Update existing to add slug
            if (!dryRun) {
              await admin.from('recipes').update({ slug: corpusRecipe.slug }).eq('id', byName.id)
            }
            recipeId = byName.id
            result.recipe_id = recipeId
            result.action = 'found'
          } else {
            // Create new recipe
            if (!dryRun) {
              const categoryMap: Record<string, string> = {
                plato: 'platos',
                sandwich: 'entre_panes',
                postre: 'postres',
                pizza: 'pizzas',
                preparacion_base: 'especialidades',
                guarnicion: 'especialidades',
                bebida: 'bebidas',
              }

              const { data: newRecipe, error: createError } = await admin
                .from('recipes')
                .insert({
                  name: corpusRecipe.nombre,
                  slug: corpusRecipe.slug,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  category: (categoryMap[corpusRecipe.categoria] ?? 'platos') as any,
                  notes: corpusRecipe.notas.join(' ') || null,
                  preparation: corpusRecipe.pasos.join('\n'),
                  yield_portions: 1,
                  is_active: true,
                  ingredients: corpusRecipe.ingredientes.map(i => ({
                    name: i.producto,
                    qty: String(i.cantidad ?? ''),
                    unit: i.unidad ?? '',
                  })),
                  created_by: user.id,
                })
                .select('id')
                .single()

              if (createError || !newRecipe) {
                throw new Error(`Error creando receta: ${createError?.message}`)
              }

              recipeId = newRecipe.id
            } else {
              recipeId = '' // dry run placeholder
            }
            result.recipe_id = recipeId
            result.action = 'created'
          }
        }

        // --- 2. Clear existing recipe_ingredients if overwrite ---
        if (overwrite && !dryRun && recipeId) {
          await admin.from('recipe_ingredients').delete().eq('recipe_id', recipeId)
          // Also clear pending links for this recipe
          await admin
            .from('recipe_ingredient_pending_links')
            .delete()
            .eq('recipe_id', recipeId)
            .eq('status', 'pending')
        }

        // --- 3. Get existing recipe_ingredient slugs to skip duplicates ---
        const { data: existingLinks } = await admin
          .from('recipe_ingredients')
          .select('stock_item_id')
          .eq('recipe_id', recipeId)

        const existingStockIds = new Set((existingLinks ?? []).map(l => String(l.stock_item_id)))

        // --- 4. Process each ingredient ---
        for (const ingredient of corpusRecipe.ingredientes) {
          const normalized = normalizeIngredient(ingredient, corpusRecipe.slug)

          // Skip preparations and ambiguous ingredients (they can't map 1:1 to stock)
          if (normalized.classification === 'preparacion_base') {
            result.details.push({
              name: ingredient.producto,
              confidence: 'skip',
              score: 0,
              stock_item_name: null,
              qty_per_portion: null,
              unit: null,
              action: 'skipped',
              reason: 'Es una sub-preparación (vegetales asados, salsa LVE, etc.) — pendiente de receta propia',
              converted: false,
            })
            result.ingredients_skipped++
            continue
          }

          const match = matchIngredientToStock(
            ingredient.producto,
            normalized.normalized_name,
            corpusRecipe.slug,
            stockItems,
          )

          const shouldInsert = allowedConfidences.includes(match.confidence)

          if (!shouldInsert || !match.suggested_stock_item_id) {
            // → Cola de revisión manual
            const pendingReason = !match.suggested_stock_item_id
              ? 'Sin ningún match en stock_items'
              : `Match ${match.confidence} (score ${match.confidence_score}): "${match.suggested_stock_item_name}" — requiere confirmación`

            if (!dryRun && recipeId) {
              await admin
                .from('recipe_ingredient_pending_links')
                .upsert({
                  recipe_id: recipeId,
                  recipe_name: corpusRecipe.nombre,
                  recipe_slug: corpusRecipe.slug,
                  ingredient_name: ingredient.producto,
                  normalized_name: normalized.normalized_name,
                  cantidad: ingredient.cantidad,
                  unidad: ingredient.unidad,
                  match_confidence: (match.confidence === 'sin_match' || match.confidence === 'ambiguo')
                    ? match.confidence
                    : 'ambiguo',
                  match_score: match.confidence_score,
                  suggested_stock_item_id: match.suggested_stock_item_id ?? null,
                  suggested_stock_item_name: match.suggested_stock_item_name,
                  match_reasons: match.reasons,
                  status: 'pending',
                }, { onConflict: 'recipe_id,normalized_name' })
            }

            result.details.push({
              name: ingredient.producto,
              confidence: match.confidence,
              score: match.confidence_score,
              stock_item_name: match.suggested_stock_item_name,
              qty_per_portion: null,
              unit: null,
              action: 'pending',
              reason: pendingReason,
              converted: false,
            })
            result.ingredients_pending++
            totalPending++
            continue
          }

          // Match is good → try unit conversion
          const stockItem = stockItems.find(s => s.id === match.suggested_stock_item_id)
          const stockUnit = stockItem?.unit ?? 'unidad'
          const converted = convertQtyToStockUnit(ingredient.cantidad, ingredient.unidad, stockUnit)

          if (converted === null) {
            // Unit conversion failed → pending
            const convReason = ingredient.cantidad === null
              ? `Sin cantidad definida en el corpus — requiere valor manual`
              : `No se puede convertir "${ingredient.unidad}" a "${stockUnit}" — revisión manual`

            if (!dryRun && recipeId) {
              await admin
                .from('recipe_ingredient_pending_links')
                .upsert({
                  recipe_id: recipeId,
                  recipe_name: corpusRecipe.nombre,
                  recipe_slug: corpusRecipe.slug,
                  ingredient_name: ingredient.producto,
                  normalized_name: normalized.normalized_name,
                  cantidad: ingredient.cantidad,
                  unidad: ingredient.unidad,
                  match_confidence: 'ambiguo',
                  match_score: match.confidence_score,
                  suggested_stock_item_id: match.suggested_stock_item_id,
                  suggested_stock_item_name: match.suggested_stock_item_name,
                  match_reasons: [convReason, ...match.reasons],
                  status: 'pending',
                }, { onConflict: 'recipe_id,normalized_name' })
            }

            result.details.push({
              name: ingredient.producto,
              confidence: match.confidence,
              score: match.confidence_score,
              stock_item_name: match.suggested_stock_item_name,
              qty_per_portion: null,
              unit: null,
              action: 'pending',
              reason: convReason,
              converted: false,
            })
            result.ingredients_pending++
            totalPending++
            continue
          }

          // Skip if already linked
          if (existingStockIds.has(match.suggested_stock_item_id)) {
            result.details.push({
              name: ingredient.producto,
              confidence: match.confidence,
              score: match.confidence_score,
              stock_item_name: match.suggested_stock_item_name,
              qty_per_portion: converted.qty,
              unit: converted.unit,
              action: 'skipped',
              reason: 'Ya existe vínculo en recipe_ingredients (skip sin overwrite)',
              converted: converted.converted,
            })
            result.ingredients_skipped++
            continue
          }

          // → INSERT into recipe_ingredients
          if (!dryRun && recipeId) {
            const { error: insertError } = await admin
              .from('recipe_ingredients')
              .upsert({
                recipe_id: recipeId,
                stock_item_id: match.suggested_stock_item_id,
                qty_per_portion: converted.qty,
                ingredient_unit: converted.unit,
                notes: converted.converted
                  ? `Convertido de ${ingredient.cantidad}${ingredient.unidad} → ${converted.qty}${converted.unit}`
                  : null,
              }, { onConflict: 'recipe_id,stock_item_id' })

            if (insertError) {
              result.details.push({
                name: ingredient.producto,
                confidence: match.confidence,
                score: match.confidence_score,
                stock_item_name: match.suggested_stock_item_name,
                qty_per_portion: converted.qty,
                unit: converted.unit,
                action: 'skipped',
                reason: `Error al insertar: ${insertError.message}`,
                converted: converted.converted,
              })
              result.ingredients_skipped++
              totalErrors++
              continue
            }
          }

          result.details.push({
            name: ingredient.producto,
            confidence: match.confidence,
            score: match.confidence_score,
            stock_item_name: match.suggested_stock_item_name,
            qty_per_portion: converted.qty,
            unit: converted.unit,
            action: 'inserted',
            reason: converted.converted
              ? `${match.confidence.toUpperCase()} (${match.confidence_score}) | Convertido: ${ingredient.cantidad}${ingredient.unidad} → ${converted.qty}${converted.unit}`
              : `${match.confidence.toUpperCase()} (${match.confidence_score}) | ${match.reasons.join(', ')}`,
            converted: converted.converted,
          })
          result.ingredients_inserted++
          totalInserted++
          existingStockIds.add(match.suggested_stock_item_id)
        }
      } catch (recipeError) {
        result.action = 'error'
        result.details.push({
          name: 'ERROR',
          confidence: 'error',
          score: 0,
          stock_item_name: null,
          qty_per_portion: null,
          unit: null,
          action: 'skipped',
          reason: recipeError instanceof Error ? recipeError.message : 'Error desconocido',
          converted: false,
        })
        totalErrors++
      }

      results.push(result)
    }

    // --- Summary ---
    const summary = {
      dry_run: dryRun,
      min_confidence: minConfidence,
      overwrite,
      stock_items_available: stockItems.length,
      corpus_recipes: RECIPE_CORPUS.length,
      recipes_created: results.filter(r => r.action === 'created').length,
      recipes_found: results.filter(r => r.action === 'found').length,
      recipes_errored: results.filter(r => r.action === 'error').length,
      total_inserted: totalInserted,
      total_pending: totalPending,
      total_skipped: totalSkipped,
      total_errors: totalErrors,
    }

    console.log(`[/api/recipes/ingest POST] ${dryRun ? 'DRY RUN' : 'WRITTEN'} | ${totalInserted} inserted, ${totalPending} pending, ${totalErrors} errors`)

    return NextResponse.json({
      success: true,
      summary,
      results,
      pendingReviewNote: totalPending > 0
        ? `${totalPending} ingredientes requieren revisión manual en recipe_ingredient_pending_links`
        : null,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/recipes/ingest POST]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
