'use client'

import { useEffect, useState } from 'react'
import { FileText, Loader2, RefreshCw } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { FadeIn } from '@/components/ui/motion'
import { Button } from '@/components/ui/button'

export function ExecutiveSummary() {
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [source, setSource] = useState<'ai' | 'data' | null>(null)

  async function fetchSummary() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/summary')
      if (res.ok) {
        const data = await res.json()
        setSummary(data.summary)
        setSource(data.source)
      }
    } catch {
      setSummary('No se pudo generar el resumen.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSummary() }, [])

  if (loading) {
    return (
      <div className="card-elevated-lg space-y-3 rounded-2xl p-5">
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin text-[#006d5a]" />
          <span className="section-label">Generando resumen...</span>
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    )
  }

  return (
    <FadeIn>
      <div className="card-elevated-lg rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-[#006d5a]" />
            <span className="section-label">Resumen ejecutivo</span>
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={fetchSummary}
            className="gap-1 text-[10px] text-[#a39e97]"
          >
            <RefreshCw className="size-3" />
            Actualizar
          </Button>
        </div>
        <div className="mt-3 space-y-1.5 text-sm leading-relaxed text-[#3d2c24]">
          {summary?.split('\n').map((line, i) => (
            <p key={i} className={line.includes('⚠️') || line.includes('crítico') ? 'font-medium text-[#ea504c]' : ''}>
              {line}
            </p>
          ))}
        </div>
        {source === 'ai' && (
          <p className="mt-3 text-[10px] text-[#a39e97]">Generado por IA · Basado en datos reales del sistema</p>
        )}
      </div>
    </FadeIn>
  )
}
