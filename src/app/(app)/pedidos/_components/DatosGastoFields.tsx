'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COMPROBANTES, esFactura, type CategoriaGasto, type ComprobanteTipo, type DatosGasto } from '@/lib/compras/datos-gasto'
import { parseQty } from './shared'

// ---------------------------------------------------------------------------
// "Datos del gasto" en Llegó / Llegó todo: categoría (obligatoria: con eso se
// hace el análisis de fin de mes) y comprobante. Categoría, tipo y número van
// a Fudo; IVA e IIBB (Factura A) quedan en Sala de Profes y se vuelven a
// cargar en Fudo, porque Fudo no deja recibirlos por la API.
// ---------------------------------------------------------------------------

export function useDatosGasto(supplierId: string | null | undefined) {
  const [categorias, setCategorias] = useState<CategoriaGasto[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorFudo, setErrorFudo] = useState<string | null>(null)
  const [categoriaId, setCategoriaId] = useState('')
  const [comprobante, setComprobante] = useState<ComprobanteTipo>('sin_comprobante')
  const [numero, setNumero] = useState('')
  const [iva, setIva] = useState('')
  const [iibb, setIibb] = useState('')

  useEffect(() => {
    let alive = true
    fetch(`/api/compras/datos-gasto${supplierId ? `?supplier_id=${encodeURIComponent(supplierId)}` : ''}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return
        setCategorias(Array.isArray(d.categorias) ? d.categorias : [])
        setErrorFudo(d.error ?? null)
        // Lo último que se usó con este proveedor
        if (d.ultima?.categoriaId) setCategoriaId(d.ultima.categoriaId)
        if (COMPROBANTES.some((c) => c.key === d.ultima?.comprobante)) setComprobante(d.ultima.comprobante)
      })
      .catch(() => { if (alive) setErrorFudo('No se pudieron traer las categorías') })
      .finally(() => { if (alive) setCargando(false) })
    return () => { alive = false }
  }, [supplierId])

  const num = (v: string) => { const n = parseQty(v); return Number.isFinite(n) && n >= 0 ? n : null }
  const facturaA = comprobante === 'factura_a'
  const datos: DatosGasto = {
    categoriaId: categoriaId || null,
    categoriaNombre: categorias.find((c) => c.id === categoriaId)?.name ?? null,
    comprobante,
    numero: esFactura(comprobante) || comprobante === 'ticket' ? numero.trim() || null : null,
    iva: facturaA ? num(iva) : null,
    iibb: facturaA ? num(iibb) : null,
  }
  // Obligatoria cuando hay de dónde elegir: si Fudo no responde no se traba
  // la recepción de la mercadería.
  const falta = cargando || (categorias.length > 0 && !categoriaId)

  return {
    datos, falta,
    campos: { categorias, cargando, errorFudo, categoriaId, setCategoriaId, comprobante, setComprobante, numero, setNumero, iva, setIva, iibb, setIibb },
  }
}

const inputCls = 'w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm text-[#3d2c24] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:outline-none'

export function DatosGastoFields({ campos }: { campos: ReturnType<typeof useDatosGasto>['campos'] }) {
  const { categorias, cargando, errorFudo, categoriaId, setCategoriaId, comprobante, setComprobante, numero, setNumero, iva, setIva, iibb, setIibb } = campos
  return (
    <div className="space-y-2.5 rounded-xl bg-[#faf8f5] p-3">
      <label className="block">
        <span className="text-[12px] font-semibold text-[#3d2c24]">
          Categoría del gasto {categorias.length > 0 && <span className="text-[#ea504c]">*</span>}
        </span>
        {cargando ? (
          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-[#a39e97]"><Loader2 className="size-3 animate-spin" /> Trayendo categorías de Fudo…</span>
        ) : categorias.length === 0 ? (
          <span className="mt-1 block text-[11px] text-[#d4943a]">
            {errorFudo ? 'Fudo no respondió: el gasto se carga sin categoría (completala en Fudo).' : 'No hay categorías de gasto en Fudo.'}
          </span>
        ) : (
          <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className={cn(inputCls, 'mt-1', !categoriaId && 'border-[#ea504c]/50')}>
            <option value="">Elegí la categoría…</option>
            {/* Agrupadas como en Fudo: "Compras y proveedores › Verdulería" */}
            {[...new Set(categorias.map((c) => c.grupo ?? 'Otras'))]
              .sort((x, y) => (x === 'Otras' ? 1 : y === 'Otras' ? -1 : x.localeCompare(y)))
              .map((grupo) => (
                <optgroup key={grupo} label={grupo}>
                  {categorias.filter((c) => (c.grupo ?? 'Otras') === grupo).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
          </select>
        )}
      </label>

      <div>
        <span className="text-[12px] font-semibold text-[#3d2c24]">Comprobante</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {COMPROBANTES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setComprobante(c.key)}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-[12px] font-semibold',
                comprobante === c.key ? 'border-[#006d5a] bg-[#e8f5f1] text-[#006d5a]' : 'border-[#ebe6df] bg-white text-[#7d6c64]',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {comprobante !== 'sin_comprobante' && (
        <input value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={45} placeholder="Número (ej: 0001-00012345)" className={inputCls} />
      )}

      {comprobante === 'factura_a' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {([['IVA', iva, setIva], ['IIBB', iibb, setIibb]] as const).map(([label, value, setter]) => (
              <label key={label} className="block">
                <span className="text-[11px] font-semibold text-[#3d2c24]">{label}</span>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#a39e97]">$</span>
                  <input inputMode="decimal" value={value} onChange={(e) => setter(e.target.value)} placeholder="0" className={cn(inputCls, 'pl-7')} />
                </div>
              </label>
            ))}
          </div>
          <p className="text-[10.5px] text-[#a39e97]">IVA e IIBB quedan en Sala de Profes. En Fudo hay que volver a cargarlos (Fudo no deja recibirlos desde otra app).</p>
        </>
      )}
    </div>
  )
}
