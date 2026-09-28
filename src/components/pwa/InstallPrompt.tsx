'use client'

import { useEffect, useState, useCallback } from 'react'
import { Download, X, Share, Plus } from 'lucide-react'

// ---------------------------------------------------------------------------
// InstallPrompt — shows a popup on first login to install the PWA
//
// Behavior:
//   - Android/Desktop: captures `beforeinstallprompt`, shows native install
//   - iOS: shows manual instructions (Share → Add to Home Screen)
//   - Only shows once per device (localStorage flag)
//   - Delays 3 seconds after mount to avoid overwhelming the user
//   - If dismissed, won't show again for 7 days
//   - If "installed" or already in standalone mode, never shows
// ---------------------------------------------------------------------------

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIOS(): boolean {
  if (typeof window === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

const STORAGE_KEY = 'pwa-install-prompt'

function getPromptState(): { installed: boolean; dismissedAt: number | null } {
  if (typeof window === 'undefined') return { installed: false, dismissedAt: null }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { installed: false, dismissedAt: null }
    return JSON.parse(raw)
  } catch {
    return { installed: false, dismissedAt: null }
  }
}

function setPromptState(state: { installed?: boolean; dismissedAt?: number | null }) {
  const current = getPromptState()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...state }))
}

export function InstallPrompt() {
  const [show, setShow] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [iosMode, setIosMode] = useState(false)

  useEffect(() => {
    // Already running as installed app — never show
    if (isStandalone()) {
      setPromptState({ installed: true })
      return
    }

    const state = getPromptState()
    if (state.installed) return

    // If dismissed less than 7 days ago, don't show
    if (state.dismissedAt) {
      const daysSince = (Date.now() - state.dismissedAt) / (1000 * 60 * 60 * 24)
      if (daysSince < 7) return
    }

    // iOS — no beforeinstallprompt, show manual instructions
    if (isIOS()) {
      setIosMode(true)
      const timer = setTimeout(() => setShow(true), 3000)
      return () => clearTimeout(timer)
    }

    // Android / Desktop — listen for beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setTimeout(() => setShow(true), 3000)
    }

    window.addEventListener('beforeinstallprompt', handler)

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setPromptState({ installed: true })
    } else {
      setPromptState({ dismissedAt: Date.now() })
    }
    setDeferredPrompt(null)
    setShow(false)
  }, [deferredPrompt])

  const handleDismiss = useCallback(() => {
    setPromptState({ dismissedAt: Date.now() })
    setShow(false)
  }, [])

  if (!show) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300 rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="relative flex items-center gap-3 rounded-t-2xl bg-primary px-5 py-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20">
            <Download className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-white">
              Instalar Sala de Profes
            </h3>
            <p className="text-xs text-white/80">Acceso rápido desde tu pantalla</p>
          </div>
          <button
            onClick={handleDismiss}
            className="absolute right-3 top-3 rounded-full p-1 text-white/70 hover:bg-white/20 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {iosMode ? (
            <>
              <p className="mb-4 text-sm text-muted-foreground">
                Para instalar la app en tu iPhone:
              </p>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <Share className="h-4 w-4" />
                  </div>
                  <p className="text-sm">
                    Tocá el botón <strong>Compartir</strong> <span className="text-muted-foreground">(abajo del navegador)</span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <Plus className="h-4 w-4" />
                  </div>
                  <p className="text-sm">
                    Elegí <strong>Agregar a Inicio</strong>
                  </p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Agregá la app a tu pantalla de inicio para acceder más rápido, recibir notificaciones y usarla sin barra del navegador.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 border-t px-5 py-4">
          <button
            onClick={handleDismiss}
            className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/50"
          >
            Ahora no
          </button>
          {iosMode ? (
            <button
              onClick={handleDismiss}
              className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90"
            >
              Entendido
            </button>
          ) : (
            <button
              onClick={handleInstall}
              className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90"
            >
              Instalar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
