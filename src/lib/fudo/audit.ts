import { SupabaseClient } from '@supabase/supabase-js'
import { fudo, type FudoIngredient, type FudoProduct } from '@/lib/fudoClient'
import {
  incidentKey,
  recordFudoIncident,
  resolveMissingFudoIncidents,
  type FudoIncidentSeverity,
} from '@/lib/fudo/sync-events'

type StockItemAuditRow = {
  id: string
  name: string
  unit: string
  current_qty: number
  fudo_ingredient_id: string | null
  fudo_product_id: string | null
  fudo_skip: boolean
  is_active: boolean
}

type MenuItemAuditRow = {
  id: string
  name: string
  fudo_product_id: string | null
  sale_price: number | null
  is_active: boolean
}

type SupplierAuditRow = {
  id: string
  name: string
  fudo_provider_id: string | null
}

type FudoProvider = {
  id: string
  name?: string
}

export type FudoStockIssueCode =
  | 'fudo_product_missing'
  | 'fudo_ingredient_missing'
  | 'product_stock_null'
  | 'ingredient_stock_null'
  | 'product_stockControl_false'
  | 'ingredient_stockControl_false'
  | 'stock_mismatch_ge_1'
  | 'name_mismatch'
  | 'unit_suspect_fractional_unit'

export type FudoStockIssue = {
  id: string
  name: string
  current_qty: number
  fudo_product_id: string | null
  fudo_ingredient_id: string | null
  fudo_name: string | null
  fudo_stock: number | null
  source: 'product' | 'ingredient' | null
  issues: FudoStockIssueCode[]
}

export type FudoMenuIssue = {
  id: string
  name: string
  fudo_product_id: string
  fudo_name: string | null
  app_price: number | null
  fudo_price: number | null
  issues: Array<'name_mismatch' | 'price_mismatch' | 'active_mismatch'>
}

export type FudoSupplierIssue = {
  id: string
  name: string
  fudo_provider_id: string
  fudo_name: string | null
  issues: Array<'provider_missing' | 'name_mismatch'>
}

export type FudoDuplicateLink = {
  id: string
  names: string[]
}

export type FudoMissingItem = {
  id: string
  name: string | null
  stock: number | null
  stockControl: boolean | null
}

