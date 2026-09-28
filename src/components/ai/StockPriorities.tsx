'use client'

import { useEffect, useState, useCallback } from 'react'
import { Sparkles, AlertTriangle, Truck, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import type { StockPriority } from '@/lib/ai/stock-priorities'

type PrioritiesResponse = {
  priorities: StockPriority[]
  aiExplanation: string | null
  total: number
  critical: number
  noSupplier: number
}

export function StockPriorities() {
  const [data, setData] = useState<PrioritiesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ai/stock-priorities')
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetch_() }, [fetch_])

  if (loading) {
    return (
      <div className="rounded-xl border border-[#006d5a]/10 bg-[#f0f7f5] p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-[#006d5a] animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#006d5a]">Analizando prioridades...</span>
        </div>
        <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-[#006d5a]/10" />
      </div>
    )
  }

  if (!data || data.priorities.length === 0) return null

  const top = data.priorities.slice(0, expanded ? 10 : 3)

  return (
    <div className="rounded-xl border border-[#006d5a]/10 bg-[#f0f7f5] p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-[#006d5a]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#006d5a]">
            Prioridades IA · {data.critical} críticos · {data.noSupplier} sin proveedor
          </span>
        </div>
        <button onClick={fetch_} className="rounded-lg p-1 hover:bg-[#006d5a]/10">
          <RefreshCw className="size-3 text-[#006d5a]/60" />
        </button>
      </div>

      {/* AI explanation */}
      {data.aiExplanation && (
        <p className="text-[12px] leading-relaxed text-[#3d2c24]">{data.aiExplanation}</p>
      )}

      {/* Priority items */}
      <div className="space-y-1.5">
        {top.map((p) => (
          <div
            key={p.item_id}
            className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2"
          >
            {/* Status dot */}
            <div className={`size-2 shrink-0 rounded-full ${
              p.status === 'critico' ? 'bg-[#ea504c]' : p.status === 'atencion' ? 'bg-[#d4943a]' : 'bg-[#006d5a]'
            }`} />

            {/* Item info */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-[#3d2c24]">{p.item_name}</p>
              <p className="text-[10px] text-[#a39e97]">{p.suggested_action}</p>
            </div>

            {/* Supplier badge */}
            {p.supplier_status === 'sin_proveedor' ? (
              <span className="flex items-center gap-0.5 rounded-full bg-[#fef2f2] px-2 py-0.5 text-[9px] font-semibold text-[#ea504c]">
                <Truck className="size-2.5" />
                Sin prov.
              </span>
            ) : (
              <span className="text-[9px] text-[#a39e97] truncate max-w-[80px]">{p.supplier_name}</span>
            )}

            {/* Score */}
            <span className={`shrink-0 text-[10px] font-bold tabular-nums ${
              p.priority_score >= 60 ? 'text-[#ea504c]' : p.priority_score >= 30 ? 'text-[#d4943a]' : 'text-[#006d5a]'
            }`}>
              {p.priority_score}
            </span>
          </div>
        ))}
      </div>

      {/* Expand/collapse */}
      {data.priorities.length > 3 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-center gap-1 rounded-lg py-1 text-[10px] font-semibold text-[#006d5a] hover:bg-[#006d5a]/5"
        >
          {expanded ? (
            <><ChevronUp className="size-3" /> Mostrar menos</>
          ) : (
            <><ChevronDown className="size-3" /> Ver {data.priorities.length - 3} más</>
          )}
        </button>
      )}

      <p className="text-[9px] text-[#a39e97]">
        Basado en datos reales · No incluye consumo estimado
      </p>
    </div>
  )
}
