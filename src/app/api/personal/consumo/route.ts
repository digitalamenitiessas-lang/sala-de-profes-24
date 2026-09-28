import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSocio, isManagerOrAbove } from '@/lib/roles'
import { fudo } from '@/lib/fudoClient'
import { costRecipes } from '@/lib/recipes/recipe-cost'

// ---------------------------------------------------------------------------
// GET /api/personal/consumo?days=30
// ---------------------------------------------------------------------------
// COSTO DEL CONSUMO DEL PERSONAL — panel de control para socios.
//
// En Fudo el consumo del personal se ticketea con productos cuyo NOMBRE
// contiene "personal" (siempre a precio $0). El precio es $0, pero el COSTO
// real (lo que erosiona el margen) se calcula por RECETA:
//
//   producto "personal"  → (map por nombre normalizado) → producto base con receta
//   → recipes → recipe_ingredients → stock_items.cost_per_unit
//
// Los productos "personal" NO tienen receta propia: se mapean a su equivalente
// de venta normalizando el nombre (quitar "personal", "menu de personal", etc.)
// y fuzzy-matcheando contra menu_items que SÍ tengan receta. Si no hay match,
// ese consumo queda "sin costeo" (costo desconocido) y se reporta — no se
// inventa costo.
//
// Detección de productos "personal": desde la API de Fudo por nombre (cache
// 10 min), para captar nuevos productos sin hardcodear IDs.
//
// Solo socio (también encargado). Devuelve: costo total del período, cantidad
// de consumos, desglose por producto, serie diaria de costo y count de
// consumos "sin costeo".
// ---------------------------------------------------------------------------

const PAGE_SIZE = 1000
const FUDO_PERSONAL_CACHE_TTL_MS = 10 * 60 * 1000

type PersonalProduct = { id: string; name: string }

// Cache de productos "personal" detectados en Fudo (10 min)
let personalCache: { at: number; products: PersonalProduct[] } | null = null

type ProductBreakdown = {
  fudo_product_id: string
  name: string
  times: number // cantidad de tickets/consumos
  qty: number // unidades consumidas
  cost_total: number | null // null si sin costeo
  costed: boolean
}

type DailyPoint = { date: string; cost: number }

