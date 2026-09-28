'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Ban, CheckCheck, Layers, Loader2, Package, Search, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { isManagerOrAbove } from '@/lib/roles'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { AnimatePresence, motion } from '@/components/ui/motion'
import type { PlatoPendiente, VentasVinculosPayload } from '@/lib/ventas/vinculos-recetas'

// ---------------------------------------------------------------------------
// Platos sin receta — para que cada venta descuente lo que consume
// ---------------------------------------------------------------------------
// Lo que se llama igual que un plato del salón (versiones PedidosYa) o que un
// insumo con tamaño ("Leche Entera 190 ML") se vincula solo. Acá queda solo lo
// que necesita una persona. Cuando no queda nada, el aviso deja de mostrarse.
// ---------------------------------------------------------------------------

const money = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`
const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 })

function fold(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

type Accion =
  | { accion: 'receta'; recipe_id: string; label: string }
  | { accion: 'insumo'; stock_item_id: string; qty: number; label: string }
  | { accion: 'combo' }
  | { accion: 'sin_consumo' }

export default function PlatosSinRecetaPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const canManage = isManagerOrAbove(profile?.role)
  const [data, setData] = useState<VentasVinculosPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ventas/vinculos', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo cargar')
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (canManage) void load()
  }, [canManage, load])

  async function resolver(p: PlatoPendiente, a: Accion) {
    const snapshot = data
    // Optimista: sale de la lista al toque
    setData((d) => {
      if (!d) return d
      const pend = d.resumen.revenue_pendiente - p.revenue
      return {
        ...d,
        pendientes: d.pendientes.filter((x) => x.menu_item_id !== p.menu_item_id),
        opciones: d.opciones.filter((x) => x.menu_item_id !== p.menu_item_id),
        resumen: {
          ...d.resumen,
          revenue_pendiente: pend,
          cobertura_pct: d.resumen.revenue_total > 0 ? Math.round(1000 * (1 - pend / d.resumen.revenue_total)) / 10 : d.resumen.cobertura_pct,
        },
      }
    })
    try {
      const res = await fetch('/api/ventas/vinculos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menu_item_id: p.menu_item_id, ...a }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar')
      toast.success(
        a.accion === 'receta' ? `${p.name} → ${a.label}`
          : a.accion === 'insumo' ? `${p.name} → ${a.label}`
            : a.accion === 'combo' ? `${p.name}: se cuenta por lo elegido`
              : `${p.name}: no usa insumos`,
      )
    } catch (err) {
      setData(snapshot)
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar')
    }
  }

  if (profileLoading) return <Centered><Loader2 className="size-6 animate-spin text-[#006d5a]" /></Centered>
  if (!canManage) return <Centered><p className="text-sm text-[#3d2c24]">Solo para encargados y socios</p></Centered>

  const r = data?.resumen
  const pct = r?.cobertura_pct ?? 0
  const quedan = (data?.pendientes.length ?? 0) + (data?.opciones.length ?? 0)

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-28 pt-4">
      <div className="flex items-center gap-2">
        <Link href="/ventas" aria-label="Volver" className="-ml-1.5 rounded-full p-1.5 hover:bg-black/5">
          <ArrowLeft className="size-5 text-[#3d2c24]" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-semibold tracking-tight text-[#3d2c24]">Platos sin receta</h1>
          <p className="text-[11.5px] text-[#a39e97]">Para que cada venta descuente lo que consume</p>
        </div>
      </div>

      {error && !data && <div className="rounded-2xl bg-[#fef2f2] p-4 text-[13px] text-[#ea504c]">{error}</div>}

      {loading && !data ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-[#f3efe9]" />)}</div>
      ) : data && r && (
        <>
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
            <div className="flex items-baseline justify-between">
              <p className="text-[13px] font-semibold text-[#3d2c24]">Lo vendido que ya descuenta insumos</p>
              <p className="text-[20px] font-bold tabular-nums text-[#006d5a]">{pct.toLocaleString('es-AR')}%</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e8f5f1]">
              <div className="h-2 rounded-full bg-[#006d5a] transition-all duration-700" style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-[#7d6c64]">
              {data.pendientes.length > 0
                ? <>Faltan <b>{data.pendientes.length}</b> platos que vendieron <b>{money(r.revenue_pendiente)}</b> en {data.days} días.</>
                : 'Todos los platos vendidos descuentan sus insumos.'}
              {(r.auto_por_nombre + r.auto_por_insumo) > 0 && (
                <> La app ya resolvió sola {r.auto_por_nombre + r.auto_por_insumo} (versiones PedidosYa, leches por tamaño…).</>
              )}
            </p>
          </div>

          {quedan === 0 ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-[#ebe6df]">
              <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-[#e8f5f1]">
                <CheckCheck className="size-6 text-[#006d5a]" />
              </div>
              <p className="text-[15px] font-semibold text-[#3d2c24]">Todo vinculado</p>
              <p className="mt-1 text-[12.5px] text-[#a39e97]">Lo nuevo de Fudo se vincula solo cuando coincide el nombre.</p>
            </div>
          ) : (
            <>
              {data.pendientes.length > 0 && (
                <Seccion titulo={`Platos (${data.pendientes.length})`} ayuda="Ordenados por lo que vendieron. Tocá la receta o el insumo correcto.">
                  {data.pendientes.map((p) => <Tarjeta key={p.menu_item_id} p={p} data={data} onResolver={resolver} />)}
                </Seccion>
              )}
              {data.opciones.length > 0 && (
                <Seccion titulo={`Opciones dentro de los platos (${data.opciones.length})`} ayuda="Lo que se elige adentro de otro plato: leche, packaging, forma de cocción…">
                  {data.opciones.map((p) => <Tarjeta key={p.menu_item_id} p={p} data={data} onResolver={resolver} />)}
                </Seccion>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-[13px] font-bold text-[#3d2c24]">{titulo}</h2>
        <p className="text-[11.5px] text-[#a39e97]">{ayuda}</p>
      </div>
      <AnimatePresence initial={false}>{children}</AnimatePresence>
    </section>
  )
}

function Tarjeta({ p, data, onResolver }: { p: PlatoPendiente; data: VentasVinculosPayload; onResolver: (p: PlatoPendiente, a: Accion) => void }) {
  const [modo, setModo] = useState<null | 'receta' | 'insumo'>(null)
  const esCombo = p.tipo === 'plato' && p.pct_con_opciones >= 60

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
      className="rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-[#ebe6df]"
    >
      <p className="truncate text-[14px] font-semibold text-[#3d2c24]">{p.name}</p>
      <p className="text-[11px] text-[#a39e97]">
        {p.tipo === 'plato'
          ? <>{num(p.units)} vendidos · {money(p.revenue)}{p.pct_con_opciones > 0 && <> · {p.pct_con_opciones}% con opciones</>}</>
          : <>Elegido {num(p.units)} veces en {data.days} días</>}
      </p>

      {modo === null && (
        <>
          {esCombo && (
            <button
              onClick={() => onResolver(p, { accion: 'combo' })}
              className="mt-2.5 flex w-full items-center gap-2 rounded-xl bg-[#e8f5f1] px-3 py-2 text-left transition active:scale-[0.99]"
            >
              <Layers className="size-4 shrink-0 text-[#006d5a]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-[#006d5a]">¿Es un combo? Contar solo lo elegido</span>
                <span className="block text-[10.5px] leading-snug text-[#006d5a]/80">
                  Se vende con opciones el {p.pct_con_opciones}% de las veces. Elegilo si el plato no usa insumos propios
                  (ej. desayuno con infusión). Si se cocina algo, elegí su receta.
                </span>
              </span>
            </button>
          )}

          {(p.sugerencias.length > 0 || p.insumos_sugeridos.length > 0) && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {p.sugerencias.map((s) => (
                <Chip key={s.recipe_id} onClick={() => onResolver(p, { accion: 'receta', recipe_id: s.recipe_id, label: s.name })}>
                  <Sparkles className="size-3 text-[#006d5a]" /> {s.name}
                </Chip>
              ))}
              {p.insumos_sugeridos.map((s) => (
                <Chip
                  key={s.stock_item_id}
                  onClick={() => onResolver(p, { accion: 'insumo', stock_item_id: s.stock_item_id, qty: s.qty, label: `${num(s.qty)} ${s.unit} de ${s.name}` })}
                >
                  <Package className="size-3 text-[#d4943a]" /> {s.name} <span className="text-[#a39e97]">×{num(s.qty)} {s.unit}</span>
                </Chip>
              ))}
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap gap-2">
            {p.tipo === 'plato' && (
              <BotonLinea onClick={() => setModo('receta')}><Search className="size-3.5" /> Receta</BotonLinea>
            )}
            <BotonLinea onClick={() => setModo('insumo')}><Package className="size-3.5" /> Un insumo</BotonLinea>
            <button
              onClick={() => onResolver(p, { accion: 'sin_consumo' })}
              title="Servicio, forma de cocción o algo que no usa insumos del stock"
              className="flex items-center gap-1 rounded-xl px-3 py-2 text-[11.5px] font-medium text-[#a39e97] ring-1 ring-[#ebe6df] hover:bg-[#faf8f5]"
            >
              <Ban className="size-3.5" /> No usa insumos
            </button>
          </div>
        </>
      )}

      {modo === 'receta' && (
        <Buscador
          placeholder="Buscar receta…"
          items={data.recetas.map((r) => ({ id: r.id, name: r.name }))}
          onCancel={() => setModo(null)}
          onPick={(id, name) => onResolver(p, { accion: 'receta', recipe_id: id, label: name })}
        />
      )}
      {modo === 'insumo' && <ElegirInsumo p={p} data={data} onCancel={() => setModo(null)} onResolver={onResolver} />}
    </motion.div>
  )
}

function ElegirInsumo({ p, data, onCancel, onResolver }: { p: PlatoPendiente; data: VentasVinculosPayload; onCancel: () => void; onResolver: (p: PlatoPendiente, a: Accion) => void }) {
  const [elegido, setElegido] = useState<{ id: string; name: string; unit: string } | null>(null)
  const [qty, setQty] = useState('1')
  if (!elegido) {
    return (
      <Buscador
        placeholder="Buscar insumo…"
        items={data.insumos.map((i) => ({ id: i.id, name: i.name, hint: i.unit }))}
        onCancel={onCancel}
        onPick={(id) => setElegido(data.insumos.find((i) => i.id === id) ?? null)}
      />
    )
  }
  const n = Number(qty.replace(',', '.'))
  return (
    <div className="mt-2.5 rounded-xl border border-[#ebe6df] bg-[#faf8f5] p-3">
      <p className="text-[12px] text-[#7d6c64]">Cada vez que se vende o elige <b className="text-[#3d2c24]">{p.name}</b>, descuenta:</p>
      <div className="mt-2 flex items-center gap-2">
        <input
          autoFocus
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="w-20 rounded-lg border border-[#006d5a] bg-white px-2 py-1.5 text-center text-[14px] font-bold tabular-nums text-[#006d5a] outline-none"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] text-[#3d2c24]">{elegido.unit} de {elegido.name}</span>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-xl px-3 py-2 text-[12px] font-medium text-[#7d6c64] ring-1 ring-[#ebe6df]">Cancelar</button>
        <button
          disabled={!(n > 0)}
          onClick={() => onResolver(p, { accion: 'insumo', stock_item_id: elegido.id, qty: n, label: `${num(n)} ${elegido.unit} de ${elegido.name}` })}
          className="rounded-xl bg-[#006d5a] px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          Guardar
        </button>
      </div>
    </div>
  )
}

function Buscador({ items, placeholder, onPick, onCancel }: {
  items: { id: string; name: string; hint?: string }[]
  placeholder: string
  onPick: (id: string, name: string) => void
  onCancel: () => void
}) {
  const [q, setQ] = useState('')
  const lista = useMemo(() => {
    const n = fold(q.trim())
    return (n ? items.filter((r) => fold(r.name).includes(n)) : items).slice(0, 60)
  }, [q, items])
  return (
    <div className="mt-2.5 rounded-xl border border-[#ebe6df] bg-[#faf8f5] p-2">
      <div className="mb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#a39e97]" />
          <input
            autoFocus
            placeholder={placeholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-lg border border-[#ebe6df] bg-white py-2 pl-8 pr-2 text-[13px] text-[#3d2c24] outline-none focus:border-[#006d5a]"
          />
        </div>
        <button onClick={onCancel} aria-label="Cerrar" className="rounded-lg p-2 text-[#a39e97] hover:bg-white"><X className="size-4" /></button>
      </div>
      <div className="max-h-56 space-y-0.5 overflow-y-auto">
        {lista.map((r) => (
          <button key={r.id} onClick={() => onPick(r.id, r.name)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[#3d2c24] hover:bg-white">
            <span className="truncate">{r.name}</span>
            {r.hint && <span className="shrink-0 text-[11px] text-[#a39e97]">{r.hint}</span>}
          </button>
        ))}
        {lista.length === 0 && <p className="py-3 text-center text-[12px] text-[#a39e97]">Sin resultados</p>}
      </div>
    </div>
  )
}

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-full bg-[#faf8f5] px-2.5 py-1.5 text-[11.5px] font-medium text-[#3d2c24] ring-1 ring-[#ebe6df] transition hover:ring-[#006d5a]/40 active:scale-95"
    >
      {children}
    </button>
  )
}

function BotonLinea({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#d9d2c8] px-3 py-2 text-[12px] font-medium text-[#7d6c64] hover:bg-[#faf8f5]"
    >
      {children}
    </button>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60vh] flex-col items-center justify-center">{children}</div>
}
