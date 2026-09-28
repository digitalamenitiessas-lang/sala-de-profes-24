'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Error en la aplicacion:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="flex max-w-sm flex-col items-center gap-5 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-[#fef3eb]">
          <AlertTriangle className="size-8 text-[#d4943a]" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-xl font-semibold text-[#3d2c24]">
            Algo salio mal
          </h2>
          <p className="text-sm leading-relaxed text-[#a39e97]">
            Ocurrio un error inesperado. Puedes intentar recargar esta seccion.
          </p>
        </div>
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-xl bg-[#006d5a] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all hover:bg-[#005a4a] active:scale-95"
        >
          <RotateCcw className="size-4" />
          Reintentar
        </button>
      </div>
    </div>
  )
}
