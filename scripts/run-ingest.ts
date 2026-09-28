/* eslint-disable @typescript-eslint/no-require-imports */
// Quick local script to trigger recipe ingestion with admin auth
// Usage: npx tsx scripts/run-ingest.ts [--dry-run]

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SERVICE_ROLE_KEY in env')
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY)
const dryRun = process.argv.includes('--dry-run')

async function main() {
  console.log(`\n=== Recipe Ingestion ${dryRun ? '(DRY RUN)' : '(LIVE)'} ===\n`)

  // 1. Import corpus and matching
  const { RECIPE_CORPUS, normalizeIngredient } = await import('../src/lib/recipes/corpus')
  const { matchIngredientToStock } = await import('../src/lib/recipes/stock-match')

  // 2. Fetch stock items
  const { data: stockItemsRaw } = await admin
    .from('stock_items')
    .select('id, name, category, unit')
    .eq('is_active', true)

  const stockItems = (stockItemsRaw ?? []).map(s => ({
    id: String(s.id),
    name: s.name,
    category: s.category ?? '',
    unit: s.unit ?? 'unidad',
  }))

  console.log(`Stock items: ${stockItems.length}`)
  console.log(`Corpus recipes: ${RECIPE_CORPUS.length}\n`)

  if (stockItems.length === 0) {
    console.error('No active stock_items — run Fudo sync first')
    process.exit(1)
  }

  // --- Fake user ID for created_by (use the first socio) ---
  const { data: socio } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'socio')
    .limit(1)
    .single()

  const createdBy = socio?.id ?? '00000000-0000-0000-0000-000000000000'

  let totalInserted = 0
  let totalPending = 0
  let totalSkipped = 0
  let totalCreated = 0
  let totalFound = 0

  for (const corpusRecipe of RECIPE_CORPUS) {
    process.stdout.write(`${corpusRecipe.slug}... `)

    // 1. Find or create recipe
    const { data: existing } = await admin
      .from('recipes')
      .select('id, slug')
      .eq('slug', corpusRecipe.slug)
      .single()

    let recipeId: string

    if (existing) {
      recipeId = existing.id
      process.stdout.write('found → ')
      totalFound++
    } else {
      // Try by name
      const { data: byName } = await admin
        .from('recipes')
        .select('id')
        .ilike('name', corpusRecipe.nombre)
        .is('slug', null)
        .limit(1)
        .single()

      if (byName) {
        if (!dryRun) {
          await admin.from('recipes').update({ slug: corpusRecipe.slug }).eq('id', byName.id)
        }
        recipeId = byName.id
        process.stdout.write('found (added slug) → ')
        totalFound++
      } else {
        // Create
        if (!dryRun) {
          const categoryMap: Record<string, string> = {
            plato: 'platos', sandwich: 'entre_panes', postre: 'postres',
            pizza: 'pizzas', preparacion_base: 'especialidades',
            guarnicion: 'especialidades', bebida: 'bebidas',
          }
          const { data: newR, error: createErr } = await admin
            .from('recipes')
            .insert({
              name: corpusRecipe.nombre,
              slug: corpusRecipe.slug,
              category: categoryMap[corpusRecipe.categoria] ?? 'platos',
              notes: corpusRecipe.notas.join(' ') || null,
              preparation: corpusRecipe.pasos.join('\n'),
              yield_portions: 1,
              is_active: true,
              ingredients: corpusRecipe.ingredientes.map(i => ({
                name: i.producto,
                qty: String(i.cantidad ?? ''),
                unit: i.unidad ?? '',
              })),
              created_by: createdBy,
            })
            .select('id')
            .single()

          if (createErr) {
            console.error(`\n  ERROR creating: ${createErr.message}`)
            continue
          }
          recipeId = newR!.id
        } else {
          recipeId = 'dry-run'
        }
        process.stdout.write('CREATED → ')
        totalCreated++
      }
    }

    // 2. Process ingredients
    let inserted = 0
    let pending = 0
    let skipped = 0

    const { data: existingLinks } = await admin
      .from('recipe_ingredients')
      .select('stock_item_id')
      .eq('recipe_id', recipeId)

    const existingStockIds = new Set((existingLinks ?? []).map(l => String(l.stock_item_id)))

    for (const ingredient of corpusRecipe.ingredientes) {
      const normalized = normalizeIngredient(ingredient, corpusRecipe.slug)

      if (normalized.classification === 'preparacion_base') {
        skipped++
        continue
      }

      const match = matchIngredientToStock(
        ingredient.producto,
        normalized.normalized_name,
        corpusRecipe.slug,
        stockItems,
      )

      const shouldInsert = ['exacto', 'probable'].includes(match.confidence)

      if (!shouldInsert || !match.suggested_stock_item_id) {
        // Pending link
        if (!dryRun && recipeId !== 'dry-run') {
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
              match_confidence: match.confidence === 'sin_match' || match.confidence === 'ambiguo'
                ? match.confidence : 'ambiguo',
              match_score: match.confidence_score,
              suggested_stock_item_id: match.suggested_stock_item_id ?? null,
              suggested_stock_item_name: match.suggested_stock_item_name,
              match_reasons: match.reasons,
              status: 'pending',
            }, { onConflict: 'recipe_id,normalized_name' })
        }
        pending++
        continue
      }

      // Unit conversion
      const stockItem = stockItems.find(s => s.id === match.suggested_stock_item_id)
      const stockUnit = stockItem?.unit ?? 'unidad'
      const converted = convertQtyToStockUnit(ingredient.cantidad, ingredient.unidad, stockUnit)

      if (converted === null) {
        if (!dryRun && recipeId !== 'dry-run') {
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
              match_reasons: [`No se puede convertir "${ingredient.unidad}" a "${stockUnit}"`, ...match.reasons],
              status: 'pending',
            }, { onConflict: 'recipe_id,normalized_name' })
        }
        pending++
        continue
      }

      if (existingStockIds.has(match.suggested_stock_item_id!)) {
        skipped++
        continue
      }

      // Insert recipe_ingredient
      if (!dryRun && recipeId !== 'dry-run') {
        const { error: insErr } = await admin
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

        if (insErr) {
          console.error(`\n  ERROR inserting ingredient ${ingredient.producto}: ${insErr.message}`)
          skipped++
          continue
        }
      }

      inserted++
      existingStockIds.add(match.suggested_stock_item_id!)
    }

    totalInserted += inserted
    totalPending += pending
    totalSkipped += skipped

    console.log(`${inserted} inserted, ${pending} pending, ${skipped} skipped`)
  }

  console.log(`\n=== TOTALS ===`)
  console.log(`Recipes found: ${totalFound}`)
  console.log(`Recipes created: ${totalCreated}`)
  console.log(`Ingredients inserted: ${totalInserted}`)
  console.log(`Ingredients pending review: ${totalPending}`)
  console.log(`Ingredients skipped: ${totalSkipped}`)
  console.log(`${dryRun ? '\n(DRY RUN — nothing written)' : '\nDone!'}`)
}

