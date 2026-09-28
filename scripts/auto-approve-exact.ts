// Auto-approve pending links with high-confidence matches
// Usage: npx tsx scripts/auto-approve-exact.ts [--dry-run]

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(SUPABASE_URL, SERVICE_KEY)
const dryRun = process.argv.includes('--dry-run')

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

async function main() {
  console.log(`\n=== Auto-approve exact matches ${dryRun ? '(DRY RUN)' : '(LIVE)'} ===\n`)

  // Get all pending links
  const { data: pending, error } = await admin
    .from('recipe_ingredient_pending_links')
    .select('*')
    .eq('status', 'pending')

  if (error) { console.error(error); return }
  console.log(`Pending links: ${pending.length}\n`)

  // Get stock items for unit resolution
  const { data: stockItems } = await admin
    .from('stock_items')
    .select('id, name, unit')
    .eq('is_active', true)

  const stockMap = new Map((stockItems ?? []).map(s => [s.id, s]))

  let approved = 0
  let skipped = 0
  let noConvert = 0

  for (const link of pending) {
    // Only auto-approve if suggested item exists and score >= 70
    if (!link.suggested_stock_item_id || (link.match_score ?? 0) < 70) {
      skipped++
      continue
    }

    const stockItem = stockMap.get(link.suggested_stock_item_id)
    if (!stockItem) {
      console.log(`  ${link.ingredient_name}: stock item ${link.suggested_stock_item_id} not found`)
      skipped++
      continue
    }

    let converted = convertQtyToStockUnit(link.cantidad, link.unidad, stockItem.unit)
    // If conversion fails but score is high, use original values
    if (!converted && (link.match_score ?? 0) >= 90) {
      converted = {
        qty: link.cantidad ?? 1,
        unit: link.unidad ?? stockItem.unit,
        converted: false,
      }
    }
    if (!converted) {
      console.log(`  ${link.ingredient_name}: can't convert "${link.unidad}" → "${stockItem.unit}"`)
      noConvert++
      continue
    }

    if (!dryRun && link.recipe_id) {
      // Insert recipe_ingredient
      await admin
        .from('recipe_ingredients')
        .upsert({
          recipe_id: link.recipe_id,
          stock_item_id: link.suggested_stock_item_id,
          qty_per_portion: converted.qty,
          ingredient_unit: converted.unit,
          notes: converted.converted
            ? `Auto-aprobado (score ${link.match_score}). Convertido: ${link.cantidad}${link.unidad} → ${converted.qty}${converted.unit}`
            : `Auto-aprobado (score ${link.match_score})`,
        }, { onConflict: 'recipe_id,stock_item_id' })

      // Update pending link
      await admin
        .from('recipe_ingredient_pending_links')
        .update({
          status: 'approved',
          resolved_stock_item_id: link.suggested_stock_item_id,
          resolved_qty_per_portion: converted.qty,
          resolved_unit: converted.unit,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', link.id)
    }

    console.log(`  ${dryRun ? 'WOULD APPROVE' : 'APPROVED'}: "${link.ingredient_name}" → "${stockItem.name}" (${converted.qty} ${converted.unit}, score ${link.match_score})`)
    approved++
  }

  console.log(`\n=== TOTALS ===`)
  console.log(`Approved: ${approved}`)
  console.log(`Skipped (low score/no suggestion): ${skipped}`)
  console.log(`Can't convert units: ${noConvert}`)
  console.log(`Remaining pending: ${pending.length - approved}`)
  console.log(dryRun ? '\n(DRY RUN)' : '\nDone!')
}

main().catch(err => { console.error(err); process.exit(1) })
