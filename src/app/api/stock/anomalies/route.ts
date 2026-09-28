import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import type {
  StockAnomaliesResponse,
  StockAnomalyAction,
  StockAnomalyItem,
  StockAnomalySeverity,
  StockAnomalySourceKind,
} from '@/lib/contracts/stock-anomalies'

type IncidentRow = {
  id: string
  code: string
  severity: StockAnomalySeverity
  title: string
  detail: string | null
  entity_type: string | null
  entity_id: string | null
  stock_item_id: string | null
  fudo_type: string | null
  fudo_id: string | null
  last_seen_at: string
  payload: Record<string, unknown> | null
}

type StockItemRow = {
  id: string
  name: string
  current_qty: number
  min_qty: number
  unit: string
  fudo_product_id: string | null
  fudo_ingredient_id: string | null
  fudo_skip: boolean | null
}

type RecipeIngredientRow = {
  stock_item_id: string
  recipes: { name: string } | { name: string }[] | null
}

type PendingRecipeLinkRow = {
  recipe_id: string | null
  recipe_name: string | null
  ingredient_name: string
}

type IncidentGroup = {
  key: string
  incidents: IncidentRow[]
}

const MAP_CODES = new Set([
  'duplicate_product_link',
  'duplicate_ingredient_link',
  'missing_stock_controlled_product_in_lve',
  'missing_stock_controlled_ingredient_in_lve',
  'fudo_product_missing',
  'fudo_ingredient_missing',
  'product_stock_null',
  'ingredient_stock_null',
  'product_stockControl_false',
  'ingredient_stockControl_false',
  'name_mismatch',
  'unit_suspect_fractional_unit',
])

const COUNT_CODES = new Set([
  'stock_mismatch_ge_1',
])

const SYNC_CODES = new Set([
  'fudo_read_failed',
  'fudo_write_failed',
  'fudo_write_verification_failed',
  'fudo_write_exception',
  'fudo_product_write_verification_failed',
  'fudo_product_write_exception',
  'lve_update_after_fudo_failed',
])

const RELEVANT_ENTITY_TYPES = new Set([
  'stock',
  'stock_item',
  'fudo_product',
  'fudo_ingredient',
])

function severityWeight(value: StockAnomalySeverity) {
  if (value === 'critical') return 0
  if (value === 'high') return 1
  return 2
}

function unique<T>(values: T[]) {
  return [...new Set(values)]
}