function convertQtyToStockUnit(
  corpusQty: number | null,
  corpusUnit: string | null,
  stockUnit: string,
): { qty: number; unit: string; converted: boolean } | null {
  if (corpusQty === null || corpusUnit === null) return null
  const cu = corpusUnit.toLowerCase().trim()
  const su = stockUnit.toLowerCase().trim()
  if (cu === su) return { qty: corpusQty, unit: su, converted: false }
  if ((cu === 'gr' || cu === 'g') && (su === 'kg' || su === 'kilo' || su === 'kilogramo' || su === 'kilogramos'))
    return { qty: corpusQty / 1000, unit: su, converted: true }
  if (cu === 'kg' && (su === 'gr' || su === 'g'))
    return { qty: corpusQty * 1000, unit: su, converted: true }
  if (cu === 'ml' && (su === 'lt' || su === 'l' || su === 'litro' || su === 'litros'))
    return { qty: corpusQty / 1000, unit: su, converted: true }
  if ((cu === 'lt' || cu === 'l' || cu === 'litro' || cu === 'litros') && su === 'ml')
    return { qty: corpusQty * 1000, unit: su, converted: true }
  if ((cu === 'gr' || cu === 'g') && (su === 'gr' || su === 'g'))
    return { qty: corpusQty, unit: su, converted: false }
  if ((cu === 'lt' || cu === 'l' || cu === 'litro') && (su === 'lt' || su === 'l' || su === 'litro'))
    return { qty: corpusQty, unit: su, converted: false }
  if (cu === 'unidad' || cu === 'unidades' || cu === 'u')
    return { qty: corpusQty, unit: 'unidad', converted: false }
  if (cu === 'feta' || cu === 'fetas')
    return { qty: corpusQty, unit: 'unidad', converted: false }
  return null
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
