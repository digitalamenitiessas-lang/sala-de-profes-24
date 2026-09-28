'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  Clock, LogIn, LogOut, CheckCircle, Loader2,
  History, Timer, MapPin, Shield, ShieldAlert, ShieldCheck,
  ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { errorToast } from '@/lib/toast-helpers'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/LoadingState'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { mustClockIn } from '@/lib/roles'
import { useMyAttendance, useAttendanceHistory } from '@/lib/hooks/use-attendance'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import { SuccessBurst } from '@/components/ui/success-burst'
import { playSchoolBell } from '@/lib/sounds'
import { getDeviceFingerprint, getNetworkInfo } from '@/lib/attendance/security'
import { getCurrentPosition, calculateDistance } from '@/lib/attendance/geolocation'
import { VENUE } from '@/lib/attendance/venue'
import { logAuditClient } from '@/lib/audit'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
type TodayStatus = 'not_clocked_in' | 'clocked_in' | 'completed'
type FlowState = 'idle' | 'working' | 'done'
type GeoState = 'checking' | 'ok' | 'too_far' | 'denied' | 'unavailable'

// ---------------------------------------------------------------------------
function getGreeting(d: Date) {
  const h = d.getHours()
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}

function fmtDuration(start: string, end?: string | null) {
  const ms = Math.max(0, (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime())
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60), m = totalMin % 60
  return h === 0 ? `${m}m` : `${h}h ${m}m`
}

