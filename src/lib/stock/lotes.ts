// ---------------------------------------------------------------------------
// Cuánto queda REALMENTE de cada lote
// ---------------------------------------------------------------------------
// stock_lots.qty_remaining nunca se descuenta cuando se vende o se usa: un lote
// producido hace un mes sigue figurando entero. Tomado al pie de la letra, el
// plan de producción lo contaba como "vencido" y la alerta avisaba lotes que
// ya se comieron.
// Criterio (primero entra, primero sale): el stock actual del insumo está
// formado por los lotes MÁS NUEVOS. Se le asigna el stock a los lotes del más
// nuevo al más viejo; lo que no alcanza a cubrir ya se consumió.
// ---------------------------------------------------------------------------

export type LoteBase = {
  stock_item_id: string
  qty_remaining: number
  expires_at: string | null
  produced_at?: string | null
  created_at?: string | null
}

export type LoteVigente<T extends LoteBase> = T & { restante: number }

/** Lotes de UN insumo con lo que realmente puede quedar de cada uno. */
export function asignarStockALotes<T extends LoteBase>(lotes: T[], stockActual: number): LoteVigente<T>[] {
  let queda = Math.max(0, Number(stockActual) || 0)
  const fecha = (l: T) => l.produced_at ?? l.created_at ?? l.expires_at ?? ''
  return [...lotes]
    .sort((a, b) => fecha(b).localeCompare(fecha(a))) // más nuevo primero
    .map((l) => {
      const restante = Math.min(Math.max(0, Number(l.qty_remaining) || 0), queda)
      queda -= restante
      return { ...l, restante }
    })
}

/** Por insumo: cuánto de su stock está vencido y la próxima fecha de vencimiento. */
export function resumenLotes<T extends LoteBase>(
  lotes: T[],
  stockPorItem: Map<string, number>,
  ahoraISO = new Date().toISOString(),
): Map<string, { vencido: number; proximo: string | null }> {
  const porItem = new Map<string, T[]>()
  for (const l of lotes) porItem.set(l.stock_item_id, [...(porItem.get(l.stock_item_id) ?? []), l])
  const out = new Map<string, { vencido: number; proximo: string | null }>()
  for (const [itemId, ls] of porItem) {
    let vencido = 0
    let proximo: string | null = null
    for (const l of asignarStockALotes(ls, stockPorItem.get(itemId) ?? 0)) {
      if (l.restante <= 0 || !l.expires_at) continue
      if (l.expires_at < ahoraISO) vencido += l.restante
      else if (!proximo || l.expires_at < proximo) proximo = l.expires_at
    }
    out.set(itemId, { vencido, proximo })
  }
  return out
}
