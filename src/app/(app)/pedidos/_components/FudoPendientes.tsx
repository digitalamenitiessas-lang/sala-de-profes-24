'use client'

import { useEffect, useState } from 'react'
import { traerDeFudo, type PendienteFudo } from './LlegoDeMas'
import type { StockLite } from './shared'

// ---------------------------------------------------------------------------
// Lo que está en el Fudo de la 24 y todavía no en la app, para elegirlo al
// recibir un envío de Santa Fe o al vincular un producto del cierre. La app
// trae los insumos nuevos de Fudo a la noche (cron fudo-sync); hasta entonces
// no aparecían y no se podía confirmar el envío (17/11: bombita de queso y
// suprema de pollo, creadas ese día en Fudo). Al elegir uno se crea en stock
// en el momento (POST /api/stock/create-from-fudo, encargado o socio).
// Solo insumos con "Controlar stock" (lo que se le pide a la 24 al crearlos)
// y productos con control y stock cargado: sin ?sin_stock=1, a propósito.
// ---------------------------------------------------------------------------

const PREFIJO = 'fudo:'

/** Se pide a Fudo una sola vez, y solo si hace falta (hay algo sin elegir) */
export function useFudoPendientes(activo: boolean) {
  const [lista, setLista] = useState<PendienteFudo[] | null>(null)
  useEffect(() => {
    if (!activo || lista) return
    let vivo = true
    void (async () => {
      const r = await fetch('/api/stock/create-from-fudo', { cache: 'no-store' }).catch(() => null)
      const j = r?.ok ? await r.json().catch(() => null) : null
      if (!vivo) return
      setLista([
        ...((j?.unmapped_ingredients ?? []) as { id: string; name: string; unit?: string }[]).map((i) => ({ id: String(i.id), name: i.name, unit: i.unit, tipo: 'ingrediente' as const })),
        ...((j?.unmapped_products ?? []) as { id: string; name: string }[]).map((p) => ({ id: String(p.id), name: p.name, unit: 'unidad', tipo: 'producto' as const })),
      ])
    })()
    return () => { vivo = false }
  }, [activo, lista])

  /** Si el valor elegido es de Fudo, lo crea en stock y devuelve el insumo; si no, null */
  async function traer(valor: string): Promise<StockLite | null> {
    if (!valor.startsWith(PREFIJO)) return null
    const p = lista?.find((x) => `${PREFIJO}${x.tipo}:${x.id}` === valor)
    if (!p) return null
    const item = await traerDeFudo(p)
    setLista((prev) => prev?.filter((x) => x !== p) ?? null)
    return item
  }

  return { lista, traer, esDeFudo: (valor: string) => valor.startsWith(PREFIJO) }
}

export function OpcionesFudo({ lista }: { lista: PendienteFudo[] | null }) {
  if (!lista?.length) return null
  return (
    <optgroup label="Están en Fudo, todavía no en la app">
      {lista.map((p) => (
        <option key={`${p.tipo}:${p.id}`} value={`${PREFIJO}${p.tipo}:${p.id}`}>{p.name}{p.unit ? ` (${p.unit})` : ''}</option>
      ))}
    </optgroup>
  )
}
