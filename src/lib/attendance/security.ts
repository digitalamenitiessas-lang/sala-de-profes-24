// ---------------------------------------------------------------------------
// Attendance Security — unified facade over geo, device, and network modules
// ---------------------------------------------------------------------------

import { getCurrentPosition, calculateDistance, type GeoResult as RawGeoResult } from './geolocation'
import { generateDeviceFingerprint, getDeviceLabel } from './device-fingerprint'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GeoResult = {
  lat: number
  lng: number
  accuracy: number
}

export type VenueConfig = {
  venue_lat: number
  venue_lng: number
  geo_radius_m: number
  require_photo?: boolean
}

export type DeviceInfo = {
  id: string
  userAgent: string
  language: string
  timezone: string
  screen: string
  platform: string
  label: string
}

export type NetworkInfo = {
  effectiveType?: string
  connectionType?: string
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------

export async function getGeolocation(timeout?: number): Promise<GeoResult> {
  void timeout // currently using built-in timeout from geolocation module
  const result = await getCurrentPosition()

  if (result.status !== 'success' || result.lat == null || result.lng == null) {
    throw new Error(result.error ?? 'No se pudo obtener la ubicación')
  }

  return {
    lat: result.lat,
    lng: result.lng,
    accuracy: result.accuracy ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Haversine distance (re-export with simpler name)
// ---------------------------------------------------------------------------

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  return calculateDistance(lat1, lng1, lat2, lng2)
}

// ---------------------------------------------------------------------------
// Device fingerprint
// ---------------------------------------------------------------------------

export function getDeviceFingerprint(): DeviceInfo {
  return {
    id: generateDeviceFingerprint(),
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: `${screen.width}x${screen.height}`,
    platform: navigator.platform,
    label: getDeviceLabel(),
  }
}

// ---------------------------------------------------------------------------
// Network info
// ---------------------------------------------------------------------------

type NavigatorWithConnection = Navigator & {
  connection?: {
    effectiveType?: string
    type?: string
  }
}

export function getNetworkInfo(): NetworkInfo {
  const nav = navigator as NavigatorWithConnection
  const conn = nav.connection

  return {
    effectiveType: conn?.effectiveType ?? undefined,
    connectionType: conn?.type ?? undefined,
  }
}
