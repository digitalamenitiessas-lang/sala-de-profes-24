'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ClipboardList } from 'lucide-react'

// Aviso "hay platos que se venden sin descontar insumos". Solo aparece
// mientras quede algo por vincular: cuando está todo, no se muestra nada.

type Resumen = { pendientes: number; revenue_pendiente: number; cobertura_pct: number | null }

export function PlatosSinRecetaCard() {
  const [r, setR] = useState<Resumen | null>(null)

  useEffect(() => {
    let vivo = true
    fetch('/api/ventas/vinculos?resumen=1', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (vivo) setR(json) })
      .catch(() => {})
    return () => { vivo = false }
  }, [])

  if (!r || r.pendientes === 0) return null

  return (
    <Link
      href="/ventas/vincular"
      className="flex items-center gap-3 rounded-2xl bg-[#fef7ed] p-3.5 ring-1 ring-[#d4943a]/25 transition hover:bg-[#fdf1e0]"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#d4943a]/15">
        <ClipboardList className="size-4.5 text-[#d4943a]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[#3d2c24]">
          {r.pendientes} plato{r.pendientes === 1 ? '' : 's'} u opcion{r.pendientes === 1 ? '' : 'es'} sin vincular
        </p>
        <p className="text-[11.5px] text-[#7d6c64]">
          ${Math.round(r.revenue_pendiente).toLocaleString('es-AR')} vendidos en 30 días sin descontar insumos
          {r.cobertura_pct != null && <> · {r.cobertura_pct.toLocaleString('es-AR')}% ya vinculado</>}
        </p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-[#d4943a]" />
    </Link>
  )
}
