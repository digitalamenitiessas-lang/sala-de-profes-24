'use client'

import { useEffect, useState, useMemo } from 'react'
import { ArrowLeft, Search, TrendingDown, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { FadeIn } from '@/components/ui/motion'
import type { ConsumoPayload } from '@/app/api/stock/consumo/route'

const PERIODS = [
  { days: 7, label: '7 días' },
  { days: 14, label: '14 días' },
  { days: 30, label: '30 días' },
  { days: 60, label: '60 días' },
  { days: 90, label: '90 días' },
]

export default function ConsumoPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<ConsumoPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    setData(null)
    fetch(`/api/stock/consumo?days=${days}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [days])

  const filtered = useMemo(() => {
    if (!data?.items) return []
    const q = search.toLowerCase().trim()
    if (!q) return data.items
    return data.items.filter(i => i.name.toLowerCase().includes(q))
  }, [data, search])

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-28">
      <FadeIn>
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link href="/stock" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
            <ArrowLeft className="size-4 text-[#3d2c24]" />
          </Link>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-[#3d2c24]">Consumo de insumos</h1>
            <p className="text-[11px] text-[#7d6c64]">Calculado desde ventas Fudo × recetas</p>
          </div>
        </div>

        {/* Period selector */}
        <div className="flex gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {PERIODS.map(p => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                days === p.days
                  ? 'bg-[#006d5a] text-white'
                  : 'bg-secondary text-[#7d6c64]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[#7d6c64]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar insumo..."
            className="w-full rounded-xl bg-secondary py-2.5 pl-9 pr-4 text-sm outline-none placeholder:text-[#7d6c64]"
          />
        </div>

        {/* Período info */}
        {data && !loading && (
          <p className="text-[11px] text-[#7d6c64]">
            {data.from} → {data.to} · {data.items.length} insumos con consumo
          </p>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-[#006d5a]" />
          </div>
        )}

        {/* Table */}
        {!loading && data && (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <TrendingDown className="size-8 text-[#7d6c64]" />
                <p className="text-sm font-medium text-[#3d2c24]">Sin datos de consumo</p>
                <p className="text-[11px] text-[#7d6c64]">Verificá que haya recetas cargadas con insumos</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#f0ebe8]">
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[#7d6c64]">Insumo</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-[#7d6c64]">
                      Consumido ({PERIODS.find(p => p.days === days)?.label})
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, i) => (
                    <tr key={item.stock_item_id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#faf8f7]'}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#3d2c24]">{item.name}</p>
                        <p className="mt-0.5 text-[10px] text-[#7d6c64] line-clamp-1">
                          {item.from_dishes.slice(0, 3).join(', ')}
                          {item.from_dishes.length > 3 && ` +${item.from_dishes.length - 3} más`}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-semibold text-[#3d2c24]">
                          {item.consumed % 1 === 0 ? item.consumed : item.consumed.toLocaleString('es-AR', { maximumFractionDigits: 2 })}
                        </span>
                        <span className="ml-1 text-[11px] text-[#7d6c64]">{item.unit}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </FadeIn>
    </div>
  )
}
