'use client'

// ---------------------------------------------------------------------------
// CadenaInsumo — EL HILO de un insumo, de la compra al plato vendido.
//
// Timeline vertical de 3 eslabones cosidos por un hilo de color:
//   ① COMPRA (o insumos base si es elaborado) · ② PRODUCCIÓN · ③ VENTA
// y abajo el cierre: lo que costó vs lo que facturó.
//
// Autocontenido: hace su propio fetch a /api/stock/cadena, maneja loading y
// error sin romper la página que lo monte, y se oculta si no hay hilo que
// contar. Los eslabones incompletos se dicen con todas las letras — nunca un
// cero disfrazado de dato.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import {
  ShoppingBasket, ChefHat, UtensilsCrossed, AlertTriangle, TrendingUp,
  Package, Clock, ArrowDown, Link2Off,
} from 'lucide-react'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'

// --- Tipos (espejo del payload de /api/stock/cadena) ---------------------

type InsumoBase = {
  stock_item_id: string
  name: string
  qty: number
  unit: string
  cost_per_unit: number | null
  costo: number | null
  unidad_dudosa: boolean
}

type Compra = {
  tipo: 'comprado' | 'elaborado'
  costo_cargado: number | null
  unit: string
  ultima_compra: {
    fecha: string
    qty: number
    unit: string
    cost_per_unit: number
    cost_total: number | null
    proveedor: string | null
  } | null
  precio_promedio: number | null
  precio_min: number | null
  precio_max: number | null
  compras_count: number
  proveedor: string | null
  receta: { id: string; name: string; yield_portions: number | null } | null
  origen_insumos: 'receta' | 'produccion' | null
  insumos: InsumoBase[]
  costo_insumos: number | null
}

type Tanda = {
  order_id: number
  name: string
  fecha: string
  status: string
  qty_producida: number
  qty_teorica: number | null
  eficiencia_pct: number | null
  unit: string
  costo_total: number | null
  costo_por_unidad: number | null
  costo_parcial: boolean
}

type Lote = {
  id: number
  lot_code: string
  qty_remaining: number
  unit: string
  produced_at: string
  expires_at: string | null
  status: string
}

type Produccion = {
  tandas: Tanda[]
  total_producido: number
  unit: string
  ultimo_costo_por_unidad: number | null
  costo_por_unidad_promedio: number | null
  eficiencia_promedio_pct: number | null
  stock_actual: number
  lotes: Lote[]
}

type Plato = {
  menu_item_id: string
  name: string
  fudo_product_id: string
  via: 'directo' | 'intermedio'
  intermedio: string | null
  qty_por_porcion: number | null
  unit: string
  units_7d: number
  units_28d: number
  precio_promedio: number | null
  costo_porcion: number | null
  margen_unit: number | null
  margen_pct: number | null
  facturacion_28d: number
  motivo: string | null
  margen_inflado: boolean
}

type Payload = {
  item: {
    id: string
    name: string
    unit: string
    category: string | null
    current_qty: number
    cost_per_unit: number | null
    is_produced: boolean
  }
  flags: {
    sin_receta: boolean
    sin_precio_compra: boolean
    sin_produccion: boolean
    sin_ventas: boolean
    costo_propio_ausente: boolean
  }
  compra: Compra
  produccion: Produccion | null
  venta: { platos: Plato[]; nivel_max: 1 | 2 }
  resumen: {
    ventana_dias: number
    insumo_consumido: number | null
    insumo_consumido_costo: number | null
    costo_platos: number | null
    facturacion: number
    margen: number | null
    margen_pct: number | null
    peso_insumo_pct: number | null
    platos_costeados: number
    platos_totales: number
    notas: string[]
  }
  generated_at: string
}

// --- Formato --------------------------------------------------------------

const money = (n: number | null | undefined, decimals = 0) =>
  n == null ? '—' : `$${n.toLocaleString('es-AR', { maximumFractionDigits: decimals })}`

const qty = (n: number | null | undefined, unit?: string) =>
  n == null ? '—' : `${n.toLocaleString('es-AR', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`

function fechaCorta(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires' })
}

// --- Piezas visuales ------------------------------------------------------

const RAIL = 'absolute left-[19px] top-11 bottom-0 w-px bg-gradient-to-b from-[#d8cfc4] to-transparent'

