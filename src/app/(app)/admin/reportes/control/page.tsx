'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { format, startOfMonth, endOfMonth, addMonths } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, TrendingUp, Users, Clock, DollarSign } from 'lucide-react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'
import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'
import type { InformeControl } from '@/lib/reportes/control'

// ---------------------------------------------------------------------------
// Control del personal: asistencia por persona, encargados y costo laboral
// contra ventas (Fudo). Cálculo en lib/reportes/control.ts.
// ---------------------------------------------------------------------------

const PERIODOS = [
  { key: '1q', label: '1° Quincena' },
  { key: '2q', label: '2° Quincena' },
  { key: 'mes', label: 'Mes completo' },
] as const

const money = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`
const rol = (r: string) => ROLES[r as AppRole]?.label ?? r
// Semáforo del costo laboral sobre ventas
const colorPct = (p: number | null) => (p == null ? '#a39e97' : p <= 20 ? '#006d5a' : p <= 30 ? '#d4943a' : '#ea504c')

export default function ControlPage() {
  const [ref, setRef] = useState(new Date())
  const [periodo, setPeriodo] = useState<string>('mes')
  const [datos, setDatos] = useState<InformeControl | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rango = useCallback(() => {
    const a = startOfMonth(ref)
    const b = endOfMonth(ref)
    if (periodo === '1q') return { from: format(a, 'yyyy-MM-dd'), to: format(new Date(ref.getFullYear(), ref.getMonth(), 15), 'yyyy-MM-dd') }
    if (periodo === '2q') return { from: format(new Date(ref.getFullYear(), ref.getMonth(), 16), 'yyyy-MM-dd'), to: format(b, 'yyyy-MM-dd') }
    return { from: format(a, 'yyyy-MM-dd'), to: format(b, 'yyyy-MM-dd') }
  }, [ref, periodo])

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const { from, to } = rango()
      const r = await fetch(`/api/admin/reportes/control?from=${from}&to=${to}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'No se pudo armar el informe')
      setDatos(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo armar el informe')
    } finally {
      setCargando(false)
    }
  }, [rango])

  const c = datos?.costo

  return (
    <div className="space-y-5 pb-28">
      <div>
        <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Control del personal</h2>
        <p className="section-label mt-1">Asistencia, encargados y costo laboral contra ventas</p>
      </div>

      {/* Período */}
      <div className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-[#ebe6df]">
        <div className="flex items-center justify-between">
          <button onClick={() => setRef((d) => addMonths(d, -1))} className="rounded-lg p-2 hover:bg-[#f3efe9]" aria-label="Mes anterior"><ChevronLeft className="size-4" /></button>
          <p className="text-sm font-bold capitalize text-[#3d2c24]">{format(ref, "MMMM 'de' yyyy", { locale: es })}</p>
          <button onClick={() => setRef((d) => addMonths(d, 1))} className="rounded-lg p-2 hover:bg-[#f3efe9]" aria-label="Mes siguiente"><ChevronRight className="size-4" /></button>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {PERIODOS.map((p) => (
            <button key={p.key} onClick={() => setPeriodo(p.key)} className={cn('rounded-lg py-1.5 text-xs font-semibold', periodo === p.key ? 'bg-[#3d2c24] text-white' : 'bg-[#f3efe9] text-[#5c4a42]')}>
              {p.label}
            </button>
          ))}
        </div>
        <button onClick={cargar} disabled={cargando} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-2.5 text-sm font-bold text-white disabled:opacity-60">
          {cargando && <Loader2 className="size-4 animate-spin" />}
          {cargando ? 'Armando el informe… (trae las ventas de Fudo)' : 'Ver informe'}
        </button>
        {error && <p className="text-center text-xs text-[#ea504c]">{error}</p>}
      </div>

      {datos && c && (
        <>
          {datos.avisoDatos && (
            <p className="flex items-start gap-2 rounded-xl bg-[#fdf6ec] p-3 text-xs text-[#b0762a]"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{datos.avisoDatos}</p>
          )}

          {/* ===================== COSTO LABORAL ===================== */}
          <section className="space-y-3">
            <h3 className="font-display text-lg text-[#3d2c24]">Costo laboral contra ventas</h3>
            <div className="grid grid-cols-2 gap-2">
              <Kpi icon={TrendingUp} label="Ventas (Fudo)" valor={money(c.totalVentas)} />
              <Kpi icon={DollarSign} label="Sueldos" valor={money(c.totalCosto)} />
              <Kpi icon={Users} label="Sueldos / ventas" valor={c.pct != null ? `${c.pct}%` : '—'} color={colorPct(c.pct)} />
              <Kpi icon={Clock} label="Venta por hora trabajada" valor={c.ventasPorHoraTrabajada != null ? money(c.ventasPorHoraTrabajada) : '—'} />
            </div>
            <p className="text-[11px] text-[#7d6c64]">
              Sueldos: misma cuenta que la liquidación. Ventas: ventas cerradas de Fudo, con descuentos. Verde hasta 20%, ámbar hasta 30%, rojo más de 30%.
            </p>

            <div className="rounded-2xl bg-white p-3 ring-1 ring-[#ebe6df]">
              <p className="mb-2 text-xs font-semibold text-[#3d2c24]">Por día</p>
              <ul className="divide-y divide-[#f0ebe4] text-xs">
                {c.dias.map((d) => (
                  <li key={d.fecha} className="flex items-center gap-2 py-1.5">
                    <span className="w-24 shrink-0 capitalize text-[#5c4a42]">{format(new Date(`${d.fecha}T12:00:00`), 'EEE d/MM', { locale: es })}</span>
                    <span className="flex-1 tabular-nums text-[#3d2c24]">{money(d.ventas)}</span>
                    <span className="w-20 text-right tabular-nums text-[#7d6c64]">{money(d.costo)}</span>
                    <span className="w-14 text-right font-bold tabular-nums" style={{ color: colorPct(d.pct) }}>{d.pct != null ? `${d.pct}%` : '—'}</span>
                  </li>
                ))}
              </ul>
            </div>

            {c.porDiaSemana.length > 0 && (
              <div className="rounded-2xl bg-white p-3 ring-1 ring-[#ebe6df]">
                <p className="mb-2 text-xs font-semibold text-[#3d2c24]">Por día de la semana (sueldos / ventas)</p>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={c.porDiaSemana} margin={{ left: -24, right: 4 }}>
                    <XAxis dataKey="dia" tickFormatter={(v: string) => v.slice(0, 3)} tick={{ fontSize: 10, fill: '#7d6c64' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} unit="%" />
                    <Tooltip formatter={(v) => [`${v}%`, 'Sueldos / ventas']} />
                    <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
                      {c.porDiaSemana.map((x) => <Cell key={x.dia} fill={colorPct(x.pct)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {c.porHora.length > 0 && (
              <div className="rounded-2xl bg-white p-3 ring-1 ring-[#ebe6df]">
                <p className="text-xs font-semibold text-[#3d2c24]">Por hora: venta promedio y gente trabajando</p>
                <p className="mb-2 text-[11px] text-[#7d6c64]">Barras: venta promedio en esa hora. Abajo, cuántos estaban fichados y cuánto vende cada uno. Las horas con mucha gente y poca venta son las que sobran.</p>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={c.porHora} margin={{ left: -10, right: 4 }}>
                    <XAxis dataKey="hora" tickFormatter={(h: number) => `${h}`} tick={{ fontSize: 9, fill: '#7d6c64' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 9, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(v) => [money(Number(v)), 'Venta promedio']} labelFormatter={(h) => `${h}:00 a ${h}:59`} />
                    <Bar dataKey="ventasProm" fill="#006d5a" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-2 grid grid-cols-3 gap-1 text-[10.5px] sm:grid-cols-6">
                  {c.porHora.map((h) => {
                    const bajo = h.ventasPorPersona != null && h.ventasPorPersona < (c.ventasPorHoraTrabajada ?? 0) * 0.5
                    return (
                      <div key={h.hora} className={cn('rounded-md px-1.5 py-1', bajo ? 'bg-[#fef2f2] text-[#ea504c]' : 'bg-[#faf8f5] text-[#5c4a42]')}>
                        <b>{h.hora}h</b> · {h.personasProm} pers.
                        <span className="block">{h.ventasPorPersona != null ? `${money(h.ventasPorPersona)}/pers.` : '—'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </section>

          {/* ===================== ASISTENCIA ===================== */}
          <section className="space-y-2">
            <h3 className="font-display text-lg text-[#3d2c24]">Asistencia por persona</h3>
            <p className="text-[11px] text-[#7d6c64]">
              Hasta el {format(new Date(`${datos.period.asistenciaHasta}T12:00:00`), "d/MM")} (días terminados). Tarde y salida antes: más de 10 minutos.
              Los días con turno mal cargado no cuentan como tardanza.
            </p>
            <div className="space-y-1.5">
              {datos.asistencia.map((f) => (
                <div key={f.id} className="rounded-xl bg-white p-3 ring-1 ring-[#ebe6df]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#3d2c24]">{f.nombre}</p>
                      <p className="text-[11px] text-[#a39e97]">{rol(f.puesto)} · {f.fichados} de {f.turnos} turnos fichados</p>
                    </div>
                    <span className="text-lg font-bold tabular-nums" style={{ color: f.cumplimiento >= 95 ? '#006d5a' : f.cumplimiento >= 80 ? '#d4943a' : '#ea504c' }}>{f.cumplimiento}%</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[10.5px]">
                    {f.tarde > 0 && <Chip rojo>{f.tarde} tarde (prom. {f.minutosTardeProm} min)</Chip>}
                    {f.salidasAntes > 0 && <Chip rojo>{f.salidasAntes} salida{f.salidasAntes !== 1 ? 's' : ''} antes</Chip>}
                    {f.sinFicharSinMotivo > 0 && <Chip rojo>{f.sinFicharSinMotivo} sin fichar sin motivo</Chip>}
                    {Object.entries(f.ausencias).map(([m, n]) => <Chip key={m}>{n} {m.toLowerCase()}</Chip>)}
                    {f.horasExtra > 0 && <Chip>{f.horasExtra} h extra (autorizó {f.extraAutorizadaPor.join(', ')})</Chip>}
                    {f.malCargados > 0 && <Chip ambar>{f.malCargados} turno{f.malCargados !== 1 ? 's' : ''} mal cargado{f.malCargados !== 1 ? 's' : ''}</Chip>}
                    {f.llegoPorEncargado > 0 && <Chip>{f.llegoPorEncargado} &quot;Llegó&quot; del encargado</Chip>}
                    {f.tarde + f.salidasAntes + f.sinFicharSinMotivo + f.malCargados === 0 && Object.keys(f.ausencias).length === 0 && <Chip verde>Sin observaciones</Chip>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ===================== TAREAS CON HORARIO ===================== */}
          {datos.tareas && datos.tareas.protocolos.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-display text-lg text-[#3d2c24]">Tareas con horario</h3>
              <p className="text-[11px] text-[#7d6c64]">Baño, tolva, descartables… A tiempo = hecha dentro de la hora. No hecha = el día terminó sin hacerse.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {datos.tareas.protocolos.map((p) => (
                  <div key={p.nombre} className="rounded-xl bg-white p-3 ring-1 ring-[#ebe6df]">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[#3d2c24]">{p.nombre}</p>
                      <span className="text-lg font-bold tabular-nums" style={{ color: p.cumplimiento >= 90 ? '#006d5a' : p.cumplimiento >= 70 ? '#d4943a' : '#ea504c' }}>{p.cumplimiento}%</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[10.5px]">
                      <Chip verde>{p.aTiempo} a tiempo</Chip>
                      {p.tarde > 0 && <Chip ambar>{p.tarde} tarde</Chip>}
                      {p.noHechas > 0 && <Chip rojo>{p.noHechas} sin hacer{p.sinAsignar > 0 ? ` (${p.sinAsignar} sin asignar)` : ''}</Chip>}
                      <Chip>{p.total} en total</Chip>
                    </div>
                  </div>
                ))}
              </div>
              {datos.tareas.personas.length > 0 && (
                <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-[#ebe6df]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-[#a39e97]">
                        <th className="px-3 py-2 text-left">Persona</th>
                        <th className="px-2 py-2 text-right">Asignadas</th>
                        <th className="px-2 py-2 text-right">A tiempo</th>
                        <th className="px-2 py-2 text-right">Tarde</th>
                        <th className="px-2 py-2 text-right">Sin hacer</th>
                        <th className="px-3 py-2 text-right">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.tareas.personas.map((x) => (
                        <tr key={x.id} className="border-t border-[#f0ebe4]">
                          <td className="px-3 py-2 font-semibold text-[#3d2c24]">{x.nombre}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{x.asignadas}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{x.aTiempo}</td>
                          <td className={cn('px-2 py-2 text-right tabular-nums', x.tarde > 0 && 'font-semibold text-[#d4943a]')}>{x.tarde}</td>
                          <td className={cn('px-2 py-2 text-right tabular-nums', x.noHechas > 0 && 'font-bold text-[#ea504c]')}>{x.noHechas}</td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums" style={{ color: x.cumplimiento >= 90 ? '#006d5a' : x.cumplimiento >= 70 ? '#d4943a' : '#ea504c' }}>{x.cumplimiento}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ===================== ENCARGADOS ===================== */}
          {datos.encargados.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-display text-lg text-[#3d2c24]">Qué hizo cada encargado</h3>
              <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-[#ebe6df]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-[#a39e97]">
                      <th className="px-3 py-2 text-left">Encargado</th>
                      <th className="px-2 py-2 text-right">Turnos cargados</th>
                      <th className="px-2 py-2 text-right">Correcciones</th>
                      <th className="px-2 py-2 text-right">&quot;Llegó&quot;</th>
                      <th className="px-2 py-2 text-right">H. extra autoriz.</th>
                      <th className="px-3 py-2 text-right">Motivos anotados</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.encargados.map((e) => (
                      <tr key={e.id} className="border-t border-[#f0ebe4]">
                        <td className="px-3 py-2 font-semibold text-[#3d2c24]">{e.nombre}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{e.turnosCargados}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{e.correcciones}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{e.llegoMarcados}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{e.horasExtraAutorizadas} h</td>
                        <td className="px-3 py-2 text-right tabular-nums">{e.ausenciasAnotadas}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Kpi({ icon: Icon, label, valor, color }: { icon: typeof Users; label: string; valor: string; color?: string }) {
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-[#ebe6df]">
      <Icon className="size-4 text-[#a39e97]" />
      <p className="mt-1 text-lg font-bold tabular-nums" style={{ color: color ?? '#3d2c24' }}>{valor}</p>
      <p className="text-[10px] text-[#a39e97]">{label}</p>
    </div>
  )
}

function Chip({ children, rojo, ambar, verde }: { children: ReactNode; rojo?: boolean; ambar?: boolean; verde?: boolean }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 font-semibold',
      rojo ? 'bg-[#fef2f2] text-[#ea504c]' : ambar ? 'bg-[#fdf6ec] text-[#b0762a]' : verde ? 'bg-[#e8f5f1] text-[#006d5a]' : 'bg-[#f3efe9] text-[#5c4a42]')}>
      {children}
    </span>
  )
}
