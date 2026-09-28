'use client'

import { useEffect, useState, useCallback } from 'react'
import { Sparkles, RefreshCw, AlertCircle } from 'lucide-react'

type BriefingState = {
  text: string | null
  model: string | null
  loading: boolean
  error: boolean
}

export function DailyBriefing() {
  const [state, setState] = useState<BriefingState>({
    text: null,
    model: null,
    loading: true,
    error: false,
  })

  const fetchBriefing = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: false }))
    try {
      const res = await fetch('/api/ai/briefing')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setState({ text: data.text, model: data.model, loading: false, error: false })
    } catch {
      setState({ text: null, model: null, loading: false, error: true })
    }
  }, [])

  useEffect(() => {
    fetchBriefing()
  }, [fetchBriefing])

  if (state.loading) {
    return (
      <div className="rounded-xl border border-[#006d5a]/10 bg-[#f0f7f5] p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[#006d5a] animate-pulse" />
          <span className="text-xs font-semibold text-[#006d5a]">Analizando operación...</span>
        </div>
        <div className="mt-2 space-y-1.5">
          <div className="h-3 w-3/4 animate-pulse rounded bg-[#006d5a]/10" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-[#006d5a]/10" />
        </div>
      </div>
    )
  }

  if (state.error || !state.text) {
    return (
      <div className="rounded-xl border border-[#ebe6df] bg-[#faf8f5] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-[#a39e97]" />
            <span className="text-xs text-[#a39e97]">Briefing no disponible</span>
          </div>
          <button
            onClick={fetchBriefing}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-[#006d5a] hover:bg-[#e8f5f1]"
          >
            <RefreshCw className="size-3" />
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[#006d5a]/10 bg-[#f0f7f5] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-[#006d5a]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#006d5a]">Briefing del día</span>
        </div>
        <button
          onClick={fetchBriefing}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-[#006d5a]/60 hover:bg-[#006d5a]/5"
          title="Actualizar briefing"
        >
          <RefreshCw className="size-3" />
        </button>
      </div>
      <p className="text-[13px] leading-relaxed text-[#3d2c24]">
        {state.text}
      </p>
      {state.model && (
        <p className="mt-2 text-[9px] text-[#a39e97]">
          Generado por IA · {new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </div>
  )
}
