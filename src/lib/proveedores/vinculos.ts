import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchFudoExpenses, type FudoExpense } from '@/lib/fudo/expenses'
import { providerRhythm, lastLinkSync, SYNC_STALE_MS } from '@/lib/proveedores/fudo-links'
import { suggestSupplier } from '@/lib/proveedores/supplier-match'

// ---------------------------------------------------------------------------
// Estado completo de los vínculos insumo↔proveedor, para /proveedores/vincular
// y el diálogo de cada proveedor. Una sola lectura, sin N+1.
// ---------------------------------------------------------------------------

export type VinculoSupplier = {
  id: string
  name: string
  phone: string | null
  category: string | null
  order_days: number[]
  lead_time_days: number | null
  fudo_linked: boolean
  /** Ritmo de compra real en Fudo (null si no hay compras o Fudo no respondió) */
  rhythm: { purchases: number; last_at: string; by_dow: number[]; usual_days: number[] } | null
}

export type VinculoItem = {
  id: string
  name: string
  category: string | null
  area: string | null
  unit: string
  current_qty: number
  min_qty: number
  in_fudo: boolean
}

export type Vinculo = {
  item_id: string
  supplier_id: string
  is_primary: boolean
  source: 'manual' | 'fudo' | 'legacy'
  fudo_purchases: number
  last_purchase_at: string | null
  confirmed_at: string | null
}

export type ReviewConflict = {
  item_id: string
  current_supplier_id: string
  suggested_supplier_id: string
  reason: string
}

export type ReviewUnlinked = {
  item_id: string
  /** sugerencia por nombre (sin compras en Fudo que la respalden) */
  suggestion: { supplier_id: string; reason: string } | null
}

export type VinculosPayload = {
  suppliers: VinculoSupplier[]
  items: VinculoItem[]
  links: Vinculo[]
  review: {
    unlinked: ReviewUnlinked[]
    conflicts: ReviewConflict[]
    /** proveedores con compras frecuentes y sin días de pedido cargados */
    calendar: string[]
  }
  fudo: { ok: boolean; last_sync_at: string | null; sync_due: boolean }
}

const DAY_MS = 86_400_000

