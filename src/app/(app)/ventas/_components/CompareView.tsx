'use client'

// ---------------------------------------------------------------------------
// Comparar — Día vs Día (en vivo/histórico) y Período vs Período (v2).
// Todo el estado de comparación vive acá: cambiar fechas o filtros NO toca
// el estado del modo Día de la página (nada de LoadingState global).
// Período v2: presets, filtros compartidos (canal/rubro/día/franja/consumo),
// curva diaria superpuesta, día de semana, canal, rubros y productos con delta.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, isToday, isYesterday, startOfMonth, startOfWeek, subDays, subMonths } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { Loader2, RefreshCw } from 'lucide-react'
import { FadeIn } from '@/components/ui/motion'
import { ChartCard } from '@/components/admin/ChartCard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { VENTAS_DATA_DESDE, type VentasCanal } from '@/lib/ventas/aggregate'
import type { DashboardData, RangeData } from './types'
import { formatPrice } from './types'

type Props = {
  /** Trae un día: hoy en vivo (auto-sync), pasado desde la tabla local. */
  fetchDia: (fecha: string, esHoy: boolean) => Promise<DashboardData | null>
  isManager: boolean
}

// Paleta de comparación: A verde (actual), B marrón (anterior)
const VERDE = '#006d5a'
const MARRON = '#8b5e34'
const GRIS = '#a39e97'

type PeriodRange = { from: string; to: string }
type Rangos = { a: PeriodRange; b: PeriodRange }

type PresetKey = 'semana' | 'ult7' | 'mes' | 'ult30' | 'custom'

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'semana', label: 'Esta semana vs pasada' },
  { key: 'ult7', label: 'Últimos 7 vs 7 anteriores' },
  { key: 'mes', label: 'Este mes vs pasado (a mismo día)' },
  { key: 'ult30', label: 'Últimos 30 vs 30 anteriores' },
  { key: 'custom', label: 'Personalizado' },
]

type FranjaKey = 'todas' | 'manana' | 'mediodia' | 'tarde' | 'noche'
const FRANJAS: { key: FranjaKey; label: string; desde?: number; hasta?: number }[] = [
  { key: 'todas', label: 'Todas' },
  { key: 'manana', label: 'Mañana 6-12', desde: 6, hasta: 11 },
  { key: 'mediodia', label: 'Mediodía 12-16', desde: 12, hasta: 15 },
  { key: 'tarde', label: 'Tarde 16-20', desde: 16, hasta: 19 },
  { key: 'noche', label: 'Noche 20-2', desde: 20, hasta: 1 },
]

// 0=domingo … 6=sábado (mismo código que el agregador), mostrados L→D
const DOWS: { dow: number; label: string }[] = [
  { dow: 1, label: 'L' }, { dow: 2, label: 'M' }, { dow: 3, label: 'X' }, { dow: 4, label: 'J' },
  { dow: 5, label: 'V' }, { dow: 6, label: 'S' }, { dow: 0, label: 'D' },
]

const CANALES: { key: 'todos' | VentasCanal; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'local', label: 'Local' },
  { key: 'takeaway', label: 'Takeaway' },
  { key: 'pedidosya', label: 'PedidosYa' },
]
const CANAL_LABELS: Record<VentasCanal, string> = { local: 'Local', takeaway: 'Takeaway', pedidosya: 'PedidosYa' }

const ymd = (d: Date) => format(d, 'yyyy-MM-dd')
const hoy = () => new Date()

function clampRango(r: PeriodRange): { rango: PeriodRange; clampeado: boolean; sinDatos: boolean } {
  // Un rango ENTERO anterior al primer día con datos no se clampea a un día
  // real (eso traía el 2 de mayo verdadero): se manda tal cual, el server lo
  // devuelve vacío, y la UI avisa que no hay datos antes de may 2026.
  if (r.to < VENTAS_DATA_DESDE) return { rango: r, clampeado: false, sinDatos: true }
  const from = r.from < VENTAS_DATA_DESDE ? VENTAS_DATA_DESDE : r.from
  return { rango: { from, to: r.to }, clampeado: from !== r.from, sinDatos: false }
}

/** Días del rango que cuentan para el promedio: con filtro de día de semana,
 *  solo los que matchean (4 sábados de un mes son 4 días, no 30). */
function diasQueCuentan(d: RangeData, dows: number[]): number {
  if (dows.length === 0 || dows.length >= 7) return d.byDay.length
  const set = new Set(dows)
  return d.byDay.filter((x) => set.has(new Date(`${x.date}T12:00:00Z`).getUTCDay())).length
}

function computarPreset(preset: Exclude<PresetKey, 'custom'>): Rangos {
  const now = hoy()
  switch (preset) {
    case 'semana': {
      // Lunes-hoy vs el mismo tramo de la semana anterior
      const lunes = startOfWeek(now, { weekStartsOn: 1 })
      return {
        a: { from: ymd(lunes), to: ymd(now) },
        b: { from: ymd(subDays(lunes, 7)), to: ymd(subDays(now, 7)) },
      }
    }
    case 'ult7':
      return {
        a: { from: ymd(subDays(now, 6)), to: ymd(now) },
        b: { from: ymd(subDays(now, 13)), to: ymd(subDays(now, 7)) },
      }
    case 'mes': {
      // A mismo día: 1-10 sep vs 1-10 ago (subMonths clampea fin de mes)
      const prev = subMonths(now, 1)
      return {
        a: { from: ymd(startOfMonth(now)), to: ymd(now) },
        b: { from: ymd(startOfMonth(prev)), to: ymd(prev) },
      }
    }
    case 'ult30':
      return {
        a: { from: ymd(subDays(now, 29)), to: ymd(now) },
        b: { from: ymd(subDays(now, 59)), to: ymd(subDays(now, 30)) },
      }
  }
}

