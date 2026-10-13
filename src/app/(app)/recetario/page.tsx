'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, BookOpen, ChevronRight, Info, Loader2, Search, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { canon, toStockUnitStrict } from '@/lib/recipes/recipe-cost'
import { avisoCantidad } from '@/lib/recipes/recetario-platos'

// ---------------------------------------------------------------------------
// Recetario de platos — qué lleva cada plato de la carta, por porción
// ---------------------------------------------------------------------------
// No es producción: es la ficha del plato (el sándwich lleva pan, 60 g de
// jamón, 2 fetas de queso…). Sirve para el costo y el margen, para las
// compras sugeridas y para que cocina lo arme siempre igual.
// Los ingredientes MANDAN EN FUDO (con esa receta Fudo descuenta el stock al
// vender): acá se ven y se marcan los errores para corregirlos en Fudo y
// volver a importar el Excel. Solo "Cómo se arma" se edita acá.
// ---------------------------------------------------------------------------

type Plato = {
  id: string; nombre: string; categoria: string; precio: number | null; ingredientes: number
  costo: number | null; costoCompleto: boolean; revisar: string[]; editadaEnApp: boolean; enFudo: boolean
  /** Se arma con opciones de Fudo (ej. el Clásico): no lleva receta fija */
  conOpciones: boolean
}
type Insumo = { id: string; nombre: string; unidad: string; costo: number | null; elaborado: boolean }
type Detalle = {
  plato: { id: string; nombre: string; precio: number | null }
  preparacion: string; editadaEnApp: string | null; editadaPor: string | null; desdeFudo: string | null
  ingredientes: { stock_item_id: string; nombre: string; unidadStock: string; qty: number; unidad: string; nota: string | null; elaborado: boolean; lleva: string | null }[]
  opciones: { nombre: string; min: number; max: number; opciones: { nombre: string; precioExtra: number; costo: number | null; conReceta: boolean }[] }[]
  insumos: Insumo[]; puedeEditar: boolean
}
type Filtro = 'todos' | 'sin_receta' | 'opciones' | 'revisar'