function Nodo({
  n, icon: Icon, tone, titulo, kicker, children, ultimo,
}: {
  n: number
  icon: typeof ShoppingBasket
  tone: 'verde' | 'ambar' | 'marron'
  titulo: string
  kicker?: string
  children: React.ReactNode
  ultimo?: boolean
}) {
  const colors = {
    verde: { bg: '#006d5a', soft: '#e8f2ef' },
    ambar: { bg: '#d4943a', soft: '#fdf6ec' },
    marron: { bg: '#3d2c24', soft: '#f4f0eb' },
  }[tone]

  return (
    <div className="relative pl-11">
      {!ultimo && <div className={RAIL} />}
      <div
        className="absolute left-0 top-0 grid size-10 place-items-center rounded-full text-white shadow-sm"
        style={{ backgroundColor: colors.bg }}
      >
        <Icon className="size-[18px]" strokeWidth={2.2} />
      </div>
      <div className="pb-6">
        <div className="flex items-baseline gap-2 pt-1">
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
            style={{ backgroundColor: colors.soft, color: colors.bg }}
          >
            {n}
          </span>
          <h4 className="font-display text-[15px] leading-none text-[#3d2c24]">{titulo}</h4>
        </div>
        {kicker && <p className="mt-1 text-[11px] text-[#8b7a70]">{kicker}</p>}
        <div className="mt-2.5">{children}</div>
      </div>
    </div>
  )
}

function Card({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'warn' }) {
  return (
    <div
      className={`rounded-2xl border p-3 ${
        tone === 'warn' ? 'border-[#f1dfba] bg-[#fffaf2]' : 'border-[#ebe6df] bg-white'
      }`}
    >
      {children}
    </div>
  )
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-[#f1dfba] bg-[#fffaf2] p-3">
      <AlertTriangle className="mt-px size-4 shrink-0 text-[#d4943a]" strokeWidth={2.2} />
      <p className="text-[12px] leading-snug text-[#7d6c64]">{children}</p>
    </div>
  )
}