function fmtRange(r: PeriodRange) {
  const a = new Date(r.from + 'T12:00:00')
  const b = new Date(r.to + 'T12:00:00')
  if (r.from === r.to) return format(a, 'd MMM', { locale: es })
  return `${format(a, 'd MMM', { locale: es })} – ${format(b, 'd MMM', { locale: es })}`
}

/** 'las 23:47' si es de hoy, 'ayer 23:47', o '9 sep 23:47' si es más viejo. */
function fmtDataHasta(iso: string): string {
  const d = new Date(iso)
  if (isToday(d)) return `las ${format(d, 'HH:mm')}`
  if (isYesterday(d)) return `ayer ${format(d, 'HH:mm')}`
  return format(d, 'd MMM HH:mm', { locale: es })
}

/** Δ% redondeado; null si no hay base (B en 0). */
function pctDe(a: number, b: number): number | null {
  return b > 0 ? Math.round(((a - b) / b) * 100) : null
}

/** Número compacto para valores por día (tickets, items). */
function fmtNum(n: number): string {
  return n >= 100 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1)
}

// ── Piezas de UI ───────────────────────────────────────────────────────────

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        active ? 'bg-[#006d5a] text-white shadow-sm' : 'bg-secondary text-muted-foreground'
      }`}
    >
      {children}
    </button>
  )
}

/** Verde=sube, rojo=baja, gris=igual (±2%). */
function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[11px] font-semibold text-[#a39e97]">—</span>
  if (Math.abs(pct) <= 2) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-[#f3efe9] px-2 py-0.5 text-[11px] font-bold text-[#a39e97]">
        = {Math.abs(pct)}%
      </span>
    )
  }
  const up = pct > 0
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${up ? 'bg-[#e8f5f1] text-[#006d5a]' : 'bg-[#fef2f2] text-[#ea504c]'}`}>
      {up ? '↑' : '↓'} {Math.abs(pct)}%
    </span>
  )
}

function TarjetasDelta({ a, b, daysA, daysB, labelMesas = 'Mesas cerradas' }: {
  a: DashboardData; b: DashboardData; daysA: number; daysB: number; labelMesas?: string
}) {
  const desigual = daysA > 0 && daysB > 0 && daysA !== daysB
  const rows = [
    { label: 'Facturado',       valA: a.totalFacturado, valB: b.totalFacturado, fmt: true,  porDia: true  },
    { label: 'Tickets',         valA: a.totalTickets,   valB: b.totalTickets,   fmt: false, porDia: true  },
    { label: 'Ticket promedio', valA: a.avgTicket,      valB: b.avgTicket,      fmt: true,  porDia: false },
    { label: 'Items vendidos',  valA: a.totalItems,     valB: b.totalItems,     fmt: false, porDia: true  },
    { label: labelMesas,        valA: a.mesasCerradas,  valB: b.mesasCerradas,  fmt: false, porDia: true  },
  ]
  return (
    <>
      {rows.map((row) => {
        const normaliza = desigual && row.porDia
        const perA = row.valA / daysA
        const perB = row.valB / daysB
        const pct = normaliza ? pctDe(perA, perB) : pctDe(row.valA, row.valB)
        return (
          <div key={row.label} className="rounded-xl border bg-card p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
              {row.label}
              {normaliza && <span className="ml-1.5 normal-case tracking-normal text-[#c8c2ba]">· normalizado por día</span>}
            </p>
            <div className="grid grid-cols-3 items-start gap-2">
              <div>
                <p className="font-display text-lg font-bold tabular-nums text-[#006d5a]">
                  {row.fmt ? formatPrice(row.valA) : row.valA}
                </p>
                {normaliza && (
                  <p className="text-[10px] tabular-nums text-[#a39e97]">≈ {row.fmt ? formatPrice(Math.round(perA)) : fmtNum(perA)}/día</p>
                )}
              </div>
              <div className="pt-1 text-center">
                <DeltaBadge pct={pct} />
              </div>
              <div className="text-right">
                <p className="font-display text-lg font-bold tabular-nums text-[#8b5e34]">
                  {row.fmt ? formatPrice(row.valB) : row.valB}
                </p>
                {normaliza && (
                  <p className="text-[10px] tabular-nums text-[#a39e97]">≈ {row.fmt ? formatPrice(Math.round(perB)) : fmtNum(perB)}/día</p>
                )}
              </div>
            </div>
          </div>
        )
      })}
      {desigual && (
        <p className="px-1 text-[10px] text-[#a39e97]">
          Los períodos no miden lo mismo ({daysA} vs {daysB} días): el Δ% se calcula sobre el promedio por día.
        </p>
      )}
    </>
  )
}

