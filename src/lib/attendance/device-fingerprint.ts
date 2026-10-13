// ---------------------------------------------------------------------------
// Device Fingerprint — generates a stable hash from browser characteristics
// ---------------------------------------------------------------------------

export function generateDeviceFingerprint(): string {
  const parts = [
    `${screen.width}x${screen.height}`,
    `${screen.colorDepth}`,
    navigator.language,
    navigator.platform,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${navigator.hardwareConcurrency ?? 0}`,
    `${navigator.maxTouchPoints ?? 0}`,
    navigator.userAgent.replace(/\s+/g, '').slice(0, 80),
  ]

  const raw = parts.join('|')

  // Simple hash (djb2)
  let hash = 5381
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0
  }

  return `df_${hash.toString(36)}`
}

/**
 * Identificador propio de ESTE celular: se genera una vez y queda guardado en
 * el teléfono (sobrevive a cerrar sesión). La huella de arriba se arma con el
 * modelo y el navegador, así que dos iPhone iguales daban la misma: no sirve
 * para "un celular, una persona". Si el teléfono no deja guardar, se usa la
 * huella vieja (el servidor no la usa para bloquear).
 */
const DEVICE_ID_KEY = 'lve_device_id'

export function getDeviceId(): string {
  try {
    const guardado = localStorage.getItem(DEVICE_ID_KEY)
    if (guardado && guardado.startsWith('dv_')) return guardado
    const nuevo = `dv_${crypto.randomUUID()}`
    localStorage.setItem(DEVICE_ID_KEY, nuevo)
    return nuevo
  } catch {
    return generateDeviceFingerprint()
  }
}

export function getDeviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return 'iPhone Safari'
  if (/iPad/i.test(ua)) return 'iPad Safari'
  if (/Android/i.test(ua) && /Chrome/i.test(ua)) return 'Android Chrome'
  if (/Android/i.test(ua)) return 'Android Browser'
  if (/Macintosh/i.test(ua) && /Chrome/i.test(ua)) return 'Mac Chrome'
  if (/Macintosh/i.test(ua) && /Safari/i.test(ua)) return 'Mac Safari'
  if (/Windows/i.test(ua) && /Chrome/i.test(ua)) return 'Windows Chrome'
  if (/Windows/i.test(ua) && /Firefox/i.test(ua)) return 'Windows Firefox'
  return 'Navegador desconocido'
}
