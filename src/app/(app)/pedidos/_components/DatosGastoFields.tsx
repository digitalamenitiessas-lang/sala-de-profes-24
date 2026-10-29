'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COMPROBANTES, esFactura, esFacturaEnFudo, type CategoriaGasto, type ComprobanteTipo, type DatosGasto } from '@/lib/compras/datos-gasto'

// ---------------------------------------------------------------------------
// "Datos del gasto" en Llegó / Llegó todo: categoría (obligatoria: con eso se
// hace el análisis de fin de mes) y comprobante. Categoría, tipo y número van
// a Fudo. La Factura A no: la carga administración en Fudo con IVA, IIBB y
// total, y en la app queda solo que llegó (lib/compras/factura-en-fudo).
// ---------------------------------------------------------------------------

export function useDatosGasto(supplierId: string | null | undefined) {
  const [categorias, setCategorias] = useState<CategoriaGasto[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorFudo, setErrorFudo] = useState<string | null>(null)
  const [categoriaId, setCategoriaId] = useState('')
  const [comprobante, setComprobante] = useState<ComprobanteTipo>('sin_comprobante')
  const [numero, setNumero] = useState('')
  // Número de la última carga de HOY de este proveedor (misma factura)
  // Número de la última factura de hoy, con el proveedor al que pertenece: si
  // se cambia de proveedor no queda el de otro mientras llega la respuesta.
  const [anterior, setAnterior] = useState<{ supplierId: string | null; numero: string } | null>(null)
  const numeroAnterior = anterior && anterior.supplierId === (supplierId ?? null) ? anterior.numero : null

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
        // El número NO se precarga: con el mismo número la compra se suma al
        // gasto anterior en Fudo, y eso tiene que decidirlo una persona (botón
        // "Usar ese número" abajo del campo).
        setAnterior(typeof d.ultima?.numero === 'string' && d.ultima.numero ? { supplierId: supplierId ?? null, numero: d.ultima.numero } : null)
      })
      .catch(() => { if (alive) setErrorFudo('No se pudieron traer las categorías') })
      .finally(() => { if (alive) setCargando(false) })
    return () => { alive = false }
  }, [supplierId])

  const datos: DatosGasto = {
    categoriaId: categoriaId || null,
    categoriaNombre: categorias.find((c) => c.id === categoriaId)?.name ?? null,
    comprobante,
    numero: esFactura(comprobante) || comprobante === 'ticket' ? numero.trim() || null : null,
    iva: null,
    iibb: null,
  }
  // Factura A: la carga administración en Fudo; en la app no hay gasto
  const facturaEnFudo = esFacturaEnFudo(datos)
  // Obligatoria cuando hay de dónde elegir: si Fudo no responde no se traba
  // la recepción de la mercadería.
  const falta = cargando || (!facturaEnFudo && categorias.length > 0 && !categoriaId)

  return {
    datos, falta, facturaEnFudo,
    campos: { categorias, cargando, errorFudo, categoriaId, setCategoriaId, comprobante, setComprobante, numero, setNumero, numeroAnterior },
  }
}

const inputCls = 'w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-sm text-[#3d2c24] placeholder:text-[#c4bdb7] focus:border-[#006d5a] focus:outline-none'

export function DatosGastoFields({ campos }: { campos: ReturnType<typeof useDatosGasto>['campos'] }) {
  const { categorias, cargando, errorFudo, categoriaId, setCategoriaId, comprobante, setComprobante, numero, setNumero, numeroAnterior } = campos
  const facturaA = comprobante === 'factura_a'
  return (
    <div className="space-y-2.5 rounded-xl bg-[#faf8f5] p-3">
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
        <div className="space-y-1">
          <input value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={45} placeholder="Número (ej: 0001-00012345)" className={inputCls} />
          {/* Sumarse al gasto anterior en Fudo solo con un toque explícito */}
          {!facturaA && numeroAnterior && numero.trim() !== numeroAnterior && (
            <button
              type="button"
              onClick={() => setNumero(numeroAnterior)}
              className="block text-left text-[10.5px] font-semibold text-[#4a90d9] underline decoration-dotted underline-offset-2"
            >
              ¿Es la misma factura que la carga anterior (N° {numeroAnterior})? Usar ese número
            </button>
          )}
          {!facturaA && (
            <p className="text-[10.5px] text-[#a39e97]">
              {numeroAnterior && numero.trim() === numeroAnterior
                ? 'Es el mismo número que la carga anterior de hoy: se suma a ese gasto en Fudo. Si es otra factura, cambialo.'
                : 'Misma factura cargada producto por producto: poné el mismo número y queda un solo gasto en Fudo.'}
            </p>
          )}
        </div>
      )}

      {facturaA ? (
        <div className="rounded-lg bg-[#eef4fc] px-3 py-2 text-[11.5px] text-[#2f5d8a] ring-1 ring-[#cfdcf3]">
          <p className="font-semibold">La Factura A la carga administración en Fudo</p>
          <p className="mt-0.5">Con IVA, IIBB y el total. Acá queda solo lo que llegó: no se paga ni se crea el gasto desde la app. El stock entra cuando la factura esté en Fudo con los productos.</p>
        </div>
      ) : (
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
      )}
    </div>
  )
}