function ChartHoras({ a, b, labelA, labelB, horaInicio = 0 }: {
  a: DashboardData; b: DashboardData; labelA: string; labelB: string
  /** Hora con la que arranca el eje (franja que cruza medianoche: 20 → 20..23,0,1). */
  horaInicio?: number
}) {
  if (a.byHour.length === 0 && b.byHour.length === 0) return null
  const map = new Map<string, { hour: string; a: number; b: number }>()
  for (const h of a.byHour) map.set(h.hour, { hour: h.hour, a: h.revenue, b: 0 })
  for (const h of b.byHour) {
    const row = map.get(h.hour) ?? { hour: h.hour, a: 0, b: 0 }
    row.b = h.revenue
    map.set(h.hour, row)
  }
  const orden = (hour: string) => (Number(hour.slice(0, 2)) - horaInicio + 24) % 24
  const serie = Array.from(map.values()).sort((x, y) => orden(x.hour) - orden(y.hour))
  return (
    <ChartCard title="Ventas por hora" subtitle={`${labelA} vs ${labelB}`}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={serie} margin={{ left: -15, right: 8 }}>
          <XAxis dataKey="hour" tick={{ fontSize: 10, fill: GRIS }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: GRIS }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) => [formatPrice(v), name === 'a' ? labelA : labelB]}
          />
          <Bar dataKey="a" fill={VERDE} radius={[4, 4, 0, 0]} />
          <Bar dataKey="b" fill={MARRON} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** Curva diaria A vs B, alineada por índice de día (no por fecha). */
function CurvaDiaria({ a, b, labelA, labelB }: { a: RangeData; b: RangeData; labelA: string; labelB: string }) {
  const len = Math.max(a.byDay.length, b.byDay.length)
  if (len < 2) return null
  const serie = Array.from({ length: len }, (_, i) => ({
    idx: i + 1,
    a: a.byDay[i]?.revenue ?? null,
    b: b.byDay[i]?.revenue ?? null,
    dateA: a.byDay[i]?.date ?? null,
    dateB: b.byDay[i]?.date ?? null,
  }))
  const fmtDia = (d: string | null) => (d ? format(new Date(d + 'T12:00:00'), 'd MMM', { locale: es }) : '—')
  return (
    <ChartCard title="Curva diaria" subtitle="Día 1 = primer día de cada período">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={serie} margin={{ left: -15, right: 8 }}>
          <XAxis dataKey="idx" tick={{ fontSize: 10, fill: GRIS }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: GRIS }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) => [formatPrice(v ?? 0), name === 'a' ? labelA : labelB]}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            labelFormatter={(idx: any) => {
              const p = serie[Number(idx) - 1]
              return p ? `Día ${idx} · ${fmtDia(p.dateA)} / ${fmtDia(p.dateB)}` : `Día ${idx}`
            }}
          />
          <Line type="monotone" dataKey="a" stroke={VERDE} strokeWidth={2} dot={false} connectNulls={false} />
          <Line type="monotone" dataKey="b" stroke={MARRON} strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function BarrasDow({ a, b, labelA, labelB }: { a: RangeData; b: RangeData; labelA: string; labelB: string }) {
  const serie = DOWS.map(({ dow, label }) => ({
    dia: label,
    a: a.byDow.find((d) => d.dow === dow)?.revenue ?? 0,
    b: b.byDow.find((d) => d.dow === dow)?.revenue ?? 0,
  }))
  if (serie.every((s) => s.a === 0 && s.b === 0)) return null
  return (
    <ChartCard title="Por día de semana" subtitle={`${labelA} vs ${labelB}`}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={serie} margin={{ left: -15, right: 8 }}>
          <XAxis dataKey="dia" tick={{ fontSize: 10, fill: GRIS }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: GRIS }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(v: any, name: any) => [formatPrice(v), name === 'a' ? labelA : labelB]}
          />
          <Bar dataKey="a" fill={VERDE} radius={[4, 4, 0, 0]} />
          <Bar dataKey="b" fill={MARRON} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function TablaCanal({ a, b }: { a: RangeData; b: RangeData }) {
  const rows = (['local', 'takeaway', 'pedidosya'] as VentasCanal[])
    .map((c) => ({
      canal: c,
      revA: a.byCanal.find((x) => x.canal === c)?.revenue ?? 0,
      revB: b.byCanal.find((x) => x.canal === c)?.revenue ?? 0,
    }))
    .filter((r) => r.revA > 0 || r.revB > 0)
  if (rows.length === 0) return null
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Por canal</p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.canal} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 text-[12px]">
            <span className="font-medium text-[#3d2c24]">{CANAL_LABELS[r.canal]}</span>
            <span className="tabular-nums font-bold text-[#006d5a]">{formatPrice(r.revA)}</span>
            <span className="tabular-nums text-[#8b5e34]">{formatPrice(r.revB)}</span>
            <span className="w-16 text-right"><DeltaBadge pct={pctDe(r.revA, r.revB)} /></span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TablaRubros({ a, b }: { a: RangeData; b: RangeData }) {
  // Key por id (dos rubros pueden llamarse igual)
  const map = new Map<string, { key: string; nombre: string; revA: number; revB: number }>()
  for (const c of a.byCategoria) {
    const key = c.id ?? '(sin)'
    map.set(key, { key, nombre: c.nombre, revA: c.revenue, revB: 0 })
  }
  for (const c of b.byCategoria) {
    const key = c.id ?? '(sin)'
    const row = map.get(key) ?? { key, nombre: c.nombre, revA: 0, revB: 0 }
    row.revB = c.revenue
    map.set(key, row)
  }
  const rows = [...map.values()].sort((x, y) => y.revA + y.revB - (x.revA + x.revB)).slice(0, 8)
  if (rows.length === 0) return null
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Rubros (top 8)</p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 text-[12px]">
            <span className="truncate font-medium text-[#3d2c24]">{r.nombre}</span>
            <span className="tabular-nums font-bold text-[#006d5a]">{formatPrice(r.revA)}</span>
            <span className="tabular-nums text-[#8b5e34]">{formatPrice(r.revB)}</span>
            <span className="w-16 text-right"><DeltaBadge pct={pctDe(r.revA, r.revB)} /></span>
          </div>
        ))}
      </div>
    </div>
  )
}

