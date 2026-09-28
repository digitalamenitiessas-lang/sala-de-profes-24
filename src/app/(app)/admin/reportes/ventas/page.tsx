'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Download, Loader2, BarChart2, Clock, FileText, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/ui/motion'
import { MomentosView } from '@/app/(app)/ventas/_components/MomentosView'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type ReporteDish = {
  menu_item_id: string
  name: string
  category: string
  units: number
  avg_price: number
  cost_per_portion: number
  food_cost_pct: number
}

type BrokenDish = {
  menu_item_id: string
  name: string
  category: string
  units: number
  missing_items: string[]
}

type ReportePayload = {
  days: number
  from: string
  to: string
  dishes: ReporteDish[]
  broken: BrokenDish[]
  generated_at: string
}

type DishWithMargin = ReporteDish & { margin_per_unit: number; total_margin: number }
type SortKey = 'total_margin' | 'units' | 'food_cost_pct'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number) {
  return `$${n.toLocaleString('es-AR')}`
}

function foodCostStyle(pct: number): React.CSSProperties {
  if (pct <= 30) return { color: '#006d5a', backgroundColor: '#e8f5f1' }
  if (pct <= 40) return { color: '#d4943a', backgroundColor: '#fdf6ec' }
  return { color: '#ea504c', backgroundColor: '#fef2f2' }
}

function downloadCSV(data: ReportePayload, dishes: DishWithMargin[]) {
  const headers = ['Producto', 'Categoría', 'Unidades vendidas', 'Precio promedio', 'Costo por porción', 'Margen/unidad', 'Food Cost %', 'Margen total']
  const rows = dishes.map(d => [
    d.name,
    d.category,
    String(d.units),
    String(d.avg_price),
    String(d.cost_per_portion),
    String(d.margin_per_unit),
    `${d.food_cost_pct}%`,
    String(d.total_margin),
  ])
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `reporte-ventas-${data.days}d-${data.from}-${data.to}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function downloadPDF(data: ReportePayload, dishes: DishWithMargin[]) {
  const recomendados = dishes.filter(d => d.food_cost_pct <= 35)

  const fcColor = (pct: number) =>
    pct <= 30 ? '#006d5a' : pct <= 40 ? '#d4943a' : '#ea504c'

  const rows = dishes.map(d => `
    <tr>
      <td class="name">${d.name}${d.food_cost_pct <= 35 ? ' <span class="star">★</span>' : ''}</td>
      <td>${d.category || '—'}</td>
      <td class="num">${d.units.toLocaleString('es-AR')}</td>
      <td class="num">$${d.avg_price.toLocaleString('es-AR')}</td>
      <td class="num">$${d.cost_per_portion.toLocaleString('es-AR')}</td>
      <td class="num">$${d.margin_per_unit.toLocaleString('es-AR')}</td>
      <td class="num"><span style="color:${fcColor(d.food_cost_pct)};font-weight:700">${d.food_cost_pct}%</span></td>
      <td class="num total">$${d.total_margin.toLocaleString('es-AR')}</td>
    </tr>
  `).join('')

  const recomendadosBlock = recomendados.length > 0 ? `
    <div class="highlight">
      <div class="highlight-title">★ Recomendados para promocionar — Food Cost ≤ 35%</div>
      <ul>
        ${recomendados.slice(0, 12).map(d =>
          `<li><strong>${d.name}</strong> — margen $${d.margin_per_unit.toLocaleString('es-AR')}/unidad · ${d.food_cost_pct}% food cost · margen total $${d.total_margin.toLocaleString('es-AR')}</li>`
        ).join('')}
      </ul>
    </div>
  ` : ''

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte de Ventas · La Vieja Escuela</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11px; color: #1a1a1a; padding: 24px 28px; }
  h1 { font-size: 20px; font-weight: 700; color: #3d2c24; margin-bottom: 2px; }
  .subtitle { color: #a39e97; font-size: 11px; margin-bottom: 18px; }
  .highlight { background: #e8f5f1; border-left: 4px solid #006d5a; border-radius: 6px; padding: 10px 14px; margin-bottom: 18px; }
  .highlight-title { font-size: 11px; font-weight: 700; color: #006d5a; margin-bottom: 7px; }
  .highlight ul { list-style: none; }
  .highlight li { padding: 2px 0; color: #1a1a1a; }
  .highlight li::before { content: "· "; color: #006d5a; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #faf8f5; border-bottom: 2px solid #ebe6df; text-align: left; padding: 6px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: #a39e97; font-weight: 600; }
  th.r { text-align: right; }
  td { padding: 5px 8px; border-bottom: 1px solid #f3efe9; font-size: 11px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.name { font-weight: 600; color: #3d2c24; }
  td.total { font-weight: 700; color: #006d5a; }
  .star { color: #006d5a; }
  .footer { margin-top: 14px; font-size: 9px; color: #a39e97; display: flex; justify-content: space-between; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<h1>Reporte de Ventas · La Vieja Escuela</h1>
<p class="subtitle">Últimos ${data.days} días · ${data.from} → ${data.to} · Solo productos con receta de costo completo</p>
${recomendadosBlock}
<table>
  <thead>
    <tr>
      <th>Producto</th>
      <th>Categoría</th>
      <th class="r">Unidades</th>
      <th class="r">Precio</th>
      <th class="r">Costo</th>
      <th class="r">Margen/u</th>
      <th class="r">Food Cost</th>
      <th class="r">Margen total</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">
  <span>${dishes.length} productos · generado ${new Date(data.generated_at).toLocaleString('es-AR')}</span>
  <span>★ food cost ≤ 35% · recomendados para promocionar</span>
</div>
</body>
</html>`

  const win = window.open('', '_blank')
  if (!win) {
    toast.error('El navegador bloqueó la ventana emergente. Habilitá los pop-ups para este sitio.')
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  win.print()
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

type Tab = 'tabla' | 'momentos'
const DAY_OPTIONS = [30, 60, 90] as const

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'total_margin', label: 'Margen total' },
  { key: 'units', label: 'Unidades' },
  { key: 'food_cost_pct', label: 'Food Cost' },
]

