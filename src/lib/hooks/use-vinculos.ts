'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Vinculo, VinculosPayload } from '@/lib/proveedores/vinculos'

// ---------------------------------------------------------------------------
// useVinculos — estado de vínculos insumo↔proveedor con:
//   · sync automático con las compras de Fudo si el último tiene > 30 min
//   · cambios optimistas (la UI responde al toque) + reconciliación con el server
// ---------------------------------------------------------------------------

export type LinkOp = 'primary' | 'add' | 'confirm' | 'remove'
export type LinkChange = { item_id: string; supplier_id: string; op: LinkOp }

function applyLocal(p: VinculosPayload, changes: LinkChange[]): VinculosPayload {
  let links = [...p.links]
  const now = new Date().toISOString()
  const touched = new Set<string>()
  for (const c of changes) {
    touched.add(c.item_id)
    const idx = links.findIndex((l) => l.item_id === c.item_id && l.supplier_id === c.supplier_id)
    const hasPrimary = links.some((l) => l.item_id === c.item_id && l.is_primary)
    if (c.op === 'primary') {
      links = links.map((l) => (l.item_id === c.item_id ? { ...l, is_primary: l.supplier_id === c.supplier_id } : l))
      if (idx === -1) links.push(newLink(c, true, now))
      else links[idx] = { ...links[idx], is_primary: true, confirmed_at: now }
    } else if (c.op === 'add') {
      if (idx === -1) links.push(newLink(c, !hasPrimary, now))
    } else if (c.op === 'confirm') {
      if (idx !== -1) links[idx] = { ...links[idx], confirmed_at: now }
    } else if (c.op === 'remove' && idx !== -1) {
      const wasPrimary = links[idx].is_primary
      links.splice(idx, 1)
      if (wasPrimary) {
        const next = links
          .filter((l) => l.item_id === c.item_id)
          .sort((a, b) => b.fudo_purchases - a.fudo_purchases)[0]
        if (next) links = links.map((l) => (l === next ? { ...l, is_primary: true } : l))
      }
    }
  }
  const primaryOf = new Set(links.filter((l) => l.is_primary).map((l) => l.item_id))
  return {
    ...p,
    links,
    review: {
      ...p.review,
      unlinked: p.review.unlinked.filter((u) => !primaryOf.has(u.item_id)),
      conflicts: p.review.conflicts.filter((c) => !touched.has(c.item_id)),
    },
  }
}

function newLink(c: LinkChange, isPrimary: boolean, now: string): Vinculo {
  return { item_id: c.item_id, supplier_id: c.supplier_id, is_primary: isPrimary, source: 'manual', fudo_purchases: 0, last_purchase_at: null, confirmed_at: now }
}

export function useVinculos(enabled = true) {
  const [data, setData] = useState<VinculosPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoSynced = useRef(false)
  const pending = useRef(0)

  const load = useCallback(async () => {
    const res = await fetch('/api/proveedores/vinculos', { cache: 'no-store' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'No se pudieron cargar los vínculos')
    // Si hay cambios en vuelo, no pisar el estado optimista con uno viejo
    if (pending.current === 0) setData(json as VinculosPayload)
    return json as VinculosPayload
  }, [])

  const syncFudo = useCallback(async (opts: { force?: boolean; silent?: boolean } = {}) => {
    setSyncing(true)
    try {
      const res = await fetch('/api/proveedores/vinculos/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: !!opts.force }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Fudo no respondió')
      await load()
      if (!opts.silent) {
        const news = json.created + json.revived
        toast.success(news > 0 || json.autoPrimary > 0
          ? `Fudo: ${news} vínculo${news === 1 ? '' : 's'} nuevo${news === 1 ? '' : 's'}${json.autoPrimary ? `, ${json.autoPrimary} con proveedor asignado` : ''}`
          : `Al día con Fudo · ${json.expenses} compras revisadas`)
      }
    } catch (err) {
      if (!opts.silent) toast.error(err instanceof Error ? err.message : 'Error al sincronizar con Fudo')
    } finally {
      setSyncing(false)
    }
  }, [load])

  useEffect(() => {
    if (!enabled) return
    let alive = true
    ;(async () => {
      try {
        const first = await load()
        if (alive && first.fudo.sync_due && !autoSynced.current) {
          autoSynced.current = true
          void syncFudo({ silent: true })
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Error')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [enabled, load, syncFudo])

  const apply = useCallback(async (changes: LinkChange[], successMsg?: string) => {
    if (changes.length === 0) return true
    const snapshot = data
    pending.current++
    setData((d) => (d ? applyLocal(d, changes) : d))
    try {
      const res = await fetch('/api/proveedores/vinculos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar')
      if (successMsg) toast.success(successMsg)
      return true
    } catch (err) {
      setData(snapshot)
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
      return false
    } finally {
      pending.current--
      if (pending.current === 0) void load().catch(() => {})
    }
  }, [data, load])

  const saveCalendar = useCallback(async (supplierId: string, orderDays: number[], leadTimeDays: number | null) => {
    const snapshot = data
    setData((d) => d && ({
      ...d,
      suppliers: d.suppliers.map((s) => (s.id === supplierId ? { ...s, order_days: orderDays, lead_time_days: leadTimeDays } : s)),
      review: { ...d.review, calendar: d.review.calendar.filter((id) => id !== supplierId) },
    }))
    try {
      const res = await fetch('/api/proveedores/vinculos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendar: { supplier_id: supplierId, order_days: orderDays, lead_time_days: leadTimeDays } }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar')
      return true
    } catch (err) {
      setData(snapshot)
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
      return false
    }
  }, [data])

  return { data, loading, error, syncing, syncFudo, apply, saveCalendar, reload: load }
}