function formatQty(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (Number.isInteger(value)) return String(value)
  return value.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

function getSourceKind(item: StockItemRow | null): StockAnomalySourceKind {
  if (!item) return null
  if (item.fudo_product_id || item.fudo_ingredient_id) return 'fudo'
  if (item.fudo_skip === true) return 'local'
  return 'unmapped'
}

function getRecipeNames(rows: RecipeIngredientRow[] | undefined) {
  if (!rows?.length) return []

  return unique(
    rows.flatMap((row) => {
      if (!row.recipes) return []
      if (Array.isArray(row.recipes)) {
        return row.recipes.map((recipe) => recipe.name).filter(Boolean)
      }
      return row.recipes.name ? [row.recipes.name] : []
    }),
  )
}

function summarizeRecipeNames(recipeNames: string[]) {
  if (recipeNames.length <= 2) return recipeNames.join(', ')
  return `${recipeNames.slice(0, 2).join(', ')} y ${recipeNames.length - 2} más`
}

function isRelevantIncident(row: IncidentRow) {
  if (row.code.startsWith('menu_')) return false
  if (row.code.startsWith('supplier_')) return false
  if (row.code.startsWith('fudo_sales_import')) return false
  return Boolean(row.stock_item_id) || RELEVANT_ENTITY_TYPES.has(row.entity_type ?? '')
}

function groupKey(row: IncidentRow) {
  return row.stock_item_id
    ?? [row.code, row.entity_type ?? '', row.entity_id ?? '', row.fudo_type ?? '', row.fudo_id ?? ''].join(':')
}

function pickSeverity(group: IncidentGroup): StockAnomalySeverity {
  return [...group.incidents]
    .sort((a, b) => severityWeight(a.severity) - severityWeight(b.severity))[0].severity
}

function pickCodes(group: IncidentGroup) {
  return unique(group.incidents.map((incident) => incident.code))
}

function pickPrimaryAction(codes: string[]): {
  action: StockAnomalyAction
  label: string
  href: string | null
} {
  if (codes.some((code) => COUNT_CODES.has(code))) {
    return { action: 'count', label: 'Contar ahora', href: null }
  }
  if (codes.some((code) => MAP_CODES.has(code))) {
    return { action: 'map', label: 'Revisar vínculo', href: '/admin/stock/mapeo' }
  }
  if (codes.some((code) => SYNC_CODES.has(code))) {
    return { action: 'sync', label: 'Traer Fudo', href: null }
  }
  return { action: 'map', label: 'Revisar vínculo', href: '/admin/stock/mapeo' }
}

function incidentLabel(group: IncidentGroup, item: StockItemRow | null) {
  const first = group.incidents[0]
  const payload = first.payload ?? {}

  if (item?.name) return item.name
  if (typeof payload.name === 'string' && payload.name.trim()) return payload.name
  if (typeof payload.fudo_name === 'string' && payload.fudo_name.trim()) return payload.fudo_name
  if (first.entity_type === 'stock') return 'Sincronización Fudo'
  return first.title
}

function buildTitle(group: IncidentGroup, item: StockItemRow | null) {
  const codes = pickCodes(group)
  const label = incidentLabel(group, item)

  if (codes.some((code) => code === 'duplicate_product_link' || code === 'duplicate_ingredient_link')) {
    return `${label}: vínculo Fudo duplicado`
  }
  if (codes.some((code) => code === 'missing_stock_controlled_product_in_lve' || code === 'missing_stock_controlled_ingredient_in_lve')) {
    return `${label}: existe en Fudo pero falta en LVE`
  }
  if (codes.some((code) => code === 'fudo_product_missing' || code === 'fudo_ingredient_missing')) {
    return `${label}: vínculo Fudo roto`
  }
  if (codes.includes('stock_mismatch_ge_1')) {
    return `${label}: diferencia LVE ↔ Fudo`
  }
  if (codes.some((code) => code === 'product_stock_null' || code === 'ingredient_stock_null' || code === 'product_stockControl_false' || code === 'ingredient_stockControl_false')) {
    return `${label}: Fudo no está listo para sincronizar`
  }
  if (codes.some((code) => SYNC_CODES.has(code))) {
    return `${label}: Fudo no confirmó el stock`
  }
  if (codes.some((code) => code === 'name_mismatch' || code === 'unit_suspect_fractional_unit')) {
    return `${label}: revisar mapeo`
  }

  return group.incidents[0].title
}

function buildDetail(group: IncidentGroup, item: StockItemRow | null, recipeNames: string[]) {
  const codes = pickCodes(group)
  const payload = group.incidents[0].payload ?? {}
  const parts: string[] = []

  if (codes.includes('stock_mismatch_ge_1')) {
    const fudoStock = typeof payload.fudo_stock === 'number' ? payload.fudo_stock : null
    if (item && fudoStock !== null) {
      parts.push(`LVE marca ${formatQty(item.current_qty)} ${item.unit} y Fudo ${formatQty(fudoStock)}.`)
    } else {
      parts.push('La cantidad guardada en LVE no coincide con la que devuelve Fudo.')
    }
  }

  if (codes.some((code) => code === 'duplicate_product_link' || code === 'duplicate_ingredient_link')) {
    parts.push('Un mismo ID de Fudo quedó asociado más de una vez y puede pisar stock incorrecto.')
  }

  if (codes.some((code) => code === 'missing_stock_controlled_product_in_lve' || code === 'missing_stock_controlled_ingredient_in_lve')) {
    parts.push('Fudo tiene control de stock activo para este item, pero no existe un item equivalente activo en LVE.')
  }

  if (codes.some((code) => code === 'fudo_product_missing' || code === 'fudo_ingredient_missing')) {
    parts.push('El ID guardado en LVE ya no existe o dejó de responder en Fudo.')
  }

  if (codes.some((code) => code === 'product_stock_null' || code === 'ingredient_stock_null')) {
    parts.push('Fudo devolvió stock nulo para este vínculo.')
  }

  if (codes.some((code) => code === 'product_stockControl_false' || code === 'ingredient_stockControl_false')) {
    parts.push('Fudo tiene apagado el control de stock para este vínculo.')
  }

  if (codes.includes('name_mismatch')) {
    parts.push('El nombre en LVE no coincide con el nombre en Fudo.')
  }

  if (codes.includes('unit_suspect_fractional_unit')) {
    parts.push('Está en unidad pero con stock fraccionado; probablemente el vínculo o la unidad están mal.')
  }

  if (codes.some((code) => SYNC_CODES.has(code)) && group.incidents[0].detail) {
    parts.push(group.incidents[0].detail)
  }

  if (recipeNames.length > 0) {
    parts.push(`Afecta ${recipeNames.length} receta${recipeNames.length === 1 ? '' : 's'}: ${summarizeRecipeNames(recipeNames)}.`)
  }

  return parts.filter(Boolean).slice(0, 3).join(' ')
}

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!isManagerOrAbove(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const admin = createAdminClient()

    const [incidentsRes, pendingLinksRes] = await Promise.all([
      admin
        .from('fudo_sync_incidents')
        .select('id, code, severity, title, detail, entity_type, entity_id, stock_item_id, fudo_type, fudo_id, last_seen_at, payload')
        .eq('status', 'open')
        .order('last_seen_at', { ascending: false })
        .limit(60),
      admin
        .from('recipe_ingredient_pending_links')
        .select('recipe_id, recipe_name, ingredient_name')
        .eq('status', 'pending')
        .order('recipe_name', { ascending: true }),
    ])

    if (incidentsRes.error) throw incidentsRes.error
    if (pendingLinksRes.error) throw pendingLinksRes.error

    const relevantIncidents = ((incidentsRes.data ?? []) as IncidentRow[])
      .filter(isRelevantIncident)

    const grouped = new Map<string, IncidentGroup>()
    for (const incident of relevantIncidents) {
      const key = groupKey(incident)
      const group = grouped.get(key)
      if (group) {
        group.incidents.push(incident)
      } else {
        grouped.set(key, { key, incidents: [incident] })
      }
    }

    const stockItemIds = unique(
      [...grouped.values()]
        .map((group) => group.incidents[0].stock_item_id)
        .filter((value): value is string => Boolean(value)),
    )

    const [stockItemsRes, recipeIngredientsRes] = await Promise.all([
      stockItemIds.length > 0
        ? admin
          .from('stock_items')
          .select('id, name, current_qty, min_qty, unit, fudo_product_id, fudo_ingredient_id, fudo_skip')
          .in('id', stockItemIds)
        : Promise.resolve({ data: [], error: null }),
      stockItemIds.length > 0
        ? admin
          .from('recipe_ingredients')
          .select('stock_item_id, recipes(name)')
          .in('stock_item_id', stockItemIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (stockItemsRes.error) throw stockItemsRes.error
    if (recipeIngredientsRes.error) throw recipeIngredientsRes.error

    const stockItemsById = new Map(
      ((stockItemsRes.data ?? []) as StockItemRow[]).map((item) => [item.id, item]),
    )
    const recipesByStockItem = new Map<string, RecipeIngredientRow[]>()
    for (const row of (recipeIngredientsRes.data ?? []) as RecipeIngredientRow[]) {
      const current = recipesByStockItem.get(row.stock_item_id) ?? []
      current.push(row)
      recipesByStockItem.set(row.stock_item_id, current)
    }

    const items: StockAnomalyItem[] = [...grouped.values()]
      .map((group) => {
        group.incidents.sort((a, b) => severityWeight(a.severity) - severityWeight(b.severity))

        const first = group.incidents[0]
        const item = first.stock_item_id ? stockItemsById.get(first.stock_item_id) ?? null : null
        const recipeNames = item ? getRecipeNames(recipesByStockItem.get(item.id)) : []
        const codes = pickCodes(group)
        const action = pickPrimaryAction(codes)

        return {
          id: group.key,
          source: 'fudo',
          code: codes[0],
          severity: pickSeverity(group),
          title: buildTitle(group, item),
          detail: buildDetail(group, item, recipeNames),
          primary_action: action.action,
          action_label: action.label,
          action_href: action.href,
          stock_item_id: item?.id ?? first.stock_item_id ?? null,
          stock_item_name: item?.name ?? null,
          current_qty: item?.current_qty ?? null,
          min_qty: item?.min_qty ?? null,
          unit: item?.unit ?? null,
          source_kind: getSourceKind(item),
          recipe_count: recipeNames.length,
          recipe_names: recipeNames,
          fudo_type: first.fudo_type,
          fudo_id: first.fudo_id,
          last_seen_at: first.last_seen_at ?? null,
        } satisfies StockAnomalyItem
      })

    const pendingLinks = (pendingLinksRes.data ?? []) as PendingRecipeLinkRow[]
    if (pendingLinks.length > 0) {
      const groupedByRecipe = new Map<string, PendingRecipeLinkRow[]>()
      for (const row of pendingLinks) {
        const key = row.recipe_id ?? row.recipe_name ?? 'sin_receta'
        const bucket = groupedByRecipe.get(key) ?? []
        bucket.push(row)
        groupedByRecipe.set(key, bucket)
      }

      const recipeNames = [...groupedByRecipe.values()]
        .sort((a, b) => b.length - a.length)
        .slice(0, 3)
        .map((rows) => rows[0].recipe_name)
        .filter((value): value is string => Boolean(value))

      items.push({
        id: 'recipes:pending_links',
        source: 'recipes',
        code: 'recipe_links_pending',
        severity: pendingLinks.length >= 8 ? 'high' : 'medium',
        title: `${pendingLinks.length} materias primas sin vincular al stock`,
        detail: `Hay ${groupedByRecipe.size} receta${groupedByRecipe.size === 1 ? '' : 's'} que todavía no descuentan bien. ${recipeNames.length > 0 ? `Las más afectadas: ${summarizeRecipeNames(recipeNames)}.` : ''}`.trim(),
        primary_action: 'pending_links',
        action_label: 'Vincular recetas',
        action_href: '/admin/recetas/pending',
        stock_item_id: null,
        stock_item_name: null,
        current_qty: null,
        min_qty: null,
        unit: null,
        source_kind: null,
        recipe_count: groupedByRecipe.size,
        recipe_names: recipeNames,
        fudo_type: null,
        fudo_id: null,
        last_seen_at: null,
      })
    }

    items.sort((a, b) => {
      const severityDiff = severityWeight(a.severity) - severityWeight(b.severity)
      if (severityDiff !== 0) return severityDiff
      return (a.stock_item_name ?? a.title).localeCompare(b.stock_item_name ?? b.title)
    })

    const response: StockAnomaliesResponse = {
      summary: {
        total: items.length,
        critical: items.filter((item) => item.severity === 'critical').length,
        high: items.filter((item) => item.severity === 'high').length,
        medium: items.filter((item) => item.severity === 'medium').length,
        items_blocked: items.filter((item) => item.stock_item_id).length,
        pending_recipe_links: pendingLinks.length,
        requires_sync: items.some((item) => item.primary_action === 'sync'),
        requires_mapping: items.some((item) => item.primary_action === 'map' || item.primary_action === 'pending_links'),
      },
      items: items.slice(0, 16),
      generated_at: new Date().toISOString(),
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[GET /api/stock/anomalies]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
