'use client'

import { createClient } from '@/lib/supabase/client'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

type PushSubscriptionJson = {
  endpoint?: string
  keys?: {
    p256dh?: string
    auth?: string
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)

  for (let i = 0; i < raw.length; i += 1) {
    arr[i] = raw.charCodeAt(i)
  }

  return arr
}

export function canUsePushApi() {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  )
}

async function syncSubscription(subscription: PushSubscription) {
  const sub = subscription.toJSON() as PushSubscriptionJson

  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    throw new Error('Suscripción push inválida')
  }

  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: sub.keys,
    }),
  })

  if (!response.ok) {
    throw new Error('No se pudo guardar la suscripción push')
  }
}

export async function ensurePushSubscription(enabled: boolean) {
  if (!enabled) {
    await removeCurrentPushSubscription()
    return 'disabled'
  }

  if (!canUsePushApi()) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'missing_config'
  if (Notification.permission === 'denied') return 'permission_denied'

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()

  if (!subscription) {
    let permission = Notification.permission

    if (permission === 'default') {
      permission = await Notification.requestPermission()
    }

    if (permission !== 'granted') return 'permission_denied'

    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }

  await syncSubscription(subscription)

  return 'subscribed'
}

export async function removeCurrentPushSubscription() {
  if (!canUsePushApi()) return false

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()

  if (!subscription) return false

  try {
    await fetch('/api/push/subscribe', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
      keepalive: true,
    })
  } catch {
    // Best effort cleanup on logout/disable.
  }

  return subscription.unsubscribe().catch(() => false)
}

export async function signOutBrowserSession() {
  const supabase = createClient()

  // Dar de baja los avisos de este celular, con tiempo máximo: si el service
  // worker no está activo, `serviceWorker.ready` no se resuelve nunca y antes
  // la sesión no llegaba a cerrarse (se volvía al inicio con la sesión abierta).
  await Promise.race([
    removeCurrentPushSubscription().catch(() => {}),
    new Promise((r) => setTimeout(r, 1500)),
  ])
  await supabase.auth.signOut().catch(() => {})
}
