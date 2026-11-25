'use client'

import { useState } from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Informe } from '@/lib/informes/esquema'

// ---------------------------------------------------------------------------
// Informe para bajar en PDF (lo arma La Vieja con el bloque INFORME_JSON)
// ---------------------------------------------------------------------------
// Compartido por /asistente y el chat flotante. Antes estaba solo en
// /asistente: en el chat flotante La Vieja decía "Bajalo con el botón" y no
// había botón (y el menú de socios y encargados no tiene /asistente).
// ---------------------------------------------------------------------------

type MensajeChat = { role: 'user' | 'assistant'; content: string; informe?: Informe }

/** Historial para /api/chatbot: el último informe viaja entero para poder pedir "agregale…" o "cambiale…" */
export function historialConInforme(recientes: MensajeChat[]): { role: 'user' | 'assistant'; content: string }[] {
  const ultimoInforme = recientes.findLast((m) => m.informe)
  return recientes.map((m) => ({
    role: m.role,
    content: m === ultimoInforme
      ? `${m.content}\n\n[Informe PDF que armaste en este mensaje:]\n\`\`\`INFORME_JSON\n${JSON.stringify(m.informe).slice(0, 15000)}\n\`\`\``
      : m.content,
  }))
}

export function TarjetaInforme({ informe, chico = false }: { informe: Informe; chico?: boolean }) {
  const [estado, setEstado] = useState<'listo' | 'bajando' | 'error'>('listo')

  async function descargar() {
    setEstado('bajando')
    try {
      const res = await fetch('/api/asistente/informe-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ informe }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const nombre = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'Informe - LVE 24.pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombre
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setEstado('listo')
    } catch {
      setEstado('error')
    }
  }

  const tablas = informe.secciones.filter((s) => s.tabla).length
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border border-[#d5e6dc] bg-[#f1f7f3]', chico ? 'mt-2 p-2.5' : 'mt-3 p-3')}>
      <div className={cn('flex shrink-0 items-center justify-center rounded-lg bg-[#006d5a] text-white', chico ? 'size-8' : 'size-9')}>
        <FileText className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold text-[#3d2c24]">{informe.titulo}</p>
        <p className="text-[10px] text-[#5c4a42]">
          {estado === 'error'
            ? 'No se pudo armar el PDF. Probá de nuevo.'
            : `Informe en PDF · ${informe.secciones.length} ${informe.secciones.length === 1 ? 'sección' : 'secciones'}${tablas ? ` · ${tablas} ${tablas === 1 ? 'tabla' : 'tablas'}` : ''}`}
        </p>
      </div>
      <button
        onClick={descargar}
        disabled={estado === 'bajando'}
        className="flex shrink-0 items-center gap-1 rounded-lg bg-[#006d5a] px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-[#005a4a] disabled:opacity-60"
      >
        {estado === 'bajando' ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
        {estado === 'bajando' ? 'Armando…' : chico ? 'PDF' : 'Descargar PDF'}
      </button>
    </div>
  )
}
