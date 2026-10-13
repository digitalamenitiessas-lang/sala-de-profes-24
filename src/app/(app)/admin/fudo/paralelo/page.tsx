'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  MoonStar,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react'
import { FadeIn, StaggerList, StaggerItem, PulseRing } from '@/components/ui/motion'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Tipos de la respuesta de /api/fudo/paralelo
// ---------------------------------------------------------------------------

type ResumenDia = {
  day: string
  precision: number | null
  items_total: number
  divergentes: number
}

type Divergente = {
  stock_item_id: string
  name: string
  unit: string
  lve_qty: number
  fudo_qty: number
  diff: number
  qty_consumed: number
  qty_produced: number
  qty_received: number
  cost_per_unit: number | null
  impacto: number | null
}

type EstadoMotor = {
  desde: string | null
  ultimo_dia: string
  dias_corriendo: number
}

type ParaleloResponse = {
  estado: 'sin_datos' | EstadoMotor
  resumen?: ResumenDia[]
  divergentes_hoy?: Divergente[]
  sin_actividad?: number
  error?: string
}

// ---------------------------------------------------------------------------
// Paleta y helpers
// ---------------------------------------------------------------------------

const VERDE = '#006d5a'
const AMBAR = '#d4943a'
const ROJO = '#ea504c'

function tonoPrecision(p: number | null): string {
  if (p == null) return '#c4bfb8'
  if (p >= 95) return VERDE
  if (p >= 85) return AMBAR
  return ROJO
}

function veredicto(p: number | null): string {
  if (p == null) return 'Sin actividad para comparar'
  if (p >= 95) return 'Coincide con Fudo — el motor está listo'
  if (p >= 85) return 'Cerca — quedan diferencias por pulir'
  return 'Todavía diverge — mirá la lista de abajo'
}

function fmtQty(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 })
}

function fmtPlata(n: number): string {
  return `$${Math.round(n).toLocaleString('es-AR')}`
}

function fmtDia(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
}

