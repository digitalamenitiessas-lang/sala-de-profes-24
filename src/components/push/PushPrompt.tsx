'use client'

import { useEffect, useState, useCallback } from 'react'
import { Bell, Loader2, Share } from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { canUsePushApi, ensurePushSubscription } from '@/lib/push/client'

// ---------------------------------------------------------------------------
// PushPrompt — bottom sheet para activar notificaciones push.
//
// Aparece en cada sesión (sessionStorage) hasta que el usuario activa o bloquea.
// El botón "Ahora no" la descarta por esa sesión. Al abrir la app de nuevo
// vuelve a aparecer — esto es intencional: queremos que toda la gente las active.
//
// Coordinación con InstallPrompt:
//   - iOS SIN instalar como PWA → las APIs push NO existen. El InstallPrompt
//     guía a "Agregar a inicio". Una vez instalada este prompt aparece.
//   - Android / PWA instalada / escritorio → botón directo.
// ---------------------------------------------------------------------------

// sessionStorage key — se resetea con cada nueva apertura de la app
const SESSION_KEY = 'push-prompt-dismissed'

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
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  )
}

export function PushPrompt() {
  const { profile } = useProfileContext()
  const [show, setShow] = useState(false)
  const [esIosNoInstalada, setEsIosNoInstalada] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    if (typeof window === 'undefined') return

    // Ya fue descartado en esta sesión → no volver a molestar
    if (sessionStorage.getItem(SESSION_KEY)) return

    const ios = isIOS()
    const standalone = isStandalone()

    if (ios && !standalone) {
      // iOS sin instalar: mostrar instrucciones de cómo añadir a inicio
      setEsIosNoInstalada(true)
      setShow(true)
      return
    }

    if (!canUsePushApi()) return
    if (Notification.permission === 'denied') return // ya bloqueadas, ActivarAvisos lo maneja
    if (Notification.permission === 'granted') {
      // Verificar que haya suscripción real (puede que el permiso esté pero sin sub)
      navigator.serviceWorker?.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => { if (!sub) setShow(true) })
        .catch(() => { /* sin SW, no mostramos */ })
      return
    }

    // permission === 'default' → mostrar siempre hasta que acepte o bloquee
    setShow(true)
  }, [profile?.id])

  const dismiss = useCallback(() => {
    sessionStorage.setItem(SESSION_KEY, '1')
    setShow(false)
  }, [])

  const activate = useCallback(async () => {
    setBusy(true)
    try {
      const result = await ensurePushSubscription(true)
      if (result === 'subscribed') {
        toast.success('¡Listo! Vas a recibir los avisos de la app.')
        sessionStorage.setItem(SESSION_KEY, '1')
        setShow(false)
      } else if (result === 'permission_denied') {
        toast.error('Bloqueaste las notificaciones. Activálas desde los ajustes del navegador.')
        dismiss()
      } else {
        toast.error('No se pudieron activar en este dispositivo.')
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
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-[60] bg-black/30" onClick={dismiss} />

      {/* Bottom sheet */}
      <div className="fixed inset-x-0 bottom-0 z-[61] rounded-t-3xl bg-white shadow-2xl">
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-[#e0dbd5]" />
        </div>

        <div className="px-5 pb-8 pt-2">
          {/* Ícono */}
          <div className="mb-4 flex justify-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-[#e8f5f1]">
              <Bell className="size-8 text-[#006d5a]" strokeWidth={1.75} />
            </div>
          </div>

          {esIosNoInstalada ? (
            <>
              <h2 className="text-center text-[17px] font-bold text-[#3d2c24]">
                Añadí la app a tu pantalla de inicio
              </h2>
              <p className="mt-2 text-center text-[13px] leading-relaxed text-[#7d6c64]">
                En iPhone, las notificaciones solo funcionan cuando abrís la app desde el ícono.
              </p>
              <div className="mt-4 rounded-2xl bg-[#f9f7f3] p-4 space-y-2">
                <div className="flex items-start gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#006d5a] text-[11px] font-bold text-white">1</span>
                  <p className="text-[13px] text-[#3d2c24] leading-snug">
                    Tocá el botón <Share className="inline size-4" /> <strong>Compartir</strong> abajo en Safari
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#006d5a] text-[11px] font-bold text-white">2</span>
                  <p className="text-[13px] text-[#3d2c24] leading-snug">Elegí <strong>"Agregar a pantalla de inicio"</strong></p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#006d5a] text-[11px] font-bold text-white">3</span>
                  <p className="text-[13px] text-[#3d2c24] leading-snug">Abrí la app desde ese ícono y activá los avisos</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-center text-[17px] font-bold text-[#3d2c24]">
                Activá los avisos
              </h2>
              <p className="mt-2 text-center text-[13px] leading-relaxed text-[#7d6c64]">
                Te llegan alertas de stock, pedidos y novedades del equipo, aunque no tengas la app abierta.
              </p>
            </>
          )}

          <div className="mt-5 space-y-2">
            {!esIosNoInstalada && (
              <button
                onClick={() => void activate()}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#006d5a] py-3.5 text-[15px] font-bold text-white disabled:opacity-60 active:scale-[0.98]"
              >
                {busy ? <Loader2 className="size-5 animate-spin" /> : <Bell className="size-5" />}
                Activar notificaciones
              </button>
            )}
            <button
              onClick={dismiss}
              className="w-full py-3 text-[13px] font-medium text-[#a39e97] active:opacity-70"
            >
              Ahora no
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
