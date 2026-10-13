// ---------------------------------------------------------------------------
// Geolocation utilities for attendance system
// ---------------------------------------------------------------------------

export type GeoResult = {
  status: 'success' | 'denied' | 'unavailable' | 'timeout' | 'error'
  lat?: number
  lng?: number
  accuracy?: number
  error?: string
}

export type DistanceResult = {
  distance_m: number
  in_range: boolean
  status: 'verde' | 'amber' | 'rojo'
}

const GEO_TIMEOUT = 15000
// Algunos celulares nunca llaman a ningún callback (ni éxito ni error, p. ej.
// con el permiso pendiente): sin este tope la pantalla quedaba girando.
const GEO_HARD_TIMEOUT = GEO_TIMEOUT + 5000

/**
 * @param options.maximumAge acepta una lectura del GPS de hasta N ms (0 = nueva).
 */
export function getCurrentPosition(options: { maximumAge?: number } = {}): Promise<GeoResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ status: 'unavailable', error: 'Geolocalización no disponible en este navegador' })
      return
    }

    let done = false
    const finish = (r: GeoResult) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(
      () => finish({ status: 'timeout', error: 'Tiempo de espera agotado' }),
      GEO_HARD_TIMEOUT,
    )

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        finish({
          status: 'success',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        })
      },
      (err) => {
        if (err.code === 1) finish({ status: 'denied', error: 'Permiso de ubicación denegado' })
        else if (err.code === 2) finish({ status: 'unavailable', error: 'Ubicación no disponible' })
        else if (err.code === 3) finish({ status: 'timeout', error: 'Tiempo de espera agotado' })
        else finish({ status: 'error', error: err.message })
      },
      { enableHighAccuracy: true, timeout: GEO_TIMEOUT, maximumAge: options.maximumAge ?? 0 },
    )
  })
}

// Haversine formula — client-side distance check (for display)
export function calculateDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371000 // Earth radius in meters
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return Math.round(R * c)
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180)
}

export function checkDistance(
  userLat: number, userLng: number,
  localLat: number, localLng: number,
  radiusM: number,
): DistanceResult {
  const distance_m = calculateDistance(userLat, userLng, localLat, localLng)
  const in_range = distance_m <= radiusM
  const status = distance_m <= radiusM ? 'verde'
    : distance_m <= radiusM * 2 ? 'amber'
    : 'rojo'
  return { distance_m, in_range, status }
}
