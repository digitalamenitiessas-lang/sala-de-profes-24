'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ShoppingBag, FileText, Trophy, Flame, Star,
  UtensilsCrossed, CheckCircle, Receipt,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { FadeIn, PulseRing, motion } from '@/components/ui/motion'
import { ChartCard } from '@/components/admin/ChartCard'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts'
import type { DashboardData } from './types'
import { formatPrice, PIE_COLORS, STATE_LABELS } from './types'

type Props = {
  data: DashboardData
  selectedDate: Date
  isLive: boolean
}

export function DayView({ data, selectedDate, isLive }: Props) {
  const [tab, setTab] = useState<'resumen' | 'mesas' | 'cerradas'>('resumen')

  // Un día pasado viene de la tabla local (range-summary): no hay mesas en
  // curso ni detalle de tickets. Se ocultan las tarjetas live para que no
  // quede un "$0 en curso" o pestañas vacías que confunden.
  const activeTab = isLive ? tab : 'resumen'

  return (
    <>
      {/* Hero KPI — facturado del día */}
      <FadeIn>
        <div
          className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg shadow-[#006d5a]/15"
          style={{ background: 'linear-gradient(135deg, #017c66 0%, #006d5a 45%, #00523f 100%)' }}
        >
          {/* Texturas decorativas */}
          <div className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full bg-white/[0.06]" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 size-44 rounded-full bg-black/[0.10]" />

          <div className="relative">
            <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">
              Facturado del día
              {isLive && <PulseRing color="#ffd489" />}
            </span>
            <p className="mt-1.5 font-display text-[2.5rem] font-bold leading-none tabular-nums tracking-tight">
              {formatPrice(data.totalFacturado)}
            </p>
            <p className="mt-2 text-[11px] text-white/60">
              {/* Histórico: el registro no tiene mesas, cuenta tickets del canal local */}
              {isLive
                ? `${data.mesasCerradas} mesa${data.mesasCerradas !== 1 ? 's' : ''} cerrada${data.mesasCerradas !== 1 ? 's' : ''}`
                : `${data.mesasCerradas} ticket${data.mesasCerradas !== 1 ? 's' : ''} en salón`}
              {' · '}ticket promedio {formatPrice(data.avgTicket)}
            </p>
          </div>

          {/* Sparkline del día */}
          {data.byHour.length > 1 && (
            <div className="relative -mx-2 mt-3 h-14">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.byHour} margin={{ top: 4, left: 0, right: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="heroSparkline" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    strokeOpacity={0.85}
                    fill="url(#heroSparkline)"
                    isAnimationActive
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Sub-KPIs — "En curso" y "Total día" solo tienen sentido en vivo */}
          <div className={`relative mt-3 grid gap-2 ${isLive ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {isLive && (
              <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-[#ffd489]">En curso</span>
                <p className="mt-0.5 truncate text-[14px] font-bold tabular-nums text-[#ffd489]">{formatPrice(data.totalEnCurso)}</p>
                <p className="truncate text-[9px] text-white/50">
                  {data.mesasAbiertas} mesa{data.mesasAbiertas !== 1 ? 's' : ''}
                  {(data.takeawayAbiertos ?? 0) > 0 && ` +${data.takeawayAbiertos} TA`}
                </p>
              </div>
            )}
            {isLive ? (
              <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-white/60">Total día</span>
                <p className="mt-0.5 truncate text-[14px] font-bold tabular-nums">{formatPrice(data.totalGeneral)}</p>
                <p className="truncate text-[9px] text-white/50">cerrado + en curso</p>
              </div>
            ) : (
              <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
                <span className="text-[9px] font-semibold uppercase tracking-wider text-white/60">Ticket prom.</span>
                <p className="mt-0.5 truncate text-[14px] font-bold tabular-nums">{formatPrice(data.avgTicket)}</p>
                <p className="truncate text-[9px] text-white/50">por ticket</p>
              </div>
            )}
            <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur-sm">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-white/60">Tickets</span>
              <p className="mt-0.5 truncate text-[14px] font-bold tabular-nums">{data.totalTickets}</p>
              <p className="truncate text-[9px] text-white/50">{data.totalItems} items</p>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* Tab nav — solo en vivo: un día pasado no tiene mesas ni detalle de tickets */}
      {isLive && (
      <div className="flex rounded-full bg-secondary p-0.5 shadow-inner">
        {([
          { key: 'resumen',  label: 'Resumen',                           icon: FileText      },
          { key: 'mesas',    label: `En curso (${data.totalAbiertas})`,  icon: UtensilsCrossed },
          { key: 'cerradas', label: `Cerradas (${data.mesasCerradas})`,  icon: CheckCircle   },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="relative flex flex-1 items-center justify-center gap-1 rounded-full py-2 text-[11px] font-semibold transition-colors"
          >
            {tab === t.key && (
              <motion.span
                layoutId="dayview-tab-pill"
                className="absolute inset-0 rounded-full bg-[#006d5a] shadow-sm"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className={`relative z-10 flex items-center gap-1 ${tab === t.key ? 'text-white' : 'text-muted-foreground'}`}>
              <t.icon className="size-4" />
              {t.label}
            </span>
          </button>
        ))}
      </div>
      )}

      {/* RESUMEN */}
      {activeTab === 'resumen' && (
        <>
          {data.topProducts.length > 0 && (
            <FadeIn>
              <div className="space-y-4 rounded-2xl border border-[#ebe6df] bg-gradient-to-br from-[#f8f5f0] to-white p-5">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-[#006d5a]">
                    <FileText className="size-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-[15px] font-bold text-[#3d2c24]">Informe del Día</h2>
                    <p className="text-[11px] text-[#a39e97]">{isLive ? 'Datos en vivo de Fudo' : 'Del registro de ventas'}</p>
                  </div>
                </div>
                <div className="rounded-xl bg-white/80 p-4 text-[13px] leading-relaxed text-[#3d2c24]">
                  <p>
                    Facturado (cerradas): <strong className="text-[#006d5a]">{formatPrice(data.totalFacturado)}</strong>.
                    {isLive && (
                      <> En curso: <strong className="text-[#d4943a]">{formatPrice(data.totalEnCurso)}</strong> en {data.mesasAbiertas} mesas.</>
                    )}
                  </p>
                  {(() => {
                    const peak = data.byHour.reduce((max, h) => h.revenue > max.revenue ? h : max, data.byHour[0])
                    return peak && peak.revenue > 0 ? (
                      <p className="mt-1.5">Hora pico: <strong>{peak.hour}</strong> con {formatPrice(peak.revenue)} en {peak.tickets} tickets.</p>
                    ) : null
                  })()}
                </div>

                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#a39e97]">
                    <Trophy className="size-3.5 text-[#d4943a]" /> Lo más vendido hoy
                  </p>
                  <div className="space-y-1.5">
                    {data.topProducts.slice(0, 5).map((p, i) => {
                      const medals = ['🥇', '🥈', '🥉']
                      const pct = data.totalItems > 0 ? Math.round((p.qty / data.totalItems) * 100) : 0
                      return (
                        <div key={p.name} className="flex items-center gap-3 rounded-xl bg-white/80 px-3.5 py-2.5">
                          <span className="text-xl">{medals[i] ?? `${i + 1}.`}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold text-[#3d2c24]">{p.name}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-[#ebe6df]">
                                <div className="h-1.5 rounded-full bg-[#006d5a] transition-all" style={{ width: `${Math.min(pct * 2, 100)}%` }} />
                              </div>
                              <span className="shrink-0 text-[10px] font-bold tabular-nums text-[#a39e97]">{p.qty} · {pct}%</span>
                            </div>
                          </div>
                          <span className="shrink-0 text-[13px] font-bold tabular-nums text-[#006d5a]">{formatPrice(p.revenue)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {(() => {
                  const insights: { icon: typeof Flame; text: string; color: string }[] = []
                  if (data.topProducts[0]) insights.push({ icon: Star, text: `${data.topProducts[0].name} lidera con ${data.topProducts[0].qty} vendidos`, color: '#d4943a' })
                  const peak = data.byHour.reduce((max, h) => h.tickets > max.tickets ? h : max, data.byHour[0])
                  if (peak && peak.tickets > 2) insights.push({ icon: Flame, text: `Hora más activa: ${peak.hour} con ${peak.tickets} tickets`, color: '#ea504c' })
                  if (data.totalTickets > 0) insights.push({ icon: ShoppingBag, text: `Promedio ${(data.totalItems / data.totalTickets).toFixed(1)} items por ticket`, color: '#006d5a' })
                  return insights.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#a39e97]">
                        <Flame className="size-3.5 text-[#ea504c]" /> Insights
                      </p>
                      {insights.map((ins, i) => (
                        <div key={i} className="flex items-center gap-2.5 rounded-lg bg-white/80 px-3 py-2">
                          <ins.icon className="size-3.5 shrink-0" style={{ color: ins.color }} />
                          <p className="text-[12px] text-[#3d2c24]">{ins.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : null
                })()}
              </div>
            </FadeIn>
          )}

          {data.byHour.length > 0 && (
            <FadeIn delay={0.1}>
              <ChartCard title="Ventas por hora" subtitle="Facturación durante el día">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.byHour} margin={{ left: -15, right: 8 }}>
                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#a39e97' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(v: any) => [formatPrice(v), 'Facturación']}
                    />
                    <Bar dataKey="revenue" fill="#006d5a" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </FadeIn>
          )}

          {(data.bySaleType?.length ?? 0) > 0 && (
            <FadeIn delay={0.15}>
              <ChartCard title="Tipo de venta" subtitle="En local vs Para llevar">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={data.bySaleType} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="revenue" nameKey="name">
                      {data.bySaleType.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Legend formatter={(value) => <span className="text-xs text-[#3d2c24]">{value}</span>} iconType="circle" iconSize={8} />
                    <Tooltip
                      contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(v: any) => [formatPrice(v), '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </FadeIn>
          )}

          {data.topProducts.length > 5 && (
            <FadeIn delay={0.2}>
              <div className="space-y-2">
                <span className="section-label">Más vendidos (6-15)</span>
                <div className="space-y-1">
                  {data.topProducts.slice(5).map((p, i) => (
                    <div key={p.name} className="card-elevated flex items-center gap-3 rounded-xl px-4 py-2.5">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#f3efe9] text-[10px] font-bold text-[#a39e97]">{i + 6}</span>
                      <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#3d2c24]">{p.name}</p>
                      <span className="shrink-0 text-[11px] font-bold tabular-nums text-[#a39e97]">{p.qty}x</span>
                      <span className="shrink-0 text-[12px] font-bold tabular-nums text-[#006d5a]">{formatPrice(p.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </FadeIn>
          )}
        </>
      )}

      {/* MESAS EN CURSO */}
      {activeTab === 'mesas' && (
        <FadeIn>
          <div className="space-y-2">
            {data.openTables.length === 0 && data.openTakeaway.length === 0 ? (
              <EmptyState icon={UtensilsCrossed} title="Sin pedidos en curso" description="No hay mesas ni pedidos abiertos en este momento." />
            ) : (
              <>
                {data.openTakeaway.length > 0 && (
                  <>
                    <p className="section-label px-1">Para llevar / Delivery ({data.openTakeaway.length})</p>
                    {data.openTakeaway.map((ticket) => {
                      const stateInfo = STATE_LABELS[ticket.state] ?? STATE_LABELS['IN-COURSE']!
                      return (
                        <div key={ticket.ticketId} className="card-elevated overflow-hidden rounded-xl">
                          <div className="flex items-center justify-between px-4 py-3" style={{ borderLeftWidth: 4, borderLeftColor: '#8b5e34' }}>
                            <div className="flex items-center gap-2.5">
                              <div className="flex size-9 items-center justify-center rounded-lg bg-[#faf0e4]">
                                <ShoppingBag className="size-4 text-[#8b5e34]" />
                              </div>
                              <div>
                                <p className="text-[13px] font-semibold text-[#3d2c24]">
                                  {ticket.saleType === 'TAKEAWAY' ? 'Para llevar' : 'Delivery'} #{ticket.ticketId}
                                </p>
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ backgroundColor: stateInfo.bg, color: stateInfo.color }}>{stateInfo.label}</span>
                                  <span className="text-[10px] text-[#a39e97]">{format(new Date(ticket.time), 'HH:mm')}</span>
                                </div>
                              </div>
                            </div>
                            <p className="text-base font-bold tabular-nums text-[#3d2c24]">{formatPrice(ticket.total)}</p>
                          </div>
                          {ticket.items.length > 0 && (
                            <div className="space-y-1 border-t border-border/30 px-4 py-2.5">
                              {ticket.items.map((item, j) => (
                                <div key={j} className="flex items-center justify-between text-[12px]">
                                  <span className="text-[#3d2c24]"><span className="font-semibold text-[#006d5a]">{item.qty}x</span> {item.name}</span>
                                  <span className="tabular-nums text-[#a39e97]">{formatPrice(item.price)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </>
                )}
                {data.openTables.length > 0 && (
                  <>
                    <p className="section-label px-1">Mesas en local ({data.openTables.length})</p>
                    {[...data.openTables].sort((a, b) => (a.tableNumber ?? 999) - (b.tableNumber ?? 999)).map((ticket) => {
                      const stateInfo = STATE_LABELS[ticket.state] ?? STATE_LABELS['IN-COURSE']!
                      return (
                        <div key={ticket.ticketId} className="card-elevated overflow-hidden rounded-xl">
                          <div className="flex items-center justify-between px-4 py-3" style={{ borderLeftWidth: 4, borderLeftColor: stateInfo.color }}>
                            <div className="flex items-center gap-2.5">
                              <div className="flex size-9 items-center justify-center rounded-lg bg-[#f8f5f0]">
                                <span className="text-sm font-bold text-[#3d2c24]">{ticket.tableNumber ?? '—'}</span>
                              </div>
                              <div>
                                <p className="text-[13px] font-semibold text-[#3d2c24]">Mesa {ticket.tableNumber ?? ticket.ticketId}</p>
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ backgroundColor: stateInfo.bg, color: stateInfo.color }}>{stateInfo.label}</span>
                                  <span className="text-[10px] text-[#a39e97]">{format(new Date(ticket.time), 'HH:mm')}</span>
                                </div>
                              </div>
                            </div>
                            <p className="text-base font-bold tabular-nums text-[#3d2c24]">{formatPrice(ticket.total)}</p>
                          </div>
                          {ticket.items.length > 0 && (
                            <div className="space-y-1 border-t border-border/30 px-4 py-2.5">
                              {ticket.items.map((item, j) => (
                                <div key={j} className="flex items-center justify-between text-[12px]">
                                  <span className="text-[#3d2c24]"><span className="font-semibold text-[#006d5a]">{item.qty}x</span> {item.name}</span>
                                  <span className="tabular-nums text-[#a39e97]">{formatPrice(item.price)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </>
                )}
              </>
            )}
          </div>
        </FadeIn>
      )}

      {/* CERRADAS */}
      {activeTab === 'cerradas' && (
        <FadeIn>
          <div className="space-y-2">
            {data.recentSales.length === 0 ? (
              <EmptyState icon={CheckCircle} title="Sin mesas cerradas" description="Las mesas cerradas aparecerán acá." />
            ) : (
              data.recentSales.map((ticket) => (
                <div key={ticket.ticketId} className="card-elevated overflow-hidden rounded-xl">
                  <div className="flex items-center justify-between px-4 py-3" style={{ borderLeftWidth: 4, borderLeftColor: '#a39e97' }}>
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-[#f3efe9]">
                        <span className="text-sm font-bold text-[#a39e97]">{ticket.tableNumber ?? '—'}</span>
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-[#3d2c24]">Mesa {ticket.tableNumber ?? ticket.ticketId}</p>
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-[#f3efe9] px-2 py-0.5 text-[9px] font-bold text-[#a39e97]">Cerrada</span>
                          <span className="text-[10px] text-[#a39e97]">
                            {ticket.closedAt ? format(new Date(ticket.closedAt), 'HH:mm') : format(new Date(ticket.time), 'HH:mm')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="text-base font-bold tabular-nums text-[#006d5a]">{formatPrice(ticket.total)}</p>
                  </div>
                  {ticket.items.length > 0 && (
                    <div className="space-y-1 border-t border-border/30 px-4 py-2.5">
                      {ticket.items.map((item, j) => (
                        <div key={j} className="flex items-center justify-between text-[12px]">
                          <span className="text-[#3d2c24]"><span className="font-semibold text-[#006d5a]">{item.qty}x</span> {item.name}</span>
                          <span className="tabular-nums text-[#a39e97]">{formatPrice(item.price)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </FadeIn>
      )}

      {/* Empty fallback */}
      {data.totalTickets === 0 && activeTab === 'resumen' && (
        <EmptyState
          icon={Receipt}
          title={isLive ? 'Sin ventas hoy' : `Sin ventas el ${format(selectedDate, "d 'de' MMMM", { locale: es })}`}
          description={isLive ? 'Cuando se abran mesas en Fudo, aparecerán acá en tiempo real.' : 'No se registraron ventas este día.'}
        />
      )}
    </>
  )
}