type ProdDelta = {
  id: string
  nombre: string
  unA: number
  unB: number
  revA: number
  revB: number
  delta: number
  pct: number | null
}

function FilaProducto({ p }: { p: ProdDelta }) {
  const nuevo = p.revB === 0 && p.unB === 0 && (p.revA > 0 || p.unA > 0)
  const dejo = p.revA === 0 && p.unA === 0 && (p.revB > 0 || p.unB > 0)
  return (
    <tr className="border-t border-border/30">
      <td className="max-w-[160px] py-1.5 pr-2">
        <span className="block truncate text-[12px] font-medium text-[#3d2c24]">{p.nombre}</span>
        {nuevo && <span className="rounded-full bg-[#e8f5f1] px-1.5 py-px text-[9px] font-bold text-[#006d5a]">nuevo</span>}
        {dejo && <span className="rounded-full bg-[#fef2f2] px-1.5 py-px text-[9px] font-bold text-[#ea504c]">dejó de venderse</span>}
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] tabular-nums text-[#3d2c24]">
        <span className="text-[#8b5e34]">{p.unB}</span> → <span className="font-bold text-[#006d5a]">{p.unA}</span>
      </td>
      <td className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] tabular-nums text-[#3d2c24]">
        <span className="text-[#8b5e34]">{formatPrice(p.revB)}</span> → <span className="font-bold text-[#006d5a]">{formatPrice(p.revA)}</span>
      </td>
      <td className="whitespace-nowrap py-1.5 pl-2 text-right">
        <DeltaBadge pct={p.pct} />
      </td>
    </tr>
  )
}

function TablaProductos({ a, b }: { a: RangeData; b: RangeData }) {
  const [verTodos, setVerTodos] = useState(false)
  const merged = useMemo<ProdDelta[]>(() => {
    const map = new Map<string, ProdDelta>()
    for (const p of a.byProduct) {
      map.set(p.fudoProductId, {
        id: p.fudoProductId, nombre: p.nombre, unA: p.unidades, revA: p.revenue, unB: 0, revB: 0, delta: 0, pct: null,
      })
    }
    for (const p of b.byProduct) {
      const row = map.get(p.fudoProductId) ?? {
        id: p.fudoProductId, nombre: p.nombre, unA: 0, revA: 0, unB: 0, revB: 0, delta: 0, pct: null,
      }
      row.unB = p.unidades
      row.revB = p.revenue
      map.set(p.fudoProductId, row)
    }
    return [...map.values()]
      .map((r) => ({ ...r, delta: r.revA - r.revB, pct: pctDe(r.revA, r.revB) }))
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
  }, [a, b])

  if (merged.length === 0) return null

  // merged ya viene por |Δ$|: para positivos eso ES orden por delta desc,
  // para negativos por delta asc (los que más cayeron primero)
  const subas = merged.filter((r) => r.delta > 0).slice(0, 10)
  const bajas = merged.filter((r) => r.delta < 0).slice(0, 10)

  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Productos con delta</p>
      <p className="mb-2 text-[10px] text-[#a39e97]">Ordenados por Δ$ · antes ({'B'}) → ahora ({'A'})</p>
      {verTodos ? (
        <TablaDeltaProductos rows={merged} />
      ) : (
        <div className="space-y-3">
          {subas.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-bold text-[#006d5a]">↑ Top subas</p>
              <TablaDeltaProductos rows={subas} />
            </div>
          )}
          {bajas.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-bold text-[#ea504c]">↓ Top bajas</p>
              <TablaDeltaProductos rows={bajas} />
            </div>
          )}
        </div>
      )}
      <button
        onClick={() => setVerTodos((v) => !v)}
        className="mt-2 w-full rounded-lg bg-secondary py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-[#3d2c24]"
      >
        {verTodos ? 'Ver top subas y bajas' : `Ver todos (${merged.length})`}
      </button>
    </div>
  )
}

/** 'Compras Fudo $X · food cost real Y%' por período (solo manager). */
function TablaDeltaProductos({ rows }: { rows: ProdDelta[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px]">
        <thead>
          <tr className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">
            <th className="pb-1 pr-2 text-left">Producto</th>
            <th className="px-2 pb-1 text-right">Un. antes → ahora</th>
            <th className="px-2 pb-1 text-right">$ antes → ahora</th>
            <th className="pb-1 pl-2 text-right">Δ%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => <FilaProducto key={p.id} p={p} />)}
        </tbody>
      </table>
    </div>
  )
}

function CeldaFoodCost({ d, color }: { d: RangeData; color: string }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2">
      {d.comprasFudo != null ? (
        <p className="text-[11px] text-[#3d2c24]">
          Compras Fudo <strong className="tabular-nums" style={{ color }}>{formatPrice(d.comprasFudo)}</strong>
          {d.foodCostReal != null && (
            <> · food cost real <strong className="tabular-nums" style={{ color }}>{(d.foodCostReal * 100).toFixed(1)}%</strong></>
          )}
        </p>
      ) : (
        <p className="text-[10px] text-[#a39e97]">{d.costosNota ?? 'Sin datos de compras'}</p>
      )}
      {d.comprasFudo != null && d.costosNota && (
        <p className="mt-0.5 text-[10px] text-[#a39e97]">{d.costosNota}</p>
      )}
    </div>
  )
}

