'use client'

import type { ReactNode } from 'react'
import { BarChart3 } from 'lucide-react'

type ChartCardProps = {
  title: string
  subtitle?: string
  isEmpty?: boolean
  emptyMessage?: string
  children: ReactNode
}

export function ChartCard({ title, subtitle, isEmpty, emptyMessage, children }: ChartCardProps) {
  return (
    <div className="card-elevated-lg overflow-hidden rounded-2xl p-5">
      <p className="section-label">{title}</p>
      {subtitle && <p className="mt-0.5 text-xs text-[#a39e97]">{subtitle}</p>}
      <div className="mt-4">
        {isEmpty ? (
          <div className="flex flex-col items-center py-8 text-center">
            <BarChart3 className="size-8 text-[#ebe6df]" />
            <p className="mt-3 text-sm font-medium text-[#a39e97]">
              {emptyMessage ?? 'Sin datos para mostrar'}
            </p>
            <p className="mt-0.5 text-xs text-[#a39e97]/70">
              Los datos aparecerán cuando haya actividad
            </p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