// ---------------------------------------------------------------------------
export default function MiTurnoPage() {
  const { profile, loading: profileLoading } = useProfileContext()

  const [now, setNow] = useState(new Date())
  const [showSuccess, setShowSuccess] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historyLimit, setHistoryLimit] = useState(7)
  const [flowState, setFlowState] = useState<FlowState>('idle')
  const [flowMsg, setFlowMsg] = useState('')

  // Geo state
  const [geoState, setGeoState] = useState<GeoState>('checking')
  const [geoDistance, setGeoDistance] = useState<number | null>(null)

  // SWR hooks
  const { record: todayRecord, isLoading: loadingToday, mutate: mutateToday } = useMyAttendance(profile?.id)
  const { history, isLoading: loadingHistory, mutate: mutateHistory } = useAttendanceHistory(profile?.id, historyLimit)

  const loading = loadingToday || loadingHistory

  // Live clock
  useEffect(() => {
    let i: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (i) return
      setNow(new Date())
      i = setInterval(() => setNow(new Date()), 1000)
    }
    const stop = () => { if (i) { clearInterval(i); i = null } }
    const onVisibility = () => { if (document.hidden) stop(); else start() }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [])

  // Geo check — runs on load and every 30s
  const checkGeo = useCallback(async () => {
    setGeoState('checking')
    const result = await getCurrentPosition()
    if (result.status === 'denied') {
      setGeoState('denied')
      return
    }
    if (result.status !== 'success' || result.lat == null || result.lng == null) {
      setGeoState('unavailable')
      return
    }
    const dist = calculateDistance(result.lat, result.lng, VENUE.lat, VENUE.lng)
    setGeoDistance(dist)
    // Misma regla que el servidor: se descuenta el margen de error del GPS (hasta 100 m)
    const margen = Math.min(result.accuracy && result.accuracy > 0 ? result.accuracy : 0, 100)
    setGeoState(Math.max(0, dist - margen) <= VENUE.radiusM ? 'ok' : 'too_far')
  }, [])

  useEffect(() => {
    if (!mustClockIn(profile ?? undefined)) return
    checkGeo()
    const interval = setInterval(checkGeo, 30_000)
    return () => clearInterval(interval)
  }, [checkGeo, profile])

  // Status
  const status: TodayStatus = !todayRecord
    ? 'not_clocked_in'
    : todayRecord.clock_out_at ? 'completed' : 'clocked_in'

  const liveDuration = useMemo(() => {
    if (!todayRecord) return null
    if (status === 'clocked_in') return fmtDuration(todayRecord.clock_in_at)
    if (status === 'completed') return fmtDuration(todayRecord.clock_in_at, todayRecord.clock_out_at)
    return null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayRecord, status, now])

  // ------------------------------------------
  // Flujo de fichaje
  // ------------------------------------------
  async function handleClock(action: 'in' | 'out') {
    setFlowState('working')
    setFlowMsg('Obteniendo ubicación...')

    // GPS — obligatorio
    const geoResult = await getCurrentPosition()
    if (geoResult.status !== 'success' || !geoResult.lat || !geoResult.lng) {
      toast.error('No se pudo obtener tu ubicación. Activá el GPS e intentá de nuevo.')
      setFlowState('idle')
      return
    }

    // Device + network
    setFlowMsg('Registrando dispositivo...')
    const dev = getDeviceFingerprint()
    const net = getNetworkInfo()
    void net // collected for future use

    setFlowMsg('Registrando fichaje...')

    try {
      const res = await fetch('/api/attendance/clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: action === 'in' ? 'clock_in' : 'clock_out',
          gps_lat: geoResult.lat,
          gps_lng: geoResult.lng,
          gps_accuracy: geoResult.accuracy,
          device_fingerprint: dev.id,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.code === 'OUT_OF_RANGE') {
          toast.error(`Estás a ${data.distance_m}m del local. Necesitás estar en La Vieja Escuela.`)
        } else if (data.code === 'GPS_REQUIRED') {
          toast.error('Activá el GPS de tu dispositivo para poder fichar.')
        } else {
          errorToast('No pudimos registrar tu fichaje', data.error)
        }
        // Refresh geo after a failed attempt
        void checkGeo()
        setFlowState('idle')
        return
      }

      playSchoolBell()
      setShowSuccess(true)
      setFlowState('done')
      toast.success(action === 'in' ? '¡Ingreso registrado!' : '¡Egreso registrado!')

      logAuditClient({
        userId: profile?.id ?? null,
        userName: profile ? `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null : null,
        action: action === 'in' ? 'clock_in' : 'clock_out',
        module: 'asistencia',
        entityType: 'clock_event',
        description: action === 'in' ? 'Fichaje de entrada' : 'Fichaje de salida',
      })

      mutateToday()
      mutateHistory()
      setTimeout(() => setFlowState('idle'), 2000)
    } catch (err) {
      errorToast('Error de conexión', err, { retry: () => handleClock(action) })
      setFlowState('idle')
    }
  }

  // ------------------------------------------
  if (profileLoading || loading) return <LoadingState message="Cargando tu turno..." />
  if (!profile) return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-muted-foreground">No se pudo cargar el perfil.</p>
    </div>
  )

  // Working overlay
  if (flowState === 'working') {
    return (
      <div className="mx-auto max-w-lg flex flex-col items-center gap-6 pt-20 pb-28">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-[#f0f7f5]">
          <Shield className="size-8 text-[#006d5a]" strokeWidth={1.5} />
        </div>
        <h2 className="font-display text-xl font-bold text-[#3d2c24]">Registrando fichaje</h2>
        <Loader2 className="size-10 animate-spin text-[#006d5a]" />
        <p className="text-sm text-[#a39e97]">{flowMsg}</p>
        <button
          onClick={() => { setFlowState('idle'); toast.error('Fichaje cancelado') }}
          className="mt-4 rounded-xl border border-[#ebe6df] px-5 py-2 text-sm font-medium text-[#a39e97] hover:bg-[#faf8f5]"
        >
          Cancelar
        </button>
      </div>
    )
  }

  // Sin fichaje requerido
  if (!mustClockIn(profile)) {
    return (
      <div className="mx-auto max-w-lg pb-28 pt-10 text-center">
        <div className="card-elevated-lg mx-auto max-w-sm px-6 py-12">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-[#f0f7f5]">
            <CheckCircle className="size-8 text-[#006d5a]" strokeWidth={1.5} />
          </div>
          <p className="font-display text-xl font-semibold text-[#3d2c24]">Sin fichaje</p>
          <p className="mt-2 text-sm text-[#a39e97]">Tu rol no requiere marcar ingreso ni egreso.</p>
        </div>
      </div>
    )
  }

  // ------------------------------------------
  // Geo status indicator config
  // ------------------------------------------
  const geoBlocked = geoState === 'too_far' || geoState === 'denied'

  const GEO_CONFIG = {
    ok:          { icon: ShieldCheck, text: `En ${VENUE.name} ✓`,                 cls: 'bg-[#e8f5f1] text-[#006d5a]' },
    checking:    { icon: Loader2,     text: 'Verificando ubicación...',            cls: 'bg-[#f8f5f0] text-[#a39e97]' },
    too_far:     { icon: MapPin,      text: geoDistance ? `Estás a ${geoDistance}m · Necesitás estar en el local` : 'Fuera del local', cls: 'bg-[#fef2f2] text-[#ea504c]' },
    denied:      { icon: ShieldAlert, text: 'Permiso de GPS denegado — activalo en ajustes', cls: 'bg-[#fef2f2] text-[#ea504c]' },
    unavailable: { icon: MapPin,      text: 'GPS no disponible',                  cls: 'bg-[#fdf6ec] text-[#d4943a]' },
  }
  const geo = GEO_CONFIG[geoState]
  const GeoIcon = geo.icon

  // ------------------------------------------
  return (
    <div className="mx-auto max-w-lg space-y-5 pb-28">
      <SuccessBurst show={showSuccess} onComplete={() => setShowSuccess(false)} />

      {/* Hero Clock */}
      <FadeIn className="pt-4 text-center">
        <p className="font-display text-5xl sm:text-7xl font-bold tabular-nums tracking-tight text-[#3d2c24]">
          {format(now, 'HH:mm')}
          <span className="text-2xl sm:text-3xl font-medium text-[#a39e97]">{format(now, ':ss')}</span>
        </p>
        <p className="section-label mt-4">
          {format(now, "EEEE d 'de' MMMM, yyyy", { locale: es })}
        </p>
      </FadeIn>

      {/* Geo status banner */}
      <FadeIn delay={0.05}>
        <div className={cn('flex items-center justify-between gap-2 rounded-xl px-4 py-3', geo.cls)}>
          <div className="flex items-center gap-2 text-sm font-medium">
            <GeoIcon className={cn('size-4 shrink-0', geoState === 'checking' && 'animate-spin')} />
            <span>{geo.text}</span>
          </div>
          {(geoState === 'unavailable' || geoState === 'too_far') && (
            <button onClick={checkGeo} className="shrink-0 rounded-lg p-1.5 hover:bg-black/5" aria-label="Reintentar">
              <RefreshCw className="size-3.5" />
            </button>
          )}
        </div>
      </FadeIn>

      {/* Status Card */}
      <FadeIn delay={0.1}>
        <div
          className="card-elevated-lg relative overflow-hidden px-6 py-10"
          style={{
            borderLeftWidth: '4px',
            borderLeftColor:
              status === 'clocked_in' ? '#d4943a' :
              status === 'completed'  ? '#006d5a' : 'transparent',
          }}
        >
          {/* NOT CLOCKED IN */}
          {status === 'not_clocked_in' && (
            <div className="flex flex-col items-center gap-6">
              <div className={cn('flex size-20 items-center justify-center rounded-2xl', geoBlocked ? 'bg-[#fef2f2]' : 'bg-[#f0f7f5]')}>
                <LogIn className={cn('size-9', geoBlocked ? 'text-[#ea504c]' : 'text-[#006d5a]')} strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <p className="font-display text-lg font-semibold text-[#3d2c24]">{getGreeting(now)}</p>
                <p className="mt-1 text-sm text-[#a39e97]">No registraste ingreso hoy.</p>
              </div>
              <Button
                onClick={() => handleClock('in')}
                disabled={geoBlocked}
                className={cn(
                  'h-16 w-full rounded-2xl text-base font-semibold text-white shadow-md active:scale-[0.98]',
                  geoBlocked
                    ? 'bg-[#a39e97] cursor-not-allowed'
                    : 'bg-[#006d5a] hover:bg-[#005a4a]',
                )}
              >
                <LogIn className="mr-2.5 size-5" />
                {geoBlocked ? 'Debés estar en el local' : 'Marcar Ingreso'}
              </Button>
            </div>
          )}

          {/* CLOCKED IN */}
          {status === 'clocked_in' && todayRecord && (
            <div className="flex flex-col items-center gap-6">
              <div className="flex size-20 items-center justify-center rounded-2xl bg-[#fdf6ec]">
                <Clock className="size-9 text-[#d4943a]" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <p className="section-label">Ingreso registrado</p>
                <p className="mt-2 font-display text-4xl font-bold tabular-nums text-[#3d2c24]">
                  {format(new Date(todayRecord.clock_in_at), 'HH:mm')}
                </p>
                {liveDuration && (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#fdf6ec] px-3 py-1">
                    <Timer className="size-3.5 text-[#d4943a]" />
                    <span className="text-sm font-semibold tabular-nums text-[#d4943a]">{liveDuration} trabajando</span>
                  </div>
                )}
                {todayRecord.is_suspicious && (
                  <div className="mt-3 flex items-center justify-center gap-1 text-xs text-amber-600">
                    <ShieldAlert className="size-3" /> Con advertencias
                  </div>
                )}
              </div>
              <Button
                onClick={() => handleClock('out')}
                disabled={geoBlocked}
                className={cn(
                  'h-16 w-full rounded-2xl text-base font-semibold text-white shadow-md active:scale-[0.98]',
                  geoBlocked
                    ? 'bg-[#a39e97] cursor-not-allowed'
                    : 'bg-[#d4943a] hover:bg-[#c0852f]',
                )}
              >
                <LogOut className="mr-2.5 size-5" />
                {geoBlocked ? 'Debés estar en el local' : 'Marcar Egreso'}
              </Button>
            </div>
          )}

          {/* COMPLETED */}
          {status === 'completed' && todayRecord && (
            <div className="flex flex-col items-center gap-6">
              <div className="flex size-20 items-center justify-center rounded-2xl bg-[#e8f5f1]">
                <CheckCircle className="size-9 text-[#006d5a]" strokeWidth={1.5} />
              </div>
              <div className="w-full text-center">
                <p className="font-display text-xl font-semibold text-[#006d5a]">Turno completado</p>
                <div className="mt-6 flex items-center justify-center gap-8">
                  <div className="text-center">
                    <p className="section-label">Ingreso</p>
                    <p className="mt-1 font-display text-3xl font-bold tabular-nums text-[#3d2c24]">
                      {format(new Date(todayRecord.clock_in_at), 'HH:mm')}
                    </p>
                  </div>
                  <div className="h-12 w-px bg-[#ebe6df]" />
                  <div className="text-center">
                    <p className="section-label">Egreso</p>
                    <p className="mt-1 font-display text-3xl font-bold tabular-nums text-[#3d2c24]">
                      {todayRecord.clock_out_at ? format(new Date(todayRecord.clock_out_at), 'HH:mm') : '--:--'}
                    </p>
                  </div>
                </div>
                {liveDuration && (
                  <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#e8f5f1] px-3 py-1">
                    <Timer className="size-3.5 text-[#006d5a]" />
                    <span className="text-sm font-semibold tabular-nums text-[#006d5a]">{liveDuration} trabajados</span>
                  </div>
                )}
                {todayRecord.is_suspicious && (
                  <div className="mt-4 flex items-center justify-center gap-1 text-xs text-amber-600">
                    <ShieldAlert className="size-3" /> Con advertencias
                  </div>
                )}
                {/* Turno cortado (mediodía y noche): se puede volver a marcar ingreso */}
                <button
                  onClick={() => handleClock('in')}
                  disabled={geoBlocked}
                  className="mt-5 text-[13px] font-semibold text-[#006d5a] underline disabled:text-[#a39e97] disabled:no-underline"
                >
                  {geoBlocked ? 'Para volver a fichar tenés que estar en el local' : 'Vuelvo a entrar (turno cortado)'}
                </button>
              </div>
            </div>
          )}
        </div>
      </FadeIn>

      {/* Historial */}
      <FadeIn delay={0.2} className="space-y-4">
        <button
          onClick={() => setShowHistory(v => !v)}
          className="flex w-full items-center gap-2.5 px-1"
        >
          <History className="size-4 text-[#a39e97]" strokeWidth={1.5} />
          <h2 className="font-display text-lg font-semibold text-[#3d2c24]">Historial reciente</h2>
          <div className="ml-auto">
            {showHistory ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
          </div>
        </button>

        {showHistory && (
          history.length === 0 ? (
            <div className="card-elevated flex flex-col items-center gap-2 px-6 py-10 text-center">
              <History className="size-8 text-[#ebe6df]" />
              <p className="text-sm font-medium text-[#a39e97]">Aún no hay registros</p>
            </div>
          ) : (
            <>
              <StaggerList className="space-y-2.5">
                {history.map(r => (
                  <StaggerItem key={r.id}>
                    <div
                      className="card-elevated flex items-center gap-4 rounded-xl px-4 py-3.5"
                      style={{
                        borderLeftWidth: '3px',
                        borderLeftColor: r.is_suspicious ? '#d4943a' : r.clock_out_at ? '#006d5a' : '#ea504c',
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium capitalize text-[#3d2c24]">
                          {format(new Date(r.operative_date + 'T12:00:00'), 'EEE d MMM', { locale: es })}
                        </p>
                        <div className="mt-0.5 flex items-center gap-x-3 text-xs text-[#a39e97]">
                          <span className="tabular-nums">{format(new Date(r.clock_in_at), 'HH:mm')}</span>
                          <span className="text-[#ebe6df]">/</span>
                          <span className="tabular-nums">{r.clock_out_at ? format(new Date(r.clock_out_at), 'HH:mm') : '--:--'}</span>
                          {r.clock_out_at && (
                            <>
                              <span className="text-[#ebe6df]">·</span>
                              <span>{fmtDuration(r.clock_in_at, r.clock_out_at)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium',
                        r.is_suspicious ? 'bg-amber-50 text-amber-700' :
                        r.clock_out_at  ? 'bg-[#e8f5f1] text-[#006d5a]' :
                        'bg-red-50 text-[#ea504c]'
                      )}>
                        {r.is_suspicious ? '⚠ Con advertencias' : r.clock_out_at ? '✓ Completo' : 'Sin egreso'}
                      </span>
                    </div>
                  </StaggerItem>
                ))}
              </StaggerList>
              {history.length >= historyLimit && (
                <button
                  onClick={() => setHistoryLimit(prev => prev + 15)}
                  className="mt-3 w-full rounded-xl border border-[#ebe6df] py-2 text-xs font-medium text-[#a39e97] hover:bg-[#faf8f5]"
                >
                  Ver más registros
                </button>
              )}
            </>
          )
        )}
      </FadeIn>
    </div>
  )
}
