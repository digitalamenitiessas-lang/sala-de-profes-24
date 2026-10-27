'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarRange, Copy, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Resumen para pagar (martes): lo adeudado por proveedor en un rango de
// fechas de compra, con Excel (Resumen + Detalle por factura) y texto para
// copiar. Sale de los recibos de Sala de Profes, no de Fudo.
// ---------------------------------------------------------------------------

export type ReciboPagar = {
  id: number
  supplier_name: string
  received_date: string
  cost_total: number | null
  comprobante_numero?: string | null
}

type Rango = 'semana_pasada' | 'esta_semana' | 'todo' | 'elegir'

const hoyAR = () => new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
function sumarDias(fecha: string, n: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** Lunes de la semana de esa fecha */
function lunesDe(fecha: string): string {
  const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay() // 0 = domingo
  return sumarDias(fecha, -((dia + 6) % 7))
}
const fmtMoney = (n: number) => `$${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
const fmtFecha = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`

export function ResumenPagar({ recibos }: { recibos: ReciboPagar[] }) {
  const hoy = hoyAR()
  const [rango, setRango] = useState<Rango>('semana_pasada')
  const [desdeElegido, setDesdeElegido] = useState(sumarDias(lunesDe(hoy), -7))
  const [hastaElegido, setHastaElegido] = useState(hoy)

  const { desde, hasta } = useMemo(() => {
    const lunes = lunesDe(hoy)
    if (rango === 'semana_pasada') return { desde: sumarDias(lunes, -7), hasta: sumarDias(lunes, -1) }
    if (rango === 'esta_semana') return { desde: lunes, hasta: hoy }
    if (rango === 'elegir') return { desde: desdeElegido || null, hasta: hastaElegido || null }
    return { desde: null as string | null, hasta: null as string | null }
  }, [rango, hoy, desdeElegido, hastaElegido])

  const enRango = useMemo(() => recibos.filter((r) => (!desde || r.received_date >= desde) && (!hasta || r.received_date <= hasta)), [recibos, desde, hasta])
  const proveedores = useMemo(() => {
    const m = new Map<string, { total: number; recibos: number; sinPrecio: number; facturas: Set<string> }>()
    for (const r of enRango) {
      const p = m.get(r.supplier_name) ?? { total: 0, recibos: 0, sinPrecio: 0, facturas: new Set<string>() }
      p.recibos++
      const monto = Number(r.cost_total) || 0
      if (monto > 0) p.total += monto
      else p.sinPrecio++
      if (r.comprobante_numero) p.facturas.add(r.comprobante_numero)
      m.set(r.supplier_name, p)
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [enRango])
  const total = proveedores.reduce((a, [, p]) => a + p.total, 0)

  const etiqueta = desde || hasta
    ? `compras del ${desde ? fmtFecha(desde) : 'inicio'} al ${hasta ? fmtFecha(hasta) : 'hoy'}`
    : 'todo lo adeudado'

  async function copiar() {
    const lineas = proveedores.map(([nombre, p]) =>
      `• ${nombre}: ${fmtMoney(p.total)}${p.facturas.size ? ` (fact. ${[...p.facturas].join(', ')})` : ''}${p.sinPrecio ? ` + ${p.sinPrecio} sin precio` : ''}`)
    const texto = `Cuentas a pagar — ${etiqueta}\n\n${lineas.join('\n')}\n\nTotal: ${fmtMoney(total)}`
    try {
      await navigator.clipboard.writeText(texto)
      toast.success('Resumen copiado')
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  const params = new URLSearchParams()
  if (desde) params.set('desde', desde)
  if (hasta) params.set('hasta', hasta)

  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-[#ebe6df]">
      <div className="flex items-center gap-2">
        <CalendarRange className="size-4 text-[#8b5e34]" />
        <p className="flex-1 text-sm font-semibold text-[#3d2c24]">Resumen para pagar</p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {([['semana_pasada', 'Semana pasada'], ['esta_semana', 'Esta semana'], ['todo', 'Todo lo adeudado'], ['elegir', 'Elegir fechas']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setRango(k)} className={cn('rounded-full px-3 py-1 text-[11.5px] font-semibold ring-1', rango === k ? 'bg-[#3d2c24] text-white ring-[#3d2c24]' : 'bg-white text-[#3d2c24] ring-[#ebe6df]')}>
            {label}
          </button>
        ))}
      </div>
      {rango === 'elegir' && (
        <div className="mt-2 flex items-center gap-2 text-[11.5px] text-[#7d6c64]">
          Del <input type="date" value={desdeElegido} onChange={(e) => setDesdeElegido(e.target.value)} className="rounded-lg border border-[#ebe6df] px-2 py-1 text-[12px]" />
          al <input type="date" value={hastaElegido} onChange={(e) => setHastaElegido(e.target.value)} className="rounded-lg border border-[#ebe6df] px-2 py-1 text-[12px]" />
        </div>
      )}
      <p className="mt-2 text-[11px] text-[#a39e97]">Lo que sigue a pagar de las {etiqueta} (lun a dom).</p>

      {proveedores.length === 0 ? (
        <p className="mt-3 rounded-xl bg-[#faf8f5] px-3 py-3 text-center text-[12px] text-[#a39e97]">No hay nada a pagar en esas fechas</p>
      ) : (
        <ul className="mt-2 divide-y divide-[#f5f0ea] rounded-xl bg-[#faf8f5] px-3">
          {proveedores.map(([nombre, p]) => (
            <li key={nombre} className="flex items-center gap-2 py-2 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate text-[#3d2c24]">
                {nombre}
                <span className="ml-1 text-[10.5px] text-[#a39e97]">{p.recibos} recibo{p.recibos !== 1 ? 's' : ''}{p.sinPrecio ? ` · ${p.sinPrecio} sin precio` : ''}</span>
              </span>
              <span className="shrink-0 font-bold tabular-nums text-[#3d2c24]">{fmtMoney(p.total)}</span>
            </li>
          ))}
          <li className="flex items-center gap-2 py-2 text-[13px] font-bold">
            <span className="flex-1 text-[#3d2c24]">Total</span>
            <span className="tabular-nums text-[#d4943a]">{fmtMoney(total)}</span>
          </li>
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <a href={`/api/compras/cuentas-export?${params.toString()}`} className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-2 text-[12.5px] font-semibold text-white active:scale-[0.98]', proveedores.length === 0 && 'pointer-events-none opacity-40')}>
          <Download className="size-3.5" /> Descargar Excel
        </a>
        <button onClick={() => void copiar()} disabled={proveedores.length === 0} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#f3efe9] py-2 text-[12.5px] font-semibold text-[#3d2c24] active:scale-[0.98] disabled:opacity-40">
          <Copy className="size-3.5" /> Copiar resumen
        </button>
      </div>
    </div>
  )
}