export async function buildVinculosPayload(admin: SupabaseClient): Promise<VinculosPayload> {
  const [suppliersRes, itemsRes, linksRes, expenses] = await Promise.all([
    admin.from('suppliers')
      .select('id, name, phone, category, order_days, lead_time_days, fudo_provider_id')
      .eq('is_active', true).order('name'),
    admin.from('stock_items')
      .select('id, name, category, area, unit, current_qty, min_qty, is_produced, fudo_ingredient_id, fudo_product_id')
      .eq('is_active', true).order('name'),
    admin.from('stock_item_suppliers')
      .select('stock_item_id, supplier_id, is_primary, source, fudo_purchases, last_purchase_at, confirmed_at')
      .is('dismissed_at', null),
    // Ritmo de compra: best-effort con timeout, igual que las sugerencias.
    (async (): Promise<FudoExpense[] | null> => {
      try {
        return await Promise.race([
          fetchFudoExpenses(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
        ])
      } catch { return null }
    })(),
  ])
  if (suppliersRes.error) throw new Error(suppliersRes.error.message)
  if (itemsRes.error) throw new Error(itemsRes.error.message)
  if (linksRes.error) throw new Error(linksRes.error.message)

  const rhythm = expenses ? providerRhythm(expenses) : new Map()

  const suppliers: VinculoSupplier[] = (suppliersRes.data ?? []).map((s) => {
    const r = s.fudo_provider_id ? rhythm.get(String(s.fudo_provider_id)) : undefined
    return {
      id: s.id,
      name: s.name,
      phone: s.phone,
      category: s.category ?? null,
      order_days: s.order_days ?? [],
      lead_time_days: s.lead_time_days,
      fudo_linked: !!s.fudo_provider_id,
      rhythm: r ? { purchases: r.purchases, last_at: r.lastAt, by_dow: r.byDow, usual_days: r.usualDays } : null,
    }
  })
  const activeSupplier = new Set(suppliers.map((s) => s.id))

  // Lo que se produce en cocina no se compra: fuera de los vínculos.
  const items: VinculoItem[] = (itemsRes.data ?? [])
    .filter((i) => !i.is_produced)
    .map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category,
      area: i.area ?? null,
      unit: i.unit,
      current_qty: Number(i.current_qty ?? 0),
      min_qty: Number(i.min_qty ?? 0),
      in_fudo: !!(i.fudo_ingredient_id || i.fudo_product_id),
    }))
  const itemIds = new Set(items.map((i) => i.id))

  const links: Vinculo[] = (linksRes.data ?? [])
    .filter((l) => itemIds.has(l.stock_item_id) && activeSupplier.has(l.supplier_id))
    .map((l) => ({
      item_id: l.stock_item_id,
      supplier_id: l.supplier_id,
      is_primary: l.is_primary,
      source: l.source,
      fudo_purchases: l.fudo_purchases,
      last_purchase_at: l.last_purchase_at,
      confirmed_at: l.confirmed_at,
    }))

  const linksByItem = new Map<string, Vinculo[]>()
  for (const l of links) {
    const list = linksByItem.get(l.item_id) ?? []
    list.push(l)
    linksByItem.set(l.item_id, list)
  }

  // --- Cola de revisión -----------------------------------------------------
  const now = Date.now()
  const supplierOptions = suppliers.map((s) => ({ id: s.id, name: s.name }))
  const unlinked: ReviewUnlinked[] = []
  const conflicts: ReviewConflict[] = []

  for (const item of items) {
    const list = linksByItem.get(item.id) ?? []
    const primary = list.find((l) => l.is_primary)
    if (!primary) {
      const s = suggestSupplier(item, supplierOptions)
      unlinked.push({ item_id: item.id, suggestion: s ? { supplier_id: s.supplierId, reason: s.reason } : null })
      continue
    }
    const best = list
      .filter((l) => l.fudo_purchases > 0)
      .sort((a, b) => b.fudo_purchases - a.fudo_purchases || (b.last_purchase_at ?? '').localeCompare(a.last_purchase_at ?? ''))[0]
    if (!best || best.supplier_id === primary.supplier_id || best.fudo_purchases < 2) continue

    const bestLast = best.last_purchase_at ? Date.parse(best.last_purchase_at) : 0
    // "Mantener" vale hasta que haya compras nuevas al otro proveedor.
    if (primary.confirmed_at && Date.parse(primary.confirmed_at) >= bestLast) continue

    const primaryLast = primary.last_purchase_at ? Date.parse(primary.last_purchase_at) : 0
    let reason: string | null = null
    if (primary.fudo_purchases === 0) {
      reason = `En Fudo nunca se le compró al actual; ${best.fudo_purchases} compras al otro`
    } else if (now - primaryLast > 60 * DAY_MS && now - bestLast < 30 * DAY_MS) {
      reason = `Las compras recientes van al otro proveedor (${best.fudo_purchases} compras)`
    }
    if (reason) {
      conflicts.push({ item_id: item.id, current_supplier_id: primary.supplier_id, suggested_supplier_id: best.supplier_id, reason })
    }
  }

  const primaryCount = new Map<string, number>()
  for (const l of links) if (l.is_primary) primaryCount.set(l.supplier_id, (primaryCount.get(l.supplier_id) ?? 0) + 1)
  const calendar = suppliers
    .filter((s) => s.order_days.length === 0 && (s.rhythm?.usual_days.length ?? 0) > 0 && (primaryCount.get(s.id) ?? 0) > 0)
    .sort((a, b) => (primaryCount.get(b.id) ?? 0) - (primaryCount.get(a.id) ?? 0))
    .map((s) => s.id)

  const sync = lastLinkSync()
  return {
    suppliers,
    items,
    links,
    review: { unlinked, conflicts, calendar },
    fudo: {
      ok: expenses !== null,
      last_sync_at: sync ? new Date(sync.at).toISOString() : null,
      sync_due: !sync || now - sync.at > SYNC_STALE_MS,
    },
  }
}
