import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  deriveSector,
  getOverstockThreshold,
  getPromoTitle,
  guessCategoryForFinishedGood,
  guessShelfLifeDays,
  isFinishedGood,
  isPerishableCandidate,
  STOCK_SECTOR_META,
  type StockConfidence,
  type StockIntelligenceResponse,
  type StockPriority,
  type StockSector,
  type StockSectorAction,
  type StockSetupIssue,
} from '@/lib/stock/intelligence'
import type { StockCategoryValue } from '@/types/database'

/** Formato es-AR consistente para cantidades en textos (12.000000001 → "12"). */
function fmtQty(value: number | null | undefined): string {
  const num = Number(value ?? 0)
  if (!Number.isFinite(num)) return '0'
  return num.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

type StockRow = {
  id: string
  name: string
  category: StockCategoryValue
  unit: string
  current_qty: number
  min_qty: number
  cost_per_unit: number | null
  shelf_life_days: number | null
  notes: string | null
  updated_at: string
  fudo_product_id: string | null
  fudo_ingredient_id: string | null
  fudo_skip: boolean | null
}

type MenuRow = {
  id: string
  name: string
  category: string | null
  menu_category_id: number | null
  recipe_id: string | null
  fudo_product_id: string | null
  is_active: boolean
}

type MenuCategoryRow = {
  id: number
  name: string
}

type FudoSaleRow = {
  fudo_product_id: string
  quantity: number
}

type StockLotRow = {
  stock_item_id: string | number
  qty_remaining: number
  expires_at: string | null
  status: string
}

type StockAnomalyDecisionRow = {
  id: string
  issue_key: string
  stock_item_id: string | number
  issue_type: StockSetupIssue['type']
  decision: 'confirmed_ok' | 'snoozed' | 'rule_created' | 'fix_fudo' | 'fix_lve'
  note: string | null
  snapshot: Record<string, unknown> | null
  snoozed_until: string | null
  created_at: string
}

type StockAnomalyRuleRow = {
  id: string
  stock_item_id: string | number | null
  issue_type: StockSetupIssue['type'] | null
  name_pattern: string | null
  category: StockCategoryValue | null
  unit: string | null
  min_qty: number | null
  max_qty: number | null
  notify_enabled: boolean
  notification_priority: 'baja' | 'media' | 'alta' | 'critica'
  last_notified_at: string | null
  created_from_issue_key: string | null
  note: string | null
  is_active: boolean
}

function priorityWeight(priority: StockPriority) {
  if (priority === 'high') return 0
  if (priority === 'medium') return 1
  return 2
}

function createAction(input: Omit<StockSectorAction, 'id'>): StockSectorAction {
  return {
    id: `${input.kind}:${input.stock_item_id}:${input.sector}`,
    ...input,
  }
}

function createSetupIssue(input: Omit<StockSetupIssue, 'id'>): StockSetupIssue {
  return {
    id: `${input.type}:${input.stock_item_id}`,
    ...input,
  }
}

function getIssueKey(issue: Pick<StockSetupIssue, 'type' | 'stock_item_id'>) {
  return `${issue.type}:${issue.stock_item_id}`
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isUnit(value: string | null | undefined, expected: string) {
  return normalizeText(value) === normalizeText(expected)
}

function getExpectedUnit(item: Pick<StockRow, 'name' | 'category' | 'unit' | 'fudo_product_id'>): string | null {
  const name = normalizeText(item.name)

  if (item.fudo_product_id) {
    return null
  }

  if (
    item.category === 'carnes'
    || /\b(jamon|lomo|carne|pollo|bondiola|panceta|salame|chorizo|morcilla|bife|entraña|entrana)\b/.test(name)
  ) {
    return 'kg'
  }

  if (/\b(leche|aceite|vinagre|almibar|salsa|crema de leche)\b/.test(name)) {
    return 'l'
  }

  if (/\b(queso|muzzarella|mozzarella|harina|azucar|cacao|papa|papas|tomate|cebolla|zanahoria|morron|limon|palta)\b/.test(name)) {
    return 'kg'
  }

  return null
}

function unitReviewDetail(item: StockRow): string | null {
  const expected = getExpectedUnit(item)
  if (!expected || isUnit(item.unit, expected)) return null

  return `Figura como ${item.unit}, pero por nombre/categoría debería controlarse en ${expected}. Esto puede convertir ${fmtQty(item.current_qty)} ${item.unit} en una lectura operativa falsa.`
}

function quantityAnomalyDetail(params: {
  item: StockRow
  soldLast14Days: number
  finishedGood: boolean
}): { severity: StockPriority; detail: string } | null {
  const { item, soldLast14Days, finishedGood } = params
  const name = normalizeText(item.name)

  if (isUnit(item.unit, 'unidad') && Math.abs(item.current_qty - Math.round(item.current_qty)) > 0.001) {
    return {
      severity: 'medium',
      detail: `Tiene ${fmtQty(item.current_qty)} unidades con decimal. Si se cuenta por unidad, debería ser entero; si es peso/volumen, hay que corregir la unidad.`,
    }
  }

  if (/\bbanana|bananas\b/.test(name) && item.current_qty >= 150) {
    return {
      severity: 'high',
      detail: `Hay ${fmtQty(item.current_qty)} ${item.unit} de banana. Es una cantidad alta: confirmar conteo físico, unidad y carga en Fudo.`,
    }
  }

  if (item.category === 'carnes' && item.current_qty >= 40) {
    return {
      severity: 'high',
      detail: `Hay ${fmtQty(item.current_qty)} ${item.unit} en carnes. Revisar unidad, merma o compra duplicada antes de volver a pedir.`,
    }
  }

  if ((item.category === 'frutas' || item.category === 'verduras') && item.current_qty >= 120) {
    return {
      severity: 'medium',
      detail: `Hay ${fmtQty(item.current_qty)} ${item.unit} en ${item.category}. Confirmar si la unidad es correcta y si hay riesgo de merma.`,
    }
  }

  if (item.category === 'lacteos' && item.current_qty >= 80) {
    return {
      severity: 'medium',
      detail: `Hay ${fmtQty(item.current_qty)} ${item.unit} en lácteos. Revisar vencimiento, unidad y compra reciente.`,
    }
  }

  if (finishedGood && item.current_qty >= 20 && soldLast14Days <= 3) {
    return {
      severity: item.shelf_life_days != null && item.shelf_life_days <= 7 ? 'high' : 'medium',
      detail: `Hay ${fmtQty(item.current_qty)} ${item.unit} y solo ${soldLast14Days} ventas en los últimos 14 días. Revisar producción, promo o baja de compra.`,
    }
  }

  return null
}

function isAnomalyIssue(issue: StockSetupIssue) {
  return issue.type === 'unit_review'
    || issue.type === 'quantity_anomaly'
    || issue.type === 'negative_stock'
    || issue.type === 'stale_stock'
    || issue.type === 'missing_lot_control'
    || issue.type === 'expired_lot_stock'
    || issue.type === 'mapping_conflict'
    || issue.type === 'missing_fudo_mapping'
    || issue.type === 'sales_stock_mismatch'
}

function isOptionalLotsError(message: string | undefined) {
  if (!message) return false
  return message.includes('stock_lots')
    || message.includes('Could not find the table')
    || message.includes('does not exist')
}

function isOptionalAnomalyControlsError(message: string | undefined) {
  if (!message) return false
  return message.includes('stock_anomaly_')
    || message.includes('Could not find the table')
    || message.includes('does not exist')
}

function ruleMatchesIssue(rule: StockAnomalyRuleRow, issue: StockSetupIssue, item: StockRow | null) {
  if (!rule.is_active) return false
  if (rule.issue_type && rule.issue_type !== issue.type) return false
  if (rule.stock_item_id && String(rule.stock_item_id) !== String(issue.stock_item_id)) return false
  if (!item) return false
  if (rule.category && rule.category !== item.category) return false
  if (rule.unit && normalizeText(rule.unit) !== normalizeText(item.unit)) return false
  if (rule.name_pattern && !normalizeText(item.name).includes(normalizeText(rule.name_pattern))) return false
  return true
}

function isWithinRule(rule: StockAnomalyRuleRow, qty: number) {
  if (rule.min_qty != null && qty < Number(rule.min_qty)) return false
  if (rule.max_qty != null && qty > Number(rule.max_qty)) return false
  return true
}

function confirmedOkStillApplies(decision: StockAnomalyDecisionRow, item: StockRow | null) {
  if (!item) return false
  const snapshotQty = Number(decision.snapshot?.current_qty)
  const snapshotUnit = String(decision.snapshot?.unit ?? '')

  if (snapshotUnit && normalizeText(snapshotUnit) !== normalizeText(item.unit)) return false
  if (!Number.isFinite(snapshotQty)) return true
  if (snapshotQty === 0) return Math.abs(item.current_qty) <= 1

  const diffPct = Math.abs(item.current_qty - snapshotQty) / Math.abs(snapshotQty)
  return diffPct <= 0.2
}

function shouldSuppressIssue(params: {
  issue: StockSetupIssue
  item: StockRow | null
  latestDecision: StockAnomalyDecisionRow | null
  rules: StockAnomalyRuleRow[]
  now: Date
}) {
  const { issue, item, latestDecision, rules, now } = params

  for (const rule of rules) {
    if (ruleMatchesIssue(rule, issue, item) && item && isWithinRule(rule, item.current_qty)) {
      return true
    }
  }

  if (!latestDecision) return false

  if (
    latestDecision.decision === 'snoozed'
    && latestDecision.snoozed_until
    && new Date(latestDecision.snoozed_until) > now
  ) {
    return true
  }

  if (latestDecision.decision === 'confirmed_ok' && confirmedOkStillApplies(latestDecision, item)) {
    return true
  }

  return false
}

async function maybeNotifyRuleViolation(params: {
  admin: SupabaseClient
  userId: string
  rule: StockAnomalyRuleRow
  item: StockRow
  detail: string
}) {
  const { admin, userId, rule, item, detail } = params
  if (!rule.notify_enabled) return

  const lastNotifiedAt = rule.last_notified_at ? new Date(rule.last_notified_at) : null
  if (lastNotifiedAt && Date.now() - lastNotifiedAt.getTime() < 24 * 60 * 60 * 1000) return

  const title = `Stock fuera de regla: ${item.name}`
  const body = `${detail}\n\nActual: ${fmtQty(item.current_qty)} ${item.unit}. Revisar en Control de mercadería.`

  await (admin as SupabaseClient).from('announcements').insert({
    author_id: userId,
    type: 'operativo',
    priority: rule.notification_priority,
    title,
    body,
    scope: 'role',
    target_role: 'encargado',
    target_user_id: null,
    expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  })

  await (admin as SupabaseClient)
    .from('stock_anomaly_rules')
    .update({ last_notified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', rule.id)
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
    const now = new Date()
    const staleSyncLimit = new Date(now.getTime() - 26 * 60 * 60 * 1000)
    const salesSince = new Date(now)
    salesSince.setDate(salesSince.getDate() - 14)

    const [stockRes, menuRes, menuCategoriesRes, salesRes] = await Promise.all([
      admin
        .from('stock_items')
        .select('id, name, category, unit, current_qty, min_qty, cost_per_unit, shelf_life_days, notes, updated_at, fudo_product_id, fudo_ingredient_id, fudo_skip')
        .eq('is_active', true)
        .order('name'),
      admin
        .from('menu_items')
        .select('id, name, category, menu_category_id, recipe_id, fudo_product_id, is_active')
        .eq('is_active', true)
        .not('fudo_product_id', 'is', null),
      admin
        .from('menu_categories')
        .select('id, name'),
      // Paginado: 14 días son ~2.500 líneas y Supabase corta en 1000 por
      // default — sin esto las señales de venta quedaban subcontadas ~60%.
      (async () => {
        const rows: FudoSaleRow[] = []
        for (let page = 0; page < 50; page++) {
          const { data, error } = await admin
            .from('fudo_consumo') // ítems vendidos + opciones elegidas
            .select('fudo_product_id, quantity')
            .gte('sold_at', salesSince.toISOString())
            .order('id', { ascending: true })
            .range(page * 1000, page * 1000 + 999)
          if (error) return { data: null, error }
          if (!data || data.length === 0) break
          rows.push(...(data as FudoSaleRow[]))
          if (data.length < 1000) break
        }
        return { data: rows, error: null }
      })(),
    ])

    if (stockRes.error) throw stockRes.error
    if (menuRes.error) throw menuRes.error
    if (menuCategoriesRes.error) throw menuCategoriesRes.error
    if (salesRes.error) throw salesRes.error

    const [lotsRes, decisionsRes, rulesRes] = await Promise.all([
      admin
        .from('stock_lots')
        .select('stock_item_id, qty_remaining, expires_at, status')
        .in('status', ['active', 'expired']),
      (admin as SupabaseClient)
        .from('stock_anomaly_decisions')
        .select('id, issue_key, stock_item_id, issue_type, decision, note, snapshot, snoozed_until, created_at')
        .order('created_at', { ascending: false })
        .limit(500),
      (admin as SupabaseClient)
        .from('stock_anomaly_rules')
        .select('id, stock_item_id, issue_type, name_pattern, category, unit, min_qty, max_qty, notify_enabled, notification_priority, last_notified_at, created_from_issue_key, note, is_active')
        .eq('is_active', true),
    ])

    const stockItems = (stockRes.data ?? []) as unknown as StockRow[]
    const menuItems = (menuRes.data ?? []) as unknown as MenuRow[]
    const menuCategories = (menuCategoriesRes.data ?? []) as MenuCategoryRow[]
    const fudoSales = (salesRes.data ?? []) as FudoSaleRow[]
    const stockLots = (!lotsRes.error ? (lotsRes.data ?? []) : []) as unknown as StockLotRow[]
    const decisions = (!decisionsRes.error ? (decisionsRes.data ?? []) : []) as unknown as StockAnomalyDecisionRow[]
    const rules = (!rulesRes.error ? (rulesRes.data ?? []) : []) as unknown as StockAnomalyRuleRow[]

    if (lotsRes.error && !isOptionalLotsError(lotsRes.error.message)) {
      throw lotsRes.error
    }
    if (decisionsRes.error && !isOptionalAnomalyControlsError(decisionsRes.error.message)) {
      throw decisionsRes.error
    }
    if (rulesRes.error && !isOptionalAnomalyControlsError(rulesRes.error.message)) {
      throw rulesRes.error
    }

    const stockItemById = new Map(stockItems.map((item) => [String(item.id), item]))
    const menuCategoryById = new Map(menuCategories.map((item) => [item.id, item.name]))
    const activeMenuByFudoId = new Map(
      menuItems
        .filter((item) => item.fudo_product_id)
        .map((item) => [item.fudo_product_id!, item]),
    )
    const salesByFudoProductId = fudoSales.reduce((acc, sale) => {
      const key = String(sale.fudo_product_id)
      acc.set(key, (acc.get(key) ?? 0) + Number(sale.quantity ?? 0))
      return acc
    }, new Map<string, number>())
    const activeLotQtyByStockItemId = stockLots.reduce((acc, lot) => {
      if (lot.status !== 'active') return acc
      const key = String(lot.stock_item_id)
      acc.set(key, (acc.get(key) ?? 0) + Number(lot.qty_remaining ?? 0))
      return acc
    }, new Map<string, number>())
    const expiredLotQtyByStockItemId = stockLots.reduce((acc, lot) => {
      const expiresAt = lot.expires_at ? new Date(lot.expires_at) : null
      if (lot.status !== 'expired' && (!expiresAt || expiresAt >= now)) return acc
      const key = String(lot.stock_item_id)
      acc.set(key, (acc.get(key) ?? 0) + Number(lot.qty_remaining ?? 0))
      return acc
    }, new Map<string, number>())

    const sectorActions: Record<StockSector, StockSectorAction[]> = {
      salon: [],
      bar: [],
      cocina: [],
      compras: [],
    }
    const setupIssues: StockSetupIssue[] = []
    const latestDecisionByIssueKey = new Map<string, StockAnomalyDecisionRow>()
    for (const decision of decisions) {
      if (!latestDecisionByIssueKey.has(decision.issue_key)) {
        latestDecisionByIssueKey.set(decision.issue_key, decision)
      }
    }

    let finishedGoods = 0
    let finishedGoodsWithShelfLife = 0
    let perishableMissingShelfLife = 0
    let lowStockItems = 0
    let overstockFinishedGoods = 0

    for (const item of stockItems) {
      const menuMatch = item.fudo_product_id
        ? activeMenuByFudoId.get(item.fudo_product_id) ?? null
        : null
      const menuCategoryName = menuMatch?.menu_category_id
        ? menuCategoryById.get(menuMatch.menu_category_id) ?? null
        : null

      const primarySector = deriveSector({
        category: item.category,
        unit: item.unit,
        fudo_product_id: item.fudo_product_id,
        menuCategoryName,
      })

      const finishedGood = isFinishedGood(item)
      const perishableCandidate = isPerishableCandidate(item)
      const overstockThreshold = getOverstockThreshold(item)
      const isOverstock = item.current_qty >= overstockThreshold && item.current_qty > 0
      // Criterio gastronómico: crítico real = negativo o por debajo de un mínimo
      // definido (min_qty > 0). qty=0 con min_qty=0 no es un quiebre: no hay
      // umbral operativo, así que no infla el conteo ni dispara "Reponer".
      const isRealCritical = (item.current_qty ?? 0) < 0
        || ((item.min_qty ?? 0) > 0 && (item.current_qty ?? 0) <= (item.min_qty ?? 0))
      const suggestedShelfLife = guessShelfLifeDays(item.category, menuCategoryName)
      const suggestedCategory = finishedGood ? guessCategoryForFinishedGood(menuCategoryName) : null
      const stockItemId = String(item.id)
      const soldLast14Days = item.fudo_product_id
        ? salesByFudoProductId.get(String(item.fudo_product_id)) ?? 0
        : 0

      if (item.fudo_product_id && item.fudo_ingredient_id) {
        setupIssues.push(createSetupIssue({
          stock_item_id: stockItemId,
          stock_item_name: item.name,
          severity: 'high',
          type: 'mapping_conflict',
          title: `Doble vínculo Fudo en ${item.name}`,
          detail: 'El mismo item está vinculado como producto y como insumo. Hay que dejar un solo origen para evitar escrituras sobre el stock equivocado.',
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      if (!item.fudo_product_id && !item.fudo_ingredient_id && item.fudo_skip !== true) {
        setupIssues.push(createSetupIssue({
          stock_item_id: stockItemId,
          stock_item_name: item.name,
          severity: item.current_qty > 0 ? 'high' : 'medium',
          type: 'missing_fudo_mapping',
          title: `${item.name} no tiene origen claro`,
          detail: 'No está vinculado a Fudo ni marcado como Local LVE. La app no debería permitir escritura hasta resolver si depende de Fudo o es control interno.',
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      if ((item.fudo_product_id || item.fudo_ingredient_id) && new Date(item.updated_at) < staleSyncLimit) {
        setupIssues.push(createSetupIssue({
          stock_item_id: stockItemId,
          stock_item_name: item.name,
          severity: 'high',
          type: 'stale_stock',
          title: `${item.name} no sincronizó hoy`,
          detail: `Última actualización: ${item.updated_at}. Si Fudo está conectado, este item debería refrescarse todos los días.`,
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      if (item.current_qty < 0) {
        setupIssues.push(createSetupIssue({
          stock_item_id: stockItemId,
          stock_item_name: item.name,
          severity: 'high',
          type: 'negative_stock',
          title: `${item.name} quedó en negativo`,
          detail: `Figura ${fmtQty(item.current_qty)} ${item.unit}. Esto suele indicar venta sin stock, receta mal descontada o ajuste manual equivocado.`,
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      const unitDetail = unitReviewDetail(item)
      if (unitDetail) {
        setupIssues.push(createSetupIssue({
          stock_item_id: stockItemId,
          stock_item_name: item.name,
          severity: 'high',
          type: 'unit_review',
          title: `Revisar unidad de ${item.name}`,
          detail: unitDetail,
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      const quantityAnomaly = quantityAnomalyDetail({ item, soldLast14Days, finishedGood })
      if (quantityAnomaly) {
        setupIssues.push(createSetupIssue({
          stock_item_id: stockItemId,
          stock_item_name: item.name,
          severity: quantityAnomaly.severity,
          type: 'quantity_anomaly',
          title: `Cantidad rara en ${item.name}`,
          detail: quantityAnomaly.detail,
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      if (finishedGood && item.current_qty <= 0 && soldLast14Days >= 5) {
        setupIssues.push(createSetupIssue({
          stock_item_id: stockItemId,
          stock_item_name: item.name,
          severity: 'high',
          type: 'sales_stock_mismatch',
          title: `${item.name} se vende pero figura sin stock`,
          detail: `Tiene ${fmtQty(item.current_qty)} ${item.unit}, pero registra ${soldLast14Days} ventas en los últimos 14 días. Revisar stock Fudo, producción o vínculo del producto.`,
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      if (
        stockLots.length > 0
        && item.current_qty > 0
        && item.shelf_life_days != null
        && (finishedGood || item.category === 'panaderia')
        && activeLotQtyByStockItemId.get(stockItemId) == null
      ) {
        setupIssues.push(createSetupIssue({
          stock_item_id: stockItemId,
          stock_item_name: item.name,
          severity: 'medium',
          type: 'missing_lot_control',
          title: `${item.name} tiene stock sin lote`,
          detail: `Hay ${fmtQty(item.current_qty)} ${item.unit} y vida útil de ${item.shelf_life_days} días, pero no hay lote activo para saber qué vence primero.`,
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      const expiredQty = expiredLotQtyByStockItemId.get(stockItemId) ?? 0
      if (expiredQty > 0) {
        setupIssues.push(createSetupIssue({
          stock_item_id: stockItemId,
          stock_item_name: item.name,
          severity: 'high',
          type: 'expired_lot_stock',
          title: `${item.name} tiene lote vencido con stock`,
          detail: `Hay ${fmtQty(expiredQty)} ${item.unit} en lotes vencidos. Hay que descartar, reprocesar o corregir el lote antes de confiar en el stock.`,
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      if (finishedGood) {
        finishedGoods++
        if (item.shelf_life_days != null) finishedGoodsWithShelfLife++
        if (isOverstock) overstockFinishedGoods++
      }

      if (perishableCandidate && item.current_qty > 0 && item.shelf_life_days == null) {
        perishableMissingShelfLife++
        setupIssues.push(createSetupIssue({
          stock_item_id: item.id,
          stock_item_name: item.name,
          severity: finishedGood && isOverstock ? 'high' : 'medium',
          type: 'missing_shelf_life',
          title: finishedGood && isOverstock
            ? `No puedo sugerir promo de ${item.name}`
            : `Definir vida útil de ${item.name}`,
          detail: finishedGood && isOverstock
            ? `Hay ${fmtQty(item.current_qty)} ${item.unit} en stock. Sin vida útil cargada no puedo disparar una promo automática con criterio.`
            : `Tiene ${fmtQty(item.current_qty)} ${item.unit}. Cargá vida útil para que el radar sepa cuándo empujarlo, frenarlo o priorizarlo.`,
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      if (finishedGood && !menuMatch) {
        setupIssues.push(createSetupIssue({
          stock_item_id: item.id,
          stock_item_name: item.name,
          severity: 'medium',
          type: 'missing_menu_mapping',
          title: `Falta vínculo comercial para ${item.name}`,
          detail: 'El stock terminado existe, pero no encuentro un item activo de carta para convertirlo en acción de salón o bar.',
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      if (
        finishedGood
        && suggestedCategory
        && item.category !== suggestedCategory
      ) {
        setupIssues.push(createSetupIssue({
          stock_item_id: item.id,
          stock_item_name: item.name,
          severity: 'medium',
          type: 'category_review',
          title: `Revisar categoría de ${item.name}`,
          detail: `Está categorizado como ${item.category}, pero para operar por sector conviene llevarlo a ${suggestedCategory}.`,
          current_qty: item.current_qty,
          unit: item.unit,
          suggested_shelf_life_days: suggestedShelfLife,
          suggested_category: suggestedCategory,
        }))
      }

      if (isRealCritical) {
        lowStockItems++
        sectorActions.compras.push(createAction({
          stock_item_id: item.id,
          stock_item_name: item.name,
          sector: 'compras',
          priority: item.current_qty <= 0 ? 'high' : 'medium',
          confidence: 'high',
          kind: 'replenish',
          title: `Reponer ${item.name}`,
          detail: `Tiene ${fmtQty(item.current_qty)} ${item.unit} y el mínimo operativo es ${fmtQty(item.min_qty)}.`,
          current_qty: item.current_qty,
          unit: item.unit,
          menu_item_name: menuMatch?.name ?? null,
        }))
      }

      if (!isOverstock) continue

      const shortShelfLife = item.shelf_life_days != null && item.shelf_life_days <= 7
      const veryHighQty = item.current_qty >= Math.max(overstockThreshold + 4, item.min_qty * 4)
      const confidence: StockConfidence = item.shelf_life_days != null ? 'high' : 'low'

      if (finishedGood && shortShelfLife) {
        sectorActions[primarySector].push(createAction({
          stock_item_id: item.id,
          stock_item_name: item.name,
          sector: primarySector,
          priority: veryHighQty ? 'high' : 'medium',
          confidence,
          kind: primarySector === 'bar' ? 'push' : 'promo',
          title: getPromoTitle(menuMatch?.name ?? item.name, primarySector),
          detail: `Hay ${fmtQty(item.current_qty)} ${item.unit} en stock y la vida útil configurada es de ${item.shelf_life_days} días.`,
          current_qty: item.current_qty,
          unit: item.unit,
          menu_item_name: menuMatch?.name ?? null,
        }))

        sectorActions.compras.push(createAction({
          stock_item_id: item.id,
          stock_item_name: item.name,
          sector: 'compras',
          priority: veryHighQty ? 'high' : 'medium',
          confidence,
          kind: 'freeze_purchase',
          title: `No reponer ${item.name} por ahora`,
          detail: `Antes de comprar más, bajá las ${fmtQty(item.current_qty)} ${item.unit} ya cargadas en stock.`,
          current_qty: item.current_qty,
          unit: item.unit,
          menu_item_name: menuMatch?.name ?? null,
        }))
        continue
      }

      if (!finishedGood && shortShelfLife) {
        const targetSector: StockSector = primarySector === 'compras' ? 'cocina' : primarySector
        sectorActions[targetSector].push(createAction({
          stock_item_id: item.id,
          stock_item_name: item.name,
          sector: targetSector,
          priority: veryHighQty ? 'high' : 'medium',
          confidence,
          kind: 'use_first',
          title: `Usar primero ${item.name}`,
          detail: `Hay ${fmtQty(item.current_qty)} ${item.unit} y una vida útil corta de ${item.shelf_life_days} días.`,
          current_qty: item.current_qty,
          unit: item.unit,
          menu_item_name: menuMatch?.name ?? null,
        }))
        continue
      }

      if (finishedGood && item.shelf_life_days != null) {
        sectorActions[primarySector].push(createAction({
          stock_item_id: item.id,
          stock_item_name: item.name,
          sector: primarySector,
          priority: veryHighQty ? 'medium' : 'low',
          confidence,
          kind: primarySector === 'bar' ? 'push' : 'promo',
          title: `Mover ${menuMatch?.name ?? item.name}`,
          detail: `Hay ${fmtQty(item.current_qty)} ${item.unit}. No es urgente por vida útil, pero ya está por encima del stock objetivo.`,
          current_qty: item.current_qty,
          unit: item.unit,
          menu_item_name: menuMatch?.name ?? null,
        }))
      }
    }

    for (const rule of rules) {
      if (!rule.is_active || !rule.stock_item_id) continue
      const item = stockItemById.get(String(rule.stock_item_id))
      if (!item || isWithinRule(rule, item.current_qty)) continue

      const range = [
        rule.min_qty != null ? `mín. ${Number(rule.min_qty)}` : null,
        rule.max_qty != null ? `máx. ${Number(rule.max_qty)}` : null,
      ].filter(Boolean).join(' / ')
      const detail = `La regla aceptada para ${item.name} es ${range} ${rule.unit ?? item.unit}. Hoy figura ${fmtQty(item.current_qty)} ${item.unit}.`

      setupIssues.push(createSetupIssue({
        stock_item_id: String(item.id),
        stock_item_name: item.name,
        severity: rule.notification_priority === 'critica' || rule.notification_priority === 'alta' ? 'high' : 'medium',
        type: 'quantity_anomaly',
        title: `${item.name} salió de su regla`,
        detail,
        current_qty: item.current_qty,
        unit: item.unit,
        suggested_shelf_life_days: item.shelf_life_days,
        suggested_category: null,
        rule_id: rule.id,
      }))

      await maybeNotifyRuleViolation({
        admin,
        userId: user.id,
        rule,
        item,
        detail,
      }).catch((err) => {
        console.error('[stock anomaly notification]', err)
      })
    }

    const visibleSetupIssues = setupIssues.filter((issue) => {
      const item = stockItemById.get(String(issue.stock_item_id)) ?? null
      const latestDecision = latestDecisionByIssueKey.get(getIssueKey(issue)) ?? null
      return !shouldSuppressIssue({
        issue,
        item,
        latestDecision,
        rules,
        now,
      })
    })

    const sectors = (Object.keys(STOCK_SECTOR_META) as StockSector[]).map((sector) => {
      const actions = sectorActions[sector]
        .sort((a, b) => {
          const priorityDiff = priorityWeight(a.priority) - priorityWeight(b.priority)
          if (priorityDiff !== 0) return priorityDiff
          return b.current_qty - a.current_qty
        })
        .slice(0, 6)

      return {
        sector,
        label: STOCK_SECTOR_META[sector].label,
        icon: STOCK_SECTOR_META[sector].icon,
        counts: {
          high: actions.filter((item) => item.priority === 'high').length,
          medium: actions.filter((item) => item.priority === 'medium').length,
          low: actions.filter((item) => item.priority === 'low').length,
        },
        actions,
      }
    })

    const anomalyCount = visibleSetupIssues.filter(isAnomalyIssue).length

    // -----------------------------------------------------------------------
    // Intermedios sin vincular: stock_items elaborados (marcados fudo_skip o
    // que salieron de una orden de producción) que se usan como ingrediente en
    // recetas pero que ninguna receta produce — ni por output_stock_item_id ni
    // por match de nombre. El costeo nivel-2 de los platos que los usan queda
    // incompleto (ej: "Milanesa cruda" renombrada o sin receta homónima).
    // Tolerante: si recipes.output_stock_item_id todavía no existe (migración
    // pendiente) o falla la consulta, la sección simplemente no aparece.
    // -----------------------------------------------------------------------
    let unlinkedIntermediates: { count: number; names: string[] } | undefined
    try {
      type RecipeLinkRow = { id: string; name: string; output_stock_item_id?: string | null }
      let recipeLinks: RecipeLinkRow[] = []
      const recipesRes = await admin.from('recipes').select('id, name, output_stock_item_id')
      if (recipesRes.error) {
        const legacy = await admin.from('recipes').select('id, name')
        if (legacy.error) throw legacy.error
        recipeLinks = (legacy.data ?? []) as RecipeLinkRow[]
      } else {
        recipeLinks = (recipesRes.data ?? []) as RecipeLinkRow[]
      }

      const [riRes, poRes] = await Promise.all([
        admin.from('recipe_ingredients').select('stock_item_id'),
        admin
          .from('production_outputs')
          .select('stock_item_id')
          .eq('is_waste', false)
          .not('stock_item_id', 'is', null),
      ])
      if (riRes.error) throw riRes.error
      const usedItemIds = new Set((riRes.data ?? []).map((r) => String(r.stock_item_id)))
      // Items que alguna vez salieron de producción → elaborados (aunque no tengan fudo_skip)
      const producedInOrders = new Set(
        (!poRes.error ? (poRes.data ?? []) : []).map((r) => String(r.stock_item_id)),
      )

      const producedItemIds = new Set<string>()
      const recipeNameKeys = new Set<string>()
      for (const r of recipeLinks) {
        if (r.output_stock_item_id) producedItemIds.add(String(r.output_stock_item_id))
        // Mismo criterio que el fallback runtime (recipe-cost/demand): lower+trim
        recipeNameKeys.add(r.name.trim().toLowerCase())
      }

      const brokenNames = stockItems
        .filter((item) =>
          (item.fudo_skip === true || producedInOrders.has(String(item.id)))
          && usedItemIds.has(String(item.id))
          && !producedItemIds.has(String(item.id))
          && !recipeNameKeys.has(item.name.trim().toLowerCase()),
        )
        .map((item) => item.name)

      unlinkedIntermediates = { count: brokenNames.length, names: brokenNames.slice(0, 10) }
    } catch (err) {
      console.error('[stock intelligence] unlinked intermediates', err)
      unlinkedIntermediates = undefined
    }

    // -----------------------------------------------------------------------
    // Divergencia de costos Fudo vs LVE: items activos vinculados a un
    // ingrediente Fudo cuyo cost_per_unit local difiere >30% del costo que
    // reporta Fudo. Usa el fetch cacheado de ingredientes (30 min, una sola
    // llamada paginada) — nunca N llamadas por item. Tolerante: si Fudo no
    // responde, la sección simplemente no aparece (mismo patrón que
    // unlinked_intermediates).
    // -----------------------------------------------------------------------
    let costDivergence: StockIntelligenceResponse['cost_divergence']
    try {
      const linkedWithCost = stockItems.filter(
        (item) =>
          item.fudo_ingredient_id
          && typeof item.cost_per_unit === 'number'
          && item.cost_per_unit > 0,
      )
      if (linkedWithCost.length === 0) {
        costDivergence = { count: 0, items: [] }
      } else {
        const { getFudoIngredientsCached } = await import('@/lib/fudo/create-from-fudo')
        const fudoIngredients = await getFudoIngredientsCached()
        const fudoCostById = new Map<string, number>()
        for (const ing of fudoIngredients) {
          if (typeof ing.cost === 'number' && ing.cost > 0) {
            fudoCostById.set(String(ing.id), ing.cost)
          }
        }

        const divergent = linkedWithCost
          .flatMap((item) => {
            const fudoCost = fudoCostById.get(String(item.fudo_ingredient_id))
            if (fudoCost == null) return []
            const lveCost = item.cost_per_unit as number
            const diffPct = Math.abs(lveCost - fudoCost) / fudoCost * 100
            if (diffPct <= 30) return []
            return [{
              name: item.name,
              costo_lve: Math.round(lveCost * 100) / 100,
              costo_fudo: Math.round(fudoCost * 100) / 100,
              diff_pct: Math.round(diffPct),
            }]
          })
          .sort((a, b) => b.diff_pct - a.diff_pct)

        costDivergence = { count: divergent.length, items: divergent.slice(0, 30) }
      }
    } catch (err) {
      console.error('[stock intelligence] cost divergence', err)
      costDivergence = undefined
    }

    const response: StockIntelligenceResponse = {
      summary: {
        active_items: stockItems.length,
        finished_goods: finishedGoods,
        finished_goods_with_shelf_life: finishedGoodsWithShelfLife,
        perishable_missing_shelf_life: perishableMissingShelfLife,
        low_stock_items: lowStockItems,
        overstock_finished_goods: overstockFinishedGoods,
        setup_issues: visibleSetupIssues.length,
        anomalies: anomalyCount,
        anomaly_rules: rules.length,
      },
      sectors,
      setup_issues: visibleSetupIssues
        .sort((a, b) => {
          const severityDiff = priorityWeight(a.severity) - priorityWeight(b.severity)
          if (severityDiff !== 0) return severityDiff
          return b.current_qty - a.current_qty
        })
        .slice(0, 100),
      unlinked_intermediates: unlinkedIntermediates,
      cost_divergence: costDivergence,
      generated_at: new Date().toISOString(),
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[GET /api/stock/intelligence]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
