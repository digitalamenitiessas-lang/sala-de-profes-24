'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'
import { Sparkles, AlertTriangle, X } from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { playSchoolBell } from '@/lib/sounds'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Alarma de protocolos en toda la app (además de la notificación push).
//   Encargado/socio: "es la hora, asigná" y "atrasada".
//   Cualquiera: "te toca" cuando tiene una asignada.
// Suena la campana la primera vez que aparece cada aviso. "Después" la
// esconde 10 minutos; vuelve hasta que se complete.
// ---------------------------------------------------------------------------

type Pendiente = { id: string; nombre: string; hora: string; tipo: 'mia' | 'sin_asignar' | 'atrasada' }

const POSPONER_MS = 10 * 60_000
const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : { pendientes: [] }))

export function ProtocoloAlarma() {
  const { profile } = useProfileContext()
  const pathname = usePathname()
  const { data } = useSWR<{ pendientes: Pendiente[] }>(profile ? '/api/protocolos/pendientes' : null, fetcher, { refreshInterval: 60_000 })
  const [pospuestas, setPospuestas] = useState<Record<string, number>>({})
  const [ahora, setAhora] = useState(0)
  const sonadas = useRef<Set<string>>(new Set())

  // Re-evaluar los pospuestos cada minuto
  useEffect(() => {
    const actualizar = () => setAhora(Date.now())
    const t = setTimeout(actualizar, 0)
    const i = setInterval(actualizar, 60_000)
    return () => { clearTimeout(t); clearInterval(i) }
  }, [])

  const visibles = (data?.pendientes ?? []).filter((p) => !(pospuestas[`${p.id}:${p.tipo}`] > ahora))
  // Prioridad: la mía, después atrasadas, después sin asignar
  const orden = { mia: 0, atrasada: 1, sin_asignar: 2 } as const
  const p = [...visibles].sort((a, b) => orden[a.tipo] - orden[b.tipo] || a.hora.localeCompare(b.hora))[0]

  useEffect(() => {
    if (!p) return
    const k = `${p.id}:${p.tipo}`
    if (sonadas.current.has(k)) return
    sonadas.current.add(k)
    playSchoolBell()
  }, [p])

  if (!p || pathname?.startsWith('/protocolos')) return null

  const texto = p.tipo === 'mia'
    ? { t: `Te toca: ${p.nombre}`, s: `${p.hora} · marcá los pasos y subí la foto`, cta: 'Hacerlo' }
    : p.tipo === 'atrasada'
      ? { t: `Atrasada: ${p.nombre}`, s: `${p.hora} · todavía no se hizo`, cta: 'Resolver' }
      : { t: `Es la hora: ${p.nombre}`, s: `${p.hora} · asigná a alguien del turno`, cta: 'Asignar' }
  const urgente = p.tipo === 'atrasada'

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[84px] z-30 flex justify-center px-3">
      <div className={cn('pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl p-3 text-white shadow-xl', urgente ? 'bg-[#ea504c]' : 'bg-[#3d2c24]')}>
        <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15', urgente && 'animate-pulse')}>
          {urgente ? <AlertTriangle className="size-4.5" /> : <Sparkles className="size-4.5 text-[#f0c98a]" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-bold">{texto.t}</p>
          <p className="truncate text-[11.5px] text-white/80">{texto.s}</p>
        </div>
        <Link href="/protocolos" className={cn('shrink-0 rounded-lg px-3 py-1.5 text-[12.5px] font-bold', urgente ? 'bg-white text-[#ea504c]' : 'bg-[#f0c98a] text-[#3d2c24]')}>{texto.cta}</Link>
        <button onClick={() => { const t = Date.now(); setAhora(t); setPospuestas((x) => ({ ...x, [`${p.id}:${p.tipo}`]: t + POSPONER_MS })) }} className="shrink-0 rounded-full p-1 text-white/70 hover:bg-white/10" aria-label="Después">
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
