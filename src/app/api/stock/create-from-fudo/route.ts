// ---------------------------------------------------------------------------
// POST /api/stock/create-from-fudo — Crear stock_items desde Fudo con un tap
// GET  /api/stock/create-from-fudo — Listar ingredientes/productos Fudo sin item LVE
// ---------------------------------------------------------------------------
// Fudo es la fuente de verdad: cuando el sync detecta ingredientes/productos
// con control de stock en Fudo que no existen en LVE, este endpoint los crea
// al toque para no perder trazabilidad. Manager-only. Idempotente: si ya hay
// un stock_item vinculado a ese fudo_ingredient_id / fudo_product_id, se saltea.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { fudo } from '@/lib/fudoClient'
import { logAudit } from '@/lib/audit'
import { esErrorColumnaFaltante } from '@/lib/costos/confiable'
import {
  createStockItemsFromIngredients,
  readFudoIngredientsWithUnit,
  readLinkedFudoIds,
} from '@/lib/fudo/create-from-fudo'

export const maxDuration = 60

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UnmappedProduct = {
  id: string
  name: string
  cost: number | null
  stock: number | null
}

// ---------------------------------------------------------------------------
// Fudo helpers
// ---------------------------------------------------------------------------

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Productos Fudo con control de stock (terminados, ej. empanadas) */
async function readFudoProductsWithStock(): Promise<UnmappedProduct[]> {
  const products = await fudo.getProducts()
  return products
    .filter(p => p.stockControl && p.stock != null)
    .map(p => ({
      id: String(p.id),
      name: p.name,
      cost: asNullableNumber(p.cost),
      stock: asNullableNumber(p.stock),
    }))
}

async function requireManager() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, first_name, last_name')
    .eq('id', user.id)
    .single()

  if (!isManagerOrAbove(profile?.role)) {
    return { error: NextResponse.json({ error: 'Sin acceso' }, { status: 403 }) }
  }

  const userName = `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.trim() || null
  return { user, userName }
}

// ---------------------------------------------------------------------------
// GET — lista de ingredientes/productos Fudo sin item en LVE
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const auth = await requireManager()
    if ('error' in auth) return auth.error

    const admin = createAdminClient()
    const [ingredients, products, { linkedIngredients, linkedProducts }] = await Promise.all([
      readFudoIngredientsWithUnit(),
      readFudoProductsWithStock(),
      readLinkedFudoIds(admin),
    ])

    const unmappedIngredients = ingredients
      .filter(i => i.stockControl && !linkedIngredients.has(i.id))
      .map(({ id, name, unit, cost, stock }) => ({ id, name, unit, cost, stock }))

    const unmappedProducts = products.filter(p => !linkedProducts.has(p.id))

    return NextResponse.json({
      unmapped_ingredients: unmappedIngredients,
      unmapped_products: unmappedProducts,
      total: unmappedIngredients.length + unmappedProducts.length,
    })
  } catch (error) {
    console.error('[GET /api/stock/create-from-fudo]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// POST — crear los stock_items
// Body: { fudo_ingredient_id } | { fudo_product_id } | { all: true }
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireManager()
    if ('error' in auth) return auth.error
    const { user, userName } = auth

    const body = await request.json().catch(() => ({})) as {
      fudo_ingredient_id?: string | number
      fudo_product_id?: string | number
      all?: boolean
    }

    const targetIngredientId = body.fudo_ingredient_id != null ? String(body.fudo_ingredient_id) : null
    const targetProductId = body.fudo_product_id != null ? String(body.fudo_product_id) : null
    const all = body.all === true

    if (!all && !targetIngredientId && !targetProductId) {
      return NextResponse.json(
        { error: 'Indicá fudo_ingredient_id, fudo_product_id o all: true' },
        { status: 400 },
      )
    }

    const admin = createAdminClient()
    const needIngredients = all || Boolean(targetIngredientId)
    const needProducts = all || Boolean(targetProductId)

    const [ingredients, products, { linkedIngredients, linkedProducts }] = await Promise.all([
      needIngredients ? readFudoIngredientsWithUnit() : Promise.resolve([]),
      needProducts ? readFudoProductsWithStock() : Promise.resolve([]),
      readLinkedFudoIds(admin),
    ])

    // Candidatos según el modo
    const ingredientCandidates = all
      ? ingredients.filter(i => i.stockControl)
      : ingredients.filter(i => i.id === targetIngredientId)
    const productCandidates = all
      ? products
      : products.filter(p => p.id === targetProductId)

    if (!all && targetIngredientId && ingredientCandidates.length === 0) {
      return NextResponse.json(
        { error: `Ingrediente ${targetIngredientId} no encontrado en Fudo` },
        { status: 404 },
      )
    }
    if (!all && targetProductId && productCandidates.length === 0) {
      return NextResponse.json(
        { error: `Producto ${targetProductId} no encontrado en Fudo` },
        { status: 404 },
      )
    }

    const ingredientResult = await createStockItemsFromIngredients(
      admin,
      ingredientCandidates,
      linkedIngredients,
    )

    let created = ingredientResult.created
    let skipped = ingredientResult.skipped
    const createdNames: string[] = [...ingredientResult.createdNames]
    const errors: string[] = [...ingredientResult.errors]
    const now = new Date().toISOString()

    for (const prod of productCandidates) {
      if (linkedProducts.has(prod.id)) {
        skipped++
        continue
      }
      const hasCost = prod.cost != null && prod.cost > 0
      const basePayload = {
        name: prod.name,
        unit: 'unidad',
        cost_per_unit: hasCost ? prod.cost : null,
        current_qty: typeof prod.stock === 'number' ? Math.round(prod.stock * 100) / 100 : 0,
        fudo_product_id: prod.id,
        is_active: true,
        category: 'otros',
        semaphore: 'green',
        updated_at: now,
      }
      // Costo inicial de Fudo → cost_source 'fudo' (no confiable, solo referencia)
      let { error } = await admin.from('stock_items').insert(
        hasCost ? { ...basePayload, cost_source: 'fudo', cost_updated_at: now } : basePayload,
      )
      if (error && hasCost && esErrorColumnaFaltante(error.message, ['cost_source', 'cost_updated_at'])) {
        ;({ error } = await admin.from('stock_items').insert(basePayload))
      }
      if (error) {
        errors.push(`${prod.name}: ${error.message}`)
      } else {
        created++
        createdNames.push(prod.name)
        linkedProducts.add(prod.id)
      }
    }

    if (created > 0) {
      logAudit(admin, {
        userId: user.id,
        userName,
        action: 'create_from_fudo',
        module: 'stock',
        entityType: 'stock_item',
        description: `${userName ?? 'Encargado'}: creó ${created} item${created === 1 ? '' : 's'} de stock desde Fudo${skipped > 0 ? ` (${skipped} ya existían)` : ''}`,
        metadata: {
          created,
          skipped,
          errors: errors.length > 0 ? errors : undefined,
          items: createdNames.slice(0, 120),
          mode: all ? 'all' : targetIngredientId ? 'ingredient' : 'product',
        },
      })
    }

    return NextResponse.json({
      success: errors.length === 0,
      created,
      skipped,
      errors,
      items: createdNames,
    })
  } catch (error) {
    console.error('[POST /api/stock/create-from-fudo]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
