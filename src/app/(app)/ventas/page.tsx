'use client'

import { Suspense, useEffect, useRef, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { format, subDays, addDays, isToday } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { BarChart3, ChevronLeft, ChevronRight, Loader2, RefreshCw, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import { PlatosSinRecetaCard } from '@/components/ventas/PlatosSinRecetaCard'
import { AskBar } from '@/components/ai/AskBar'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { FadeIn, AnimatedSwitch, motion } from '@/components/ui/motion'
import type { DashboardData } from './_components/types'
import { CompareView } from './_components/CompareView'
import { MonthView } from './_components/MonthView'
import { DayView } from './_components/DayView'
import { BalanceView } from './_components/BalanceView'
import { CartaView } from './_components/CartaView'
import { PreciosView } from './_components/PreciosView'
import { ProduccionCostosView } from './_components/ProduccionCostosView'
import { PersonalView } from './_components/PersonalView'
import { MomentosView } from './_components/MomentosView'

const REFRESH_INTERVAL = 5 * 60 * 1000

type ViewMode = 'dia' | 'mes' | 'comparar' | 'balance' | 'carta' | 'momentos' | 'precios' | 'produccion' | 'personal'

const ALL_MODES: ViewMode[] = ['dia', 'mes', 'comparar', 'balance', 'carta', 'momentos', 'precios', 'produccion', 'personal']
const MANAGER_MODES: ViewMode[] = ['balance', 'carta', 'momentos', 'precios', 'produccion', 'personal']

function isViewMode(v: string | null): v is ViewMode {
  return v != null && (ALL_MODES as string[]).includes(v)
}

// useSearchParams exige un límite de Suspense para el prerender de la página
export default function VentasPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <VentasContent />
    </Suspense>
  )
}