function fmtDiaCorto(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function ParaleloFudoPage() {
  const { profile, loading: loadingProfile } = useProfileContext()
  const [data, setData] = useState<ParaleloResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/fudo/paralelo?days=14')
      const json = (await res.json()) as ParaleloResponse
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar la comparación')
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de red')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loadingProfile) return null

  if (!isManagerOrAbove(profile?.role)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <ShieldAlert className="size-10 text-[#ea504c]/40" />
        <p className="font-display text-lg font-semibold text-[#3d2c24]">Solo encargados</p>
        <p className="text-sm text-[#a39e97]">
          Acá se decide cuándo LVE puede soltarle la mano a Fudo.
        </p>
      </div>
    )
  }

  const sinDatos = data?.estado === 'sin_datos'
  const estado = data && data.estado !== 'sin_datos' ? data.estado : null
  const resumen = data?.resumen ?? []
  const ultimo = resumen.length > 0 ? resumen[resumen.length - 1] : null
  const divergentes = data?.divergentes_hoy ?? []

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pb-24">
      {/* Encabezado */}
      <FadeIn>
        <Link
          href="/admin/fudo"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#a39e97]"
        >
          <ArrowLeft className="size-3.5" />
          Fudo
        </Link>
        <h1 className="font-display text-xl font-bold tracking-tight text-[#3d2c24]">
          Paralelo LVE vs Fudo
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-[#a39e97]">
          El motor de stock propio corriendo en sombra — cuando los números coincidan, LVE puede
          operar solo.
        </p>
      </FadeIn>

      {/* Cargando */}
      {loading && !data && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-[#006d5a]" />
        </div>
      )}

      {/* Error */}
      {error && (
        <FadeIn>
          <div className="card-elevated flex items-center justify-between gap-3 rounded-2xl p-4">
            <p className="text-sm text-[#ea504c]">{error}</p>
            <button
              onClick={load}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[#f3efe9] px-3 py-2 text-xs font-semibold text-[#3d2c24] active:scale-95"
            >
              <RefreshCw className="size-3.5" />
              Reintentar
            </button>
          </div>
        </FadeIn>
      )}

      {/* Motor sin datos todavía */}
      {sinDatos && !loading && (
        <FadeIn delay={0.05}>
          <div className="card-elevated-lg flex flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-[#006d5a]/8">
              <MoonStar className="size-7 text-[#006d5a]" />
            </span>
            <p className="font-display text-lg font-semibold text-[#3d2c24]">
              Todavía no hay comparaciones
            </p>
            <p className="max-w-xs text-sm leading-relaxed text-[#a39e97]">
              El motor arranca esta madrugada — mañana vas a ver acá la primera comparación contra
              Fudo.
            </p>
          </div>
        </FadeIn>
      )}

      {/* Tarjeta de precisión */}
      {estado && ultimo && (
        <FadeIn delay={0.05}>
          <PrecisionCard estado={estado} resumen={resumen} ultimo={ultimo} sinActividad={data?.sin_actividad ?? 0} />
        </FadeIn>
      )}

      {/* Dónde diverge */}
      {estado && divergentes.length > 0 && (
        <div className="space-y-2">
          <FadeIn delay={0.1}>
            <div className="flex items-baseline justify-between">
              <h2 className="section-label">Dónde diverge</h2>
              <span className="text-[10px] text-[#a39e97]">
                {fmtDia(estado.ultimo_dia)} · ordenado por plata en juego
              </span>
            </div>
          </FadeIn>
          <StaggerList className="space-y-2">
            {divergentes.map((d) => (
              <StaggerItem key={d.stock_item_id}>
                <DivergenteCard item={d} />
              </StaggerItem>
            ))}
          </StaggerList>
        </div>
      )}

      {/* Día perfecto */}
      {estado && ultimo && divergentes.length === 0 && (
        <FadeIn delay={0.1}>
          <div className="card-elevated flex items-center gap-3 rounded-2xl p-4">
            <CheckCircle2 className="size-5 shrink-0 text-[#006d5a]" />
            <p className="text-sm text-[#3d2c24]">
              Sin divergencias el último día — todos los items con actividad coinciden con Fudo.
            </p>
          </div>
        </FadeIn>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tarjeta grande de precisión + serie de barras
// ---------------------------------------------------------------------------

function PrecisionCard({
  estado,
  resumen,
  ultimo,
  sinActividad,
}: {
  estado: EstadoMotor
  resumen: ResumenDia[]
  ultimo: ResumenDia
  sinActividad: number
}) {
  const tono = tonoPrecision(ultimo.precision)
  const coinciden = ultimo.items_total - ultimo.divergentes

  return (
    <div className="card-elevated-lg overflow-hidden rounded-2xl">
      {/* Veredicto */}
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-center justify-between">
          <p className="section-label">Precisión · {fmtDia(ultimo.day)}</p>
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-[#a39e97]">
            <PulseRing color={tono} className="size-2" />
            corriendo hace {estado.dias_corriendo} {estado.dias_corriendo === 1 ? 'día' : 'días'}
          </span>
        </div>

        <div className="mt-2 flex items-end gap-3">
          <p
            className="font-display text-[52px] font-bold leading-none tracking-tight tabular-nums"
            style={{ color: tono }}
          >
            {ultimo.precision != null ? `${ultimo.precision.toLocaleString('es-AR')}%` : '—'}
          </p>
          <p className="pb-1 text-xs leading-snug text-[#7d6c64]">{veredicto(ultimo.precision)}</p>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip label={`${coinciden} de ${ultimo.items_total} items coinciden`} color={VERDE} />
          {ultimo.divergentes > 0 && <Chip label={`${ultimo.divergentes} divergentes`} color={ROJO} />}
          {sinActividad > 0 && <Chip label={`${sinActividad} sin actividad`} color="#a39e97" />}
        </div>
      </div>

      {/* Serie diaria */}
      <div className="border-t border-[#ebe6df]/70 bg-[#faf8f5]/60 px-5 pb-3 pt-4">
        <BarrasSerie resumen={resumen} />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10px] tabular-nums text-[#a39e97]">
            {resumen.length > 0 ? fmtDiaCorto(resumen[0].day) : ''}
          </span>
          <span className="text-[10px] text-[#c4bfb8]">línea punteada = objetivo 95%</span>
          <span className="text-[10px] tabular-nums text-[#a39e97]">{fmtDiaCorto(ultimo.day)}</span>
        </div>
      </div>
    </div>
  )
}

function BarrasSerie({ resumen }: { resumen: ResumenDia[] }) {
  return (
    <div className="relative h-20">
      {/* Objetivo 95% */}
      <div
        className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[#3d2c24]/25"
        style={{ top: '5%' }}
      />
      <div className="flex h-full items-end gap-1">
        {resumen.map((d) => {
          const p = d.precision
          return (
            <div
              key={d.day}
              className="group relative flex h-full flex-1 items-end"
              title={`${fmtDia(d.day)}: ${p != null ? `${p}% (${d.divergentes} divergentes de ${d.items_total})` : 'sin actividad'}`}
            >
              <div
                className="w-full rounded-t-[4px] transition-all duration-300 group-hover:opacity-80"
                style={{
                  height: p != null ? `${Math.max(6, p)}%` : '6%',
                  backgroundColor: p != null ? tonoPrecision(p) : '#e5e0d8',
                }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ backgroundColor: `${color}14`, color }}
    >
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Card de item divergente — LVE vs Fudo lado a lado + desglose del día
// ---------------------------------------------------------------------------

function DivergenteCard({ item }: { item: Divergente }) {
  const lveArriba = item.diff > 0

  return (
    <div className="card-elevated rounded-2xl p-3.5">
      {/* Nombre + plata en juego */}
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-[#3d2c24]">{item.name}</p>
        {item.impacto != null ? (
          <span className="shrink-0 rounded-full bg-[#ea504c]/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-[#ea504c]">
            {fmtPlata(item.impacto)} en juego
          </span>
        ) : (
          <span className="shrink-0 text-[10px] text-[#c4bfb8]">sin costo cargado</span>
        )}
      </div>

      {/* LVE vs Fudo */}
      <div className="mt-2.5 flex items-center gap-2">
        <div className="flex-1 rounded-xl bg-[#006d5a]/6 px-3 py-2 ring-1 ring-[#006d5a]/10">
          <p className="text-[9px] font-bold uppercase tracking-wide text-[#006d5a]">LVE</p>
          <p className="text-sm font-bold tabular-nums text-[#3d2c24]">
            {fmtQty(item.lve_qty)} <span className="text-[10px] font-medium text-[#a39e97]">{item.unit}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center">
          <ArrowRight className="size-3.5 text-[#c4bfb8]" />
          <span
            className={cn(
              'mt-0.5 rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums',
              lveArriba ? 'bg-[#d4943a]/15 text-[#b0731f]' : 'bg-[#ea504c]/10 text-[#ea504c]',
            )}
          >
            {item.diff > 0 ? '+' : ''}
            {fmtQty(item.diff)}
          </span>
        </div>
        <div className="flex-1 rounded-xl bg-[#f3efe9] px-3 py-2 ring-1 ring-[#ebe6df]">
          <p className="text-[9px] font-bold uppercase tracking-wide text-[#a39e97]">Fudo</p>
          <p className="text-sm font-bold tabular-nums text-[#3d2c24]">
            {fmtQty(item.fudo_qty)} <span className="text-[10px] font-medium text-[#a39e97]">{item.unit}</span>
          </p>
        </div>
      </div>

      {/* Desglose del día — pista para diagnosticar */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <MovChip label="Consumido" value={item.qty_consumed} unit={item.unit} />
        <MovChip label="Producido" value={item.qty_produced} unit={item.unit} />
        <MovChip label="Recibido" value={item.qty_received} unit={item.unit} />
        {Math.abs(item.diff) >= Math.max(1, Math.abs(item.fudo_qty)) && (
          <span className="flex items-center gap-1 text-[10px] font-medium text-[#b0731f]">
            <TriangleAlert className="size-3" />
            ¿unidad o receta?
          </span>
        )}
      </div>
    </div>
  )
}

function MovChip({ label, value, unit }: { label: string; value: number; unit: string }) {
  const activo = value !== 0
  return (
    <span
      className={cn(
        'rounded-lg px-1.5 py-0.5 text-[10px] tabular-nums',
        activo ? 'bg-[#3d2c24]/6 font-semibold text-[#7d6c64]' : 'bg-transparent text-[#c4bfb8]',
      )}
    >
      {label} {fmtQty(value)}{activo ? ` ${unit}` : ''}
    </span>
  )
}
