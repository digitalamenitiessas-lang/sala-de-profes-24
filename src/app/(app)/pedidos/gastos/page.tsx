'use client'

// ---------------------------------------------------------------------------
// /pedidos/gastos — Historial de compras por período y proveedor
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { format, subMonths, startOfMonth, endOfMonth, startOfWeek, subWeeks } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ArrowLeft, BarChart3, Package, ChevronDown, ChevronUp, TrendingUp, Loader2,
} from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { FadeIn } from '@/components/ui/motion'

type PeriodKey = 'semana' | 'mes' | 'mes_pasado' | 'tres_meses' | 'anio'

type ReceiptRow = {
  id: number
  supplier_id: string | null
  supplier_name: string
  qty: number
  unit: string | null
  cost_total: number | null
  cost_per_unit: number | null
  note: string | null
  received_date: string
  payment_status: string | null
}

type SupplierGroup = {
  key: string
  name: string
  total: number
  receipts: ReceiptRow[]
}

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'semana', label: 'Esta semana' },
  { key: 'mes', label: 'Este mes' },
  { key: 'mes_pasado', label: 'Mes pasado' },
  { key: 'tres_meses', label: '3 meses' },
  { key: 'anio', label: 'Este año' },
]

function getPeriodDates(key: PeriodKey): { from: string; to: string } {
  const today = new Date()
  const fmt = (d: Date) => format(d, 'yyyy-MM-dd')
  switch (key) {
    case 'semana':
      return { from: fmt(startOfWeek(today, { weekStartsOn: 1 })), to: fmt(today) }
    case 'mes':
      return { from: fmt(startOfMonth(today)), to: fmt(today) }
    case 'mes_pasado': {
      const last = subMonths(today, 1)
      return { from: fmt(startOfMonth(last)), to: fmt(endOfMonth(last)) }
    }
    case 'tres_meses':
      return { from: fmt(subMonths(today, 3)), to: fmt(today) }
    case 'anio':
      return { from: `${today.getFullYear()}-01-01`, to: fmt(today) }
  }
}

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`

export default function GastosPage() {
  const { profile } = useProfileContext()
  const [period, setPeriod] = useState<PeriodKey>('mes')
  const [loading, setLoading] = useState(true)
  const [receipts, setReceipts] = useState<ReceiptRow[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  const canManage = isManagerOrAbove(profile?.role)

  const fetchData = useCallback(async (key: PeriodKey) => {
    setLoading(true)
    setExpanded(null)
    const { from, to } = getPeriodDates(key)
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data } = await supabase
      .from('stock_receipts')
      .select('id, supplier_id, qty, unit, cost_total, cost_per_unit, note, received_date, payment_status, suppliers!stock_receipts_supplier_id_fkey(name)')
      .not('cost_total', 'is', null)
      .gte('received_date', from)
      .lte('received_date', to)
      .order('received_date', { ascending: false })
      .limit(500)

    setReceipts(
      ((data ?? []) as unknown as (Omit<ReceiptRow, 'supplier_name'> & { suppliers: { name: string } | null })[])
        .map((r) => ({ ...r, supplier_name: r.suppliers?.name ?? 'Sin proveedor' }))
    )
    setLoading(false)
  }, [])

  useEffect(() => { void fetchData(period) }, [period, fetchData])

  const total = useMemo(() => receipts.reduce((s, r) => s + (Number(r.cost_total) || 0), 0), [receipts])

  const groups = useMemo((): SupplierGroup[] => {
    const map = new Map<string, SupplierGroup>()
    for (const r of receipts) {
      const key = r.supplier_id ?? 'none'
      const g = map.get(key) ?? { key, name: r.supplier_name, total: 0, receipts: [] }
      g.total += Number(r.cost_total) || 0
      g.receipts.push(r)
      map.set(key, g)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [receipts])

  if (!canManage) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-sm text-[#a39e97]">Solo encargados pueden ver esta pantalla</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-28">
      <FadeIn>
        <div className="flex items-center gap-3">
          <Link href="/pedidos" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-[#ebe6df] active:scale-95">
            <ArrowLeft className="size-4 text-[#3d2c24]" />
          </Link>
          <div>
            <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Gastos de compras</h1>
            <p className="section-label mt-0.5">Historial por proveedor y período</p>
          </div>
        </div>
      </FadeIn>

      {/* Selector de período */}
      <FadeIn delay={0.03}>
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                'shrink-0 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-all',
                period === p.key
                  ? 'bg-[#3d2c24] text-white'
                  : 'bg-white text-[#7d6c64] ring-1 ring-[#ebe6df] active:scale-95',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </FadeIn>

      {/* Resumen del período */}
      <FadeIn delay={0.05}>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-[#ebe6df]">
          {loading ? (
            <div className="flex items-center gap-3">
              <Loader2 className="size-5 animate-spin text-[#006d5a]" />
              <span className="text-sm text-[#a39e97]">Cargando…</span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#fdf6ec]">
                <BarChart3 className="size-5 text-[#8b5e34]" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Total comprado</p>
                <p className="font-display text-2xl font-bold tabular-nums text-[#3d2c24]">{fmtMoney(total)}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold tabular-nums text-[#d4943a]">{receipts.length}</p>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">recibos</p>
              </div>
            </div>
          )}
        </div>
      </FadeIn>

      {/* Por proveedor */}
      {!loading && groups.map((group, gi) => {
        const isExpanded = expanded === group.key
        const pct = total > 0 ? Math.round((group.total / total) * 100) : 0
        return (
          <FadeIn key={group.key} delay={gi * 0.02}>
            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
              <button
                onClick={() => setExpanded(isExpanded ? null : group.key)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#e8f5f1]">
                  <Package className="size-4 text-[#006d5a]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#3d2c24]">{group.name}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f3efe9]">
                      <div className="h-full rounded-full bg-[#006d5a] transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="shrink-0 text-[10px] font-semibold text-[#a39e97]">{pct}%</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block text-sm font-bold tabular-nums text-[#3d2c24]">{fmtMoney(group.total)}</span>
                  <span className="text-[10px] text-[#a39e97]">{group.receipts.length} recibo{group.receipts.length !== 1 ? 's' : ''}</span>
                </div>
                {isExpanded ? <ChevronUp className="size-4 shrink-0 text-[#a39e97]" /> : <ChevronDown className="size-4 shrink-0 text-[#a39e97]" />}
              </button>

              {isExpanded && (
                <div className="divide-y border-t">
                  {group.receipts.map((r) => {
                    const label = r.note ?? `${r.qty} ${r.unit ?? 'u'}`
                    return (
                      <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-[#3d2c24]">{label}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-[#a39e97]">
                            <span>{format(new Date(`${r.received_date}T12:00:00`), 'd MMM yyyy', { locale: es })}</span>
                            {r.qty > 0 && r.unit && <span>· {r.qty} {r.unit}</span>}
                            {r.cost_per_unit != null && r.cost_per_unit > 0 && r.unit && (
                              <span>· {fmtMoney(r.cost_per_unit)}/{r.unit}</span>
                            )}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="block text-xs font-bold tabular-nums text-[#3d2c24]">{fmtMoney(Number(r.cost_total) || 0)}</span>
                          <span className={cn(
                            'text-[10px] font-semibold',
                            r.payment_status === 'pagado' ? 'text-[#006d5a]' : 'text-[#d4943a]',
                          )}>
                            {r.payment_status === 'pagado' ? 'pagado' : 'a pagar'}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </FadeIn>
        )
      })}

      {!loading && receipts.length === 0 && (
        <FadeIn>
          <div className="flex flex-col items-center py-10 text-center">
            <TrendingUp className="size-10 text-[#ebe6df]" />
            <p className="mt-4 text-sm font-medium text-[#a39e97]">Sin compras registradas en este período</p>
          </div>
        </FadeIn>
      )}
    </div>
  )
}
