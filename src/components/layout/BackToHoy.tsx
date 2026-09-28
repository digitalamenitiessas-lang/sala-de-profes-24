'use client'

// ---------------------------------------------------------------------------
// Píldora "Volver a Hoy" — aparece solo cuando se llegó desde /hoy (?from=hoy).
// Mantiene el hilo del workflow: entrás a un paso, hacés lo tuyo, volvés al
// plan del día sin perder nada (el plan queda guardado por fecha).
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export function BackToHoy() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    setShow(new URLSearchParams(window.location.search).get('from') === 'hoy')
  }, [])

  if (!show) return null

  return (
    <div className="sticky top-2 z-30 -mb-2 flex justify-center">
      <Link
        href="/hoy"
        className="flex items-center gap-1.5 rounded-full bg-[#3d2c24] px-4 py-2 text-xs font-bold text-white shadow-lg active:scale-95"
      >
        <ArrowLeft className="size-3.5" />
        Volver a Hoy
      </Link>
    </div>
  )
}
