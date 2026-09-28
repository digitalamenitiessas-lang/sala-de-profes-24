'use client'

import { useEffect, useState, useCallback } from 'react'
import { Bell, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { canUsePushApi, ensurePushSubscription } from '@/lib/push/client'

// ---------------------------------------------------------------------------
// PushPrompt — pop-up para ACTIVAR notificaciones push, con gesto del usuario.
// ---------------------------------------------------------------------------
// Por qué existe: Notification.requestPermission() debe dispararse desde un
// click del usuario (obligatorio en iOS Safari). El auto-suscribe silencioso
// no alcanza — hace falta un botón visible.
//
// Coordinación con InstallPrompt:
//   - iOS SIN instalar como PWA → las APIs de push NO existen (canUsePushApi
//     es false). No mostramos nada acá: el InstallPrompt guía a "Agregar a
//     inicio" primero. Una vez instalada (standalone), estas APIs aparecen y
//     este prompt puede activar el push.
//   - Android / PWA instalada / escritorio con soporte → botón directo.
// ---------------------------------------------------------------------------

const DISMISS_KEY = 'push-prompt-dismissed-at'
const REDISPLAY_DAYS = 5

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPad moderno se reporta como Mac con touch
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  )
}

export function PushPrompt() {
  const { profile } = useProfileContext()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    if (typeof window === 'undefined') return

    // ¿Fue descartado hace poco?
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    if (dismissedAt && Date.now() - dismissedAt < REDISPLAY_DAYS * 86_400_000) return

    // iOS sin instalar → lo maneja InstallPrompt, no mostramos acá
    if (isIOS() && !isStandalone()) return

    // Sin soporte de push (o ya denegado/activado) → no mostrar el pop-up.
    if (!canUsePushApi()) return
    if (Notification.permission !== 'default') return

    // Chequear si ya hay suscripción activa (por las dudas)
    navigator.serviceWorker?.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => { if (!sub) setShow(true) })
      .catch(() => setShow(true))
  }, [profile?.id])

  const dismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setShow(false)
  }, [])

  const activate = useCallback(async () => {
    setBusy(true)
    try {
      const result = await ensurePushSubscription(true)
      if (result === 'subscribed') {
        toast.success('Notificaciones activadas ✓')
        setShow(false)
      } else if (result === 'permission_denied') {
        toast.error('Bloqueaste las notificaciones. Activalas desde los ajustes del navegador.')
        dismiss()
      } else {
        toast.error('No se pudieron activar las notificaciones en este dispositivo.')
        dismiss()
      }
    } catch {
      toast.error('No se pudieron activar las notificaciones.')
    } finally {
      setBusy(false)
    }
  }, [dismiss])

  if (!show) return null

  return (
    <div className="fixed inset-x-3 bottom-[5.5rem] z-40 mx-auto max-w-md rounded-2xl bg-white p-4 shadow-lg ring-1 ring-[#ebe6df]">
      <button
        onClick={dismiss}
        aria-label="Cerrar"
        className="absolute right-2.5 top-2.5 rounded-full p-1 text-[#a39e97] hover:bg-black/5"
      >
        <X className="size-4" />
      </button>
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#e8f5f1]">
          <Bell className="size-5 text-[#006d5a]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-[#3d2c24]">Activá las notificaciones</p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            Enterate al instante de pedidos, alertas del negocio y avisos del equipo, aunque no tengas la app abierta.
          </p>
          <button
            onClick={activate}
            disabled={busy}
            className="mt-2.5 flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-[#005a4a] disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Bell className="size-4" />}
            Activar
          </button>
        </div>
      </div>
    </div>
  )
}