const money = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`
const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 })

export default function RecetarioPlatos() {
  const [platos, setPlatos] = useState<Plato[] | null>(null)
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [puedeImportar, setPuedeImportar] = useState(false)
  const [ultimaImportacion, setUltimaImportacion] = useState<string | null>(null)
  const [buscar, setBuscar] = useState('')
  const [categoria, setCategoria] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(() => fetch('/api/recetario', { cache: 'no-store' })
    .then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error ?? 'No se pudo cargar'); return }
      setPlatos(j.platos)
      setPuedeEditar(j.puedeEditar)
      setPuedeImportar(j.puedeImportar)
      setUltimaImportacion(j.ultimaImportacion)
    })
    .catch(() => setError('No se pudo cargar')), [])
  useEffect(() => { void cargar() }, [cargar])

  const categorias = useMemo(() => [...new Set((platos ?? []).map((p) => p.categoria))].sort((a, b) => a.localeCompare(b, 'es')), [platos])
  const cuenta = useMemo(() => {
    const l = platos ?? []
    return { todos: l.length, sin_receta: l.filter((p) => p.ingredientes === 0 && !p.conOpciones).length, opciones: l.filter((p) => p.conOpciones).length, revisar: l.filter((p) => p.revisar.length > 0).length }
  }, [platos])
  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return (platos ?? []).filter((p) =>
      (!q || p.nombre.toLowerCase().includes(q)) &&
      (!categoria || p.categoria === categoria) &&
      (filtro === 'todos' || (filtro === 'sin_receta' && p.ingredientes === 0 && !p.conOpciones) || (filtro === 'opciones' && p.conOpciones) || (filtro === 'revisar' && p.revisar.length > 0)))
  }, [platos, buscar, categoria, filtro])
  const porCategoria = useMemo(() => {
    const m = new Map<string, Plato[]>()
    for (const p of visibles) m.set(p.categoria, [...(m.get(p.categoria) ?? []), p])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'))
  }, [visibles])

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-28 pt-4">
      <div>
        <h1 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight text-[#3d2c24]"><BookOpen className="size-5 text-[#d4943a]" /> Recetario de platos</h1>
        <p className="text-[11.5px] text-[#a39e97]">Qué lleva cada plato por porción. Sirve para el costo, las compras y para que cocina lo arme siempre igual.</p>
      </div>

      <ImportacionFudo ultima={ultimaImportacion} puedeImportar={puedeImportar} />

      {error && <div className="rounded-2xl bg-[#fef2f2] p-4 text-[13px] text-[#ea504c]">{error}</div>}
      {!platos && !error && <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-2xl bg-[#f3efe9]" />)}</div>}

      {platos && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {([['todos', 'Todos'], ['sin_receta', 'Sin receta'], ['opciones', 'Con opciones'], ['revisar', '⚠ Para revisar']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setFiltro(k)} className={cn('rounded-full px-3 py-1 text-[11.5px] font-medium', filtro === k ? (k === 'revisar' ? 'bg-[#fef2f2] text-[#ea504c] ring-1 ring-[#ea504c]/30' : 'bg-[#e8f5f1] text-[#006d5a] ring-1 ring-[#006d5a]/30') : 'bg-white text-[#7d6c64] ring-1 ring-[#ebe6df]')}>
                {label} <span className="opacity-60">{cuenta[k]}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl bg-white px-3 py-2 ring-1 ring-[#ebe6df]">
              <Search className="size-4 text-[#a39e97]" />
              <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar plato (sándwich, milanesa…)" className="flex-1 bg-transparent text-[13px] outline-none" />
            </div>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="max-w-[40%] rounded-xl bg-white px-2 text-[12.5px] text-[#3d2c24] ring-1 ring-[#ebe6df]">
              <option value="">Todas</option>
              {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {porCategoria.length === 0 && <p className="py-8 text-center text-[13px] text-[#a39e97]">No hay platos con ese filtro.</p>}
          {porCategoria.map(([cat, items]) => (
            <section key={cat} className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
              <p className="border-b border-[#f5f0ea] bg-[#faf8f5] px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider text-[#7d6c64]">{cat} <span className="font-normal opacity-70">· {items.length}</span></p>
              <ul className="divide-y divide-[#f5f0ea]">
                {items.map((p) => {
                  const pct = p.costo && p.precio ? Math.round((100 * p.costo) / p.precio) : null
                  return (
                    <li key={p.id}>
                      <button onClick={() => setAbierto(p.id)} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left hover:bg-[#fcfbf9]">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold text-[#3d2c24]">{p.nombre}</p>
                          <p className="truncate text-[11px] text-[#a39e97]">
                            {p.ingredientes === 0
                              ? (p.conOpciones ? <span className="font-semibold text-[#4a90d9]">Se arma con opciones de Fudo</span> : <span className="font-semibold text-[#b0762a]">Sin receta</span>)
                              : <>{p.ingredientes} ingrediente{p.ingredientes !== 1 ? 's' : ''}{p.costo ? <> · costo {money(p.costo)}{!p.costoCompleto && '*'}{pct != null && <> · <b className={pct > 35 ? 'text-[#ea504c]' : 'text-[#006d5a]'}>{pct}%</b> del precio</>}</> : ''}</>}
                          </p>
                          {p.revisar.length > 0 && <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-[#ea504c]"><AlertTriangle className="size-3" /> Revisar: {p.revisar.slice(0, 3).join(', ')}</p>}
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-[#cfc8bf]" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          <p className="px-1 text-[11px] text-[#a39e97]">* Costo aproximado: algún insumo no tiene precio de compra cargado. · Las recetas de producción (milanesas, medallones…) están en Cocina → Elaborados. · <Link href="/recetas" className="underline">Recetas con preparación (anteriores)</Link></p>
        </>
      )}

      {abierto && <EditorPlato id={abierto} puedeEditar={puedeEditar} onClose={() => setAbierto(null)} onGuardado={() => { setAbierto(null); void cargar() }} />}
    </div>
  )
}

function ImportacionFudo({ ultima, puedeImportar }: { ultima: string | null; puedeImportar: boolean }) {
  const dias = ultima ? Math.floor((Date.parse(new Date().toISOString()) - Date.parse(ultima)) / 86_400_000) : null
  const vieja = dias == null || dias > 30
  return (
    <div className={cn('flex gap-2 rounded-xl px-3 py-2 text-[11.5px]', vieja ? 'bg-[#fdf6ec] text-[#8a5a1c]' : 'bg-[#eef4fc] text-[#2f5f9a]')}>
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <div className="flex-1">
        <p>
          Los ingredientes <b>se cambian en Fudo</b> (con esa receta Fudo descuenta el stock al vender). Si ves un error, corregilo en Fudo y volvé a importar el Excel.{' '}
          {ultima ? <>Última importación: <b>{new Date(ultima).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</b>{dias != null && ` (hace ${dias} día${dias !== 1 ? 's' : ''})`}.</> : <b>Nunca se importaron.</b>}
        </p>
        {puedeImportar && (
          <Link href="/admin/fudo/importar" className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-semibold text-[#3d2c24] ring-1 ring-[#ebe6df]">
            <Upload className="size-3" /> Importar recetas de Fudo
          </Link>
        )}
      </div>
    </div>
  )
}

function EditorPlato({ id, puedeEditar, onClose, onGuardado }: { id: string; puedeEditar: boolean; onClose: () => void; onGuardado: () => void }) {
  const [d, setD] = useState<Detalle | null>(null)
  const [prep, setPrep] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [cambio, setCambio] = useState(false)

  useEffect(() => {
    void fetch(`/api/recetario/${id}`, { cache: 'no-store' }).then(async (r) => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error(j.error ?? 'No se pudo abrir'); onClose(); return }
      setD(j)
      setPrep(j.preparacion ?? '')
    })
  }, [id, onClose])

  const insumoPorId = useMemo(() => new Map((d?.insumos ?? []).map((i) => [i.id, i])), [d])
  const lineas = d?.ingredientes ?? []
  const avisos = lineas.map((l) => avisoCantidad(l.qty, normalizarUnidad(l.unidad, l.unidadStock), l.unidadStock, l.nombre))
  const graves = avisos.filter((a) => a?.grave).length
  // Costo con el precio de cada insumo (las líneas con error de unidad no suman)
  const costo = lineas.reduce((s, l) => {
    const i = insumoPorId.get(l.stock_item_id)
    if (!i?.costo || !(l.qty > 0)) return s
    const c = canon(l.qty, normalizarUnidad(l.unidad, l.unidadStock))
    const enStock = toStockUnitStrict(c.qty, c.unit, i.unidad)
    return enStock == null ? s : s + enStock * Number(i.costo)
  }, 0)
  const pct = d?.plato.precio && costo > 0 ? Math.round((100 * costo) / d.plato.precio) : null

  async function guardar() {
    if (guardando) return
    setGuardando(true)
    try {
      const r = await fetch(`/api/recetario/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preparacion: prep }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'No se pudo guardar')
      toast.success('Guardado')
      onGuardado()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !guardando) onClose() }}>
      <DialogContent className="max-h-[92svh] overflow-y-auto">
        <DialogHeader><DialogTitle>{d?.plato.nombre ?? 'Cargando…'}</DialogTitle></DialogHeader>
        {!d ? <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-[#a39e97]" /></div> : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Dato titulo="Precio" valor={d.plato.precio ? money(d.plato.precio) : '—'} />
              <Dato titulo="Costo" valor={costo > 0 ? money(costo) : '—'} />
              <Dato titulo="Costo / precio" valor={pct != null ? `${pct}%` : '—'} tono={pct != null && pct > 35 ? 'rojo' : undefined} />
            </div>

            {graves > 0 && (
              <div className="rounded-xl bg-[#fef2f2] px-3 py-2 text-[12px] text-[#b3332f]">
                <b>{graves === 1 ? 'Hay 1 error' : `Hay ${graves} errores`} en esta receta.</b> Corregilos en <b>Fudo</b> (Productos → este plato → Receta) y después volvé a importar el Excel.
              </div>
            )}

            <div>
              <p className="mb-1 text-[12px] font-semibold text-[#3d2c24]">Lleva, por porción <span className="font-normal text-[#a39e97]">· según Fudo</span></p>
              <ul className="divide-y divide-[#f5f0ea] overflow-hidden rounded-xl ring-1 ring-[#ebe6df]">
                {lineas.length === 0 && d.opciones.length === 0 && <li className="bg-[#faf8f5] px-3 py-3 text-center text-[12px] text-[#a39e97]">Sin ingredientes. Cargá la receta en Fudo y volvé a importar.</li>}
                {lineas.length === 0 && d.opciones.length > 0 && <li className="bg-[#eef4fc] px-3 py-2.5 text-[12px] text-[#2f5f9a]">No tiene receta fija: se arma con las opciones de abajo y Fudo descuenta con la receta de cada opción elegida.</li>}
                {lineas.map((l, idx) => (
                  <li key={`${l.stock_item_id}-${idx}`} className={cn('px-3 py-2', avisos[idx]?.grave ? 'bg-[#fffafa]' : 'bg-white')}>
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-[13px] text-[#3d2c24]">
                        {l.nombre}{insumoPorId.get(l.stock_item_id)?.elaborado && <span className="ml-1 rounded bg-[#fdf6ec] px-1 text-[9.5px] font-bold text-[#b0762a]">ELABORADO</span>}
                      </p>
                      <p className="shrink-0 text-[13px] font-semibold tabular-nums text-[#3d2c24]">{fmt(l.qty)} {l.unidad}</p>
                    </div>
                    {l.elaborado && (
                      <p className="mt-0.5 text-[11px] text-[#7d6c64]">
                        {l.lleva ? <>↳ Cada uno lleva: {l.lleva}. </> : <>↳ Sin receta de producción. </>}
                        <Link href="/cocina/elaborados" className="font-semibold text-[#b0762a] underline">{l.lleva ? 'Se cambia en Elaborados' : 'Cargala en Elaborados'}</Link>
                      </p>
                    )}
                    {avisos[idx] && <p className={cn('mt-0.5 text-[11px] font-semibold', avisos[idx]!.grave ? 'text-[#ea504c]' : 'text-[#b0762a]')}>⚠ {avisos[idx]!.texto}</p>}
                  </li>
                ))}
              </ul>
            </div>

            {d.opciones.length > 0 && (
              <div>
                <p className="mb-1 text-[12px] font-semibold text-[#3d2c24]">Opciones <span className="font-normal text-[#a39e97]">· según Fudo</span></p>
                <div className="space-y-2">
                  {d.opciones.map((g, gi) => (
                    <div key={gi} className="rounded-xl bg-white px-3 py-2 ring-1 ring-[#ebe6df]">
                      <p className="text-[12px] font-semibold text-[#3d2c24]">{g.nombre} <span className="font-normal text-[#a39e97]">· elige {g.min === g.max ? g.min : `${g.min} a ${g.max}`}</span></p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {g.opciones.map((o, oi) => (
                          <span key={oi} className={cn('rounded-md px-1.5 py-0.5 text-[11px]', o.conReceta ? 'bg-[#e8f5f1] text-[#004d40]' : 'bg-[#fdf6ec] text-[#8a5a1c]')}>
                            {o.nombre}{o.costo != null && <b> {money(o.costo)}</b>}{!o.conReceta && ' · sin receta'}{o.precioExtra > 0 && ` (+${money(o.precioExtra)})`}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-[10.5px] text-[#a39e97]">En verde, las opciones con receta (con su costo). En naranja, las que no tienen: al venderlas no se descuenta nada.</p>
              </div>
            )}

            <label className="block">
              <span className="mb-1 block text-[12px] font-semibold text-[#3d2c24]">Cómo se arma</span>
              <textarea value={prep} disabled={!puedeEditar} onChange={(e) => { setPrep(e.target.value); setCambio(true) }} rows={4} placeholder="Ej.: pan tostado, mayonesa de un lado, jamón, queso, gratinar 2 min…" className="w-full rounded-xl border border-[#ebe6df] px-3 py-2 text-[13px] outline-none placeholder:text-[#c4bdb7] focus:border-[#d4943a] disabled:bg-[#faf8f5]" />
            </label>
            {puedeEditar ? (
              <button onClick={() => void guardar()} disabled={guardando || !cambio} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-3 text-[14px] font-bold text-white disabled:opacity-40">
                {guardando && <Loader2 className="size-4 animate-spin" />} Guardar cómo se arma
              </button>
            ) : d.preparacion ? null : <p className="text-center text-[11.5px] text-[#a39e97]">Todavía no se cargó cómo se arma.</p>}
            {d.editadaPor && <p className="text-center text-[10.5px] text-[#a39e97]">Última edición de &quot;Cómo se arma&quot;: {d.editadaPor}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Unidad guardada ('gramos', 'kg'…) → una de las del selector */
function normalizarUnidad(u: string | null, unidadStock: string): string {
  const x = (u ?? '').trim().toLowerCase()
  if (['g', 'gr', 'grs', 'gramos'].includes(x)) return 'g'
  if (['ml', 'cc'].includes(x)) return 'ml'
  if (['l', 'lt', 'litro', 'litros'].includes(x)) return 'l'
  if (['kg', 'kilo', 'kilos'].includes(x)) return 'kg'
  if (['u', 'un', 'unid', 'unidad', 'unidades'].includes(x)) return 'unidad'
  return unidadStock === 'kg' ? 'kg' : unidadStock === 'l' ? 'l' : 'unidad'
}

function Dato({ titulo, valor, tono }: { titulo: string; valor: string; tono?: 'rojo' }) {
  return (
    <div className="rounded-xl bg-[#faf8f5] px-2 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">{titulo}</p>
      <p className={cn('text-[15px] font-bold', tono === 'rojo' ? 'text-[#ea504c]' : 'text-[#3d2c24]')}>{valor}</p>
    </div>
  )
}
