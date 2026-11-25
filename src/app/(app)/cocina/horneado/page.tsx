'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Croissant, Loader2, Minus, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LoadingState } from '@/components/ui/LoadingState'
import { DIAS, MESES } from '@/lib/horneado/fechas'
import { ETIQUETA_TIPO, type ControlHorneado, type Pieza, type Recomendado, type Registro, type TipoRegistro } from '@/lib/horneado/config'
import { ControlHorneadoPanel } from '@/components/horneado/ControlHorneado'

// ---------------------------------------------------------------------------
// Horneado — medialunas, bollitos y tortillas (vienen congelados)
// ---------------------------------------------------------------------------
// Traído de Santa Fe (Marco, a39e324, 24/11/2026).
// Hoy: cuántas conviene hornear (lo que salió ese día de la semana en las
// últimas 4 semanas, según Fudo) y el registro del día: cada tanda que sale
// del horno y, al cierre, cuántas sobraron, cuántas fueron al budín de pan y
// cuántas se tiraron.
// Control (encargados y socios): eso cruzado con lo vendido en Fudo. En Santa
// Fe está en el control interno de Joaquín, que la 24 no tiene.
// ---------------------------------------------------------------------------

type PiezaHoy = { pieza: Pieza; nombre: string; singular: string; recomendado: Recomendado | null; sobroAyer: number | null }
type Datos = {
  hoy: string
  falta_migracion: boolean
  registros: Registro[]
  piezas: PiezaHoy[]
  nombres: Record<string, string>
  yo: string
  gestion: boolean
}

