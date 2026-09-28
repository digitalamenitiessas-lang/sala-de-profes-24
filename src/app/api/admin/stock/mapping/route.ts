import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// Fuzzy matching helpers
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function words(s: string): string[] {
  return norm(s).split(' ').filter(w => w.length > 1)
}

/** Score 0-100 for how well two names match */
function fuzzyScore(stockName: string, fudoName: string): number {
  const sn = norm(stockName)
  const fn = norm(fudoName)

  // Exact match
  if (sn === fn) return 100

  // One fully contains the other
  if (fn.includes(sn)) return 85
  if (sn.includes(fn)) return 80

  // Word overlap scoring
  const sw = words(stockName)
  const fw = words(fudoName)
  if (sw.length === 0 || fw.length === 0) return 0

  let matchedWords = 0
  let partialScore = 0

  for (const sWord of sw) {
    // Exact word match
    if (fw.includes(sWord)) {
      matchedWords++
      continue
    }
    // Partial word match (one contains the other)
    const partial = fw.find(fWord => fWord.includes(sWord) || sWord.includes(fWord))
    if (partial) {
      partialScore += 0.5
    }
  }

  const totalMatch = matchedWords + partialScore
  if (totalMatch === 0) return 0

  // Score based on coverage of both sides
  const coverageStock = totalMatch / sw.length
  const coverageFudo = totalMatch / fw.length
  const avgCoverage = (coverageStock + coverageFudo) / 2

  return Math.round(avgCoverage * 70) // Max 70 for word overlap
}

type FudoItem = {
  id: string
  name: string
  type: 'ingredient' | 'product'
  stock: number | null
  cost: number | null
  stockControl: boolean
}

type Suggestion = {
  fudo_id: string
  fudo_name: string
  fudo_type: 'ingredient' | 'product'
  score: number
  stock: number | null
  cost: number | null
}

