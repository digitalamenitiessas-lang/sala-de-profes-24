'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { ChevronRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

// Resumen para Hoy: cuántas limpiezas se hicieron y si hay alguna atrasada.
type Resumen = { protocolos: { id: string; nombre: string; activo: boolean; tareas: { visible: string; estado: string }[] }[] }
const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null))

export function ProtocolosHoy() {
  const { data } = useSWR<Resumen | null>('/api/protocolos', fetcher, { refreshInterval: 120_000 })
  const activos = (data?.protocolos ?? []).filter((p) => p.activo && p.tareas.length > 0)
  if (activos.length === 0) return null
  return (
    <Link href="/protocolos" className="block rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-[#ebe6df]">
      {activos.map((p) => {
        const hechas = p.tareas.filter((t) => t.estado === 'hecha').length
        const atrasadas = p.tareas.filter((t) => t.visible === 'atrasada').length
        const sinAsignar = p.tareas.filter((t) => t.visible === 'sin_asignar').length
        return (
          <div key={p.id} className="flex items-center gap-3">
            <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', atrasadas ? 'bg-[#fef2f2]' : 'bg-[#fdf6ec]')}>
              <Sparkles className={cn('size-4', atrasadas ? 'text-[#ea504c]' : 'text-[#d4943a]')} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-[#3d2c24]">{p.nombre}: {hechas} de {p.tareas.length}</p>
              <p className={cn('text-[12px]', atrasadas ? 'font-semibold text-[#ea504c]' : 'text-[#7d6c64]')}>
                {atrasadas ? `${atrasadas} atrasada${atrasadas > 1 ? 's' : ''} sin hacer` : sinAsignar ? 'Hay una para asignar ahora' : hechas === p.tareas.length ? 'Todo hecho con fotos' : 'Al día'}
              </p>
            </div>
            <ChevronRight className="size-4 text-[#a39e97]" />
          </div>
        )
      })}
    </Link>
  )
}