type Payload = {
  days: number
  from: string
  to: string
  total_cost: number
  total_consumos: number
  total_qty: number
  sin_costeo: number // consumos sin receta mapeable
  products: ProductBreakdown[]
  daily: DailyPoint[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normaliza un nombre: minúsculas, sin acentos, sin marcadores de "personal". */
function normalizeName(raw: string): string {
  let s = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar acentos
  // Quitar marcadores de personal (orden: frases largas primero)
  s = s
    .replace(/menu de personal/g, ' ')
    .replace(/menu del personal/g, ' ')
    .replace(/menu personal/g, ' ')
    .replace(/del personal/g, ' ')
    .replace(/de personal/g, ' ')
    .replace(/personal/g, ' ')
  return s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** ¿El nombre corresponde a un consumo de personal? */
function isPersonalName(name: string): boolean {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .includes('personal')
}

/**
 * Fuzzy match de un nombre normalizado de producto personal contra los
 * candidatos de menú (ya normalizados). Estrategia:
 *   1. match exacto normalizado
 *   2. uno contiene al otro (por palabras completas — evita "te" ⊂ "tostada")
 *   3. mayor solapamiento de palabras (≥ 1 palabra significativa)
 */
function bestMenuMatch(
  targetNorm: string,
  candidates: { norm: string; words: Set<string>; recipeId: string; name: string }[],
): { recipeId: string; name: string } | null {
  if (!targetNorm) return null
  const targetWords = new Set(targetNorm.split(' ').filter((w) => w.length >= 2))
  if (targetWords.size === 0) return null

  // 1. Exacto
  const exact = candidates.find((c) => c.norm === targetNorm)
  if (exact) return { recipeId: exact.recipeId, name: exact.name }

  // 2. Contención por palabras completas (todas las palabras de uno en el otro)
  let best: { score: number; recipeId: string; name: string } | null = null
  for (const c of candidates) {
    if (c.words.size === 0) continue
    let common = 0
    for (const w of targetWords) if (c.words.has(w)) common++
    if (common === 0) continue
    // Contención total en cualquier dirección → fuerte
    const containsTarget = [...targetWords].every((w) => c.words.has(w))
    const containedByTarget = [...c.words].every((w) => targetWords.has(w))
    const score = common + (containsTarget || containedByTarget ? 10 : 0)
    if (!best || score > best.score) best = { score, recipeId: c.recipeId, name: c.name }
  }
  // Exigir al menos una palabra en común (score ≥ 1)
  return best && best.score >= 1 ? { recipeId: best.recipeId, name: best.name } : null
}

/** Pagina de a 1000 (PostgREST corta en 1000 por default). */
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 0; page < 50; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await query(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return rows
}

/** Detecta productos "personal" desde la API de Fudo (por nombre), con cache. */
async function getPersonalProducts(): Promise<PersonalProduct[]> {
  if (personalCache && Date.now() - personalCache.at < FUDO_PERSONAL_CACHE_TTL_MS) {
    return personalCache.products
  }
  const products = await fudo.getProducts()
  const personal = products
    .filter((p) => p.name && isPersonalName(p.name))
    .map((p) => ({ id: String(p.id), name: p.name }))
  personalCache = { at: Date.now(), products: personal }
  return personal
}

/** Fecha en zona Argentina (YYYY-MM-DD) a partir de un ISO. */
function argDate(iso: string): string {
  return new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    // Foco: socio. También se permite encargado.
    if (!isSocio(profile?.role) && !isManagerOrAbove(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const days = Math.min(Math.max(Number(request.nextUrl.searchParams.get('days') ?? 30) || 30, 1), 90)
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffISO = cutoff.toISOString()

    const admin = createAdminClient()

    // 1. Detectar productos "personal" en Fudo (cache 10 min)
    const personalProducts = await getPersonalProducts()
    const from = cutoffISO.slice(0, 10)
    const to = new Date().toISOString().slice(0, 10)

    if (personalProducts.length === 0) {
      return NextResponse.json({
        days, from, to, total_cost: 0, total_consumos: 0, total_qty: 0,
        sin_costeo: 0, products: [], daily: [],
      } satisfies Payload)
    }

    const personalNameById = new Map<string, string>()
    for (const p of personalProducts) personalNameById.set(p.id, p.name)
    const personalIds = [...personalNameById.keys()]

    // 2. Ventas (consumos) del período para esos productos
    type SaleRow = { fudo_product_id: string; quantity: number; sold_at: string; raw_payload: unknown }
    const sales = await fetchAll<SaleRow>((f, t) =>
      admin
        .from('fudo_sales')
        .select('fudo_product_id, quantity, sold_at, raw_payload')
        .in('fudo_product_id', personalIds)
        .gte('sold_at', cutoffISO)
        .order('id', { ascending: true })
        .range(f, t) as never,
    )

    if (sales.length === 0) {
      return NextResponse.json({
        days, from, to, total_cost: 0, total_consumos: 0, total_qty: 0,
        sin_costeo: 0, products: [], daily: [],
      } satisfies Payload)
    }

    // 3. Candidatos de menú con receta (para mapear producto personal → base)
    const { data: menuItems, error: miError } = await admin
      .from('menu_items')
      .select('name, recipe_id')
      .eq('is_active', true)
      .not('recipe_id', 'is', null)
    if (miError) throw new Error(miError.message)

    const candidates = (menuItems ?? [])
      .filter((mi) => mi.recipe_id && mi.name)
      .map((mi) => {
        const norm = normalizeName(mi.name)
        return {
          norm,
          words: new Set(norm.split(' ').filter((w) => w.length >= 2)),
          recipeId: mi.recipe_id as string,
          name: mi.name,
        }
      })

    // 4. Mapear cada producto personal a su receta base (por nombre normalizado)
    const recipeByPersonalId = new Map<string, string>()
    for (const [pid, pname] of personalNameById) {
      const match = bestMenuMatch(normalizeName(pname), candidates)
      if (match) recipeByPersonalId.set(pid, match.recipeId)
    }

    // 5. Costo por receta vía costRecipes (canonicalización + nivel 2 +
    //    gating de costo confiable). Antes acá había un cálculo manual que
    //    multiplicaba qty de intermedios sin canon() y sumaba costos Fudo:
    //    números fantasma. Ahora solo se costea lo 100% confiable; el resto
    //    queda "sin costeo" — no se inventa costo (misma filosofía del módulo).
    const usedRecipeIds = [...new Set(recipeByPersonalId.values())]
    const costPerPortionByRecipe = new Map<string, number>()
    if (usedRecipeIds.length > 0) {
      const recipeCosts = await costRecipes(admin, usedRecipeIds)
      for (const [rid, rc] of recipeCosts) {
        if (rc.confiable && rc.cost > 0) costPerPortionByRecipe.set(rid, rc.cost)
      }
    }

    // 6. Agregar consumos por producto + serie diaria
    const byProduct = new Map<string, ProductBreakdown>()
    const dailyMap = new Map<string, number>()
    let totalCost = 0
    let totalConsumos = 0
    let totalQty = 0
    let sinCosteo = 0

    for (const s of sales) {
      const pid = s.fudo_product_id
      const qty = Number(s.quantity ?? 0) || 0
      const rawName = (s.raw_payload as { item_name?: string } | null)?.item_name
      const name = rawName || personalNameById.get(pid) || 'Producto personal'
      totalConsumos += 1
      totalQty += qty

      const recipeId = recipeByPersonalId.get(pid)
      const costPerPortion = recipeId != null ? costPerPortionByRecipe.get(recipeId) : undefined
      const costed = costPerPortion != null && costPerPortion > 0
      const lineCost = costed ? costPerPortion! * qty : 0

      const entry = byProduct.get(pid) ?? {
        fudo_product_id: pid,
        name,
        times: 0,
        qty: 0,
        cost_total: costed ? 0 : null,
        costed,
      }
      entry.times += 1
      entry.qty += qty
      if (costed) {
        entry.cost_total = (entry.cost_total ?? 0) + lineCost
        entry.costed = true
      }
      byProduct.set(pid, entry)

      if (costed) {
        totalCost += lineCost
        const d = argDate(s.sold_at)
        dailyMap.set(d, (dailyMap.get(d) ?? 0) + lineCost)
      } else {
        sinCosteo += 1
      }
    }

    const products = [...byProduct.values()]
      .map((p) => ({
        ...p,
        qty: Math.round(p.qty * 100) / 100,
        cost_total: p.cost_total != null ? Math.round(p.cost_total) : null,
      }))
      .sort((a, b) => (b.cost_total ?? 0) - (a.cost_total ?? 0) || b.times - a.times)

    // Serie diaria completa (rellenar días sin consumo con 0)
    const daily: DailyPoint[] = []
    const cursor = new Date(cutoff)
    const end = new Date()
    while (cursor <= end) {
      const d = cursor.toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
      daily.push({ date: d, cost: Math.round(dailyMap.get(d) ?? 0) })
      cursor.setDate(cursor.getDate() + 1)
    }

    const payload: Payload = {
      days,
      from,
      to,
      total_cost: Math.round(totalCost),
      total_consumos: totalConsumos,
      total_qty: Math.round(totalQty * 100) / 100,
      sin_costeo: sinCosteo,
      products,
      daily,
    }

    return NextResponse.json(payload)
  } catch (err) {
    console.error('[GET /api/personal/consumo]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
