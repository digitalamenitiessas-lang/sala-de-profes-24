'use client'

import { useEffect, useState } from 'react'
import { MapPin, Check, AlertTriangle, X, Loader2 } from 'lucide-react'
import { getCurrentPosition, checkDistance, type GeoResult, type DistanceResult } from '@/lib/attendance/geolocation'
import { cn } from '@/lib/utils'

type Props = {
  localLat: number
  localLng: number
  radiusM: number
  onResult: (geo: GeoResult, distance?: DistanceResult) => void
  canSkip?: boolean
  onSkip?: () => void
}

export default function GeoCheck({ localLat, localLng, radiusM, onResult, canSkip, onSkip }: Props) {
  const [status, setStatus] = useState<'loading' | 'success' | 'warning' | 'error'>('loading')
  const [distance, setDistance] = useState<DistanceResult | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const geo = await getCurrentPosition()
      if (cancelled) return

      if (geo.status === 'success' && geo.lat != null && geo.lng != null) {
        const dist = checkDistance(geo.lat, geo.lng, localLat, localLng, radiusM)
        setDistance(dist)
        setStatus(dist.in_range ? 'success' : 'warning')
        onResult(geo, dist)
      } else {
        setStatus('error')
        setErrorMsg(geo.error ?? 'Error de geolocalización')
        onResult(geo)
      }
    }

    check()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localLat, localLng, radiusM])

  const colors = {
    loading: { bg: 'bg-[#f5f2ee]', icon: 'text-[#a39e97]', ring: 'ring-[#ebe6df]' },
    success: { bg: 'bg-[#e8f5f1]', icon: 'text-[#006d5a]', ring: 'ring-[#006d5a]/20' },
    warning: { bg: 'bg-amber-50', icon: 'text-[#d4943a]', ring: 'ring-[#d4943a]/20' },
    error:   { bg: 'bg-red-50',   icon: 'text-[#ea504c]', ring: 'ring-[#ea504c]/20' },
  }

  const c = colors[status]

  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-2xl p-5 ring-1', c.bg, c.ring)}>
      <div className={cn('flex size-14 items-center justify-center rounded-full', c.bg)}>
        {status === 'loading' && <Loader2 className={cn('size-7 animate-spin', c.icon)} />}
        {status === 'success' && <Check className={cn('size-7', c.icon)} />}
        {status === 'warning' && <AlertTriangle className={cn('size-7', c.icon)} />}
        {status === 'error' && <X className={cn('size-7', c.icon)} />}
      </div>

      <div className="text-center">
        {status === 'loading' && (
          <p className="text-sm text-[#a39e97]">Verificando ubicación...</p>
        )}
        {status === 'success' && distance && (
          <>
            <p className="text-sm font-semibold text-[#006d5a]">Dentro del rango</p>
            <p className="text-xs text-[#a39e97]">
              <MapPin className="mr-1 inline size-3" />
              {distance.distance_m}m del local (máx {radiusM}m)
            </p>
          </>
        )}
        {status === 'warning' && distance && (
          <>
            <p className="text-sm font-semibold text-[#d4943a]">Fuera del rango</p>
            <p className="text-xs text-[#a39e97]">
              <MapPin className="mr-1 inline size-3" />
              {distance.distance_m}m del local (máx {radiusM}m)
            </p>
            <p className="mt-1 text-xs text-[#d4943a]">El fichaje se marcará como sospechoso</p>
          </>
        )}
        {status === 'error' && (
          <>
            <p className="text-sm font-semibold text-[#ea504c]">{errorMsg}</p>
            <p className="mt-1 text-xs text-[#a39e97]">El fichaje se marcará como sospechoso</p>
          </>
        )}
      </div>

      {(status === 'warning' || status === 'error') && canSkip && (
        <button
          onClick={onSkip}
          className="mt-1 rounded-xl bg-white px-4 py-2 text-xs font-medium text-[#3d2c24] shadow-sm ring-1 ring-[#ebe6df]"
        >
          Continuar de todos modos
        </button>
      )}
    </div>
  )
}
