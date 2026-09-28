'use client'

import { useEffect } from 'react'

export function RegisterSW() {
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      process.env.NODE_ENV === 'production'
    ) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('[PWA] SW registered, scope:', registration.scope)

          // Check for updates periodically (every 60 min)
          setInterval(() => {
            registration.update()
          }, 60 * 60 * 1000)
        })
        .catch((error) => {
          console.error('[PWA] SW registration failed:', error)
        })
    }
  }, [])

  return null
}