// ---------------------------------------------------------------------------
// GET /api/admin/stock/mapping
// Returns unlinked stock_items with fuzzy match suggestions from Fudo
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const admin = createAdminClient()

    // 1. Get all stock_items
    const { data: allItems } = await admin
      .from('stock_items')
      .select('id, name, category, unit, current_qty, fudo_ingredient_id, fudo_product_id, is_active, fudo_skip')
      .eq('is_active', true)
      .order('name')

    // 2. Fetch all Fudo ingredients and products
    const [fudoIngredients, fudoProducts] = await Promise.all([
      fudo.getIngredients(),
      fudo.getProducts(),
    ])

    // Build unified Fudo item list
    const fudoItems: FudoItem[] = [
      ...fudoIngredients.map(i => ({
        id: i.id,
        name: i.name ?? '',
        type: 'ingredient' as const,
        stock: i.stock ?? null,
        cost: i.cost ?? null,
        stockControl: i.stockControl ?? false,
      })),
      ...fudoProducts
        .filter(p => p.active)
        .map(p => ({
          id: p.id,
          name: p.name ?? '',
          type: 'product' as const,
          stock: p.stock ?? null,
          cost: p.cost ?? null,
          stockControl: p.stockControl ?? false,
        })),
    ]

    // 3. Build set of already-linked Fudo IDs
    const linkedIngIds = new Set(
      (allItems ?? []).filter(i => i.fudo_ingredient_id).map(i => i.fudo_ingredient_id),
    )
    const linkedProdIds = new Set(
      (allItems ?? []).filter(i => i.fudo_product_id).map(i => i.fudo_product_id),
    )

    // 4. Build set of Fudo IDs that actually exist in Fudo right now
    const fudoIngredientIds = new Set(fudoIngredients.map(i => i.id))
    const fudoProductIds = new Set(fudoProducts.filter(p => p.active).map(p => p.id))

    // 4b. Detect broken links: items with a Fudo ID that no longer exists in Fudo
    const brokenLinks = (allItems ?? [])
      .filter(i => {
        if (i.fudo_ingredient_id && !fudoIngredientIds.has(i.fudo_ingredient_id)) return true
        if (i.fudo_product_id && !fudoProductIds.has(i.fudo_product_id)) return true
        return false
      })
      .map(i => ({
        id: i.id,
        name: i.name,
        category: i.category,
        unit: i.unit,
        current_qty: i.current_qty,
        fudo_ingredient_id: i.fudo_ingredient_id ?? null,
        fudo_product_id: i.fudo_product_id ?? null,
        broken_type: i.fudo_ingredient_id && !fudoIngredientIds.has(i.fudo_ingredient_id)
          ? 'ingredient' as const
          : 'product' as const,
        broken_fudo_id: (
          i.fudo_ingredient_id && !fudoIngredientIds.has(i.fudo_ingredient_id)
            ? i.fudo_ingredient_id
            : i.fudo_product_id
        ) ?? '',
      }))

    // 4c. Split into linked and unlinked (excluding broken links from "linked" count)
    const brokenIds = new Set(brokenLinks.map(b => b.id))
    const unlinked = (allItems ?? []).filter(
      i => !i.fudo_ingredient_id && !i.fudo_product_id,
    )
    const linked = (allItems ?? []).filter(
      i => (i.fudo_ingredient_id || i.fudo_product_id) && !brokenIds.has(i.id),
    )

    // 5. For each unlinked item, find top suggestions
    const unlinkedWithSuggestions = unlinked.map(item => {
      const suggestions: Suggestion[] = []

      for (const fi of fudoItems) {
        // Skip already-linked Fudo items
        if (fi.type === 'ingredient' && linkedIngIds.has(fi.id)) continue
        if (fi.type === 'product' && linkedProdIds.has(fi.id)) continue

        const score = fuzzyScore(item.name, fi.name)
        if (score >= 25) {
          suggestions.push({
            fudo_id: fi.id,
            fudo_name: fi.name,
            fudo_type: fi.type,
            score,
            stock: fi.stock,
            cost: fi.cost,
          })
        }
      }

      // Sort by score descending, take top 5
      suggestions.sort((a, b) => b.score - a.score)

      return {
        id: item.id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        current_qty: item.current_qty,
        fudo_skip: item.fudo_skip ?? false,
        suggestions: suggestions.slice(0, 5),
        best_score: suggestions[0]?.score ?? 0,
      }
    })

    // Sort: best matches first, skipped last
    unlinkedWithSuggestions.sort((a, b) => {
      if (a.fudo_skip && !b.fudo_skip) return 1
      if (!a.fudo_skip && b.fudo_skip) return -1
      return b.best_score - a.best_score
    })

    return NextResponse.json({
      unlinked: unlinkedWithSuggestions,
      broken_links: brokenLinks,
      linked_count: linked.length,
      unlinked_count: unlinked.length,
      skipped_count: unlinked.filter(i => i.fudo_skip).length,
      fudo_ingredients_count: fudoIngredients.length,
      fudo_products_count: fudoProducts.filter(p => p.active).length,
    })
  } catch (error) {
    console.error('[/api/admin/stock/mapping GET]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/stock/mapping
// Confirm a mapping or mark "sin equivalente"
// Body: { stock_item_id, action, fudo_id?, fudo_type? }
//   action: 'link' | 'skip' | 'unskip'
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const body = await request.json()
    const { stock_item_id, action, fudo_id, fudo_type } = body

    if (!stock_item_id || !action) {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })
    }

    const admin = createAdminClient()

    if (action === 'link') {
      if (!fudo_id || !fudo_type) {
        return NextResponse.json({ error: 'Faltan fudo_id y fudo_type' }, { status: 400 })
      }

      const linkColumn = fudo_type === 'ingredient' ? 'fudo_ingredient_id' : 'fudo_product_id'
      const { data: existingLink } = await admin
        .from('stock_items')
        .select('id, name')
        .eq(linkColumn, fudo_id)
        .neq('id', stock_item_id)
        .maybeSingle()

      if (existingLink) {
        return NextResponse.json(
          { error: `Ese vínculo de Fudo ya está asignado a ${existingLink.name}` },
          { status: 409 },
        )
      }

      const update: Record<string, unknown> = {
        fudo_skip: false,
        fudo_ingredient_id: null,
        fudo_product_id: null,
        updated_at: new Date().toISOString(),
      }

      if (fudo_type === 'ingredient') {
        update.fudo_ingredient_id = fudo_id
      } else {
        update.fudo_product_id = fudo_id
      }

      const { error } = await admin
        .from('stock_items')
        .update(update)
        .eq('id', stock_item_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, action: 'linked' })
    }

    if (action === 'skip') {
      const { error } = await admin
        .from('stock_items')
        .update({ fudo_skip: true, updated_at: new Date().toISOString() })
        .eq('id', stock_item_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, action: 'skipped' })
    }

    if (action === 'unskip') {
      const { error } = await admin
        .from('stock_items')
        .update({ fudo_skip: false, updated_at: new Date().toISOString() })
        .eq('id', stock_item_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, action: 'unskipped' })
    }

    // Desvincular de Fudo: limpia IDs y marca como local.
    // Usado cuando un producto fue borrado en Fudo y el vínculo quedó roto.
    if (action === 'unlink') {
      const { error } = await admin
        .from('stock_items')
        .update({
          fudo_ingredient_id: null,
          fudo_product_id: null,
          fudo_skip: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', stock_item_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      // Resolver incidents abiertos para este item
      await admin
        .from('fudo_sync_incidents')
        .update({ status: 'resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('stock_item_id', stock_item_id)
        .eq('status', 'open')

      return NextResponse.json({ success: true, action: 'unlinked' })
    }

    // Desactivar: saca el item de la app. Limpia vínculos y marca inactivo.
    // Usado cuando el producto fue borrado en Fudo y tampoco se usa más en LVE.
    if (action === 'deactivate') {
      const { error } = await admin
        .from('stock_items')
        .update({
          is_active: false,
          fudo_ingredient_id: null,
          fudo_product_id: null,
          fudo_skip: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', stock_item_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      await admin
        .from('fudo_sync_incidents')
        .update({ status: 'resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('stock_item_id', stock_item_id)
        .eq('status', 'open')

      return NextResponse.json({ success: true, action: 'deactivated' })
    }

    return NextResponse.json({ error: 'Acción inválida' }, { status: 400 })
  } catch (error) {
    console.error('[/api/admin/stock/mapping POST]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