function FoodCostPeriodos({ a, b }: { a: RangeData; b: RangeData }) {
  const tiene = (d: RangeData) => d.comprasFudo != null || d.costosNota != null
  if (!tiene(a) && !tiene(b)) return null
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <CeldaFoodCost d={a} color={VERDE} />
      <CeldaFoodCost d={b} color={MARRON} />
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────

export function CompareView({ fetchDia, isManager }: Props) {
  const [mode, setMode] = useState<'dia' | 'periodo'>('dia')

  // ── Modo Día: estado propio, separado del modo Día de la página ──
  const [dayA, setDayA] = useState<Date>(() => new Date())
  const [dayB, setDayB] = useState<Date>(() => subDays(new Date(), 1))
  const [dayAData, setDayAData] = useState<DashboardData | null>(null)
  const [dayBData, setDayBData] = useState<DashboardData | null>(null)
  const [loadingDia, setLoadingDia] = useState(false)
  const [errorDia, setErrorDia] = useState<string | null>(null)
  // Guard de secuencia: si se piden días de nuevo antes de que vuelva la
  // respuesta anterior, solo se aplica la ÚLTIMA (la vieja no pisa la vigente)
  const seqDia = useRef(0)

  const fetchDias = useCallback(async () => {
    const id = ++seqDia.current
    setLoadingDia(true)
    setErrorDia(null)
    try {
      const [ra, rb] = await Promise.all([
        fetchDia(ymd(dayA), isToday(dayA)),
        fetchDia(ymd(dayB), isToday(dayB)),
      ])
      if (id !== seqDia.current) return
      setDayAData(ra)
      setDayBData(rb)
      if (!ra || !rb) setErrorDia('No llegaron datos de uno de los días.')
    } catch (err) {
      if (id !== seqDia.current) return
      setDayAData(null)
      setDayBData(null)
      setErrorDia(err instanceof Error ? err.message : 'No se pudieron traer las ventas.')
    }
    setLoadingDia(false)
  }, [dayA, dayB, fetchDia])

  // Primera carga del panel Día (una sola vez, como hacía la página)
  const initDia = useRef(false)
  useEffect(() => {
    if (mode !== 'dia' || initDia.current) return
    initDia.current = true
    fetchDias()
  }, [mode, fetchDias])

  // ── Modo Período: presets + filtros ──
  const [preset, setPreset] = useState<PresetKey>('mes')
  const [custom, setCustom] = useState<Rangos>(() => {
    const r = computarPreset('mes')
    return { a: r.a, b: r.b }
  })
  const [customAplicado, setCustomAplicado] = useState<Rangos | null>(null)

  const [canal, setCanal] = useState<'todos' | VentasCanal>('todos')
  const [rubro, setRubro] = useState<string>('todas')
  const [dowsSel, setDowsSel] = useState<number[]>([])
  const [franja, setFranja] = useState<FranjaKey>('todas')
  // 'Sin consumo interno' prendido = excluir líneas a $0 (default del API)
  const [sinConsumo, setSinConsumo] = useState(true)

  const [rubros, setRubros] = useState<{ id: string; nombre: string }[]>([])
  const [periodAData, setPeriodAData] = useState<RangeData | null>(null)
  const [periodBData, setPeriodBData] = useState<RangeData | null>(null)
  const [loadingPeriod, setLoadingPeriod] = useState(false)
  const [refrescando, setRefrescando] = useState(false)
  const [errorPeriodo, setErrorPeriodo] = useState<string | null>(null)
  // Días de semana con los que se pidió lo que está en pantalla (para
  // normalizar por día sin mezclar con un filtro recién tocado)
  const [dowsDeDatos, setDowsDeDatos] = useState<number[]>([])
  const seqPeriodo = useRef(0)

  const aplicado: { rangos: Rangos; clampeado: boolean; sinDatosA: boolean; sinDatosB: boolean } | null = useMemo(() => {
    const crudo = preset === 'custom' ? customAplicado : computarPreset(preset)
    if (!crudo) return null
    const ca = clampRango(crudo.a)
    const cb = clampRango(crudo.b)
    return {
      rangos: { a: ca.rango, b: cb.rango },
      clampeado: ca.clampeado || cb.clampeado,
      sinDatosA: ca.sinDatos,
      sinDatosB: cb.sinDatos,
    }
  }, [preset, customAplicado])

  const buildParams = useCallback((r: PeriodRange): string => {
    const q = new URLSearchParams({ from: r.from, to: r.to })
    if (canal !== 'todos') q.set('canal', canal)
    if (rubro !== 'todas') q.set('categorias', rubro)
    if (dowsSel.length > 0 && dowsSel.length < 7) q.set('dows', dowsSel.join(','))
    const f = FRANJAS.find((x) => x.key === franja)
    if (f?.desde != null && f?.hasta != null) {
      q.set('horaDesde', String(f.desde))
      q.set('horaHasta', String(f.hasta))
    }
    if (!sinConsumo) q.set('incluirSinPrecio', '1')
    if (isManager) q.set('costos', '1')
    return q.toString()
  }, [canal, rubro, dowsSel, franja, sinConsumo, isManager])

  const fetchPeriodos = useCallback(async (fresh: boolean) => {
    if (!aplicado) return
    const id = ++seqPeriodo.current
    const dowsPedidos = dowsSel
    if (fresh) setRefrescando(true)
    else setLoadingPeriod(true)
    setErrorPeriodo(null)
    try {
      if (fresh) {
        // Actualizar: PRIMERO un solo request fresh=1 al período que toca
        // hoy/ayer (importa de Fudo y espera), DESPUÉS los dos normales en
        // paralelo. Antes fresh viajaba solo en A aunque hoy estuviera en B,
        // y el B salía en paralelo con el import a medio hacer.
        const hoyS = ymd(hoy())
        const ayerS = ymd(subDays(hoy(), 1))
        const toca = (r: PeriodRange) => r.to >= ayerS && r.from <= hoyS
        const objetivo = [aplicado.rangos.a, aplicado.rangos.b].find(toca)
        if (objetivo) {
          const q = new URLSearchParams({ from: objetivo.from, to: objetivo.to, fresh: '1' })
          await fetch(`/api/fudo/range-summary?${q}`, { credentials: 'include' }).catch(() => null)
          if (id !== seqPeriodo.current) return
        }
      }
      const [resA, resB] = await Promise.all([
        fetch(`/api/fudo/range-summary?${buildParams(aplicado.rangos.a)}`, { credentials: 'include' }),
        fetch(`/api/fudo/range-summary?${buildParams(aplicado.rangos.b)}`, { credentials: 'include' }),
      ])
      const [jsonA, jsonB] = await Promise.all([resA.json().catch(() => ({})), resB.json().catch(() => ({}))])
      if (id !== seqPeriodo.current) return
      if (!resA.ok || !resB.ok) {
        const falla = !resA.ok ? jsonA : jsonB
        throw new Error(falla?.error ?? `Error ${!resA.ok ? resA.status : resB.status}`)
      }
      const dA = (jsonA.data ?? null) as RangeData | null
      const dB = (jsonB.data ?? null) as RangeData | null
      setPeriodAData(dA)
      setPeriodBData(dB)
      setDowsDeDatos(dowsPedidos)
      if (!dA || !dB) setErrorPeriodo('No llegaron datos de uno de los períodos.')
      // Unión de rubros vistos: alimenta el select aunque después se filtre
      setRubros((prev) => {
        const m = new Map(prev.map((r) => [r.id, r.nombre]))
        for (const d of [dA, dB]) {
          for (const c of d?.byCategoria ?? []) {
            if (c.id != null) m.set(c.id, c.nombre)
          }
        }
        return [...m.entries()]
          .map(([id, nombre]) => ({ id, nombre }))
          .sort((x, y) => x.nombre.localeCompare(y.nombre))
      })
    } catch (err) {
      if (id !== seqPeriodo.current) return
      setPeriodAData(null)
      setPeriodBData(null)
      setErrorPeriodo(err instanceof Error ? err.message : 'No se pudieron traer las ventas.')
    }
    setLoadingPeriod(false)
    setRefrescando(false)
  }, [aplicado, buildParams, dowsSel])

  // Re-consultar cuando cambian rangos aplicados o filtros (modo período)
  const claveFetch = aplicado ? JSON.stringify([aplicado.rangos, canal, rubro, dowsSel, franja, sinConsumo]) : ''
  const fetchRef = useRef(fetchPeriodos)
  fetchRef.current = fetchPeriodos
  useEffect(() => {
    if (mode !== 'periodo' || claveFetch === '') return
    fetchRef.current(false)
  }, [mode, claveFetch])

  const loading = mode === 'dia' ? loadingDia : loadingPeriod
  const hoyStr = ymd(hoy())
  const incluyeHoy = aplicado != null && (aplicado.rangos.a.to >= hoyStr || aplicado.rangos.b.to >= hoyStr)
  // El "datos hasta" sale del período que toca hoy (puede ser B en un custom)
  const dataHastaHoy = aplicado == null
    ? null
    : aplicado.rangos.a.to >= hoyStr
      ? periodAData?.dataHasta ?? null
      : periodBData?.dataHasta ?? null
  // Franja que cruza medianoche (20-2): el eje de horas arranca en 'desde'
  const franjaSel = FRANJAS.find((f) => f.key === franja)
  const horaInicio = franjaSel?.desde != null && franjaSel.hasta != null && franjaSel.desde > franjaSel.hasta ? franjaSel.desde : 0
  const diasA = periodAData ? diasQueCuentan(periodAData, dowsDeDatos) : 0
  const diasB = periodBData ? diasQueCuentan(periodBData, dowsDeDatos) : 0
  const filtraDow = dowsDeDatos.length > 0 && dowsDeDatos.length < 7

  const labelA = mode === 'dia' ? format(dayA, 'EEE d MMM', { locale: es }) : aplicado ? fmtRange(aplicado.rangos.a) : ''
  const labelB = mode === 'dia' ? format(dayB, 'EEE d MMM', { locale: es }) : aplicado ? fmtRange(aplicado.rangos.b) : ''

  const inputCls = 'mt-1 w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2.5 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]'

  return (
    <FadeIn>
      <div className="space-y-4">
        {/* Modo: Día vs Período */}
        <div className="flex rounded-xl border border-[#ebe6df] bg-[#faf8f5] p-1">
          {(['dia', 'periodo'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-lg py-1.5 text-[12px] font-semibold transition-all ${
                mode === m ? 'bg-white text-[#3d2c24] shadow-sm' : 'text-[#a39e97]'
              }`}
            >
              {m === 'dia' ? 'Día' : 'Período'}
            </button>
          ))}
        </div>

        {mode === 'dia' ? (
          /* ── Modo día ── */
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Día A</label>
                <input
                  type="date"
                  value={ymd(dayA)}
                  min={VENTAS_DATA_DESDE}
                  max={hoyStr}
                  onChange={(e) => e.target.value && setDayA(new Date(e.target.value + 'T12:00:00'))}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Día B</label>
                <input
                  type="date"
                  value={ymd(dayB)}
                  min={VENTAS_DATA_DESDE}
                  max={hoyStr}
                  onChange={(e) => e.target.value && setDayB(new Date(e.target.value + 'T12:00:00'))}
                  className={inputCls}
                />
              </div>
            </div>
            <button
              onClick={fetchDias}
              disabled={loading}
              className="w-full rounded-xl bg-[#006d5a] py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? 'Cargando...' : 'Comparar'}
            </button>
          </>
        ) : (
          /* ── Modo período ── */
          <>
            {/* Presets */}
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Chip key={p.key} active={preset === p.key} onClick={() => setPreset(p.key)}>
                  {p.label}
                </Chip>
              ))}
            </div>

            {preset === 'custom' ? (
              <>
                <div className="space-y-3">
                  {([
                    { key: 'a' as const, label: 'Período A', color: '#006d5a' },
                    { key: 'b' as const, label: 'Período B', color: '#8b5e34' },
                  ]).map((s) => (
                    <div key={s.key}>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: s.color }}>{s.label}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-[#a39e97]">Desde</label>
                          <input
                            type="date"
                            value={custom[s.key].from}
                            min={VENTAS_DATA_DESDE}
                            onChange={(e) => setCustom((c) => ({ ...c, [s.key]: { ...c[s.key], from: e.target.value } }))}
                            className={inputCls}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[#a39e97]">Hasta</label>
                          <input
                            type="date"
                            value={custom[s.key].to}
                            min={VENTAS_DATA_DESDE}
                            onChange={(e) => setCustom((c) => ({ ...c, [s.key]: { ...c[s.key], to: e.target.value } }))}
                            className={inputCls}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setCustomAplicado({ a: { ...custom.a }, b: { ...custom.b } })}
                  disabled={loading || !custom.a.from || !custom.a.to || !custom.b.from || !custom.b.to}
                  className="w-full rounded-xl bg-[#006d5a] py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-[0.98] disabled:opacity-50"
                >
                  {loading ? 'Cargando...' : 'Comparar períodos'}
                </button>
              </>
            ) : (
              aplicado && (
                <p className="px-1 text-[11px] text-[#a39e97]">
                  <span className="font-semibold text-[#006d5a]">{fmtRange(aplicado.rangos.a)}</span>
                  {' vs '}
                  <span className="font-semibold text-[#8b5e34]">{fmtRange(aplicado.rangos.b)}</span>
                </p>
              )
            )}

            {aplicado?.clampeado && (
              <p className="rounded-lg bg-[#fdf6ec] px-3 py-1.5 text-[10px] font-medium text-[#8b5e34]">
                Hay datos desde may 2026: el rango se acortó a lo disponible.
              </p>
            )}
            {(aplicado?.sinDatosA || aplicado?.sinDatosB) && (
              <p className="rounded-lg bg-[#fdf6ec] px-3 py-1.5 text-[10px] font-medium text-[#8b5e34]">
                No hay datos antes de may 2026: el período {aplicado.sinDatosA && aplicado.sinDatosB ? 'A y el B quedan vacíos' : aplicado.sinDatosA ? 'A queda vacío' : 'B queda vacío'}.
              </p>
            )}

            {/* Filtros — afectan a los DOS períodos */}
            <div className="space-y-2 rounded-xl border border-[#ebe6df] bg-[#faf8f5] p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-12 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Canal</span>
                {CANALES.map((c) => (
                  <Chip key={c.key} active={canal === c.key} onClick={() => setCanal(c.key)}>{c.label}</Chip>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-12 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Franja</span>
                {FRANJAS.map((f) => (
                  <Chip key={f.key} active={franja === f.key} onClick={() => setFranja(f.key)}>{f.label}</Chip>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-12 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Día</span>
                {DOWS.map((d) => (
                  <button
                    key={d.dow}
                    onClick={() => setDowsSel((prev) => prev.includes(d.dow) ? prev.filter((x) => x !== d.dow) : [...prev, d.dow])}
                    className={`size-7 rounded-full text-[11px] font-bold transition-colors ${
                      dowsSel.includes(d.dow) ? 'bg-[#006d5a] text-white shadow-sm' : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
                {dowsSel.length > 0 && (
                  <button onClick={() => setDowsSel([])} className="text-[10px] font-semibold text-[#a39e97] underline">
                    todos
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-12 shrink-0 text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">Rubro</span>
                <select
                  value={rubro}
                  onChange={(e) => setRubro(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-[#ebe6df] bg-white px-2 py-1.5 text-[11px] font-medium text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
                >
                  <option value="todas">Todos los rubros</option>
                  {rubros.map((r) => (
                    <option key={r.id} value={r.id}>{r.nombre}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[11px] font-medium text-[#3d2c24]">Sin consumo interno</span>
                <button
                  onClick={() => setSinConsumo((v) => !v)}
                  role="switch"
                  aria-checked={sinConsumo}
                  className={`relative h-5 w-9 rounded-full transition-colors ${sinConsumo ? 'bg-[#006d5a]' : 'bg-[#d8d2c9]'}`}
                >
                  <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${sinConsumo ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
              </div>
              <p className="text-[9px] text-[#a39e97]">
                {sinConsumo ? 'Las líneas a $0 (personal, promos) quedan afuera.' : 'Incluye líneas a $0: tickets y unidades pueden inflarse.'}
              </p>
            </div>
          </>
        )}

        {/* ── Resultados ── */}
        {mode === 'dia' && dayAData && dayBData && !loading && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[#e8f5f1] px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#006d5a]">{labelA}</p>
                <p className="text-[9px] text-[#006d5a]/60">{isToday(dayA) ? 'en vivo' : 'histórico'}</p>
              </div>
              <div className="rounded-xl bg-[#faf0e4] px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8b5e34]">{labelB}</p>
                <p className="text-[9px] text-[#8b5e34]/60">{isToday(dayB) ? 'en vivo' : 'histórico'}</p>
              </div>
            </div>
            {isToday(dayA) !== isToday(dayB) && (
              <p className="px-1 text-[10px] text-[#a39e97]">
                Fuentes distintas: el día en vivo incluye descuentos de ticket.
              </p>
            )}

            <TarjetasDelta a={dayAData} b={dayBData} daysA={1} daysB={1} />

            <div className="rounded-xl border bg-card p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Top 5 productos</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  {dayAData.topProducts.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate text-[#3d2c24]">{p.name}</span>
                      <span className="ml-1 shrink-0 font-bold tabular-nums text-[#006d5a]">{p.qty}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  {dayBData.topProducts.slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="truncate text-[#3d2c24]">{p.name}</span>
                      <span className="ml-1 shrink-0 font-bold tabular-nums text-[#8b5e34]">{p.qty}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <ChartHoras a={dayAData} b={dayBData} labelA={labelA} labelB={labelB} />
          </div>
        )}

        {mode === 'periodo' && periodAData && periodBData && !loading && (
          <div className="space-y-3">
            {/* Chip de frescura + Actualizar (solo si el rango incluye hoy).
                Sin dataHasta (nada sincronizado todavía) igual se ofrece
                Actualizar al manager: es justo cuando más falta hace. */}
            {incluyeHoy && (dataHastaHoy || isManager) && (
              <div className="flex items-center justify-between gap-2">
                {dataHastaHoy ? (
                  <span className="rounded-full bg-[#f3efe9] px-2.5 py-1 text-[10px] font-semibold text-[#a39e97]">
                    Datos hasta {fmtDataHasta(dataHastaHoy)}
                  </span>
                ) : (
                  <span className="rounded-full bg-[#f3efe9] px-2.5 py-1 text-[10px] font-semibold text-[#a39e97]">
                    Sin ventas sincronizadas del rango
                  </span>
                )}
                {isManager && (
                  <button
                    onClick={() => fetchPeriodos(true)}
                    disabled={refrescando}
                    className="flex items-center gap-1 rounded-full bg-[#e8f5f1] px-2.5 py-1 text-[10px] font-bold text-[#006d5a] disabled:opacity-50"
                  >
                    {refrescando ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    Actualizar
                  </button>
                )}
              </div>
            )}

            {(periodAData.truncado || periodBData.truncado) && (
              <p className="rounded-lg bg-[#fef2f2] px-3 py-1.5 text-[10px] font-medium text-[#ea504c]">
                Rango muy grande: datos truncados{periodAData.truncado && periodBData.truncado ? '' : ` en el período ${periodAData.truncado ? 'A' : 'B'}`}. Achicá el rango para ver los números completos.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[#e8f5f1] px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#006d5a]">{labelA}</p>
                <p className="text-[9px] text-[#006d5a]/60">
                  {diasA} día{diasA !== 1 ? 's' : ''}{filtraDow && ` de ${periodAData.byDay.length}`}
                </p>
              </div>
              <div className="rounded-xl bg-[#faf0e4] px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8b5e34]">{labelB}</p>
                <p className="text-[9px] text-[#8b5e34]/60">
                  {diasB} día{diasB !== 1 ? 's' : ''}{filtraDow && ` de ${periodBData.byDay.length}`}
                </p>
              </div>
            </div>

            <TarjetasDelta
              a={periodAData}
              b={periodBData}
              daysA={diasA}
              daysB={diasB}
              labelMesas="Tickets en salón"
            />

            {isManager && <FoodCostPeriodos a={periodAData} b={periodBData} />}

            <CurvaDiaria a={periodAData} b={periodBData} labelA={labelA} labelB={labelB} />
            <BarrasDow a={periodAData} b={periodBData} labelA={labelA} labelB={labelB} />
            <ChartHoras a={periodAData} b={periodBData} labelA={labelA} labelB={labelB} horaInicio={horaInicio} />
            <TablaCanal a={periodAData} b={periodBData} />
            <TablaRubros a={periodAData} b={periodBData} />
            <TablaProductos a={periodAData} b={periodBData} />
          </div>
        )}

        {mode === 'periodo' && preset === 'custom' && !customAplicado && !loading && (
          <p className="py-4 text-center text-[12px] text-[#a39e97]">
            Elegí los dos rangos y tocá «Comparar períodos».
          </p>
        )}

        {/* Error visible: un 500 ya no deja la pantalla vacía sin explicación */}
        {!loading && (mode === 'dia' ? errorDia : errorPeriodo) && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-3 py-2.5">
            <p className="min-w-0 text-[11px] font-medium text-[#ea504c]">
              No se pudieron traer las ventas: {mode === 'dia' ? errorDia : errorPeriodo}
            </p>
            <button
              onClick={() => (mode === 'dia' ? fetchDias() : fetchPeriodos(false))}
              className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-[#ea504c] shadow-sm"
            >
              Reintentar
            </button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-[#a39e97]" />
          </div>
        )}
      </div>
    </FadeIn>
  )
}
