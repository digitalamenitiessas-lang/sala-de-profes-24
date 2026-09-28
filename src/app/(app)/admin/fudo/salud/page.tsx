'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { formatDistanceToNowStrict } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { AlertTriangle, CheckCircle2, ChevronRight, UtensilsCrossed, ChevronDown, Link2Off, Loader2, RefreshCw, RotateCw, Trash2, Unplug, Wifi, WifiOff, Merge, Smartphone, PowerOff } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Salud de Fudo — ¿la app está enlazada con Fudo? ¿qué falta arreglar?
// ---------------------------------------------------------------------------

type Pendiente = { id: string; tipo: string; origen: string; delta: number | null; nota: string | null; intentos: number; ultimo_error: string | null; proximo_intento_at: string; created_at: string; stock_items: { name: string; unit: string } | null }
type Roto = { stock_item_id: string; nombre: string; unidad: string; stock: number; activo: boolean; fudo_id: string | null; recetas: number; sugerido: { id: string; nombre: string; unidad: string; stock: number; fudo_nombre: string; misma_unidad: boolean } | null; recomendado: 'unir' | 'solo_app' | 'desactivar' }
type SinControl = { stock_item_id: string; nombre: string; fudo_nombre: string | null; fudo_id: string | null; con_pendientes: boolean; movimientos_30d: number }
type Datos = {
  conexion: { estado: 'ok' | 'intermitente' | 'caido' | 'sin_datos'; ultimo_ok_at: string | null; ultimo_error: string | null; ultimo_error_at: string | null; ultimo_menu_at: string | null }
  ventas: { ultima_at: string | null; ok: boolean; error: string | null; tickets_hoy: number }
  stock: { ultima_at: string | null; ok: boolean }
  reintentos: { pendientes: Pendiente[]; hechos_7d: number; descartados_7d: { id: string; origen: string; ultimo_error: string | null; stock_items: { name: string } | null }[] }
  vinculos_rotos: Roto[]
  sin_control: SinControl[]
  fudo_sin_app: { fudo_id: string | null; nombre: string }[]
  otros: { code: string; etiqueta: string; cantidad: number; ejemplos: { titulo: string; detalle: string | null }[] }[]
  en_app_no_fudo: {
    carta_vieja: { id: string; nombre: string; creado: string; gemelo: string | null; receta_huerfana: boolean }[]
    insumos_sin_vinculo: InsumoLocal[]
    solo_app: InsumoLocal[]
  }
}
type InsumoLocal = { id: string; nombre: string; unidad: string; stock: number; recetas: number; movimientos_60d: number }

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'No se pudo cargar')
  return r.json()
}
const hace = (iso: string | null) => (iso ? `hace ${formatDistanceToNowStrict(new Date(iso), { locale: es })}` : 'nunca')
const ORIGEN: Record<string, string> = { produccion: 'Producción', recepcion: 'Recepción', merma: 'Merma', pago_gasto: 'Pago de gasto', anulacion_recibo: 'Anulación' }
const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 })

