'use client'

import { useEffect, useState, useCallback } from 'react'
import { Bell, BellOff, Loader2, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { canUsePushApi, ensurePushSubscription, removeCurrentPushSubscription } from '@/lib/push/client'

// ---------------------------------------------------------------------------
// PushDeviceToggle — activar/desactivar push en ESTE dispositivo, desde Ajustes.
// Lugar permanente por si el usuario cerró el pop-up (PushPrompt).
// ---------------------------------------------------------------------------

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
}

type State = 'loading' | 'on' | 'off' | 'denied' | 'ios-install' | 'unsupported'

export function PushDeviceToggle() {
  const [state, setState] = useState<State>('loading')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return
    if (isIOS() && !isStandalone()) { setState('ios-install'); return }
    if (!canUsePushApi()) { setState('unsupported'); return }
    if (Notification.permission === 'denied') { setState('denied'); return }
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off')
    } catch {
      setState('off')
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const toggle = useCallback(async () => {
    setBusy(true)
    try {
      if (state === 'on') {
        await removeCurrentPushSubscription()
        toast.success('Notificaciones desactivadas en este dispositivo')
        setState('off')
      } else {
        const r = await ensurePushSubscription(true)
        if (r === 'subscribed') { toast.success('Notificaciones activadas ✓'); setState('on') }
        else if (r === 'permission_denied') { toast.error('Bloqueaste las notificaciones. Activalas desde los ajustes del navegador.'); setState('denied') }
        else toast.error('No se pudieron activar en este dispositivo.')
      }
    } catch {
      toast.error('Error al cambiar las notificaciones.')
    } finally {
      setBusy(false)
    }
  }, [state])

  const meta: Record<State, { title: string; desc: string }> = {
    loading: { title: 'Notificaciones push', desc: 'Comprobando…' },
    on: { title: 'Notificaciones push', desc: 'Activadas en este dispositivo' },
    off: { title: 'Notificaciones push', desc: 'Enterate al instante, aunque no tengas la app abierta' },
    denied: { title: 'Notificaciones push', desc: 'Bloqueadas — activalas desde los ajustes del navegador' },
    'ios-install': { title: 'Notificaciones push', desc: 'En iPhone: primero agregá la app a la pantalla de inicio (Compartir → Agregar a inicio)' },
    unsupported: { title: 'Notificaciones push', desc: 'Este dispositivo/navegador no las soporta' },
  }
  const canToggle = state === 'on' || state === 'off'
  const m = meta[state]

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#e8f5f1]">
        {state === 'on' ? <Bell className="size-4 text-[#006d5a]" /> : state === 'ios-install' ? <Smartphone className="size-4 text-[#8b5e34]" /> : <BellOff className="size-4 text-[#a39e97]" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[#3d2c24]">{m.title}</p>
        <p className="text-[11px] leading-snug text-[#a39e97]">{m.desc}</p>
      </div>
      {canToggle && (
        <button
          onClick={toggle}
          disabled={busy}
          className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50 ${state === 'on' ? 'bg-[#f5f2ee] text-[#7d6c64]' : 'bg-[#006d5a] text-white'}`}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {state === 'on' ? 'Desactivar' : 'Activar'}
        </button>
      )}
    </div>
  )
}
