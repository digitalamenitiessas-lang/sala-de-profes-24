// Ubicación del local para el fichaje (geocerca).
// Se configura por variables de entorno para no atar el código a una sucursal:
//   NEXT_PUBLIC_VENUE_LAT, NEXT_PUBLIC_VENUE_LNG, NEXT_PUBLIC_VENUE_RADIUS_M, NEXT_PUBLIC_VENUE_NAME
// Si la tabla attendance_config tiene la clave 'location', el servidor usa esa.
// Sin coordenadas configuradas el fichaje queda bloqueado (no hay a qué medir).
export const VENUE = {
  lat: Number(process.env.NEXT_PUBLIC_VENUE_LAT ?? NaN),
  lng: Number(process.env.NEXT_PUBLIC_VENUE_LNG ?? NaN),
  radiusM: Number(process.env.NEXT_PUBLIC_VENUE_RADIUS_M ?? 75), // 75m: cubre el drift del GPS en interiores
  name: process.env.NEXT_PUBLIC_VENUE_NAME ?? 'La Vieja Escuela — 24 y Maipú',
} as const

export const VENUE_CONFIGURED = Number.isFinite(VENUE.lat) && Number.isFinite(VENUE.lng)
