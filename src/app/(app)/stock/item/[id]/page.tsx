'use client'

import { use, useCallback, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ArrowLeft, Settings2, Loader2, PackageSearch } from 'lucide-react'
import { FadeIn } from '@/components/ui/motion'
import { EmptyState } from '@/components/ui/EmptyState'
import { STOCK_CATEGORIES } from '@/lib/constants'
import type { FichaResponse } from '../_components/types'
import { CadenaInsumo } from '../../_components/CadenaInsumo'
import {
  StockMirror,
  IncidentsBlock,
  RecipesBlock,
  PricesBlock,
  LotsBlock,
  MovementsBlock,
  SupplierBlock,
} from '../_components/FichaSections'

// ---------------------------------------------------------------------------
// LA FICHA DEL INSUMO — /stock/item/[id]
// ---------------------------------------------------------------------------
// Todo lo que se sabe de un insumo en una sola pantalla, y cada dato linkeado
// a donde se opera: stock vs Fudo, cadena, recetas, precios, lotes, kardex,
// proveedor. Un solo fetch a /api/stock/items/[id]/ficha.
// ---------------------------------------------------------------------------

async function fetcher(url: string): Promise<FichaResponse> {
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? 'No se pudo cargar la ficha')
  return data as FichaResponse
}

export default function FichaInsumoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [withExpenses, setWithExpenses] = useState(false)

  const url = `/api/stock/items/${id}/ficha${withExpenses ? '?expenses=1' : ''}`
  const { data, error, isLoading, isValidating, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  })

  const loadExpenses = useCallback(() => setWithExpenses(true), [])

  if (isLoading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[#a39e97]" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-4 pb-24">
        <BackLink />
        <EmptyState
          icon={PackageSearch}
          title="No se pudo abrir la ficha"
          description={error instanceof Error ? error.message : 'Insumo no encontrado.'}
          actionLabel="Volver a Stock"
          actionHref="/stock"
        />
      </div>
    )
  }

  const { item, fudo, incidents, recipes, produced_by, prices, supplier, lots, movements, errors, expenses } = data

  const catConfig = STOCK_CATEGORIES[item.category as keyof typeof STOCK_CATEGORIES]
  const semDot = item.semaphore === 'red'
    ? 'bg-[#ea504c]'
    : item.semaphore === 'yellow'
      ? 'bg-[#d4943a]'
      : 'bg-[#006d5a]'

  const chips: { label: string; tone: string }[] = [
    { label: fudo.label, tone: fudo.kind === 'unmapped' ? 'bg-[#fef2f2] text-[#ea504c]' : fudo.kind === 'local' ? 'bg-[#f3efe9] text-[#7d6c64]' : 'bg-[#e8f5f1] text-[#006d5a]' },
    { label: catConfig?.label ?? item.category, tone: 'bg-[#f3efe9] text-[#7d6c64]' },
  ]
  if (item.is_produced) chips.push({ label: 'Se produce en casa', tone: 'bg-[#eef3fb] text-[#3f5f8f]' })
  if (!item.is_active) chips.push({ label: 'Inactivo', tone: 'bg-[#fef2f2] text-[#ea504c]' })
  if (item.current_qty < 0) chips.push({ label: 'Negativo — contar', tone: 'bg-[#fef2f2] text-[#ea504c]' })
  if (item.shelf_life_days == null) chips.push({ label: 'Sin vida útil', tone: 'bg-[#fdf6ec] text-[#d4943a]' })

  return (
    <div className="space-y-3 pb-24">
      {/* Header ------------------------------------------------------------ */}
      <FadeIn>
        <div className="rounded-[1.5rem] border border-[#ebe6df] bg-white px-4 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <BackLink />
            <Link
              href={`/stock?meta=${item.id}`}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#faf8f5] px-2.5 py-1.5 text-[10px] font-bold text-[#7d6c64] transition hover:bg-[#f3efe9]"
            >
              <Settings2 className="size-3" />
              Configurar
            </Link>
          </div>

          <div className="mt-3 flex items-center gap-2.5">
            <span className={`size-3 shrink-0 rounded-full ${semDot}`} />
            <h1 className="font-display text-2xl font-bold leading-[1.1] tracking-tight text-[#3d2c24] sm:text-3xl">
              {item.name}
            </h1>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map(chip => (
              <span key={chip.label} className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${chip.tone}`}>
                {chip.label}
              </span>
            ))}
          </div>

          {item.notes && (
            <p className="mt-2 rounded-xl bg-[#faf8f5] px-3 py-2 text-[11px] leading-relaxed text-[#7d6c64]">
              {item.notes}
            </p>
          )}
        </div>
      </FadeIn>

      {/* Stock / Fudo ------------------------------------------------------ */}
      <FadeIn delay={0.04}>
        <StockMirror
          item={item}
          fudo={fudo}
          onRefresh={() => void mutate()}
          refreshing={isValidating}
        />
      </FadeIn>

      {incidents.length > 0 && (
        <FadeIn delay={0.06}>
          <IncidentsBlock incidents={incidents} />
        </FadeIn>
      )}

      {/* El hilo compra → producción → venta. Se oculta solo si no hay datos. */}
      <CadenaInsumo itemId={id} />

      {/* Recetas ----------------------------------------------------------- */}
      <FadeIn delay={0.08}>
        <RecipesBlock
          recipes={recipes}
          producedBy={produced_by}
          unit={item.unit}
          error={errors.recipes}
        />
      </FadeIn>

      {/* Precios ----------------------------------------------------------- */}
      <FadeIn delay={0.1}>
        <PricesBlock
          prices={prices}
          unit={item.unit}
          error={errors.prices}
          onLoadExpenses={loadExpenses}
          expensesLoading={withExpenses && isValidating}
          expenses={expenses}
        />
      </FadeIn>

      {/* Lotes ------------------------------------------------------------- */}
      <FadeIn delay={0.12}>
        <LotsBlock lots={lots} error={errors.lots} />
      </FadeIn>

      {/* Kardex ------------------------------------------------------------ */}
      <FadeIn delay={0.14}>
        <MovementsBlock movements={movements} unit={item.unit} error={errors.movements} />
      </FadeIn>

      {/* Proveedor --------------------------------------------------------- */}
      <FadeIn delay={0.16}>
        <SupplierBlock supplier={supplier} error={errors.supplier} />
      </FadeIn>

      <p className="pt-1 text-center text-[10px] text-[#c8bfb6]">
        Ficha generada {new Date(data.generated_at).toLocaleString('es-AR', { hour12: false })}
      </p>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      href="/stock"
      className="flex items-center gap-1.5 text-[11px] font-bold text-[#7d6c64] transition-colors hover:text-[#3d2c24]"
    >
      <ArrowLeft className="size-3.5" />
      Stock
    </Link>
  )
}
