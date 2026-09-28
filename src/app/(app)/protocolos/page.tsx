'use client'

import { useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { Camera, Check, ChevronDown, Clock, Loader2, Settings2, Sparkles, UserPlus, X, AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

// ---------------------------------------------------------------------------
// Protocolos con horario — hoy: limpieza del baño, 4 veces por día
// ---------------------------------------------------------------------------
// Cada horario es una tarea: el encargado la asigna a alguien del turno (o a
// sí mismo) y esa persona la cierra marcando todos los pasos + las fotos
// (baño: una general y otra de la basura).
// ---------------------------------------------------------------------------

type Visible = 'programada' | 'sin_asignar' | 'asignada' | 'atrasada' | 'hecha' | 'hecha_tarde'
type TareaUI = {
  id: string; fecha: string; hora: string; estado: 'pendiente' | 'asignada' | 'hecha'; visible: Visible
  asignado_a: string | null; asignado_nombre: string | null; hecho_nombre: string | null
  hecho_at: string | null; foto_url: string | null; fotos_urls?: string[]; nota: string | null
}
type ProtocoloUI = {
  id: string; nombre: string; descripcion: string | null; horarios: string[]; pasos: string[]; fotos: string[]; requiere_foto: boolean; activo: boolean
  tareas: TareaUI[]
  historial: { fecha: string; hechas: number; total: number; tareas: TareaUI[] }[]
}
type Persona = { id: string; nombre: string; role: string; presente: boolean }
type Datos = { hoy: string; protocolos: ProtocoloUI[]; personal: Persona[]; equipo: Persona[]; yo: { id: string; puede_asignar: boolean; puede_configurar: boolean } }

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'No se pudo cargar')
  return r.json()
}

const CHIP: Record<Visible, { txt: string; cls: string }> = {
  programada: { txt: 'Más tarde', cls: 'bg-[#f3efe9] text-[#7d6c64]' },
  sin_asignar: { txt: 'Sin asignar', cls: 'bg-[#fdf6ec] text-[#b0762a]' },
  asignada: { txt: 'Asignada', cls: 'bg-[#eef3fb] text-[#3b6ab5]' },
  atrasada: { txt: 'Atrasada', cls: 'bg-[#fef2f2] text-[#ea504c]' },
  hecha: { txt: 'Hecha', cls: 'bg-[#e8f5f1] text-[#006d5a]' },
  hecha_tarde: { txt: 'Hecha tarde', cls: 'bg-[#fdf6ec] text-[#b0762a]' },
}

const ROL: Record<string, string> = { socio: 'Socio', encargado: 'Encargado', chef: 'Chef', cocina: 'Cocina', barista: 'Barista', runner: 'Runner', bacha: 'Bacha' }
const hhmm = (iso: string) => format(new Date(iso), 'HH:mm')
const urlsDe = (t: TareaUI) => (t.fotos_urls?.length ? t.fotos_urls : t.foto_url ? [t.foto_url] : [])

/** Achica la foto en el celular antes de subirla (máx. 1600 px, JPEG). */
async function comprimir(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k)
    c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.8))
    return blob ?? file
  } catch {
    return file
  }
}

