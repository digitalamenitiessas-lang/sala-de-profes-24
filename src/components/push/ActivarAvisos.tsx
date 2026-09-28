'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Bell, BellOff, Loader2, Share } from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { canUsePushApi, ensurePushSubscription } from '@/lib/push/client'

// ---------------------------------------------------------------------------
// Aviso fijo para activar las notificaciones, para quien DEBE recibirlas
// (todo el equipo): conteo diario, protocolos (limpieza del baño), pedidos…
// A diferencia del pop-up general (que se descarta por 5 días), este queda
// visible hasta que se activan en ESTE dispositivo. Medido: 0 de 4 encargados
// y 5 de 10 socios las tenían activadas.
// ---------------------------------------------------------------------------

const ROLES = new Set(['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha'])

type Estado = 'cargando' | 'activas' | 'pedir' | 'ios_instalar' | 'bloqueadas' | 'sin_soporte'

function esIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
}
function esInstalada() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
}

export function ActivarAvisos() {
  const { profile } = useProfileContext()
  const [estado, setEstado] = useState<Estado>('cargando')
  const [activando, setActivando] = useState(false)

  useEffect(() => {
    if (!profile || !ROLES.has(profile.role)) return
    let vivo = true
    ;(async () => {
      let e: Estado
      if (esIOS() && !esInstalada()) e = 'ios_instalar'
      else if (!canUsePushApi()) e = 'sin_soporte'
      else if (Notification.permission === 'denied') e = 'bloqueadas'
      else {
        const sub = await navigator.serviceWorker?.ready.then((r) => r.pushManager.getSubscription()).catch(() => null)
        e = sub && Notification.permission === 'granted' ? 'activas' : 'pedir'
      }
      if (vivo) setEstado(e)
    })()
    return () => { vivo = false }
  }, [profile])

  if (!profile || !ROLES.has(profile.role) || estado === 'cargando' || estado === 'activas' || estado === 'sin_soporte') return null

  async function activar() {
    setActivando(true)
    try {
      const r = await ensurePushSubscription(true)
      if (r === 'subscribed') { setEstado('activas'); toast.success('Avisos activados en este celular') }
      else if (r === 'permission_denied') setEstado('bloqueadas')
      else toast.error('Este navegador no permite avisos')
    } catch {
      toast.error('No se pudieron activar los avisos')
    } finally {
      setActivando(false)
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl bg-[#3d2c24] p-3.5 text-white">
      {estado === 'bloqueadas' ? <BellOff className="mt-0.5 size-5 shrink-0 text-[#f0c98a]" /> : <Bell className="mt-0.5 size-5 shrink-0 text-[#f0c98a]" />}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold">Activá los avisos en este celular</p>
        {estado === 'pedir' && (
          <>
            <p className="mt-0.5 text-[11.5px] text-white/75">Así te llegan los avisos de limpieza del baño, el conteo diario y los pedidos, sin tener que mirar el grupo.</p>
            <button onClick={() => void activar()} disabled={activando} className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#f0c98a] px-3 py-1.5 text-[12.5px] font-semibold text-[#3d2c24] disabled:opacity-60">
              {activando ? <Loader2 className="size-3.5 animate-spin" /> : <Bell className="size-3.5" />} Activar avisos
            </button>
          </>
        )}
        {estado === 'ios_instalar' && (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-white/80">
            En iPhone los avisos funcionan solo con la app en la pantalla de inicio: tocá <Share className="inline size-3.5" /> <b>Compartir</b> → <b>“Agregar a inicio”</b>, abrí la app desde ese ícono y activalos ahí.
          </p>
        )}
        {estado === 'bloqueadas' && (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-white/80">
            Están bloqueados. Entrá a los <b>ajustes del navegador</b> (o de la app en iPhone) → Notificaciones → permitir para Sala de Profes, y volvé a abrir la app.
          </p>
        )}
      </div>
    </div>
  )
}