async function accion(body: Record<string, unknown>) {
  const r = await fetch('/api/fudo/salud', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(j?.error ?? 'No se pudo')
  return j
}

export default function SaludFudoPage() {
  const { data, error, isLoading, mutate } = useSWR<Datos>('/api/fudo/salud', fetcher, { refreshInterval: 60_000 })
  const [ocupado, setOcupado] = useState<string | null>(null)

  async function correr(clave: string, body: Record<string, unknown>, ok: (j: Record<string, unknown>) => string) {
    setOcupado(clave)
    try {
      const j = await accion(body)
      toast.success(ok(j))
      await mutate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo')
    } finally {
      setOcupado(null)
    }
  }

  if (isLoading && !data) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-[#a39e97]" /></div>
  if (error || !data) return <p className="py-20 text-center text-sm text-[#ea504c]">{error?.message ?? 'No se pudo cargar'}</p>

  const c = data.conexion
  const color = c.estado === 'ok' ? 'bg-[#e8f5f1] text-[#006d5a]' : c.estado === 'intermitente' ? 'bg-[#fdf6ec] text-[#b0762a]' : c.estado === 'sin_datos' ? 'bg-[#f3efe9] text-[#5c4a42]' : 'bg-[#fef2f2] text-[#ea504c]'
  const titulo = c.estado === 'ok' ? 'Conectada con Fudo' : c.estado === 'intermitente' ? 'Fudo responde con cortes' : c.estado === 'sin_datos' ? 'Todavía sin controles' : 'Fudo no responde'
  const sinControlAfecta = data.sin_control.filter((x) => x.con_pendientes || x.movimientos_30d > 0)
  const sinControlResto = data.sin_control.filter((x) => !x.con_pendientes && x.movimientos_30d === 0)
  const problemas = data.reintentos.pendientes.length + data.vinculos_rotos.length + sinControlAfecta.length

  return (
    <div className="space-y-4 px-1 pt-2">
      <div>
        <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-tight text-[#3d2c24]">Salud de Fudo</h1>
        <p className="section-label mt-1.5">Se revisa sola cada 10 minutos</p>
      </div>

      {/* Conexión */}
      <section className={cn('rounded-2xl p-4', color)}>
        <div className="flex items-center gap-3">
          {c.estado === 'ok' ? <Wifi className="size-6" /> : <WifiOff className="size-6" />}
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-bold">{titulo}</p>
            <p className="text-[12px] opacity-80">Última respuesta {hace(c.ultimo_ok_at)}{c.estado !== 'ok' && c.ultimo_error ? ` · ${c.ultimo_error}` : ''}</p>
          </div>
          <button onClick={() => void correr('probar', { accion: 'probar' }, (j) => (j.ok ? 'Fudo responde bien' : `Fudo no responde: ${j.error}`))} disabled={!!ocupado} className="flex items-center gap-1 rounded-lg bg-white/70 px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-60">
            {ocupado === 'probar' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Probar
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Dato label="Ventas" valor={hace(data.ventas.ultima_at)} extra={`${data.ventas.tickets_hoy} tickets hoy`} />
          <Dato label="Stock" valor={hace(data.stock.ultima_at)} extra="cada hora" />
          <Dato label="Menú y precios" valor={hace(c.ultimo_menu_at)} extra="1 vez por día" />
        </div>
      </section>

      {problemas === 0 && (
        <p className="flex items-center gap-2 rounded-2xl bg-white p-4 text-[13.5px] font-semibold text-[#006d5a] ring-1 ring-[#ebe6df]"><CheckCircle2 className="size-5" /> Nada pendiente: todo lo cargado llegó a Fudo.</p>
      )}

      {/* Cola de reintentos */}
      {(data.reintentos.pendientes.length > 0 || data.reintentos.hechos_7d > 0) && (
        <Seccion icono={<RotateCw className="size-4 text-[#d4943a]" />} titulo="Esperando para entrar a Fudo" subtitulo={`Se reintenta solo. En los últimos 7 días entraron solos ${data.reintentos.hechos_7d}.`}>
          {data.reintentos.pendientes.length === 0 && <p className="text-[12.5px] text-[#7d6c64]">No hay nada esperando.</p>}
          {data.reintentos.pendientes.map((p) => (
            <li key={p.id} className="rounded-xl bg-[#fcfbf9] p-3 ring-1 ring-[#f0ebe4]">
              <p className="text-[13.5px] font-semibold text-[#3d2c24]">
                {p.stock_items?.name ?? 'Pago de gasto'}{p.delta != null && <span className="font-normal text-[#7d6c64]"> · {p.delta > 0 ? '+' : ''}{num(Number(p.delta))} {p.stock_items?.unit}</span>}
              </p>
              <p className="text-[11.5px] text-[#7d6c64]">{ORIGEN[p.origen] ?? p.origen} {hace(p.created_at)} · {p.intentos} intento{p.intentos === 1 ? '' : 's'}</p>
              {p.ultimo_error && <p className="mt-1 text-[11.5px] text-[#b0762a]">{p.ultimo_error}</p>}
              <div className="mt-2 flex gap-2">
                <Boton onClick={() => void correr(p.id, { accion: 'reintentar', id: p.id }, (j) => (j.estado === 'hecho' ? '¡Entró a Fudo!' : `Todavía no entra: ${j.error ?? ''}`))} cargando={ocupado === p.id} disabled={!!ocupado}><RotateCw className="size-3.5" /> Reintentar ya</Boton>
                <Boton suave onClick={() => { if (confirm('¿Descartar? No se va a mandar a Fudo.')) void correr(p.id + 'd', { accion: 'descartar', id: p.id }, () => 'Descartado') }} cargando={ocupado === p.id + 'd'} disabled={!!ocupado}><Trash2 className="size-3.5" /> Descartar</Boton>
              </div>
            </li>
          ))}
        </Seccion>
      )}

      {/* Vínculos rotos */}
      {data.vinculos_rotos.length > 0 && (
        <Seccion icono={<Link2Off className="size-4 text-[#ea504c]" />} titulo={`Vínculos rotos (${data.vinculos_rotos.length})`} subtitulo="Fudo borró el ingrediente al que estaban vinculados: lo que se cuente o reciba de estos no llega a Fudo.">
          {data.vinculos_rotos.map((r) => (
            <li key={r.stock_item_id} className="rounded-xl bg-[#fcfbf9] p-3 ring-1 ring-[#f0ebe4]">
              <p className="text-[13.5px] font-semibold text-[#3d2c24]">{r.nombre} {!r.activo && <span className="text-[11px] font-normal text-[#a39e97]">(inactivo)</span>}</p>
              <p className="text-[11.5px] text-[#7d6c64]">
                Stock {num(r.stock)} {r.unidad} · era el #{r.fudo_id} en Fudo · {r.recetas > 0 ? `se usa en ${r.recetas} receta${r.recetas === 1 ? '' : 's'}` : 'no se usa en recetas'}
              </p>
              {r.sugerido && (
                <p className="mt-1 text-[11.5px] text-[#3d2c24]">
                  Parece el mismo que <b>{r.sugerido.nombre}</b> (en Fudo «{r.sugerido.fudo_nombre}», stock {num(r.sugerido.stock)} {r.sugerido.unidad}). Revisá antes de unir: el stock de «{r.nombre}» no se suma.
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {r.sugerido?.misma_unidad && (
                  <Boton destacado={r.recomendado === 'unir'} onClick={() => { if (confirm(`¿Unir «${r.nombre}» en «${r.sugerido!.nombre}»? Las recetas y proveedores pasan a «${r.sugerido!.nombre}» y «${r.nombre}» se desactiva.`)) void correr(r.stock_item_id + 'u', { accion: 'unir', duplicado: r.stock_item_id, bueno: r.sugerido!.id }, (j) => `Unido: ${j.recetas} receta(s) pasaron a ${j.bueno}`) }} cargando={ocupado === r.stock_item_id + 'u'} disabled={!!ocupado}>
                    <Merge className="size-3.5" /> Unir con {r.sugerido.nombre}
                  </Boton>
                )}
                <Boton destacado={r.recomendado === 'solo_app'} onClick={() => void correr(r.stock_item_id + 's', { accion: 'solo_app', stock_item_id: r.stock_item_id }, () => `${r.nombre}: queda solo en la app`)} cargando={ocupado === r.stock_item_id + 's'} disabled={!!ocupado}>
                  <Smartphone className="size-3.5" /> Dejar solo en la app
                </Boton>
                {r.recetas === 0 && (
                  <Boton destacado={r.recomendado === 'desactivar'} suave={r.recomendado !== 'desactivar'} onClick={() => void correr(r.stock_item_id + 'x', { accion: 'desactivar', stock_item_id: r.stock_item_id }, () => `${r.nombre} desactivado`)} cargando={ocupado === r.stock_item_id + 'x'} disabled={!!ocupado}>
                    <PowerOff className="size-3.5" /> Desactivar
                  </Boton>
                )}
              </div>
            </li>
          ))}
        </Seccion>
      )}

      {/* Control de stock apagado en Fudo */}
      {sinControlAfecta.length > 0 && (
        <Seccion icono={<Unplug className="size-4 text-[#d4943a]" />} titulo={`Control de stock apagado en Fudo (${sinControlAfecta.length})`} subtitulo="Tienen producción o recepciones, pero Fudo no les lleva stock, así que no se les puede sumar. Arreglo: en Fudo → Insumos → abrir el insumo → activar «Controlar stock». Si no hace falta en Fudo, dejalo solo en la app.">
          {sinControlAfecta.map((s) => <FilaSinControl key={s.stock_item_id} s={s} ocupado={ocupado} correr={correr} />)}
        </Seccion>
      )}
      {sinControlResto.length > 0 && (
        <Plegable titulo={`Otros ${sinControlResto.length} con control de stock apagado en Fudo`} ayuda="No tuvieron producción ni recepciones en 30 días: por ahora no fallan.">
          {sinControlResto.map((s) => <FilaSinControl key={s.stock_item_id} s={s} ocupado={ocupado} correr={correr} />)}
        </Plegable>
      )}

      <EnAppNoEnFudo d={data.en_app_no_fudo} ocupado={ocupado} correr={correr} />

      <PlatosSinVinculo />

      {/* Productos de Fudo con stock que la app no usa */}
      {data.fudo_sin_app.length > 0 && (
        <Plegable titulo={`Productos de Fudo con control de stock que la app no usa (${data.fudo_sin_app.length})`} ayuda="No rompen nada. Si no los contás, podés apagarles el control de stock en Fudo.">
          {data.fudo_sin_app.map((f) => <li key={String(f.fudo_id)} className="text-[12.5px] text-[#3d2c24]">{f.nombre} <span className="text-[#a39e97]">#{f.fudo_id}</span></li>)}
        </Plegable>
      )}

      {/* Otras diferencias */}
      {data.otros.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-[12px] font-semibold uppercase tracking-wide text-[#a39e97]">Otras diferencias (informativas)</p>
          {data.otros.map((o) => (
            <Plegable key={o.code} titulo={`${o.etiqueta} (${o.cantidad})`}>
              {o.ejemplos.map((e, i) => <li key={i} className="text-[12.5px] text-[#3d2c24]">{e.titulo}{e.detalle && <span className="text-[#7d6c64]"> — {e.detalle}</span>}</li>)}
              {o.cantidad > o.ejemplos.length && <li className="text-[12px] text-[#a39e97]">y {o.cantidad - o.ejemplos.length} más…</li>}
            </Plegable>
          ))}
        </div>
      )}

      {data.reintentos.descartados_7d.length > 0 && (
        <Plegable titulo={`Descartados en los últimos 7 días (${data.reintentos.descartados_7d.length})`} ayuda="No llegaron a Fudo: si hace falta, corregí el stock con un conteo.">
          {data.reintentos.descartados_7d.map((d) => <li key={d.id} className="text-[12.5px] text-[#3d2c24]">{d.stock_items?.name ?? ORIGEN[d.origen] ?? d.origen}<span className="text-[#7d6c64]"> — {d.ultimo_error}</span></li>)}
        </Plegable>
      )}
    </div>
  )
}

type Vinculos = { pendientes: { menu_item_id: string; name: string; units: number; pct_con_opciones: number }[]; opciones: unknown[]; resumen: { cobertura_pct: number | null } }

/** Platos vendidos que no descuentan stock (se resuelven en Ventas → Vincular). */
function PlatosSinVinculo() {
  const { data } = useSWR<Vinculos>('/api/ventas/vinculos', fetcher, { revalidateOnFocus: false })
  if (!data || (data.pendientes.length === 0 && data.opciones.length === 0)) return null
  const top = data.pendientes.slice(0, 4)
  return (
    <Link href="/ventas/vincular" className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-[#3d2c24]"><UtensilsCrossed className="size-4 text-[#d4943a]" /> Platos vendidos que no descuentan stock</h2>
      <p className="mt-0.5 text-[12px] leading-snug text-[#7d6c64]">
        {data.resumen.cobertura_pct != null && <>El {data.resumen.cobertura_pct}% de lo facturado ya descuenta stock. </>}
        Faltan {data.pendientes.length} plato{data.pendientes.length === 1 ? '' : 's'}{data.opciones.length > 0 && ` y ${data.opciones.length} opciones`}: decí qué consume cada uno.
      </p>
      <ul className="mt-2 space-y-1">
        {top.map((p) => (
          <li key={p.menu_item_id} className="flex items-center justify-between text-[12.5px] text-[#3d2c24]">
            <span className="truncate">{p.name}{p.pct_con_opciones >= 80 && <span className="text-[#7d6c64]"> · parece combo</span>}</span>
            <span className="shrink-0 tabular-nums text-[#7d6c64]">{num(p.units)} vendidos</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center gap-1 text-[12.5px] font-semibold text-[#d4943a]">Vincular ahora <ChevronRight className="size-3.5" /></p>
    </Link>
  )
}

type Correr = (clave: string, body: Record<string, unknown>, ok: (j: Record<string, unknown>) => string) => Promise<void>

/** Lo que está activo en la app y no existe en Fudo, separado por tipo. */
function EnAppNoEnFudo({ d, ocupado, correr }: { d: Datos['en_app_no_fudo']; ocupado: string | null; correr: Correr }) {
  const total = d.carta_vieja.length + d.insumos_sin_vinculo.length + d.solo_app.length
  if (total === 0) return null
  const conGemelo = d.carta_vieja.filter((p) => p.gemelo).length
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-[#3d2c24]"><Trash2 className="size-4 text-[#7d6c64]" /> En la app pero no en Fudo</h2>
      <p className="mt-0.5 text-[12px] leading-snug text-[#7d6c64]">Cosas activas en la app que Fudo no tiene. Desactivar no borra la historia y se puede revertir. Los platos que Fudo borre de ahora en más se desactivan solos cada día.</p>

      {d.carta_vieja.length > 0 && (
        <div className="mt-3 rounded-xl bg-[#fcfbf9] p-3 ring-1 ring-[#f0ebe4]">
          <p className="text-[13.5px] font-semibold text-[#3d2c24]">🍽️ Carta vieja cargada a mano ({d.carta_vieja.length} platos)</p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-[#7d6c64]">
            Se cargaron el {d.carta_vieja[0].creado.split('-').reverse().join('/')} antes de conectar Fudo. Las ventas no los usan (usan los platos de Fudo){conGemelo > 0 && <>; {conGemelo} tienen el mismo plato en Fudo</>}. Las recetas no se borran.
          </p>
          <Plegable titulo="Ver cuáles son">
            {d.carta_vieja.map((p) => (
              <li key={p.id} className="text-[12.5px] text-[#3d2c24]">
                {p.nombre}
                {p.gemelo && <span className="text-[#7d6c64]"> — en Fudo: {p.gemelo}</span>}
                {p.receta_huerfana && <span className="text-[#b0762a]"> — su receta no la usa ningún plato de Fudo (revisar nombre)</span>}
              </li>
            ))}
          </Plegable>
          <div className="mt-2">
            <Boton destacado onClick={() => { if (confirm(`¿Desactivar los ${d.carta_vieja.length} platos de la carta vieja? No están en Fudo y las ventas no los usan.`)) void correr('carta', { accion: 'desactivar_platos', ids: d.carta_vieja.map((p) => p.id) }, (j) => `${j.desactivados} platos desactivados`) }} cargando={ocupado === 'carta'} disabled={!!ocupado}>
              <PowerOff className="size-3.5" /> Desactivar los {d.carta_vieja.length}
            </Boton>
          </div>
        </div>
      )}

      {d.insumos_sin_vinculo.length > 0 && (
        <div className="mt-3 rounded-xl bg-[#fcfbf9] p-3 ring-1 ring-[#f0ebe4]">
          <p className="text-[13.5px] font-semibold text-[#3d2c24]">📦 Insumos sin vínculo a Fudo ({d.insumos_sin_vinculo.length})</p>
          <p className="mt-0.5 text-[11.5px] text-[#7d6c64]">No están en Fudo ni marcados como «solo app». Si no se usan, desactivalos.</p>
          <ul className="mt-2 space-y-1.5">
            {d.insumos_sin_vinculo.map((i) => <FilaInsumoLocal key={i.id} i={i} ocupado={ocupado} correr={correr} />)}
          </ul>
        </div>
      )}

      {d.solo_app.length > 0 && (
        <Plegable titulo={`Solo en la app a propósito (${d.solo_app.length})`} ayuda="Marcados para llevarse solo acá (descartables, etc.). Si alguno ya no se usa, desactivalo.">
          {d.solo_app.map((i) => <FilaInsumoLocal key={i.id} i={i} ocupado={ocupado} correr={correr} />)}
        </Plegable>
      )}
    </section>
  )
}

function FilaInsumoLocal({ i, ocupado, correr }: { i: InsumoLocal; ocupado: string | null; correr: Correr }) {
  const sinUso = i.recetas === 0 && i.movimientos_60d === 0
  return (
    <li className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-[#3d2c24]">{i.nombre}</p>
        <p className="text-[11px] text-[#7d6c64]">
          Stock {num(i.stock)} {i.unidad} · {i.recetas > 0 ? `en ${i.recetas} receta${i.recetas === 1 ? '' : 's'}` : 'sin recetas'} · {i.movimientos_60d > 0 ? `${i.movimientos_60d} movimientos en 60 días` : 'sin movimientos en 60 días'}
        </p>
      </div>
      {i.recetas === 0 && (
        <Boton destacado={sinUso} suave={!sinUso} onClick={() => void correr(i.id + 'x', { accion: 'desactivar', stock_item_id: i.id }, () => `${i.nombre} desactivado`)} cargando={ocupado === i.id + 'x'} disabled={!!ocupado}>
          <PowerOff className="size-3.5" /> Desactivar
        </Boton>
      )}
    </li>
  )
}

function FilaSinControl({ s, ocupado, correr }: { s: SinControl; ocupado: string | null; correr: (clave: string, body: Record<string, unknown>, ok: (j: Record<string, unknown>) => string) => Promise<void> }) {
  return (
    <li className={cn('flex items-center gap-3 rounded-xl p-3 ring-1', s.con_pendientes ? 'bg-[#fffaf3] ring-[#f1dfba]' : 'bg-[#fcfbf9] ring-[#f0ebe4]')}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[#3d2c24]">{s.nombre}</p>
        <p className="text-[11.5px] text-[#7d6c64]">
          En Fudo: {s.fudo_nombre ?? `#${s.fudo_id}`}
          {s.movimientos_30d > 0 && ` · ${s.movimientos_30d} movimiento${s.movimientos_30d === 1 ? '' : 's'} en 30 días`}
          {s.con_pendientes && <b className="text-[#b0762a]"> · tiene movimientos esperando</b>}
        </p>
      </div>
      <Boton suave onClick={() => void correr(s.stock_item_id + 's', { accion: 'solo_app', stock_item_id: s.stock_item_id }, () => `${s.nombre}: queda solo en la app`)} cargando={ocupado === s.stock_item_id + 's'} disabled={!!ocupado}><Smartphone className="size-3.5" /> Solo app</Boton>
    </li>
  )
}

function Dato({ label, valor, extra }: { label: string; valor: string; extra: string }) {
  return (
    <div className="rounded-xl bg-white/60 px-2 py-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-[12.5px] font-bold leading-tight">{valor}</p>
      <p className="text-[10.5px] opacity-70">{extra}</p>
    </div>
  )
}

function Seccion({ icono, titulo, subtitulo, children }: { icono: React.ReactNode; titulo: string; subtitulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-[#3d2c24]">{icono} {titulo}</h2>
      <p className="mt-0.5 text-[12px] leading-snug text-[#7d6c64]">{subtitulo}</p>
      <ul className="mt-3 space-y-2">{children}</ul>
    </section>
  )
}

function Plegable({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <section className="rounded-2xl bg-white px-4 py-3 ring-1 ring-[#ebe6df]">
      <button onClick={() => setAbierto((v) => !v)} className="flex w-full items-center justify-between gap-2 text-left text-[13px] font-semibold text-[#3d2c24]">
        <span className="flex items-center gap-2"><AlertTriangle className="size-3.5 shrink-0 text-[#a39e97]" /> {titulo}</span>
        <ChevronDown className={cn('size-4 shrink-0 transition', abierto && 'rotate-180')} />
      </button>
      {abierto && (
        <>
          {ayuda && <p className="mt-1.5 text-[11.5px] text-[#7d6c64]">{ayuda}</p>}
          <ul className="mt-2 space-y-1">{children}</ul>
        </>
      )}
    </section>
  )
}

function Boton({ children, onClick, cargando, disabled, destacado, suave }: { children: React.ReactNode; onClick: () => void; cargando?: boolean; disabled?: boolean; destacado?: boolean; suave?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={cn('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-50', destacado ? 'bg-[#3d2c24] text-white' : suave ? 'bg-transparent text-[#7d6c64] ring-1 ring-[#ebe6df]' : 'bg-[#f3efe9] text-[#3d2c24]')}>
      {cargando ? <Loader2 className="size-3.5 animate-spin" /> : null}
      {children}
    </button>
  )
}