export default function ReporteVentasPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('tabla')
  const [days, setDays] = useState<30 | 60 | 90>(30)
  const [data, setData] = useState<ReportePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortKey>('total_margin')

  const load = useCallback(async () => {
    setLoading(true)
    setData(null)
    try {
      const res = await fetch(`/api/ventas/reporte?days=${days}`, { credentials: 'include' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string })?.error ?? 'Error al cargar el reporte')
      }
      setData(await res.json() as ReportePayload)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cargar el reporte')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { void load() }, [load])

  const sortedDishes = useMemo((): DishWithMargin[] => {
    if (!data) return []
    const enriched = data.dishes.map(d => ({
      ...d,
      margin_per_unit: d.avg_price - d.cost_per_portion,
      total_margin: (d.avg_price - d.cost_per_portion) * d.units,
    }))
    return enriched.sort((a, b) => {
      if (sortBy === 'units') return b.units - a.units
      if (sortBy === 'food_cost_pct') return a.food_cost_pct - b.food_cost_pct
      return b.total_margin - a.total_margin
    })
  }, [data, sortBy])

  return (
    <div className="space-y-5">
      {/* Header */}
      <FadeIn>
        <button
          onClick={() => router.push('/admin/reportes')}
          className="mb-1 flex items-center gap-1 text-[11px] text-[#a39e97] active:opacity-60"
        >
          <ChevronLeft className="size-3.5" />
          Reportes
        </button>
        <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Ventas</h2>
        <p className="section-label mt-1">Margen y food cost por producto · recetas completas</p>
      </FadeIn>

      {/* Tabs */}
      <div className="flex rounded-full bg-secondary p-0.5">
        {([
          { key: 'tabla' as Tab, label: 'Tabla', Icon: BarChart2 },
          { key: 'momentos' as Tab, label: 'Momentos', Icon: Clock },
        ] as const).map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-[12px] font-semibold transition-colors ${
              tab === key ? 'bg-[#006d5a] text-white' : 'text-muted-foreground'
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {tab === 'tabla' ? (
        <div className="space-y-4">
          {/* Período + ordenar + descargas */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-full bg-secondary p-0.5">
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                    days === d ? 'bg-[#006d5a] text-white' : 'text-muted-foreground'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            {data && data.dishes.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadCSV(data, sortedDishes)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[11px] font-semibold text-[#3d2c24] active:opacity-80"
                >
                  <Download className="size-3.5" />
                  CSV
                </button>
                <button
                  onClick={() => downloadPDF(data, sortedDishes)}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#3d2c24] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm active:opacity-80"
                >
                  <FileText className="size-3.5" />
                  PDF
                </button>
              </div>
            )}
          </div>

          {/* Ordenar */}
          {data && data.dishes.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[#a39e97]">Ordenar</span>
              <div className="flex rounded-full bg-secondary p-0.5">
                {SORT_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setSortBy(key)}
                    className={`rounded-full px-3 py-1 text-[10px] font-semibold transition-colors ${
                      sortBy === key ? 'bg-[#006d5a] text-white' : 'text-muted-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Estado de carga */}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 size-5 animate-spin" />
              Calculando costos…
            </div>
          ) : !data || data.dishes.length === 0 ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-[#ebe6df]">
              <p className="text-[14px] font-semibold text-[#3d2c24]">Sin productos con receta completa</p>
              <p className="mt-1 text-[12px] text-[#a39e97]">
                Solo aparecen productos con todos los ingredientes costeados y ventas en el período.
              </p>
            </div>
          ) : (
            <FadeIn>
              <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-[12px]">
                    <thead>
                      <tr className="border-b border-[#ebe6df] bg-[#faf8f5]">
                        <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Producto</th>
                        <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Cat.</th>
                        <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Unidades</th>
                        <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Precio</th>
                        <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Costo</th>
                        <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Margen/u</th>
                        <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Food Cost</th>
                        <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Margen total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f3efe9]">
                      {sortedDishes.map((dish) => (
                        <tr key={dish.menu_item_id} className="transition-colors hover:bg-[#faf8f5]">
                          <td className="px-4 py-2.5">
                            <span className="font-semibold text-[#3d2c24]">{dish.name}</span>
                            {dish.food_cost_pct <= 35 && (
                              <span
                                className="ml-1.5 text-[10px] text-[#006d5a]"
                                title="Food cost ≤ 35% — buen candidato para promocionar"
                              >
                                ★
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-[#a39e97]">{dish.category || '—'}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#3d2c24]">
                            {dish.units.toLocaleString('es-AR')}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[#3d2c24]">
                            {fmt(dish.avg_price)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[#3d2c24]">
                            {fmt(dish.cost_per_portion)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#3d2c24]">
                            {fmt(dish.margin_per_unit)}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span
                              className="rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
                              style={foodCostStyle(dish.food_cost_pct)}
                            >
                              {dish.food_cost_pct}%
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-bold text-[#006d5a]">
                            {fmt(dish.total_margin)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-[#ebe6df] px-4 py-2.5">
                  <p className="text-[10px] text-[#a39e97]">
                    {data.dishes.length} productos · {data.from} → {data.to}
                  </p>
                  <p className="text-[10px] text-[#a39e97]">
                    ★ food cost ≤ 35% · recomendados para promocionar
  </p>
                </div>
              </div>
            </FadeIn>
          )}

          {/* Recetas con costo roto */}
          {data && data.broken && data.broken.length > 0 && (
            <FadeIn>
              <details className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-[#ebe6df]">
                <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 hover:bg-[#faf8f5]">
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="size-3.5 text-[#d4943a]" />
                    <span className="text-[12px] font-semibold text-[#3d2c24]">
                      {data.broken.length} productos sin costo completo — excluidos del reporte
                    </span>
                  </span>
                  <span className="text-[10px] text-[#a39e97] group-open:hidden">Ver detalle</span>
                  <span className="hidden text-[10px] text-[#a39e97] group-open:inline">Cerrar</span>
                </summary>
                <div className="overflow-x-auto border-t border-[#ebe6df]">
                  <table className="w-full min-w-[480px] text-[12px]">
                    <thead>
                      <tr className="bg-[#faf8f5]">
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Producto</th>
                        <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Cat.</th>
                        <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Unidades</th>
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Qué falta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f3efe9]">
                      {data.broken.map((dish) => (
                        <tr key={dish.menu_item_id} className="hover:bg-[#faf8f5]">
                          <td className="px-4 py-2 font-semibold text-[#3d2c24]">{dish.name}</td>
                          <td className="px-3 py-2 text-[#a39e97]">{dish.category || '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#3d2c24]">{dish.units.toLocaleString('es-AR')}</td>
                          <td className="px-4 py-2 text-[#d4943a]">
                            {dish.missing_items.join(' · ') || 'receta vacía'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </FadeIn>
          )}
        </div>
      ) : (
        <MomentosView />
      )}
    </div>
  )
}
