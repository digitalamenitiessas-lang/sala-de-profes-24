'use client'

import { useEffect, useRef } from 'react'
import { useProfileContext } from '@/lib/hooks/use-profile'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

/**
 * Auto-subscribes the current user to push notifications.
 * - Waits for service worker registration
 * - Requests notification permission (only once)
 * - Sends subscription to the server
 */
export function usePushSubscription() {
  const { profile } = useProfileContext()
  const attemptedRef = useRef(false)

  useEffect(() => {
    if (!profile?.id) return
    if (attemptedRef.current) return
    if (!VAPID_PUBLIC_KEY) return
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    // Don't auto-prompt — only subscribe if already granted
    if (Notification.permission === 'denied') return

    attemptedRef.current = true

    async function subscribe() {
      try {
        const registration = await navigator.serviceWorker.ready

        // Check existing subscription
        let subscription = await registration.pushManager.getSubscription()

        if (!subscription && Notification.permission === 'granted') {
          // Ya concedido pero sin suscripción — re-suscribir (silencioso, no
          // requiere gesto porque el permiso ya está dado).
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          })
        }

        // NO pedir permiso automáticamente acá: Notification.requestPermission()
        // debe dispararse desde un gesto del usuario (obligatorio en iOS). De eso
        // se encarga PushPrompt (el pop-up con botón "Activar"). Si el permiso
        // sigue en 'default', no hacemos nada — el usuario lo activa desde ahí.
        if (!subscription) return

        // Send to server
        const sub = subscription.toJSON()
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: sub.endpoint,
            keys: sub.keys,
          }),
        })
      } catch (err) {
        console.error('[Push] Subscription failed:', err)
      }
    }

    subscribe()
  }, [profile?.id])
}
