import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchFudoExpenses, type FudoExpense } from '@/lib/fudo/expenses'

// ---------------------------------------------------------------------------
// Vínculos insumo↔proveedor a partir de las COMPRAS reales en Fudo
// ---------------------------------------------------------------------------
// La API de Fudo no tiene un vínculo ingrediente→proveedor (los Ingredient
// solo traen ingredientCategory y recipeCard). Lo que sí tiene es el módulo
// de gastos: cada Expense tiene un provider y expenseItems con su ingredient.
// De ahí sale la evidencia: "a este proveedor le compraste este insumo N
// veces, la última el día X".
//
// Reglas del sync (nunca pisa una decisión humana):
//   · Actualiza fudo_purchases / last_purchase_at de cada vínculo.
//   · Crea los vínculos que faltan (source 'fudo') como alternativos.
//   · Si un insumo no tiene principal, el proveedor con más compras pasa a
//     serlo (así entra en las sugerencias de pedido).
//   · Un vínculo descartado a mano solo reaparece si hay compras POSTERIORES
//     al descarte — y reaparece como alternativo, nunca como principal.
// ---------------------------------------------------------------------------

export type Evidence = { purchases: number; lastAt: string }

/** "ingrediente|proveedor" (ids de Fudo) → evidencia */
export function purchaseEvidence(expenses: FudoExpense[]): Map<string, Evidence> {
  const map = new Map<string, Evidence>()
  for (const e of expenses) {
    if (!e.providerId) continue
    for (const ing of new Set(e.ingredientIds)) {
      const key = `${ing}|${e.providerId}`
      const prev = map.get(key)
      if (!prev) map.set(key, { purchases: 1, lastAt: e.date })
      else {
        prev.purchases++
        if (e.date > prev.lastAt) prev.lastAt = e.date
      }
    }
  }
  return map
}

export type ProviderRhythm = {
  purchases: number
  lastAt: string
  /** compras por día de semana (0=dom … 6=sáb), hora de Argentina */
  byDow: number[]
  /** días en que se le compra habitualmente (≥20% de sus compras y ≥2 veces) */
  usualDays: number[]
}

/** Ritmo de compra por proveedor de Fudo → sugiere días de pedido. */
export function providerRhythm(expenses: FudoExpense[]): Map<string, ProviderRhythm> {
  const map = new Map<string, ProviderRhythm>()
  for (const e of expenses) {
    if (!e.providerId) continue
    const r = map.get(e.providerId) ?? { purchases: 0, lastAt: e.date, byDow: [0, 0, 0, 0, 0, 0, 0], usualDays: [] }
    r.purchases++
    if (e.date > r.lastAt) r.lastAt = e.date
    // UTC-3 fijo (Argentina no tiene horario de verano)
    r.byDow[new Date(Date.parse(e.date) - 3 * 3_600_000).getUTCDay()]++
    map.set(e.providerId, r)
  }
  for (const r of map.values()) {
    r.usualDays = r.byDow
      .map((n, dow) => ({ n, dow }))
      .filter(({ n }) => n >= 2 && n / r.purchases >= 0.2)
      .map(({ dow }) => dow)
  }
  return map
}

export type LinkSyncResult = {
  expenses: number
  pairs: number
  created: number
  updated: number
  revived: number
  autoPrimary: number
}

type LinkRow = {
  stock_item_id: string
  supplier_id: string
  is_primary: boolean
  fudo_purchases: number
  last_purchase_at: string | null
  dismissed_at: string | null
}

// Último sync por instancia: la pantalla de vínculos dispara uno si pasó más
// de SYNC_STALE_MS (además del cron diario y del botón manual).
export const SYNC_STALE_MS = 30 * 60 * 1000
let lastSync: { at: number; result: LinkSyncResult } | null = null
export const lastLinkSync = () => lastSync

// Versión de los vínculos: la ruta de sugerencias de pedido la compara para
// no servir su cache de 5 min después de un cambio de proveedor.
let version = 0
export const linksVersion = () => version
export function bumpLinksVersion() { version++ }

/**
 * Trae las compras de Fudo y actualiza stock_item_suppliers.
 * Necesita un cliente service role (escribe sin pasar por RLS).
 */