async function fetcher<T>(url: string): Promise<T> {
  const r = await fetch(url)
  const j = await r.json().catch(() => null)
  if (!r.ok || !j) throw new Error(j?.error ?? 'No se pudo cargar')
  return j as T
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })
const fechaLarga = (f: string) => { const d = new Date(`${f}T12:00:00Z`); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}` }

export default function HorneadoPage() {
  const { data, error, isLoading, mutate } = useSWR<Datos>('/api/horneado', fetcher, { refreshInterval: 60_000 })
  const [vista, setVista] = useState<'hoy' | 'control'>('hoy')
  const control = useSWR<ControlHorneado>(data?.gestion && vista === 'control' ? '/api/horneado?vista=control' : null, fetcher, { revalidateOnFocus: false })

  if (isLoading && !data) return <LoadingState />
  if (error && !data) return <p className="mx-auto max-w-lg rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] text-[#ea504c]">{(error as Error).message}</p>
  if (!data) return <LoadingState />

  async function enviar(body: Record<string, unknown>): Promise<boolean> {
    try {
      const r = await fetch('/api/horneado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => null)
      if (!r.ok) { toast.error(j?.error ?? 'No se pudo guardar'); return false }
      return true
    } catch {
      toast.error('Sin conexión: no se guardó')
      return false
    } finally {
      await mutate()
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-32">
      <div className="flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-[#d4943a]/10">
          <Croissant className="size-4 text-[#b0762a]" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-[#3d2c24]">Horneado</h1>
          <p className="text-[12px] text-[#7d6c64]">Medialunas, bollitos y tortillas · {fechaLarga(data.hoy)}</p>
        </div>
      </div>

      {data.gestion && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#f3efe9] p-1">
          {(['hoy', 'control'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              className={cn('rounded-lg py-2 text-[12.5px] font-semibold', vista === v ? 'bg-white text-[#3d2c24] shadow-sm' : 'text-[#7d6c64]')}
            >
              {v === 'hoy' ? 'Hoy' : 'Control'}
            </button>
          ))}
        </div>
      )}

      {data.falta_migracion && (
        <p className="rounded-xl bg-[#fef2f2] px-3 py-2.5 text-[12px] font-semibold text-[#ea504c]">Falta correr la migración del horneado (20261125_horneado.sql).</p>
      )}

      {vista === 'control' && data.gestion ? (
        <ControlHorneadoPanel datos={control.data} cargando={control.isLoading} error={control.error ? (control.error as Error).message : null} />
      ) : (
        <>
          <p className="rounded-xl bg-[#f3efe9] px-3 py-2 text-[11.5px] leading-snug text-[#7d6c64]">
            Cargá cada tanda cuando sale del horno. Al cierre, cuántas sobraron, cuántas fueron al budín de pan y cuántas se tiraron.
          </p>

          {data.piezas.map((p) => (
            <TarjetaPieza
              key={p.pieza}
              p={p}
              registros={data.registros.filter((r) => r.pieza === p.pieza)}
              nombres={data.nombres}
              yo={data.yo}
              gestion={data.gestion}
              enviar={enviar}
            />
          ))}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function TarjetaPieza({ p, registros, nombres, yo, gestion, enviar }: {
  p: PiezaHoy
  registros: Registro[]
  nombres: Record<string, string>
  yo: string
  gestion: boolean
  enviar: (b: Record<string, unknown>) => Promise<boolean>
}) {
  const [cargando, setCargando] = useState<TipoRegistro | null>(null)
  const horneadas = registros.filter((r) => r.tipo === 'tanda').reduce((a, r) => a + r.cantidad, 0)
  const rec = p.recomendado
  const deMas = rec ? horneadas - rec.total : 0
  const sobrante = registros.find((r) => r.tipo === 'sobrante')
  const esMedialuna = p.pieza === 'medialuna'

  return (
    <section className="space-y-3 rounded-2xl bg-white p-3.5 ring-1 ring-[#ebe6df]">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-[#3d2c24]">{p.nombre}</p>
          {rec ? (
            <p className="text-[12px] leading-snug text-[#7d6c64]">
              Conviene hornear hoy <b className="text-[#3d2c24]">{rec.total}</b>
              {esMedialuna && rec.total > 4
                ? <>: <b className="text-[#3d2c24]">{rec.manana}</b> a la mañana y <b className="text-[#3d2c24]">{rec.tarde}</b> a la tarde, solo si se acaban.</>
                : '. Si se acaban, hornear más al momento.'}
            </p>
          ) : (
            <p className="text-[12px] text-[#a39e97]">Todavía no hay ventas para calcular cuántas.</p>
          )}
          {p.sobroAyer != null && <p className="text-[11px] text-[#a39e97]">Ayer sobraron {p.sobroAyer}.</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('text-2xl font-bold tabular-nums', deMas > 0 ? 'text-[#b0762a]' : 'text-[#006d5a]')}>{horneadas}</p>
          <p className="text-[10.5px] text-[#a39e97]">horneadas hoy</p>
        </div>
      </div>

      {deMas > 0 && (
        <p className="rounded-lg bg-[#fdf6ec] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#9a6418]">Van {deMas} más de lo que suele salir un {p.recomendado ? 'día así' : 'día'}.</p>
      )}

      {cargando ? (
        <FormCantidad
          tipo={cargando}
          pieza={p}
          inicial={cargando === 'tanda' ? (rec ? Math.max(1, (horneadas === 0 && esMedialuna && rec.total > 4 ? rec.manana : rec.total - horneadas)) : 6) : (cargando === 'sobrante' ? sobrante?.cantidad ?? 0 : 1)}
          onCancelar={() => setCargando(null)}
          onGuardar={async (cantidad, nota) => {
            const ok = await enviar({ accion: 'agregar', pieza: p.pieza, tipo: cargando, cantidad, nota })
            if (ok) { toast.success(`${ETIQUETA_TIPO[cargando]}: ${cantidad}`); setCargando(null) }
          }}
        />
      ) : (
        <div className="space-y-2">
          <button type="button" onClick={() => setCargando('tanda')} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-3 text-[13.5px] font-bold text-white active:scale-[0.98]">
            <Plus className="size-4" /> Salió una tanda
          </button>
          <div className="grid grid-cols-3 gap-2">
            {(['sobrante', 'budin', 'tirado'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setCargando(t)} className="rounded-xl bg-[#f3efe9] px-2 py-2.5 text-[11.5px] font-semibold leading-tight text-[#3d2c24] active:scale-95">
                {t === 'sobrante' ? (sobrante ? `Sobraron: ${sobrante.cantidad}` : 'Sobraron al cierre') : ETIQUETA_TIPO[t]}
              </button>
            ))}
          </div>
        </div>
      )}

      {registros.length > 0 && (
        <ul className="space-y-1 border-t border-dashed border-[#ebe6df] pt-2">
          {registros.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-[12px] text-[#3d2c24]">
              <span className="w-11 shrink-0 tabular-nums text-[#a39e97]">{hora(r.created_at)}</span>
              <span className="min-w-0 flex-1 truncate">
                {ETIQUETA_TIPO[r.tipo]}: <b className="tabular-nums">{r.cantidad}</b>
                {r.created_by && nombres[r.created_by] ? <span className="text-[#a39e97]"> · {nombres[r.created_by]}</span> : null}
                {r.nota ? <span className="text-[#a39e97]"> · {r.nota}</span> : null}
              </span>
              {(gestion || r.created_by === yo) && (
                <button
                  type="button"
                  onClick={() => { if (window.confirm('¿Borrar este registro?')) void enviar({ accion: 'borrar', id: r.id }) }}
                  className="shrink-0 rounded-md p-1 text-[#a39e97] hover:bg-[#fef2f2] hover:text-[#ea504c]"
                  aria-label="Borrar registro"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function FormCantidad({ tipo, pieza, inicial, onCancelar, onGuardar }: {
  tipo: TipoRegistro
  pieza: PiezaHoy
  inicial: number
  onCancelar: () => void
  onGuardar: (cantidad: number, nota: string | null) => Promise<void>
}) {
  const [cantidad, setCantidad] = useState(Math.max(0, Math.round(inicial)))
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const minimo = tipo === 'sobrante' ? 0 : 1
  const pregunta = tipo === 'tanda' ? `¿Cuántas ${pieza.nombre.toLowerCase()} salieron del horno?`
    : tipo === 'sobrante' ? `¿Cuántas ${pieza.nombre.toLowerCase()} sobraron al cierre?`
      : tipo === 'budin' ? `¿Cuántas ${pieza.nombre.toLowerCase()} fueron al budín de pan?`
        : `¿Cuántas ${pieza.nombre.toLowerCase()} se tiraron?`

  return (
    <div className="space-y-2.5 rounded-xl bg-[#faf8f5] p-3">
      <p className="text-[12.5px] font-semibold text-[#3d2c24]">{pregunta}</p>
      <div className="flex items-center justify-center gap-3">
        <button type="button" onClick={() => setCantidad((c) => Math.max(minimo, c - 1))} className="flex size-11 items-center justify-center rounded-xl bg-white ring-1 ring-[#ebe6df] active:scale-95" aria-label="Una menos">
          <Minus className="size-4" />
        </button>
        <input
          value={cantidad}
          onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); setCantidad(Number.isFinite(n) ? Math.min(500, n) : 0) }}
          inputMode="numeric"
          className="w-20 rounded-xl border border-[#ebe6df] bg-white py-2.5 text-center text-2xl font-bold tabular-nums text-[#3d2c24] focus:border-[#006d5a] focus:outline-none"
          aria-label="Cantidad"
        />
        <button type="button" onClick={() => setCantidad((c) => Math.min(500, c + 1))} className="flex size-11 items-center justify-center rounded-xl bg-white ring-1 ring-[#ebe6df] active:scale-95" aria-label="Una más">
          <Plus className="size-4" />
        </button>
      </div>
      {tipo === 'tirado' && (
        <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={200} placeholder="Por qué (se quemaron, viejas…)" className="w-full rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[13px] focus:border-[#006d5a] focus:outline-none" />
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancelar} disabled={guardando} className="rounded-xl bg-white px-4 py-2.5 text-[13px] font-semibold text-[#7d6c64] ring-1 ring-[#ebe6df]">Cancelar</button>
        <button
          type="button"
          disabled={guardando || cantidad < minimo}
          onClick={async () => { setGuardando(true); await onGuardar(cantidad, nota.trim() || null); setGuardando(false) }}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-2.5 text-[13.5px] font-bold text-white disabled:opacity-50"
        >
          {guardando && <Loader2 className="size-4 animate-spin" />} Guardar
        </button>
      </div>
    </div>
  )
}