export default function ProtocolosPage() {
  const { data, error, isLoading, mutate } = useSWR<Datos>('/api/protocolos', fetcher, { refreshInterval: 60_000 })
  const [asignando, setAsignando] = useState<{ p: ProtocoloUI; t: TareaUI } | null>(null)
  const [completando, setCompletando] = useState<{ p: ProtocoloUI; t: TareaUI } | null>(null)
  const [configurando, setConfigurando] = useState<ProtocoloUI | null>(null)
  const [fotos, setFotos] = useState<string[] | null>(null)

  if (isLoading && !data) return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-[#a39e97]" /></div>
  if (error || !data) return <p className="py-20 text-center text-sm text-[#ea504c]">{error?.message ?? 'No se pudo cargar'}</p>

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-28">
      <div>
        <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-tight text-[#3d2c24]">Protocolos</h1>
        <p className="section-label mt-1.5">Se asignan, se hacen y se registran con fotos</p>
      </div>

      {data.protocolos.filter((p) => p.activo || data.yo.puede_configurar).map((p) => (
        <Protocolo
          key={p.id}
          p={p}
          yo={data.yo}
          onAsignar={(t) => setAsignando({ p, t })}
          onCompletar={(t) => setCompletando({ p, t })}
          onConfigurar={() => setConfigurando(p)}
          onFoto={setFotos}
        />
      ))}

      {asignando && (
        <AsignarDialog
          tarea={asignando.t}
          protocolo={asignando.p}
          personal={data.personal}
          equipo={data.equipo}
          yoId={data.yo.id}
          onClose={() => setAsignando(null)}
          onDone={() => { setAsignando(null); void mutate() }}
        />
      )}
      {completando && (
        <CompletarDialog
          tarea={completando.t}
          protocolo={completando.p}
          onClose={() => setCompletando(null)}
          onDone={() => { setCompletando(null); void mutate() }}
        />
      )}
      {configurando && (
        <ConfigDialog p={configurando} onClose={() => setConfigurando(null)} onDone={() => { setConfigurando(null); void mutate() }} />
      )}
      {fotos && (
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 overflow-y-auto bg-black/85 p-4" onClick={() => setFotos(null)}>
          {fotos.map((f) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={f} src={f} alt="Foto del protocolo" className={cn('max-w-full rounded-xl object-contain', fotos.length > 1 ? 'max-h-[44svh]' : 'max-h-full')} />
          ))}
          <button className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white" aria-label="Cerrar"><X className="size-5" /></button>
        </div>
      )}
    </div>
  )
}