function Dato({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-[#a2948b]">{label}</p>
      <p className="font-display text-[15px] tabular-nums" style={{ color: accent ?? '#3d2c24' }}>{value}</p>
    </div>
  )
}

function Chip({ children, tone = 'neutro' }: { children: React.ReactNode; tone?: 'neutro' | 'verde' | 'ambar' | 'rojo' }) {
  const cls = {
    neutro: 'bg-[#f3efe9] text-[#7d6c64]',
    verde: 'bg-[#e8f2ef] text-[#006d5a]',
    ambar: 'bg-[#fdf6ec] text-[#d4943a]',
    rojo: 'bg-[#fef2f2] text-[#ea504c]',
  }[tone]
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{children}</span>
}

function Flecha() {
  return (
    <div className="relative -mt-3 mb-1 pl-11">
      <ArrowDown className="absolute left-[13px] size-[13px] text-[#c9bdb2]" strokeWidth={2.5} />
    </div>
  )
}

function Skeleton() {
  return (
    <div className="rounded-2xl border border-[#ebe6df] bg-white p-4">
      <div className="h-3 w-24 animate-pulse rounded-full bg-[#f0ebe4]" />
      <div className="mt-4 space-y-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex gap-3">
            <div className="size-10 shrink-0 animate-pulse rounded-full bg-[#f0ebe4]" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 w-1/3 animate-pulse rounded-full bg-[#f0ebe4]" />
              <div className="h-12 animate-pulse rounded-2xl bg-[#f6f2ec]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Componente -----------------------------------------------------------

export function CadenaInsumo({ itemId }: { itemId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/stock/cadena?item=${encodeURIComponent(itemId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'No se pudo armar la cadena')
        return res.json() as Promise<Payload>
      })
      .then((json) => { if (!cancelled) setData(json) })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [itemId])

  if (loading) return <Skeleton />
  // Fallar en silencio: la página que monta esto no se rompe ni se ensucia.
  if (error || !data) return null

  const { item, flags, compra, produccion, venta, resumen } = data
  const elaborado = compra.tipo === 'elaborado'
  const hayHilo = compra.ultima_compra != null || compra.insumos.length > 0
    || (produccion?.tandas.length ?? 0) > 0 || venta.platos.length > 0
  if (!hayHilo) return null

  const platosTop = venta.platos.slice(0, 6)
  const platosRestantes = venta.platos.length - platosTop.length

  return (
    <FadeIn>
      <section className="overflow-hidden rounded-2xl border border-[#ebe6df] bg-[#fdfcfa]">
        {/* Encabezado: el hilo en una línea */}
        <header className="relative overflow-hidden border-b border-[#ebe6df] bg-gradient-to-br from-[#017c66] via-[#006d5a] to-[#00523f] px-4 py-3.5 text-white">
          <div className="pointer-events-none absolute -right-10 -top-14 size-40 rounded-full bg-white/[0.07]" />
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">La cadena</p>
            <h3 className="font-display text-[19px] leading-tight">{item.name}</h3>
            <p className="mt-0.5 text-[11px] text-white/70">
              {elaborado ? 'Se elabora acá' : 'Se compra'} · de la compra al plato · últimos {resumen.ventana_dias} días
            </p>
          </div>
        </header>

        <div className="px-4 pt-4">
          {/* ---------------- ESLABÓN 1 — COMPRA ---------------- */}
          <Nodo
            n={1}
            icon={ShoppingBasket}
            tone="marron"
            titulo={elaborado ? 'De qué está hecho' : 'De dónde viene'}
            kicker={elaborado
              ? (compra.origen_insumos === 'receta'
                ? `Receta «${compra.receta?.name}»`
                : compra.origen_insumos === 'produccion'
                  ? 'Insumos de la última producción real'
                  : undefined)
              : (compra.proveedor ?? undefined)}
          >
            {!elaborado && compra.ultima_compra && (
              <Card>
                <div className="grid grid-cols-3 gap-2">
                  <Dato label="Último precio" value={`${money(compra.ultima_compra.cost_per_unit)}/${compra.unit}`} accent="#006d5a" />
                  <Dato label="Comprado" value={qty(compra.ultima_compra.qty, compra.ultima_compra.unit)} />
                  <Dato label="Fecha" value={fechaCorta(compra.ultima_compra.fecha)} />
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {compra.ultima_compra.proveedor && <Chip>{compra.ultima_compra.proveedor}</Chip>}
                  {compra.precio_promedio != null && (
                    <Chip tone="neutro">prom {money(compra.precio_promedio)}/{compra.unit}</Chip>
                  )}
                  {compra.compras_count > 1 && <Chip>{compra.compras_count} compras</Chip>}
                  {compra.precio_max != null && compra.precio_min != null && compra.precio_max > compra.precio_min && (
                    <Chip tone="ambar">rango {money(compra.precio_min)}–{money(compra.precio_max)}</Chip>
                  )}
                </div>
              </Card>
            )}

            {!elaborado && !compra.ultima_compra && (
              flags.sin_precio_compra && compra.costo_cargado ? (
                <Card tone="warn">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#d4943a]" strokeWidth={2.2} />
                    <div>
                      <p className="text-[12px] leading-snug text-[#7d6c64]">
                        Sin compras registradas con precio. Se usa el costo cargado a mano en la ficha.
                      </p>
                      <p className="mt-1.5 font-display text-[17px] tabular-nums text-[#3d2c24]">
                        {money(compra.costo_cargado)}<span className="text-[12px] text-[#8b7a70]">/{compra.unit}</span>
                      </p>
                    </div>
                  </div>
                </Card>
              ) : (
                <Aviso>Sin precio de compra cargado — no se puede saber cuánto cuesta este insumo.</Aviso>
              )
            )}

            {elaborado && compra.insumos.length > 0 && (
              <Card>
                <StaggerList className="divide-y divide-[#f2ede6]">
                  {compra.insumos.map(ins => (
                    <StaggerItem key={ins.stock_item_id}>
                      <div className="flex items-center justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] text-[#3d2c24]">{ins.name}</p>
                          <p className="text-[11px] text-[#a2948b]">
                            {qty(ins.qty, ins.unit)}
                            {ins.unidad_dudosa && <span className="text-[#d4943a]"> · unidad a revisar</span>}
                          </p>
                        </div>
                        <p className="shrink-0 font-display text-[14px] tabular-nums text-[#3d2c24]">
                          {ins.costo != null ? money(ins.costo) : <span className="text-[11px] text-[#d4943a]">sin costo</span>}
                        </p>
                      </div>
                    </StaggerItem>
                  ))}
                </StaggerList>
                {compra.costo_insumos != null && (
                  <div className="mt-2 flex items-center justify-between border-t border-[#ebe6df] pt-2">
                    <span className="text-[11px] uppercase tracking-wide text-[#a2948b]">Total de la tanda</span>
                    <span className="font-display text-[16px] tabular-nums text-[#006d5a]">{money(compra.costo_insumos)}</span>
                  </div>
                )}
              </Card>
            )}

            {elaborado && compra.insumos.length === 0 && (
              <Aviso>Sin receta ni producción cargada — no se sabe con qué se hace este elaborado.</Aviso>
            )}

            {elaborado && flags.sin_receta && compra.insumos.length > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#8b7a70]">
                <Link2Off className="size-3 shrink-0 text-[#d4943a]" />
                Sin receta cargada: el desglose sale de la última producción real.
              </p>
            )}
          </Nodo>

          <Flecha />

          {/* ---------------- ESLABÓN 2 — PRODUCCIÓN ---------------- */}
          {elaborado && (
            <>
              <Nodo
                n={2}
                icon={ChefHat}
                tone="ambar"
                titulo="Producción"
                kicker={produccion && produccion.tandas.length > 0
                  ? `${produccion.tandas.length} ${produccion.tandas.length === 1 ? 'tanda' : 'tandas'} · ${qty(produccion.total_producido, produccion.unit)} producidas`
                  : undefined}
              >
                {produccion && produccion.tandas.length > 0 ? (
                  <>
                    <Card>
                      <div className="grid grid-cols-3 gap-2">
                        <Dato
                          label="Últ. costo/u"
                          value={money(produccion.ultimo_costo_por_unidad)}
                          accent="#d4943a"
                        />
                        <Dato label="Promedio" value={money(produccion.costo_por_unidad_promedio)} />
                        <Dato
                          label="Eficiencia"
                          value={produccion.eficiencia_promedio_pct != null ? `${produccion.eficiencia_promedio_pct}%` : '—'}
                          accent={produccion.eficiencia_promedio_pct != null && produccion.eficiencia_promedio_pct < 90 ? '#ea504c' : undefined}
                        />
                      </div>
                      <div className="mt-2.5 space-y-1.5 border-t border-[#f2ede6] pt-2.5">
                        {produccion.tandas.slice(0, 4).map(t => (
                          <div key={t.order_id} className="flex items-center justify-between gap-3 text-[12px]">
                            <span className="min-w-0 truncate text-[#7d6c64]">
                              {fechaCorta(t.fecha)} · {qty(t.qty_producida, t.unit)}
                              {t.eficiencia_pct != null && t.eficiencia_pct < 100 && (
                                <span className="text-[#ea504c]"> · merma {Math.round(100 - t.eficiencia_pct)}%</span>
                              )}
                            </span>
                            <span className="shrink-0 tabular-nums text-[#3d2c24]">
                              {t.costo_por_unidad != null ? `${money(t.costo_por_unidad)}/u` : 'sin costo'}
                              {t.costo_parcial && <span className="text-[#d4943a]"> *</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                      {produccion.tandas.some(t => t.costo_parcial) && (
                        <p className="mt-2 text-[10px] text-[#a2948b]">* algún insumo sin precio: el costo está subestimado.</p>
                      )}
                    </Card>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Chip tone={produccion.stock_actual > 0 ? 'verde' : 'rojo'}>
                        <Package className="mr-1 inline size-3" />
                        quedan {qty(produccion.stock_actual, produccion.unit)}
                      </Chip>
                      {produccion.lotes.map(l => (
                        <Chip key={l.id} tone={l.expires_at ? 'ambar' : 'neutro'}>
                          <Clock className="mr-1 inline size-3" />
                          {l.lot_code}: {qty(l.qty_remaining, l.unit)}
                          {l.expires_at ? ` · vence ${fechaCorta(l.expires_at)}` : ''}
                        </Chip>
                      ))}
                    </div>
                  </>
                ) : (
                  <Aviso>Todavía no hay tandas de producción registradas para este elaborado.</Aviso>
                )}
              </Nodo>
              <Flecha />
            </>
          )}

          {/* ---------------- ESLABÓN 3 — VENTA ---------------- */}
          <Nodo
            n={elaborado ? 3 : 2}
            icon={UtensilsCrossed}
            tone="verde"
            titulo="Se vende como"
            kicker={venta.platos.length > 0
              ? `${venta.platos.length} ${venta.platos.length === 1 ? 'plato' : 'platos'}${venta.nivel_max === 2 ? ' · vía elaborado intermedio' : ''}`
              : undefined}
            ultimo={venta.platos.length === 0}
          >
            {venta.platos.length > 0 ? (
              <StaggerList className="space-y-2">
                {platosTop.map(p => (
                  <StaggerItem key={p.menu_item_id}>
                    <Card tone={p.motivo ? 'warn' : 'plain'}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-semibold text-[#3d2c24]">{p.name}</p>
                          <p className="mt-0.5 text-[11px] text-[#a2948b]">
                            {p.units_28d} en 28d · {p.units_7d} en 7d
                            {p.qty_por_porcion != null && ` · ${qty(p.qty_por_porcion, p.unit)}/plato`}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {p.margen_unit != null ? (
                            <>
                              <p className="font-display text-[16px] tabular-nums text-[#006d5a]">{money(p.margen_unit)}</p>
                              <p className="text-[10px] text-[#a2948b]">margen{p.margen_pct != null ? ` · ${p.margen_pct}%` : ''}</p>
                            </>
                          ) : (
                            <p className="text-[11px] font-semibold text-[#d4943a]">sin margen</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {p.via === 'intermedio' && p.intermedio && <Chip tone="ambar">vía {p.intermedio}</Chip>}
                        {p.precio_promedio != null && <Chip tone="verde">vende {money(p.precio_promedio)}</Chip>}
                        {p.costo_porcion != null && <Chip>cuesta {money(p.costo_porcion)}</Chip>}
                        {p.margen_inflado && <Chip tone="ambar">costo incompleto</Chip>}
                      </div>

                      {p.motivo && (
                        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-[#7d6c64]">
                          <AlertTriangle className="mt-px size-3 shrink-0 text-[#d4943a]" />
                          {p.motivo}
                        </p>
                      )}
                    </Card>
                  </StaggerItem>
                ))}
                {platosRestantes > 0 && (
                  <p className="pt-0.5 text-[11px] text-[#a2948b]">
                    + {platosRestantes} {platosRestantes === 1 ? 'plato más' : 'platos más'} con menos ventas.
                  </p>
                )}
              </StaggerList>
            ) : (
              <Aviso>
                Ningún plato activo con producto Fudo usa este insumo. Sin receta que lo vincule no se puede saber
                dónde se vende ni cuánto deja.
              </Aviso>
            )}
          </Nodo>
        </div>

        {/* ---------------- CIERRE DEL HILO ---------------- */}
        {venta.platos.length > 0 && (
          <div className="border-t border-[#ebe6df] bg-white px-4 py-3.5">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="size-3.5 text-[#006d5a]" strokeWidth={2.4} />
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#a2948b]">
                El hilo en {resumen.ventana_dias} días
              </p>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <Dato
                label="Insumo usado"
                value={resumen.insumo_consumido != null ? qty(resumen.insumo_consumido, item.unit) : '—'}
              />
              <Dato
                label="Costó"
                value={money(resumen.insumo_consumido_costo)}
                accent="#d4943a"
              />
              <Dato label="Facturó" value={money(resumen.facturacion)} accent="#006d5a" />
            </div>

            {resumen.margen != null && (
              <div className="mt-2.5 flex items-center justify-between rounded-2xl bg-[#e8f2ef] px-3 py-2">
                <span className="text-[11px] text-[#006d5a]">
                  Margen de esos platos
                  {resumen.platos_costeados < resumen.platos_totales && (
                    <span className="text-[#8b7a70]"> ({resumen.platos_costeados}/{resumen.platos_totales} costeados)</span>
                  )}
                </span>
                <span className="font-display text-[17px] tabular-nums text-[#006d5a]">
                  {money(resumen.margen)}
                  {resumen.margen_pct != null && <span className="ml-1 text-[11px]">{resumen.margen_pct}%</span>}
                </span>
              </div>
            )}

            {resumen.peso_insumo_pct != null && (
              <p className="mt-2 text-[11px] text-[#8b7a70]">
                Este insumo se lleva el <strong className="text-[#3d2c24]">{resumen.peso_insumo_pct}%</strong> de lo
                que facturan los platos donde entra.
              </p>
            )}

            {resumen.notas.length > 0 && (
              <ul className="mt-2.5 space-y-1.5 border-t border-[#f2ede6] pt-2.5">
                {resumen.notas.map((nota, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-[#8b7a70]">
                    <AlertTriangle className="mt-px size-3 shrink-0 text-[#d4943a]" />
                    {nota}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </FadeIn>
  )
}