export async function syncSupplierLinksFromFudo(
  admin: SupabaseClient,
  options: { force?: boolean } = {},
): Promise<LinkSyncResult> {
  const expenses = await fetchFudoExpenses(undefined, { force: options.force })
  const evidence = purchaseEvidence(expenses)

  const [itemsRes, suppliersRes, linksRes] = await Promise.all([
    admin.from('stock_items').select('id, fudo_ingredient_id').eq('is_active', true).not('fudo_ingredient_id', 'is', null),
    admin.from('suppliers').select('id, fudo_provider_id').eq('is_active', true).not('fudo_provider_id', 'is', null),
    admin.from('stock_item_suppliers').select('stock_item_id, supplier_id, is_primary, fudo_purchases, last_purchase_at, dismissed_at'),
  ])
  if (itemsRes.error) throw new Error(itemsRes.error.message)
  if (suppliersRes.error) throw new Error(suppliersRes.error.message)
  if (linksRes.error) throw new Error(linksRes.error.message)

  const itemByIng = new Map<string, string>()
  for (const it of itemsRes.data ?? []) itemByIng.set(String(it.fudo_ingredient_id), it.id)
  const supplierByProv = new Map<string, string>()
  for (const s of suppliersRes.data ?? []) supplierByProv.set(String(s.fudo_provider_id), s.id)

  const links = (linksRes.data ?? []) as LinkRow[]
  const linkByKey = new Map(links.map((l) => [`${l.stock_item_id}|${l.supplier_id}`, l]))
  const hasPrimary = new Set(links.filter((l) => l.is_primary).map((l) => l.stock_item_id))

  // Evidencia traducida a ids de LVE
  const lveEvidence = new Map<string, Evidence & { item: string; supplier: string }>()
  for (const [key, ev] of evidence) {
    const [ing, prov] = key.split('|')
    const item = itemByIng.get(ing)
    const supplier = supplierByProv.get(prov)
    if (!item || !supplier) continue
    lveEvidence.set(`${item}|${supplier}`, { ...ev, item, supplier })
  }

  // Mejor proveedor por insumo (más compras, desempata la más reciente)
  const bestByItem = new Map<string, { supplier: string; purchases: number; lastAt: string }>()
  for (const ev of lveEvidence.values()) {
    const prev = bestByItem.get(ev.item)
    if (!prev || ev.purchases > prev.purchases || (ev.purchases === prev.purchases && ev.lastAt > prev.lastAt)) {
      bestByItem.set(ev.item, { supplier: ev.supplier, purchases: ev.purchases, lastAt: ev.lastAt })
    }
  }

  const now = new Date().toISOString()
  const inserts: Record<string, unknown>[] = []
  const counts: Record<string, unknown>[] = []
  const revives: Record<string, unknown>[] = []
  let autoPrimary = 0

  for (const [key, ev] of lveEvidence) {
    const existing = linkByKey.get(key)
    if (!existing) {
      const makePrimary = !hasPrimary.has(ev.item) && bestByItem.get(ev.item)?.supplier === ev.supplier
      if (makePrimary) { hasPrimary.add(ev.item); autoPrimary++ }
      inserts.push({
        stock_item_id: ev.item, supplier_id: ev.supplier, is_primary: makePrimary, source: 'fudo',
        fudo_purchases: ev.purchases, last_purchase_at: ev.lastAt,
      })
      continue
    }
    const changed = existing.fudo_purchases !== ev.purchases
      || (existing.last_purchase_at ? Date.parse(existing.last_purchase_at) : 0) !== Date.parse(ev.lastAt)
    const revive = existing.dismissed_at !== null && ev.lastAt > existing.dismissed_at
    const base = { stock_item_id: ev.item, supplier_id: ev.supplier, fudo_purchases: ev.purchases, last_purchase_at: ev.lastAt, updated_at: now }
    if (revive) revives.push({ ...base, dismissed_at: null, dismissed_by: null })
    else if (changed) counts.push(base)
  }

  // Vínculos que tenían evidencia y ya no (gasto anulado en Fudo)
  for (const l of links) {
    if (l.fudo_purchases > 0 && !lveEvidence.has(`${l.stock_item_id}|${l.supplier_id}`)) {
      counts.push({ stock_item_id: l.stock_item_id, supplier_id: l.supplier_id, fudo_purchases: 0, last_purchase_at: null, updated_at: now })
    }
  }

  // Insumos que ya tenían vínculos (no descartados) pero ningún principal
  const primaryPromotions: { item: string; supplier: string }[] = []
  for (const [item, best] of bestByItem) {
    if (hasPrimary.has(item)) continue
    const link = linkByKey.get(`${item}|${best.supplier}`)
    if (link && (link.dismissed_at === null)) {
      primaryPromotions.push({ item, supplier: best.supplier })
      hasPrimary.add(item)
      autoPrimary++
    }
  }

  const upsert = async (rows: Record<string, unknown>[]) => {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await admin.from('stock_item_suppliers')
        .upsert(rows.slice(i, i + 200), { onConflict: 'stock_item_id,supplier_id' })
      if (error) throw new Error(`stock_item_suppliers: ${error.message}`)
    }
  }
  await upsert(inserts)
  await upsert(counts)
  await upsert(revives)
  for (const p of primaryPromotions) {
    const { error } = await admin.from('stock_item_suppliers')
      .update({ is_primary: true, updated_at: now })
      .eq('stock_item_id', p.item).eq('supplier_id', p.supplier)
    if (error) throw new Error(`stock_item_suppliers: ${error.message}`)
  }

  const result: LinkSyncResult = {
    expenses: expenses.length,
    pairs: lveEvidence.size,
    created: inserts.length,
    updated: counts.length,
    revived: revives.length,
    autoPrimary,
  }
  lastSync = { at: Date.now(), result }
  if (inserts.length + counts.length + revives.length + primaryPromotions.length > 0) bumpLinksVersion()
  return result
}