function Protocolo({ p, yo, onAsignar, onCompletar, onConfigurar, onFoto }: {
  p: ProtocoloUI; yo: Datos['yo']
  onAsignar: (t: TareaUI) => void; onCompletar: (t: TareaUI) => void; onConfigurar: () => void; onFoto: (urls: string[]) => void
}) {
  const [verHistorial, setVerHistorial] = useState(false)
  const hechas = p.tareas.filter((t) => t.estado === 'hecha').length

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[17px] font-bold text-[#3d2c24]"><Sparkles className="size-4 text-[#d4943a]" /> {p.nombre}</h2>
          <p className="mt-0.5 text-[12px] text-[#7d6c64]">
            {p.activo ? <>Hoy: <b className={hechas === p.tareas.length ? 'text-[#006d5a]' : 'text-[#3d2c24]'}>{hechas} de {p.tareas.length}</b> hechas · {p.horarios.join(' · ')}</> : 'Desactivado'}
          </p>
        </div>
        {yo.puede_configurar && (
          <button onClick={onConfigurar} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-[#7d6c64] hover:bg-[#f3efe9]"><Settings2 className="size-3.5" /> Horarios</button>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {p.tareas.map((t) => {
          const chip = CHIP[t.visible]
          const mia = t.asignado_a === yo.id
          const hecha = t.estado === 'hecha'
          const puedeCompletar = !hecha && (mia || yo.puede_asignar) && t.visible !== 'programada'
          return (
            <li key={t.id} className={cn('rounded-xl p-3 ring-1', t.visible === 'atrasada' ? 'bg-[#fffafa] ring-[#f3d0cf]' : mia && !hecha ? 'bg-[#f7faff] ring-[#cfdcf3]' : 'bg-[#fcfbf9] ring-[#f0ebe4]')}>
              <div className="flex items-center gap-3">
                <div className="flex w-12 shrink-0 flex-col items-center">
                  <Clock className="size-3.5 text-[#a39e97]" />
                  <span className="text-[14px] font-bold tabular-nums text-[#3d2c24]">{t.hora}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', chip.cls)}>{chip.txt}</span>
                  <p className="mt-1 truncate text-[12.5px] text-[#5c4a42]">
                    {hecha
                      ? <>{t.hecho_nombre ?? 'Alguien'} · {t.hecho_at ? hhmm(t.hecho_at) : ''}</>
                      : t.asignado_nombre ? <>Le toca a <b>{mia ? 'vos' : t.asignado_nombre}</b></> : t.visible === 'programada' ? 'Todavía no es la hora' : 'Nadie asignado'}
                  </p>
                  {hecha && t.nota && <p className="mt-0.5 text-[11.5px] italic text-[#7d6c64]">“{t.nota}”</p>}
                </div>
                {hecha && urlsDe(t).length > 0 && (
                  <button onClick={() => onFoto(urlsDe(t))} className="flex shrink-0 gap-1" aria-label="Ver fotos">
                    {urlsDe(t).map((u) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={u} src={u} alt="" className="size-12 rounded-lg object-cover ring-1 ring-[#ebe6df]" />
                    ))}
                  </button>
                )}
                {hecha && urlsDe(t).length === 0 && <Check className="size-5 shrink-0 text-[#006d5a]" />}
              </div>
              {!hecha && (yo.puede_asignar || puedeCompletar) && (
                <div className="mt-2.5 flex gap-2">
                  {yo.puede_asignar && (
                    <button onClick={() => onAsignar(t)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#f3efe9] px-3 py-2 text-[12.5px] font-semibold text-[#3d2c24]">
                      <UserPlus className="size-3.5" /> {t.asignado_a ? 'Cambiar' : 'Asignar'}
                    </button>
                  )}
                  {puedeCompletar && (
                    <button onClick={() => onCompletar(t)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#3d2c24] px-3 py-2 text-[12.5px] font-semibold text-white">
                      <Camera className="size-3.5" /> {mia ? 'Terminé' : 'Registrar'}
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
        {p.activo && p.tareas.length === 0 && <li className="text-[12.5px] text-[#7d6c64]">No hay horarios cargados.</li>}
      </ul>

      {p.historial.length > 1 && (
        <div className="mt-3 border-t border-[#f0ebe4] pt-2">
          <button onClick={() => setVerHistorial((v) => !v)} className="flex w-full items-center justify-between py-1 text-[12.5px] font-semibold text-[#5c4a42]">
            Últimos 7 días <ChevronDown className={cn('size-4 transition', verHistorial && 'rotate-180')} />
          </button>
          {verHistorial && (
            <ul className="mt-1 space-y-1.5">
              {p.historial.slice(1).map((d) => (
                <li key={d.fecha} className="flex items-center gap-2 text-[12.5px]">
                  <span className="w-24 shrink-0 capitalize text-[#7d6c64]">{format(new Date(`${d.fecha}T12:00:00`), 'EEE d/M', { locale: es })}</span>
                  <span className={cn('w-14 shrink-0 font-bold tabular-nums', d.hechas === d.total ? 'text-[#006d5a]' : 'text-[#ea504c]')}>{d.hechas}/{d.total}</span>
                  <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
                    {d.tareas.map((t) => urlsDe(t).length > 0
                      ? <button key={t.id} onClick={() => onFoto(urlsDe(t))} className="relative shrink-0" aria-label={`Fotos ${t.hora}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={urlsDe(t)[0]} alt="" className="size-8 rounded object-cover" />
                          {urlsDe(t).length > 1 && <span className="absolute -right-1 -top-1 rounded-full bg-[#3d2c24] px-1 text-[9px] font-bold text-white">{urlsDe(t).length}</span>}
                        </button>
                      : <span key={t.id} title={t.hora} className="flex size-8 shrink-0 items-center justify-center rounded bg-[#fef2f2] text-[10px] font-semibold text-[#ea504c]">{t.hora}</span>)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function AsignarDialog({ tarea, protocolo, personal, equipo, yoId, onClose, onDone }: {
  tarea: TareaUI; protocolo: ProtocoloUI; personal: Persona[]; equipo: Persona[]; yoId: string; onClose: () => void; onDone: () => void
}) {
  const [enviando, setEnviando] = useState<string | null>(null)
  const [verTodos, setVerTodos] = useState(personal.length === 0)
  // Yo primero, después los presentes, después el resto con turno hoy
  const lista = useMemo(() => {
    const yo = personal.find((p) => p.id === yoId)
    return [...(yo ? [yo] : []), ...personal.filter((p) => p.id !== yoId)]
  }, [personal, yoId])

  async function asignar(p: Persona) {
    setEnviando(p.id)
    try {
      const r = await fetch(`/api/protocolos/tareas/${tarea.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'asignar', user_id: p.id }) })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw new Error(j?.error ?? 'No se pudo asignar')
      toast.success(p.id === yoId ? 'Te la asignaste' : `Asignada a ${p.nombre.split(' ')[0]}: le llega el aviso`)
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo asignar')
      setEnviando(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader><DialogTitle>{protocolo.nombre} · {tarea.hora}</DialogTitle></DialogHeader>
        <p className="-mt-2 text-[12.5px] text-[#7d6c64]">¿Quién lo hace? Arriba están los que están fichados ahora.</p>
        {personal.length === 0 && <p className="rounded-lg bg-[#fdf6ec] px-3 py-2 text-[12px] text-[#b0762a]">No hay nadie fichado ni con turno cargado hoy: elegí del equipo.</p>}
        <ul className="space-y-1.5">
          {[...lista, ...(verTodos ? equipo.filter((p) => p.id !== yoId) : [])].map((p) => (
            <li key={p.id}>
              <button disabled={!!enviando} onClick={() => void asignar(p)} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ring-1 ring-[#ebe6df] disabled:opacity-60', tarea.asignado_a === p.id ? 'bg-[#eef3fb]' : 'bg-white hover:bg-[#fcfbf9]')}>
                <span className={cn('size-2 shrink-0 rounded-full', p.presente ? 'bg-[#16a34a]' : 'bg-[#d6d0c8]')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-[#3d2c24]">{p.id === yoId ? `Yo (${p.nombre.split(' ')[0]})` : p.nombre}</span>
                  <span className="block text-[11.5px] text-[#7d6c64]">{ROL[p.role] ?? p.role} · {p.presente ? 'fichado ahora' : personal.some((x) => x.id === p.id) ? 'tiene turno hoy' : 'sin turno hoy'}</span>
                </span>
                {enviando === p.id ? <Loader2 className="size-4 animate-spin text-[#a39e97]" /> : tarea.asignado_a === p.id ? <Check className="size-4 text-[#3b6ab5]" /> : null}
              </button>
            </li>
          ))}
          {!verTodos && equipo.length > 0 && (
            <li>
              <button onClick={() => setVerTodos(true)} className="w-full py-2 text-center text-[12.5px] font-semibold text-[#7d6c64]">Ver resto del equipo ({equipo.length})</button>
            </li>
          )}
          {!lista.some((p) => p.id === yoId) && (
            <li>
              <button disabled={!!enviando} onClick={() => void asignar({ id: yoId, nombre: 'Yo', role: '', presente: false })} className="flex w-full items-center gap-3 rounded-xl bg-white px-3 py-2.5 text-left text-[13.5px] font-semibold text-[#3d2c24] ring-1 ring-[#ebe6df]">
                <UserPlus className="size-4 text-[#7d6c64]" /> Lo hago yo
              </button>
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

function CompletarDialog({ tarea, protocolo, onClose, onDone }: { tarea: TareaUI; protocolo: ProtocoloUI; onClose: () => void; onDone: () => void }) {
  const [ok, setOk] = useState<Set<string>>(new Set())
  const etiquetas = protocolo.requiere_foto ? (protocolo.fotos?.length ? protocolo.fotos : ['Foto']) : []
  const [fotos, setFotos] = useState<(Blob | null)[]>(() => etiquetas.map(() => null))
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)
  const todos = protocolo.pasos.every((p) => ok.has(p))
  const faltaFoto = etiquetas.find((_, i) => !fotos[i])
  const puede = todos && !faltaFoto && !enviando

  async function enviar() {
    setEnviando(true)
    try {
      const fd = new FormData()
      fd.set('accion', 'completar')
      fd.set('pasos', JSON.stringify(protocolo.pasos.filter((p) => ok.has(p))))
      fd.set('nota', nota)
      fotos.forEach((f, i) => { if (f) fd.set(`foto_${i}`, f, `foto-${i + 1}.jpg`) })
      const r = await fetch(`/api/protocolos/tareas/${tarea.id}`, { method: 'POST', body: fd })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw new Error(j?.error ?? 'No se pudo registrar')
      toast.success(etiquetas.length > 1 ? '¡Listo! Quedó registrado con las fotos' : '¡Listo! Quedó registrado')
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo registrar')
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !enviando) onClose() }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader><DialogTitle>{protocolo.nombre} · {tarea.hora}</DialogTitle></DialogHeader>
        <p className="-mt-2 text-[12.5px] text-[#7d6c64]">Marcá cada paso{etiquetas.length === 1 ? ' y sacá la foto' : etiquetas.length > 1 ? ` y sacá las ${etiquetas.length} fotos` : ''}. Sin todo completo no se puede cerrar.</p>

        <ul className="space-y-1.5">
          {protocolo.pasos.map((p) => {
            const marcado = ok.has(p)
            return (
              <li key={p}>
                <button
                  onClick={() => setOk((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n })}
                  className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] ring-1 transition', marcado ? 'bg-[#e8f5f1] text-[#004d40] ring-[#bfe3d9]' : 'bg-white text-[#3d2c24] ring-[#ebe6df]')}
                >
                  <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-md border', marcado ? 'border-[#006d5a] bg-[#006d5a] text-white' : 'border-[#d6d0c8]')}>{marcado && <Check className="size-3.5" />}</span>
                  {p}
                </button>
              </li>
            )
          })}
        </ul>

        {etiquetas.length > 0 && (
          <div className={cn('grid gap-2', etiquetas.length > 1 && 'grid-cols-2')}>
            {etiquetas.map((e, i) => (
              <FotoSlot key={e + i} etiqueta={e} onFoto={(b) => setFotos((x) => x.map((y, j) => (j === i ? b : y)))} />
            ))}
          </div>
        )}

        <textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={500} rows={2} placeholder="Algo para avisar (opcional): falta papel, pérdida en el inodoro…" className="w-full rounded-xl border border-[#ebe6df] px-3 py-2 text-[13px] outline-none focus:border-[#d4943a]" />

        <DialogFooter>
          <button onClick={() => void enviar()} disabled={!puede} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] py-3 text-[14px] font-bold text-white disabled:opacity-40">
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {!todos ? (protocolo.pasos.length - ok.size === 1 ? 'Falta 1 paso' : `Faltan ${protocolo.pasos.length - ok.size} pasos`) : faltaFoto ? `Falta: ${faltaFoto.split(' (')[0].toLowerCase()}` : 'Registrar'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Un espacio para sacar una foto: abre la cámara, la achica y muestra cómo quedó. */
function FotoSlot({ etiqueta, onFoto }: { etiqueta: string; onFoto: (b: Blob) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  async function elegir(f: File | undefined) {
    if (!f) return
    const b = await comprimir(f)
    onFoto(b)
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(b) })
  }
  return (
    <div>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void elegir(e.target.files?.[0])} />
      {preview ? (
        <button onClick={() => input.current?.click()} className="relative block w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={etiqueta} className="h-36 w-full rounded-xl object-cover" />
          <span className="absolute inset-x-1.5 bottom-1.5 rounded-lg bg-black/60 px-2 py-1 text-[11px] font-semibold text-white"><Check className="mr-1 inline size-3" />{etiqueta.split(' (')[0]} · cambiar</span>
        </button>
      ) : (
        <button onClick={() => input.current?.click()} className="flex h-36 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[#d6d0c8] px-2 text-center text-[12.5px] font-semibold leading-tight text-[#5c4a42]">
          <Camera className="size-6 text-[#a39e97]" /> {etiqueta}
        </button>
      )}
    </div>
  )
}

function ConfigDialog({ p, onClose, onDone }: { p: ProtocoloUI; onClose: () => void; onDone: () => void }) {
  const [horarios, setHorarios] = useState<string[]>(p.horarios)
  const [pasos, setPasos] = useState<string[]>(p.pasos)
  const [fotosCfg, setFotosCfg] = useState<string[]>(p.fotos?.length ? p.fotos : ['Foto general'])
  const [nuevaFoto, setNuevaFoto] = useState('')
  const [activo, setActivo] = useState(p.activo)
  const [nuevaHora, setNuevaHora] = useState('')
  const [nuevoPaso, setNuevoPaso] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setGuardando(true)
    try {
      const r = await fetch(`/api/protocolos/config/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ horarios, pasos, fotos: fotosCfg, activo }) })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw new Error(j?.error ?? 'No se pudo guardar')
      toast.success('Protocolo actualizado')
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar')
      setGuardando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !guardando) onClose() }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader><DialogTitle>{p.nombre}: horarios y pasos</DialogTitle></DialogHeader>

        <div>
          <p className="mb-1.5 text-[12.5px] font-semibold text-[#3d2c24]">Horarios del día</p>
          <div className="flex flex-wrap gap-1.5">
            {[...horarios].sort().map((h) => (
              <span key={h} className="flex items-center gap-1 rounded-full bg-[#f3efe9] py-1 pl-2.5 pr-1 text-[13px] font-semibold tabular-nums text-[#3d2c24]">
                {h}
                <button onClick={() => setHorarios((x) => x.filter((y) => y !== h))} className="rounded-full p-0.5 hover:bg-white" aria-label={`Quitar ${h}`}><X className="size-3" /></button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input type="time" value={nuevaHora} onChange={(e) => setNuevaHora(e.target.value)} className="flex-1 rounded-lg border border-[#ebe6df] px-2 py-1.5 text-[13px]" />
            <button disabled={!nuevaHora || horarios.includes(nuevaHora)} onClick={() => { setHorarios((x) => [...x, nuevaHora].sort()); setNuevaHora('') }} className="flex items-center gap-1 rounded-lg bg-[#3d2c24] px-3 text-[12.5px] font-semibold text-white disabled:opacity-40"><Plus className="size-3.5" /> Agregar</button>
          </div>
          <p className="mt-1 text-[11.5px] text-[#7d6c64]">A cada horario le llega el aviso al encargado de turno. Cambia desde hoy.</p>
        </div>

        <div>
          <p className="mb-1.5 text-[12.5px] font-semibold text-[#3d2c24]">Pasos (todos obligatorios)</p>
          <ul className="space-y-1">
            {pasos.map((s, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg bg-[#fcfbf9] px-2.5 py-1.5 text-[12.5px] ring-1 ring-[#f0ebe4]">
                <span className="flex-1">{s}</span>
                <button onClick={() => setPasos((x) => x.filter((_, j) => j !== i))} aria-label="Quitar paso"><Trash2 className="size-3.5 text-[#a39e97]" /></button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input value={nuevoPaso} onChange={(e) => setNuevoPaso(e.target.value)} maxLength={120} placeholder="Nuevo paso" className="flex-1 rounded-lg border border-[#ebe6df] px-2.5 py-1.5 text-[13px]" />
            <button disabled={!nuevoPaso.trim()} onClick={() => { setPasos((x) => [...x, nuevoPaso.trim()]); setNuevoPaso('') }} className="flex items-center gap-1 rounded-lg bg-[#3d2c24] px-3 text-[12.5px] font-semibold text-white disabled:opacity-40"><Plus className="size-3.5" /> Agregar</button>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[12.5px] font-semibold text-[#3d2c24]">Fotos que se piden (todas obligatorias)</p>
          <ul className="space-y-1">
            {fotosCfg.map((f, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg bg-[#fcfbf9] px-2.5 py-1.5 text-[12.5px] ring-1 ring-[#f0ebe4]">
                <Camera className="size-3.5 text-[#a39e97]" /><span className="flex-1">{f}</span>
                {fotosCfg.length > 1 && <button onClick={() => setFotosCfg((x) => x.filter((_, j) => j !== i))} aria-label="Quitar foto"><Trash2 className="size-3.5 text-[#a39e97]" /></button>}
              </li>
            ))}
          </ul>
          {fotosCfg.length < 4 && (
            <div className="mt-2 flex gap-2">
              <input value={nuevaFoto} onChange={(e) => setNuevaFoto(e.target.value)} maxLength={80} placeholder="Ej: Foto del lavamanos" className="flex-1 rounded-lg border border-[#ebe6df] px-2.5 py-1.5 text-[13px]" />
              <button disabled={!nuevaFoto.trim()} onClick={() => { setFotosCfg((x) => [...x, nuevaFoto.trim()]); setNuevaFoto('') }} className="flex items-center gap-1 rounded-lg bg-[#3d2c24] px-3 text-[12.5px] font-semibold text-white disabled:opacity-40"><Plus className="size-3.5" /> Agregar</button>
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-[13px] text-[#3d2c24]">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="size-4" /> Protocolo activo
        </label>
        {!activo && <p className="flex items-center gap-1.5 text-[12px] text-[#b0762a]"><AlertTriangle className="size-3.5" /> Desactivado no genera tareas ni avisos.</p>}

        <DialogFooter>
          <button onClick={() => void guardar()} disabled={guardando || horarios.length === 0 || pasos.length === 0} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#3d2c24] py-3 text-[14px] font-bold text-white disabled:opacity-40">
            {guardando && <Loader2 className="size-4 animate-spin" />} Guardar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
