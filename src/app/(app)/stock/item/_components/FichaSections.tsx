'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Truck,
  Phone,
  ChefHat,
  Package,
  Layers,
  History,
  Receipt,
  RefreshCw,
} from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { formatQty } from '@/lib/stock/helpers'
import { esCostoConfiable, etiquetaFuenteCosto } from '@/lib/costos/confiable'
import type {
  FichaFudo,
  FichaItem,
  FichaLot,
  FichaMovement,
  FichaPrices,
  FichaRecipe,
  FichaSupplier,
  FichaIncident,
  FichaResponse,
} from './types'

// ---------------------------------------------------------------------------
// Shell de sección — todas las tarjetas de la ficha comparten esta caja
// ---------------------------------------------------------------------------

export function Section({
  eyebrow,
  title,
  icon: Icon,
  action,
  error,
  children,
}: {
  eyebrow: string
  title: string
  icon?: React.ComponentType<{ className?: string }>
  action?: ReactNode
  error?: string | null
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-[#ebe6df] bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-[#f1ece6] px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#a39e97]">{eyebrow}</p>
          <h2 className="mt-0.5 flex items-center gap-1.5 text-[15px] font-bold text-[#3d2c24]">
            {Icon && <Icon className="size-4 text-[#a39e97]" />}
            {title}
          </h2>
        </div>
        {action}
      </div>
      <div className="px-4 py-3">
        {error ? (
          <p className="rounded-xl bg-[#fff7f7] px-3 py-2 text-[11px] font-semibold text-[#ea504c]">
            No se pudo cargar este bloque: {error}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="py-2 text-center text-[12px] text-[#a39e97]">{text}</p>
}

function money(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${Math.round(n).toLocaleString('es-AR')}`
}

function fecha(iso: string | null | undefined, pattern = 'd MMM yyyy') {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return format(d, pattern, { locale: es })
}

// ---------------------------------------------------------------------------
// EL ESPEJO — stock LVE vs stock Fudo con la diferencia al medio
// ---------------------------------------------------------------------------

export function StockMirror({
  item,
  fudo,
  onRefresh,
  refreshing,
}: {
  item: FichaItem
  fudo: FichaFudo
  onRefresh: () => void
  refreshing: boolean
}) {
  const hasDiff = fudo.diff != null && Math.abs(fudo.diff) >= 0.01
  const sem = item.semaphore
  const semTone = sem === 'red'
    ? { text: 'text-[#ea504c]', bg: 'bg-[#fff7f7]', ring: 'ring-[#f3d0cf]' }
    : sem === 'yellow'
      ? { text: 'text-[#d4943a]', bg: 'bg-[#fffaf2]', ring: 'ring-[#f1dfba]' }
      : { text: 'text-[#006d5a]', bg: 'bg-[#f6fcfa]', ring: 'ring-[#dcefe8]' }

  return (
    <Section
      eyebrow="El reflejo"
      title="Stock LVE vs Fudo"
      icon={Package}
      action={
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="flex shrink-0 items-center gap-1 rounded-xl bg-[#faf8f5] px-2.5 py-1.5 text-[10px] font-bold text-[#7d6c64] transition hover:bg-[#f3efe9] disabled:opacity-50"
        >
          <RefreshCw className={`size-3 ${refreshing ? 'animate-spin' : ''}`} />
          Releer
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <div className={`rounded-2xl px-3 py-3 ring-1 ${semTone.bg} ${semTone.ring}`}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">LVE</p>
          <p className={`mt-0.5 font-display text-3xl font-bold leading-none tabular-nums ${semTone.text}`}>
            {formatQty(item.current_qty)}
          </p>
          <p className="mt-1 text-[10px] text-[#a39e97]">
            {item.unit} · mínimo {formatQty(item.min_qty)}
          </p>
        </div>

        <div className="rounded-2xl bg-[#faf8f5] px-3 py-3 ring-1 ring-[#ebe6df]">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Fudo</p>
          <p className="mt-0.5 font-display text-3xl font-bold leading-none tabular-nums text-[#3d2c24]">
            {fudo.fudo_qty == null ? '—' : formatQty(fudo.fudo_qty)}
          </p>
          <p className="mt-1 truncate text-[10px] text-[#a39e97]">
            {fudo.fudo_qty == null
              ? (fudo.linked ? 'No se pudo leer ahora' : 'No vinculado a Fudo')
              : `${item.unit}${fudo.fudo_name ? ` · ${fudo.fudo_name}` : ''}`}
          </p>
        </div>
      </div>

      {fudo.diff != null && (
        <div
          className={`mt-2 flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 ring-1 ${
            hasDiff ? 'bg-[#fff7f7] ring-[#f3d0cf]' : 'bg-[#f6fcfa] ring-[#dcefe8]'
          }`}
        >
          <span className={`text-[11px] font-bold ${hasDiff ? 'text-[#ea504c]' : 'text-[#006d5a]'}`}>
            {hasDiff ? 'Fudo y LVE no coinciden' : 'Fudo y LVE coinciden'}
          </span>
          <span className={`font-display text-lg font-bold tabular-nums ${hasDiff ? 'text-[#ea504c]' : 'text-[#006d5a]'}`}>
            {fudo.diff > 0 ? '+' : ''}{formatQty(fudo.diff)} {item.unit}
          </span>
        </div>
      )}

      {fudo.error && (
        <p className="mt-2 rounded-xl bg-[#fffaf2] px-3 py-2 text-[11px] font-semibold text-[#8b5e34]">
          Fudo no respondió: {fudo.error}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[#f1ece6] pt-3 text-[11px]">
        <Meta label="Vínculo" value={fudo.label} />
        <Meta
          label="ID Fudo"
          value={fudo.fudo_ingredient_id ?? fudo.fudo_product_id ?? '—'}
        />
        <Meta label="Vida útil" value={item.shelf_life_days ? `${item.shelf_life_days} días` : 'Sin definir'} />
        <Meta label="Último conteo" value={item.last_counted_at ? fecha(item.last_counted_at) : 'Nunca'} />
        {/* Costo: número SOLO con fuente confiable (compra/manual/producción).
            El costo de la API de Fudo no es real → referencia gris rotulada. */}
        {esCostoConfiable(item.cost_source, item.cost_per_unit) ? (
          <Meta
            label="Costo LVE"
            value={`${money(item.cost_per_unit)} · ${etiquetaFuenteCosto(item.cost_source)}${item.cost_updated_at ? ` · ${fecha(item.cost_updated_at, 'd MMM')}` : ''}`}
          />
        ) : (
          <div className="min-w-0">
            <dt className="text-[9px] font-bold uppercase tracking-wide text-[#a39e97]">Costo LVE</dt>
            <dd className="truncate font-semibold text-[#a39e97]">
              sin costo real
              {item.cost_per_unit != null && item.cost_per_unit > 0 && (
                <span className="font-normal"> · {money(item.cost_per_unit)} según Fudo (no usado)</span>
              )}
            </dd>
          </div>
        )}
        <Meta label="Costo Fudo" value={money(fudo.fudo_cost)} />
        {fudo.last_sync && (
          <Meta
            label="Último sync"
            value={`${fecha(fudo.last_sync.at, 'd MMM HH:mm')} · ${fudo.last_sync.status}`}
          />
        )}
        <Meta label="Actualizado" value={fecha(item.updated_at, 'd MMM HH:mm')} />
      </dl>
    </Section>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-bold uppercase tracking-wide text-[#a39e97]">{label}</dt>
      <dd className="truncate font-semibold text-[#3d2c24]">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Incidentes de sync
// ---------------------------------------------------------------------------

export function IncidentsBlock({ incidents }: { incidents: FichaIncident[] }) {
  const open = incidents.filter(i => i.status !== 'resolved')
  if (incidents.length === 0) return null

  return (
    <Section eyebrow="Fudo" title={`Incidentes (${open.length} abiertos)`} icon={AlertTriangle}>
      <div className="space-y-1.5">
        {incidents.slice(0, 6).map(inc => {
          const resolved = inc.status === 'resolved'
          return (
            <div
              key={inc.id}
              className={`rounded-xl px-3 py-2 ring-1 ${
                resolved ? 'bg-[#faf8f5] ring-[#ebe6df]' : 'bg-[#fff7f7] ring-[#f3d0cf]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className={`truncate text-[12px] font-bold ${resolved ? 'text-[#7d6c64]' : 'text-[#ea504c]'}`}>
                  {inc.code}
                </p>
                <span className="shrink-0 text-[10px] text-[#a39e97]">{fecha(inc.last_seen_at, 'd MMM')}</span>
              </div>
              {inc.detail && <p className="mt-0.5 text-[11px] leading-snug text-[#7d6c64]">{inc.detail}</p>}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Recetas que lo usan / que lo producen
// ---------------------------------------------------------------------------

export function RecipesBlock({
  recipes,
  producedBy,
  unit,
  error,
}: {
  recipes: FichaRecipe[]
  producedBy: FichaResponse['produced_by']
  unit: string
  error?: string | null
}) {
  return (
    <Section eyebrow="Consumo" title={`Recetas que lo usan (${recipes.length})`} icon={ChefHat} error={error}>
      {producedBy.length > 0 && (
        <div className="mb-3 rounded-xl bg-[#f6fcfa] px-3 py-2 ring-1 ring-[#dcefe8]">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#006d5a]">Se produce con</p>
          <div className="mt-1 space-y-1">
            {producedBy.map(r => (
              <Link
                key={r.recipe_id}
                href="/recetas"
                className="flex items-center justify-between gap-2 text-[12px] font-semibold text-[#006d5a] hover:underline"
              >
                <span className="truncate">{r.name}</span>
                <ArrowRight className="size-3 shrink-0" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {recipes.length === 0 ? (
        <Empty text="Ninguna receta declara este insumo todavía." />
      ) : (
        <div className="space-y-1.5">
          {recipes.map(r => (
            <Link
              key={r.recipe_id}
              href="/recetas"
              className="flex items-center gap-3 rounded-xl bg-[#faf8f5] px-3 py-2.5 transition-colors hover:bg-[#f3efe9] active:scale-[0.99]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-bold text-[#3d2c24]">{r.name}</p>
                <p className="text-[10px] text-[#a39e97]">
                  {r.category ?? 'sin categoría'}
                  {!r.is_active && ' · inactiva'}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-display text-sm font-bold tabular-nums text-[#3d2c24]">
                  {formatQty(r.qty_per_portion)}
                </p>
                <p className="text-[9px] text-[#a39e97]">{r.unit ?? unit} / porción</p>
              </div>
              <ArrowRight className="size-3.5 shrink-0 text-[#a39e97]" />
            </Link>
          ))}
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Precios — barras simples, sin librerías
// ---------------------------------------------------------------------------

export function PricesBlock({
  prices,
  unit,
  error,
  onLoadExpenses,
  expensesLoading,
  expenses,
}: {
  prices: FichaPrices
  unit: string
  error?: string | null
  onLoadExpenses: () => void
  expensesLoading: boolean
  expenses: FichaResponse['expenses']
}) {
  const points = prices.receipts
    .filter(r => r.cost_per_unit != null && r.cost_per_unit > 0)
    .slice(0, 12)
    .reverse()

  const max = prices.max ?? 0
  const min = prices.min ?? 0
  const span = Math.max(max - min, 1)

  return (
    <Section eyebrow="Plata" title="Precio de compra" icon={Receipt} error={error}>
      <div className="grid grid-cols-4 gap-1.5">
        <Stat label="Último" value={money(prices.latest)} strong />
        <Stat label="Promedio" value={money(prices.avg)} />
        <Stat label="Mín" value={money(prices.min)} />
        <Stat label="Máx" value={money(prices.max)} />
      </div>

      {points.length >= 2 && (
        <div className="mt-3 flex h-20 items-end gap-1">
          {points.map(p => {
            const v = p.cost_per_unit as number
            const h = 20 + ((v - min) / span) * 80
            const isMax = v === max
            return (
              <div key={p.id} className="group flex flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[8px] font-bold tabular-nums text-[#a39e97] opacity-0 group-hover:opacity-100">
                  {Math.round(v / 1000)}k
                </span>
                <div
                  className={`w-full rounded-t-md ${isMax ? 'bg-[#d4943a]' : 'bg-[#006d5a]'}`}
                  style={{ height: `${h}%` }}
                  title={`${money(v)} · ${fecha(p.date)}`}
                />
              </div>
            )
          })}
        </div>
      )}

      {points.length >= 2 && (
        <div className="mt-1 flex justify-between text-[9px] text-[#a39e97]">
          <span>{fecha(points[0].date, 'd MMM')}</span>
          <span>${'/'}{unit} por recepción</span>
          <span>{fecha(points[points.length - 1].date, 'd MMM')}</span>
        </div>
      )}

      {prices.receipts.length === 0 ? (
        <div className="mt-2">
          <Empty text="Sin recepciones cargadas: no hay historial de precio de compra." />
          {/* Igual que el resto de la ficha: número SOLO con fuente confiable;
              lo demás va en gris y rotulado, nunca como precio de referencia. */}
          <p className="text-center text-[10px] text-[#a39e97]">
            {esCostoConfiable(prices.item_cost_source, prices.item_cost_per_unit)
              ? `Costo de referencia: ${money(prices.item_cost_per_unit)} / ${unit}`
              : (prices.item_cost_per_unit || prices.fudo_cost)
                ? `sin costo real · ${money(prices.item_cost_per_unit ?? prices.fudo_cost)} según Fudo (no usado)`
                : 'Se llena al marcar “Recibido” en Pedidos.'}
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-1">
          {prices.receipts.slice(0, 6).map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="shrink-0 text-[#a39e97]">{fecha(r.date, 'd MMM yy')}</span>
              <span className="min-w-0 flex-1 truncate text-[#7d6c64]">{r.supplier ?? 'sin proveedor'}</span>
              <span className="shrink-0 tabular-nums text-[#a39e97]">{formatQty(r.qty)} {r.unit}</span>
              <span className="shrink-0 font-bold tabular-nums text-[#3d2c24]">{money(r.cost_per_unit)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 border-t border-[#f1ece6] pt-2.5">
        {expenses == null ? (
          <button
            onClick={onLoadExpenses}
            disabled={expensesLoading}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#faf8f5] px-3 py-2 text-[11px] font-bold text-[#7d6c64] transition hover:bg-[#f3efe9] disabled:opacity-50"
          >
            {expensesLoading && <RefreshCw className="size-3 animate-spin" />}
            Buscar gastos de este insumo en Fudo
          </button>
        ) : expenses.length === 0 ? (
          <Empty text="Fudo no tiene gastos cargados con este ingrediente." />
        ) : (
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[#a39e97]">Gastos en Fudo</p>
            {expenses.slice(0, 6).map(e => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="shrink-0 text-[#a39e97]">{fecha(e.date, 'd MMM yy')}</span>
                <span className="min-w-0 flex-1 truncate text-[#7d6c64]">{e.provider ?? 'sin proveedor'}</span>
                <span className="shrink-0 font-bold tabular-nums text-[#3d2c24]">{money(e.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl px-2 py-2 text-center ring-1 ${strong ? 'bg-[#f6fcfa] ring-[#dcefe8]' : 'bg-[#faf8f5] ring-[#ebe6df]'}`}>
      <p className="text-[9px] font-bold uppercase tracking-wide text-[#a39e97]">{label}</p>
      <p className={`mt-0.5 text-[13px] font-bold tabular-nums ${strong ? 'text-[#006d5a]' : 'text-[#3d2c24]'}`}>
        {value}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Lotes y vencimientos
// ---------------------------------------------------------------------------

export function LotsBlock({ lots, error }: { lots: FichaLot[]; error?: string | null }) {
  return (
    <Section eyebrow="Frescura" title={`Lotes activos (${lots.length})`} icon={Layers} error={error}>
      {lots.length === 0 ? (
        <Empty text="Sin lotes abiertos. Los lotes se crean al registrar producción." />
      ) : (
        <div className="space-y-1.5">
          {lots.map(l => (
            <div
              key={l.id}
              className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${l.tone?.panel ?? 'border-[#ebe6df] bg-[#faf8f5]'}`}
            >
              <div className="min-w-0">
                <p className="truncate text-[12px] font-bold text-[#3d2c24]">{l.lot_code}</p>
                <p className="text-[10px] text-[#a39e97]">Producido {fecha(l.produced_at, 'd MMM')}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-display text-sm font-bold tabular-nums text-[#3d2c24]">
                  {formatQty(l.qty_remaining)} {l.unit}
                </span>
                {l.countdown && (
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${l.tone?.pill ?? ''}`}>
                    {l.countdown}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Kardex — colapsable
// ---------------------------------------------------------------------------

const KIND_TONE: Record<FichaMovement['kind'], string> = {
  compra: 'bg-[#e8f5f1] text-[#006d5a]',
  venta: 'bg-[#f3efe9] text-[#7d6c64]',
  produccion: 'bg-[#eef3fb] text-[#3f5f8f]',
  merma: 'bg-[#fef2f2] text-[#ea504c]',
  ajuste: 'bg-[#fdf6ec] text-[#d4943a]',
  conteo: 'bg-[#f3efe9] text-[#3d2c24]',
  otro: 'bg-[#f3efe9] text-[#7d6c64]',
}

export function MovementsBlock({
  movements,
  unit,
  error,
}: {
  movements: FichaMovement[]
  unit: string
  error?: string | null
}) {
  const [open, setOpen] = useState(false)
  const visible = open ? movements : movements.slice(0, 6)

  return (
    <Section eyebrow="Trazabilidad" title={`Movimientos (${movements.length})`} icon={History} error={error}>
      {movements.length === 0 ? (
        <Empty text="Sin movimientos registrados para este insumo." />
      ) : (
        <>
          <div className="space-y-1.5">
            {visible.map(m => {
              const delta = m.qty
              const positive = delta != null && delta > 0
              return (
                <div key={m.id} className="flex items-start justify-between gap-2 border-b border-[#f6f2ed] pb-1.5 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${KIND_TONE[m.kind]}`}>
                        {m.label}
                      </span>
                      {delta != null && (
                        <span className={`text-[11px] font-bold tabular-nums ${positive ? 'text-[#006d5a]' : 'text-[#ea504c]'}`}>
                          {positive ? '+' : ''}{formatQty(delta)} {unit}
                        </span>
                      )}
                    </div>
                    {m.previous_qty != null && m.new_qty != null && (
                      <p className="mt-0.5 text-[10px] tabular-nums text-[#a39e97]">
                        {formatQty(m.previous_qty)} → {formatQty(m.new_qty)}
                        {m.who ? ` · ${m.who}` : ''}
                      </p>
                    )}
                    {m.note && <p className="mt-0.5 truncate text-[10px] text-[#a39e97]">{m.note}</p>}
                  </div>
                  <span className="shrink-0 text-[10px] text-[#a39e97]">{fecha(m.at, 'd MMM HH:mm')}</span>
                </div>
              )
            })}
          </div>

          {movements.length > 6 && (
            <button
              onClick={() => setOpen(v => !v)}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl bg-[#faf8f5] py-2 text-[11px] font-bold text-[#7d6c64] transition hover:bg-[#f3efe9]"
            >
              {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              {open ? 'Ver menos' : `Ver los ${movements.length}`}
            </button>
          )}
        </>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Proveedor
// ---------------------------------------------------------------------------

export function SupplierBlock({
  supplier,
  error,
}: {
  supplier: FichaSupplier | null
  error?: string | null
}) {
  return (
    <Section eyebrow="Origen" title="Proveedor" icon={Truck} error={error}>
      {!supplier ? (
        <Empty text="Sin proveedor asignado. Se configura desde el engranaje del item en Stock." />
      ) : (
        <div className="space-y-2">
          <Link
            href="/proveedores"
            className="flex items-center gap-3 rounded-xl bg-[#faf8f5] px-3 py-2.5 transition-colors hover:bg-[#f3efe9] active:scale-[0.99]"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-[#3d2c24]">{supplier.name}</p>
              <p className="text-[10px] text-[#a39e97]">
                {supplier.category ?? 'sin rubro'}
                {supplier.contact_name ? ` · ${supplier.contact_name}` : ''}
                {supplier.lead_time_days != null ? ` · entrega ${supplier.lead_time_days}d` : ''}
              </p>
            </div>
            <ArrowRight className="size-3.5 shrink-0 text-[#a39e97]" />
          </Link>

          {supplier.phone && (
            <a
              href={`tel:${supplier.phone}`}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-2 text-[11px] font-bold text-white transition hover:bg-[#005a4a]"
            >
              <Phone className="size-3" />
              {supplier.phone}
            </a>
          )}
        </div>
      )}
    </Section>
  )
}
