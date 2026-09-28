// Link menu_items to recipes by name matching
// Usage: npx tsx scripts/run-link-menu.ts [--dry-run]

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(SUPABASE_URL, SERVICE_KEY)
const dryRun = process.argv.includes('--dry-run')

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim()
}

function words(s: string): string[] {
  return norm(s).split(/\s+/).filter(w => w.length > 2)
}

function scoreNames(a: string, b: string): number {
  const an = norm(a), bn = norm(b)
  if (an === bn) return 100
  if (an.includes(bn) || bn.includes(an)) return 80
  const aw = words(a), bw = words(b)
  const overlap = aw.filter(w => bw.includes(w)).length
  if (overlap === 0) return 0
  return Math.round((overlap / Math.max(aw.length, bw.length)) * 60)
}

async function main() {
  console.log(`\n=== Link Menu Items ${dryRun ? '(DRY RUN)' : '(LIVE)'} ===\n`)

  const { RECIPE_CORPUS } = await import('../src/lib/recipes/corpus')

  const { data: menuItems } = await admin
    .from('menu_items')
    .select('id, name, fudo_product_id, recipe_id, is_active')

  const active = (menuItems ?? []).filter(mi => mi.is_active)
  console.log(`Active menu items: ${active.length}`)

  const { data: dbRecipes } = await admin
    .from('recipes')
    .select('id, name, slug')
    .eq('is_active', true)

  console.log(`Active recipes: ${(dbRecipes ?? []).length}\n`)

  let linked = 0, already = 0, noMatch = 0

  for (const cr of RECIPE_CORPUS) {
    if (cr.is_base_preparation) {
      console.log(`${cr.slug}: skipped (base preparation)`)
      continue
    }

    const dbR = (dbRecipes ?? []).find(r => r.slug === cr.slug || norm(r.name) === norm(cr.nombre))
    if (!dbR) {
      console.log(`${cr.slug}: ERROR — not in DB`)
      continue
    }

    let bestItem: (typeof active)[0] | null = null
    let bestScore = 0
    for (const mi of active) {
      const s = scoreNames(cr.nombre, mi.name)
      if (s > bestScore) { bestScore = s; bestItem = mi }
    }

    if (!bestItem || bestScore < 60) {
      console.log(`${cr.slug}: no match (best: "${bestItem?.name}" score=${bestScore})`)
      noMatch++
      continue
    }

    if (bestItem.recipe_id) {
      console.log(`${cr.slug}: already linked → "${bestItem.name}"`)
      already++
      continue
    }

    if (!dryRun) {
      await admin.from('menu_items').update({ recipe_id: dbR.id }).eq('id', bestItem.id)
    }
    console.log(`${cr.slug}: ${dryRun ? 'WOULD LINK' : 'LINKED'} → "${bestItem.name}" (score=${bestScore})`)
    linked++
  }

  console.log(`\n=== TOTALS ===`)
  console.log(`Linked: ${linked}`)
  console.log(`Already linked: ${already}`)
  console.log(`No match: ${noMatch}`)
  console.log(dryRun ? '\n(DRY RUN)' : '\nDone!')
}

main().catch(err => { console.error(err); process.exit(1) })