function VentasContent() {
  const { profile, loading: profileLoading } = useProfileContext()
  const searchParams = useSearchParams()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  // Deep-link ?m=balance|carta|precios|produccion|personal
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const m = searchParams.get('m')
    return isViewMode(m) ? m : 'dia'
  })

  const isLive = isToday(selectedDate)
  const dateStr = format(selectedDate, 'yyyy-MM-dd')
  const isManager = isManagerOrAbove(profile?.role)
  const modes = isManager ? ALL_MODES : (['dia', 'mes', 'comparar'] as ViewMode[])
  const MODE_LABELS: Record<string, string> = {
    dia: 'Día', mes: 'Mes', comparar: 'Comparar', balance: 'Balance', carta: 'Carta',
    momentos: 'Momentos', precios: 'Precios', produccion: 'Producción', personal: 'Personal',
  }

  // Los 9 modos entraban en una sola fila que scrolleaba de costado: no se veía
  // qué había más allá del tercero. Agrupados por intención entran todos.
  const MODE_GROUPS: { label: string; modes: ViewMode[] }[] = [
    { label: 'Cuánto vendí', modes: ['dia', 'mes', 'comparar'] },
    { label: 'Cuánto me queda', modes: ['carta', 'momentos', 'balance'] },
    { label: 'Cuánto me cuesta', modes: ['precios', 'produccion', 'personal'] },
  ]

  // Si el deep-link apunta a un modo manager-only y el perfil no lo permite, volver a Día
  useEffect(() => {
    if (profileLoading) return
    if (!isManager && MANAGER_MODES.includes(viewMode)) setViewMode('dia')
  }, [profileLoading, isManager, viewMode])

  // Hoy se mira EN VIVO contra Fudo (auto-sync). Un día pasado sale de la
  // tabla local vía range-summary: auto-sync solo ve las últimas ~500 ventas
  // (3-4 días), así que un día de hace una semana devolvía "Sin ventas" en
  // silencio. range-summary ya responde con el mismo shape DashboardData
  // (los campos live vienen vacíos/0 y DayView los oculta si el día es pasado).
  const fetchDia = useCallback(async (fecha: string, esHoy: boolean): Promise<DashboardData | null> => {
    // Un !res.ok TIRA (no devuelve null): así Comparar puede mostrar el error
    // con "Reintentar" en vez de quedar vacío sin explicación.
    const url = esHoy ? '/api/fudo/auto-sync' : `/api/fudo/range-summary?from=${fecha}&to=${fecha}`
    const res = await fetch(url, { credentials: 'include' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`)
    return (esHoy ? json.today : json.data) ?? null
  }, [])

  const fetchData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setSyncing(true)
    try {
      const dia = await fetchDia(dateStr, isLive)
      if (dia) {
        setData(dia)
        setLastSync(isLive ? new Date().toISOString() : null)
      }
    } catch { /* ignore */ }
    setLoading(false)
    setSyncing(false)
  }, [dateStr, isLive, fetchDia])

  useEffect(() => {
    if (profileLoading) return
    fetchData()
  }, [profileLoading, fetchData])

  // El poll de 5 min solo corre cuando el modo activo lo usa (Día en vivo).
  // Comparar maneja sus propios datos y el resto de los modos no mira `data`.
  // Al VOLVER a Día en vivo desde otro modo, refrescar ya: si no, el primer
  // dato nuevo llegaba recién con el poll (5 min). La primera carga la hace
  // el efecto de arriba, por eso solo en la transición.
  const prevViewMode = useRef(viewMode)
  useEffect(() => {
    const venia = prevViewMode.current
    prevViewMode.current = viewMode
    if (profileLoading || !isLive || viewMode !== 'dia') return
    if (venia !== 'dia') fetchData()
    const interval = setInterval(() => fetchData(), REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [profileLoading, fetchData, isLive, viewMode])

  if (profileLoading || loading) return <LoadingState />
  if (!data) return (
    <EmptyState icon={BarChart3} title="Sin datos de ventas" description="Fudo no devolvió ventas. Verificá la conexión." />
  )

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-28">
      <FadeIn>
        {/* View mode toggle */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <h1 className="shrink-0 font-display text-2xl font-bold tracking-tight text-[#3d2c24]">Números</h1>
        </div>

        {/* Modos agrupados por lo que la persona quiere saber */}
        <div className="mb-3 space-y-1.5">
          {MODE_GROUPS.map((group) => {
            const visibles = group.modes.filter((m) => modes.includes(m))
            if (visibles.length === 0) return null
            return (
              <div key={group.label} className="flex items-center gap-2">
                <span className="w-[6.5rem] shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">
                  {group.label}
                </span>
                <div className="flex flex-wrap gap-1">
                  {visibles.map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setViewMode(mode)}
                      className={`relative rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                        viewMode === mode ? 'text-white' : 'bg-secondary text-muted-foreground'
                      }`}
                    >
                      {viewMode === mode && (
                        <motion.span
                          layoutId="ventas-mode-pill"
                          className="absolute inset-0 rounded-full bg-[#006d5a] shadow-sm"
                          transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                        />
                      )}
                      <span className="relative z-10">{MODE_LABELS[mode]}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Preguntar en castellano — cruza ventas, márgenes y compras */}
        {isManager && (
          <div className="mb-3">
            <AskBar
              scope="numeros"
              placeholder="Preguntá: qué deja más plata, qué vendí…"
              examples={['¿qué plato deja más plata?', '¿qué platos me dejan poco?', '¿qué vendí más esta semana?', '¿a quién le compro más?']}
            />
          </div>
        )}

        {/* Platos que se venden sin descontar insumos (desaparece cuando no queda ninguno) */}
        {isManager && (
          <div className="mb-3">
            <PlatosSinRecetaCard />
          </div>
        )}

        {/* Acceso directo a reportes de food cost y márgenes */}
        {isManager && (
          <div className="mb-3 flex justify-end">
            <Link
              href="/admin/reportes/ventas"
              className="flex items-center gap-1.5 rounded-full bg-[#e8f5f1] px-3 py-1.5 text-[11px] font-semibold text-[#006d5a]"
            >
              <TrendingUp className="size-3.5" />
              Ventas y márgenes
            </Link>
          </div>
        )}

        {/* Date navigator — solo en modos Día y Mes */}
        {(viewMode === 'dia' || viewMode === 'mes') && (
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                setSelectedDate(prev => viewMode === 'mes' ? new Date(prev.getFullYear(), prev.getMonth() - 1, 1) : subDays(prev, 1))
                setLoading(true)
              }}
              className="icon-btn flex items-center justify-center rounded-xl bg-secondary"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="text-center">
              <p className="text-sm font-semibold capitalize text-[#3d2c24]">
                {viewMode === 'dia'
                  ? format(selectedDate, "EEEE d 'de' MMMM", { locale: es })
                  : format(selectedDate, 'MMMM yyyy', { locale: es })
                }
              </p>
              {isLive && viewMode === 'dia' && (
                <p className="text-[10px] font-semibold text-[#006d5a]">
                  En vivo {lastSync && `· ${format(new Date(lastSync), 'HH:mm')}`}
                </p>
              )}
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  setSelectedDate(prev => viewMode === 'mes' ? new Date(prev.getFullYear(), prev.getMonth() + 1, 1) : addDays(prev, 1))
                  setLoading(true)
                }}
                disabled={isLive && viewMode === 'dia'}
                className="icon-btn flex items-center justify-center rounded-xl bg-secondary disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
              {!isLive && viewMode === 'dia' && (
                <button
                  onClick={() => { setSelectedDate(new Date()); setLoading(true) }}
                  className="flex items-center gap-1 rounded-full bg-[#006d5a] px-2.5 py-1.5 text-[10px] font-bold text-white"
                >
                  Hoy
                </button>
              )}
              {isLive && (
                <button
                  onClick={() => fetchData(true)}
                  disabled={syncing}
                  className="icon-btn flex items-center justify-center rounded-xl bg-[#e8f5f1] disabled:opacity-50"
                >
                  {syncing ? <Loader2 className="size-3.5 animate-spin text-[#006d5a]" /> : <RefreshCw className="size-3.5 text-[#006d5a]" />}
                </button>
              )}
            </div>
          </div>
        )}
      </FadeIn>

      <AnimatedSwitch id={viewMode}>
        <div className="space-y-4">
          {/* Comparar maneja sus propias fechas y su loading local: cambiar
              un día o un período acá no desmonta la pantalla entera. */}
          {viewMode === 'comparar' && (
            <CompareView fetchDia={fetchDia} isManager={isManager} />
          )}

          {viewMode === 'mes' && (
            <MonthView
              selectedDate={selectedDate}
              setSelectedDate={(d) => { setSelectedDate(d); setViewMode('dia'); setLoading(true) }}
            />
          )}

          {viewMode === 'dia' && (
            <DayView data={data} selectedDate={selectedDate} isLive={isLive} />
          )}

          {viewMode === 'balance' && isManager && <BalanceView />}

          {viewMode === 'carta' && isManager && <CartaView />}

          {viewMode === 'momentos' && isManager && <MomentosView />}

          {viewMode === 'precios' && isManager && <PreciosView />}

          {viewMode === 'produccion' && isManager && <ProduccionCostosView />}

          {viewMode === 'personal' && isManager && <PersonalView />}
        </div>
      </AnimatedSwitch>
    </div>
  )
}
