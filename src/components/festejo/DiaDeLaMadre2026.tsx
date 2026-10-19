'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'festejo_madre_2026_visto'

export function DiaDeLaMadre2026() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const hoyAR = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
    if (hoyAR !== '2026-10-19') return
    if (sessionStorage.getItem(STORAGE_KEY)) return
    setVisible(true)
  }, [])

  function cerrar() {
    sessionStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 px-4 pb-6 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-2xl text-center">
        <div className="mb-4 text-6xl">💐</div>
        <h2 className="mb-3 text-xl font-bold text-gray-900 leading-snug">
          ¡Feliz día de la madre a todo el equipo de La Vieja Escuela!
        </h2>
        <p className="mb-6 text-base text-gray-600 leading-relaxed">
          Especialmente para esas súper trabajadoras que hacen de todo... pero sobre todo: ser mamá. ❤️
        </p>
        <button
          onClick={cerrar}
          className="w-full rounded-xl bg-pink-500 py-3 text-base font-semibold text-white active:bg-pink-600"
        >
          ¡Gracias! 💐
        </button>
      </div>
    </div>
  )
}
