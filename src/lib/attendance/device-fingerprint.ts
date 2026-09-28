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