export type FudoAuditReport = {
  generatedAt: string
  summary: {
    stock_items_total: number
    stock_items_linked: number
    stock_items_unlinked: number
    stock_issues: number
    severe_stock_issues: number
    menu_issues: number
    supplier_issues: number
    missing_stock_controlled_products_in_app: number
    missing_stock_controlled_ingredients_in_app: number
    duplicate_product_links: number
    duplicate_ingredient_links: number
  }
  issueCounts: Partial<Record<FudoStockIssueCode, number>>
  stockIssues: FudoStockIssue[]
  severeStockIssues: FudoStockIssue[]
  duplicateProductLinks: FudoDuplicateLink[]
  duplicateIngredientLinks: FudoDuplicateLink[]
  menuIssues: FudoMenuIssue[]
  supplierIssues: FudoSupplierIssue[]
  missingStockControlledProducts: FudoMissingItem[]
  missingStockControlledIngredients: FudoMissingItem[]
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function incrementIssueCount(
  issueCounts: Partial<Record<FudoStockIssueCode, number>>,
  issues: FudoStockIssueCode[],
) {
  for (const issue of issues) {
    issueCounts[issue] = (issueCounts[issue] ?? 0) + 1
  }
}

function findDuplicateLinks(
  items: Array<{ name: string; fudoId: string | null }>,
): FudoDuplicateLink[] {
  const grouped = new Map<string, string[]>()

  for (const item of items) {
    if (!item.fudoId) continue
    const names = grouped.get(item.fudoId) ?? []
    names.push(item.name)
    grouped.set(item.fudoId, names)
  }

  return [...grouped.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([id, names]) => ({ id, names }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function isSevereIssue(issue: FudoStockIssue) {
  return issue.issues.some((code) => (
    code === 'fudo_product_missing'
      || code === 'fudo_ingredient_missing'
      || code === 'product_stock_null'
      || code === 'ingredient_stock_null'
      || code === 'product_stockControl_false'
      || code === 'ingredient_stockControl_false'
      || code === 'stock_mismatch_ge_1'
  ))
}

function stockIssueSeverity(code: FudoStockIssueCode): FudoIncidentSeverity {
  // 'critical' está reservado para fallos reales de Fudo (transporte, auth, escritura
  // rechazada). Las discrepancias de auditoría — incluyendo stock_mismatch_ge_1 que
  // ocurre continuamente porque Fudo descuenta ventas y LVE no — son informacionales.
  // Un incident crítico de audit bloquea TODO el conteo físico, lo cual es incorrecto.
  if (code === 'fudo_product_missing' || code === 'fudo_ingredient_missing') {
    // Vínculo roto: ese item específico no puede sincronizarse, pero no bloquear el resto.
    return 'high'
  }
  return 'medium'
}

export async function runFudoAudit(admin: SupabaseClient): Promise<FudoAuditReport> {
  const [stockItems, menuItems, suppliers, fudoProducts, fudoIngredients, fudoProviders] = await Promise.all([
    admin
      .from('stock_items')
      .select('id, name, unit, current_qty, fudo_ingredient_id, fudo_product_id, fudo_skip, is_active'),
    admin
      .from('menu_items')
      .select('id, name, fudo_product_id, sale_price, is_active'),
    admin
      .from('suppliers')
      .select('id, name, fudo_provider_id'),
    fudo.getProducts(),
    fudo.getIngredients(),
    fudo.fetchAll<FudoProvider>('/providers'),
  ])

  const stockRows = (stockItems.data ?? []) as unknown as StockItemAuditRow[]
  const menuRows = (menuItems.data ?? []) as unknown as MenuItemAuditRow[]
  const supplierRows = (suppliers.data ?? []) as unknown as SupplierAuditRow[]

  const productMap = new Map<string, FudoProduct>(
    fudoProducts.map((product) => [String(product.id), product]),
  )
  const ingredientMap = new Map<string, FudoIngredient>(
    fudoIngredients.map((ingredient) => [String(ingredient.id), ingredient]),
  )
  const providerMap = new Map<string, FudoProvider>(
    fudoProviders.map((provider) => [String(provider.id), provider]),
  )

  const linkedStock = stockRows.filter((item) => item.fudo_ingredient_id || item.fudo_product_id)
  const unlinkedStock = stockRows.filter((item) => (
    !item.fudo_ingredient_id
    && !item.fudo_product_id
    && !item.fudo_skip
  ))

  const issueCounts: Partial<Record<FudoStockIssueCode, number>> = {}
  const stockIssues: FudoStockIssue[] = []

  for (const item of linkedStock) {
    const issues: FudoStockIssueCode[] = []
    let fudoName: string | null = null
    let fudoStock: number | null = null
    let source: 'product' | 'ingredient' | null = null

    if (item.fudo_product_id) {
      const product = productMap.get(String(item.fudo_product_id))
      if (!product) {
        issues.push('fudo_product_missing')
      } else {
        source = 'product'
        fudoName = product.name ?? null
        fudoStock = toNullableNumber(product.stock)

        if (product.stockControl !== true) issues.push('product_stockControl_false')
        if (fudoStock === null) issues.push('product_stock_null')
        if (typeof fudoStock === 'number' && Math.abs(item.current_qty - fudoStock) >= 1) {
          issues.push('stock_mismatch_ge_1')
        }
      }
    }

    if (item.fudo_ingredient_id) {
      const ingredient = ingredientMap.get(String(item.fudo_ingredient_id))
      if (!ingredient) {
        issues.push('fudo_ingredient_missing')
      } else {
        if (!source) {
          source = 'ingredient'
          fudoName = ingredient.name ?? null
          fudoStock = toNullableNumber(ingredient.stock)
        }

        if (ingredient.stockControl !== true) issues.push('ingredient_stockControl_false')
        if (!item.fudo_product_id) {
          const ingredientStock = toNullableNumber(ingredient.stock)
          if (ingredientStock === null) issues.push('ingredient_stock_null')
          if (typeof ingredientStock === 'number' && Math.abs(item.current_qty - ingredientStock) >= 1) {
            issues.push('stock_mismatch_ge_1')
          }
        }
      }
    }

    if (fudoName && normalizeName(fudoName) !== normalizeName(item.name)) {
      issues.push('name_mismatch')
    }

    if (
      item.fudo_ingredient_id
      && !item.fudo_product_id
      && normalizeName(item.unit) === 'unidad'
      && Math.abs(item.current_qty - Math.round(item.current_qty)) >= 0.01
    ) {
      issues.push('unit_suspect_fractional_unit')
    }

    if (issues.length === 0) continue

    incrementIssueCount(issueCounts, issues)
    stockIssues.push({
      id: item.id,
      name: item.name,
      current_qty: item.current_qty,
      fudo_product_id: item.fudo_product_id,
      fudo_ingredient_id: item.fudo_ingredient_id,
      fudo_name: fudoName,
      fudo_stock: fudoStock,
      source,
      issues,
    })
  }

  stockIssues.sort((a, b) => a.name.localeCompare(b.name))

  const duplicateProductLinks = findDuplicateLinks(
    stockRows.map((item) => ({ name: item.name, fudoId: item.fudo_product_id })),
  )
  const duplicateIngredientLinks = findDuplicateLinks(
    stockRows.map((item) => ({ name: item.name, fudoId: item.fudo_ingredient_id })),
  )

  const appProductIds = new Set(
    stockRows
      .map((item) => item.fudo_product_id)
      .filter((id): id is string => Boolean(id)),
  )
  const appIngredientIds = new Set(
    stockRows
      .map((item) => item.fudo_ingredient_id)
      .filter((id): id is string => Boolean(id)),
  )

  // Los platos del menú (Cortado, Wraps…) tienen control de stock en Fudo por
  // su receta: ya están en LVE como menu_items, no son insumos sin vincular.
  const menuProductIds = new Set(
    menuRows
      .map((item) => item.fudo_product_id)
      .filter((id): id is string => Boolean(id))
      .map(String),
  )
  const missingStockControlledProducts = fudoProducts
    .filter((product) => product.active && product.stockControl === true)
    .filter((product) => !appProductIds.has(String(product.id)) && !menuProductIds.has(String(product.id)))
    .map((product) => ({
      id: String(product.id),
      name: product.name ?? null,
      stock: toNullableNumber(product.stock),
      stockControl: product.stockControl ?? null,
    }))

  const missingStockControlledIngredients = fudoIngredients
    .filter((ingredient) => ingredient.stockControl === true)
    .filter((ingredient) => !appIngredientIds.has(String(ingredient.id)))
    .map((ingredient) => ({
      id: String(ingredient.id),
      name: ingredient.name ?? null,
      stock: toNullableNumber(ingredient.stock),
      stockControl: ingredient.stockControl ?? null,
    }))

  const menuIssues: FudoMenuIssue[] = []
  const menuByProductId = new Map(
    menuRows
      .filter((item) => item.fudo_product_id)
      .map((item) => [String(item.fudo_product_id), item]),
  )

  for (const product of fudoProducts.filter((item) => item.active)) {
    const menuItem = menuByProductId.get(String(product.id))
    if (!menuItem) continue

    const issues: FudoMenuIssue['issues'] = []

    if (normalizeName(menuItem.name) !== normalizeName(product.name)) {
      issues.push('name_mismatch')
    }
    if (Number(menuItem.sale_price ?? 0) !== Number(product.price ?? 0)) {
      issues.push('price_mismatch')
    }
    if (Boolean(menuItem.is_active) !== Boolean(product.active)) {
      issues.push('active_mismatch')
    }

    if (issues.length === 0) continue

    menuIssues.push({
      id: menuItem.id,
      name: menuItem.name,
      fudo_product_id: String(menuItem.fudo_product_id),
      fudo_name: product.name ?? null,
      app_price: menuItem.sale_price,
      fudo_price: product.price ?? null,
      issues,
    })
  }

  menuIssues.sort((a, b) => a.name.localeCompare(b.name))

  const supplierIssues: FudoSupplierIssue[] = []

  for (const supplier of supplierRows.filter((item) => item.fudo_provider_id)) {
    const provider = providerMap.get(String(supplier.fudo_provider_id))
    if (!provider) {
      supplierIssues.push({
        id: supplier.id,
        name: supplier.name,
        fudo_provider_id: String(supplier.fudo_provider_id),
        fudo_name: null,
        issues: ['provider_missing'],
      })
      continue
    }

    if (normalizeName(supplier.name) === normalizeName(provider.name)) continue

    supplierIssues.push({
      id: supplier.id,
      name: supplier.name,
      fudo_provider_id: String(supplier.fudo_provider_id),
      fudo_name: provider.name ?? null,
      issues: ['name_mismatch'],
    })
  }

  supplierIssues.sort((a, b) => a.name.localeCompare(b.name))

  const severeStockIssues = stockIssues.filter(isSevereIssue)
  const activeIncidentKeys = new Set<string>()

  for (const issue of stockIssues) {
    for (const code of issue.issues) {
      const fudoType = issue.source ?? (issue.fudo_product_id ? 'product' : issue.fudo_ingredient_id ? 'ingredient' : null)
      const fudoId = issue.fudo_product_id ?? issue.fudo_ingredient_id
      const key = incidentKey({
        source: 'audit',
        code,
        entity_type: 'stock_item',
        entity_id: issue.id,
        stock_item_id: issue.id,
        fudo_type: fudoType,
        fudo_id: fudoId,
      })
      activeIncidentKeys.add(key)
      await recordFudoIncident(admin, {
        source: 'audit',
        code,
        severity: stockIssueSeverity(code),
        entityType: 'stock_item',
        entityId: issue.id,
        stockItemId: issue.id,
        fudoType,
        fudoId,
        title: `${issue.name}: ${code}`,
        detail: issue.fudo_name
          ? `LVE: ${issue.current_qty}; Fudo ${issue.fudo_name}: ${issue.fudo_stock ?? 'sin stock'}`
          : `LVE: ${issue.current_qty}; Fudo no disponible`,
        payload: issue as unknown as Record<string, unknown>,
      })
    }
  }

  for (const duplicate of duplicateProductLinks) {
    const key = incidentKey({
      source: 'audit',
      code: 'duplicate_product_link',
      entity_type: 'fudo_product',
      entity_id: duplicate.id,
      fudo_type: 'product',
      fudo_id: duplicate.id,
    })
    activeIncidentKeys.add(key)
    await recordFudoIncident(admin, {
      source: 'audit',
      code: 'duplicate_product_link',
      severity: 'critical',
      entityType: 'fudo_product',
      entityId: duplicate.id,
      fudoType: 'product',
      fudoId: duplicate.id,
      title: `Producto Fudo duplicado en LVE: ${duplicate.id}`,
      detail: duplicate.names.join(', '),
      payload: { names: duplicate.names },
    })
  }

  for (const duplicate of duplicateIngredientLinks) {
    const key = incidentKey({
      source: 'audit',
      code: 'duplicate_ingredient_link',
      entity_type: 'fudo_ingredient',
      entity_id: duplicate.id,
      fudo_type: 'ingredient',
      fudo_id: duplicate.id,
    })
    activeIncidentKeys.add(key)
    await recordFudoIncident(admin, {
      source: 'audit',
      code: 'duplicate_ingredient_link',
      severity: 'critical',
      entityType: 'fudo_ingredient',
      entityId: duplicate.id,
      fudoType: 'ingredient',
      fudoId: duplicate.id,
      title: `Insumo Fudo duplicado en LVE: ${duplicate.id}`,
      detail: duplicate.names.join(', '),
      payload: { names: duplicate.names },
    })
  }

  for (const item of missingStockControlledProducts) {
    const key = incidentKey({
      source: 'audit',
      code: 'missing_stock_controlled_product_in_lve',
      entity_type: 'fudo_product',
      entity_id: item.id,
      fudo_type: 'product',
      fudo_id: item.id,
    })
    activeIncidentKeys.add(key)
    await recordFudoIncident(admin, {
      source: 'audit',
      code: 'missing_stock_controlled_product_in_lve',
      severity: 'high',
      entityType: 'fudo_product',
      entityId: item.id,
      fudoType: 'product',
      fudoId: item.id,
      title: `Producto Fudo con stock sin item LVE: ${item.name ?? item.id}`,
      detail: `Stock Fudo: ${item.stock ?? 'sin valor'}`,
      payload: item,
    })
  }

  for (const item of missingStockControlledIngredients) {
    const key = incidentKey({
      source: 'audit',
      code: 'missing_stock_controlled_ingredient_in_lve',
      entity_type: 'fudo_ingredient',
      entity_id: item.id,
      fudo_type: 'ingredient',
      fudo_id: item.id,
    })
    activeIncidentKeys.add(key)
    await recordFudoIncident(admin, {
      source: 'audit',
      code: 'missing_stock_controlled_ingredient_in_lve',
      severity: 'high',
      entityType: 'fudo_ingredient',
      entityId: item.id,
      fudoType: 'ingredient',
      fudoId: item.id,
      title: `Insumo Fudo con stock sin item LVE: ${item.name ?? item.id}`,
      detail: `Stock Fudo: ${item.stock ?? 'sin valor'}`,
      payload: item,
    })
  }

  for (const issue of menuIssues) {
    for (const code of issue.issues) {
      const key = incidentKey({
        source: 'audit',
        code: `menu_${code}`,
        entity_type: 'menu_item',
        entity_id: issue.id,
        fudo_type: 'product',
        fudo_id: issue.fudo_product_id,
      })
      activeIncidentKeys.add(key)
      await recordFudoIncident(admin, {
        source: 'audit',
        code: `menu_${code}`,
        severity: code === 'price_mismatch' ? 'high' : 'medium',
        entityType: 'menu_item',
        entityId: issue.id,
        fudoType: 'product',
        fudoId: issue.fudo_product_id,
        title: `${issue.name}: ${code}`,
        detail: issue.fudo_name ?? null,
        payload: issue as unknown as Record<string, unknown>,
      })
    }
  }

  for (const issue of supplierIssues) {
    for (const code of issue.issues) {
      const key = incidentKey({
        source: 'audit',
        code: `supplier_${code}`,
        entity_type: 'supplier',
        entity_id: issue.id,
        fudo_type: 'provider',
        fudo_id: issue.fudo_provider_id,
      })
      activeIncidentKeys.add(key)
      await recordFudoIncident(admin, {
        source: 'audit',
        code: `supplier_${code}`,
        severity: code === 'provider_missing' ? 'high' : 'medium',
        entityType: 'supplier',
        entityId: issue.id,
        fudoType: 'provider',
        fudoId: issue.fudo_provider_id,
        title: `${issue.name}: ${code}`,
        detail: issue.fudo_name ?? null,
        payload: issue as unknown as Record<string, unknown>,
      })
    }
  }

  await resolveMissingFudoIncidents(admin, 'audit', activeIncidentKeys)

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      stock_items_total: stockRows.length,
      stock_items_linked: linkedStock.length,
      stock_items_unlinked: unlinkedStock.length,
      stock_issues: stockIssues.length,
      severe_stock_issues: severeStockIssues.length,
      menu_issues: menuIssues.length,
      supplier_issues: supplierIssues.length,
      missing_stock_controlled_products_in_app: missingStockControlledProducts.length,
      missing_stock_controlled_ingredients_in_app: missingStockControlledIngredients.length,
      duplicate_product_links: duplicateProductLinks.length,
      duplicate_ingredient_links: duplicateIngredientLinks.length,
    },
    issueCounts,
    stockIssues,
    severeStockIssues,
    duplicateProductLinks,
    duplicateIngredientLinks,
    menuIssues,
    supplierIssues,
    missingStockControlledProducts,
    missingStockControlledIngredients,
  }
}
