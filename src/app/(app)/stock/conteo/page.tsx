'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Check, Loader2, AlertTriangle, ClipboardList, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { FadeIn } from '@/components/ui/motion'
import { LoadingState } from '@/components/ui/LoadingState'
import { STOCK_AREAS, areaFromLveCategory, suggestedCountEveryDays, isStockArea, type StockArea } from '@/lib/stock/areas'

// ---------------------------------------------------------------------------
// Conteo guiado — "qué me toca contar hoy" (o puesta a cero)
// ---------------------------------------------------------------------------
// Recorrido priorizado de conteo físico. Cada número confirmado se escribe en
// Fudo (Fudo primero, LVE después) vía POST /api/stock/sync physical_count.
//
//   modo=hoy  (default): lo que venció su frecuencia de conteo (intermedios y
//                        pastelería a diario, proteínas cada 3 días, barra
//                        semanal, descartables quincenal), negativos siempre.
//   modo=cero          : puesta a cero — intermedios y negativos primero,
//                        después todo lo vinculado a Fudo.
// ?area=cocina|pasteleria|barra|descartables|limpieza filtra el recorrido.
// ---------------------------------------------------------------------------

type Item = {
  id: string
  name: string
  unit: string
  current_qty: number
  min_qty: number
  category: string
  is_produced: boolean
  fudo_ingredient_id: string | null
  fudo_product_id: string | null
  fudo_skip: boolean | null
  last_counted_at: string | null
  area: StockArea | null
  fudo_category: string | null
}

type Bucket = 'negativo' | 'intermedio' | 'critico' | 'vencido' | 'otro'

const BUCKET_META: Record<Bucket, { label: string; hint: string; tone: string }> = {
  negativo: { label: 'En negativo', hint: 'Fudo descontó ventas sin entradas cargadas: contá y corregí', tone: '#ea504c' },
  intermedio: { label: 'Producidos en cocina', hint: 'Milanesa cruda, bondiola, masas… se cuentan a diario', tone: '#006d5a' },
  critico: { label: 'Bajo mínimo', hint: 'Confirmá cuánto hay antes de pedir', tone: '#d4943a' },
  vencido: { label: 'Toca contar', hint: 'Venció la frecuencia de conteo de estos insumos', tone: '#8b7355' },
  otro: { label: 'Resto vinculado a Fudo', hint: 'Contá si querés dejarlos exactos', tone: '#a39e97' },
}

const DEFAULT_CERO_NOTE = 'Puesta a cero — conteo inicial'

function areaOf(i: Item): StockArea { return isStockArea(i.area) ? i.area : areaFromLveCategory(i.category) }
function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}
function needsNote(current: number, next: number, unit: string) {
  const abs = Math.abs(next - current)
  const pct = current > 0 ? abs / current : abs > 0 ? 1 : 0
  const threshold = unit.toLowerCase().includes('kg') ? Math.max(0.5, current * 0.12) : Math.max(2, current * 0.15)
  return abs >= threshold || pct >= 0.25
}

export default function ConteoPage() {
  return (
    <Suspense fallback={<LoadingState message="Preparando el conteo..." />}>
      <ConteoContent />
    </Suspense>
  )
}

function ConteoContent() {
  const router = useRouter()
  const params = useSearchParams()
  const modo = params.get('modo') === 'cero' ? 'cero' : 'hoy'
  const areaParam = params.get('area')
  const [area, setArea] = useState<StockArea | 'all'>(isStockArea(areaParam) ? areaParam : 'all')
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [done, setDone] = useState<Record<string, number>>({})

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/stock/items?preset=conteo')
        if (!res.ok) throw new Error('No se pudo cargar el stock')
        const data = await res.json()
        setItems((data.items ?? []).map((i: Record<string, unknown>) => ({
          id: String(i.id),
          name: String(i.name),
          unit: String(i.unit),
          current_qty: Number(i.current_qty ?? 0),
          min_qty: Number(i.min_qty ?? 0),
          category: String(i.category ?? 'otros'),
          is_produced: Boolean(i.is_produced),
          fudo_ingredient_id: i.fudo_ingredient_id == null ? null : String(i.fudo_ingredient_id),
          fudo_product_id: i.fudo_product_id == null ? null : String(i.fudo_product_id),
          fudo_skip: i.fudo_skip == null ? null : Boolean(i.fudo_skip),
          last_counted_at: i.last_counted_at == null ? null : String(i.last_counted_at),
          area: isStockArea(i.area) ? i.area : null,
          fudo_category: i.fudo_category == null ? null : String(i.fudo_category),
        })))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al cargar')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const selectArea = (value: StockArea | 'all') => {
    setArea(value)
    const p = new URLSearchParams(params.toString())
    if (value === 'all') p.delete('area')
    else p.set('area', value)
    router.replace(`/stock/conteo${p.toString() ? `?${p}` : ''}`, { scroll: false })
  }

  // Solo lo que se puede escribir (vínculo Fudo o local explícito)
  const countable = useMemo(
    () => items.filter((i) => (i.fudo_ingredient_id || i.fudo_product_id || i.fudo_skip) && (area === 'all' || areaOf(i) === area)),
    [items, area],
  )

  const bucketOf = (i: Item): Bucket => {
    if (i.current_qty < 0) return 'negativo'
    if (i.is_produced) return 'intermedio'
    if (i.min_qty > 0 && i.current_qty <= i.min_qty) return 'critico'
    const d = daysSince(i.last_counted_at)
    if (d === null || d >= suggestedCountEveryDays(i)) return 'vencido'
    return 'otro'
  }

  const plan = useMemo(() => {
    const order: Record<Bucket, number> = { negativo: 0, intermedio: 1, critico: 2, vencido: 3, otro: 4 }
    const scoped = countable.filter((i) => {
      // Lo ya contado en esta pasada se queda a la vista: al guardarlo cambia
      // de bucket (queda "al día") y si no, desaparecía de la lista y la barra
      // de progreso retrocedía.
      if (done[i.id] !== undefined) return true
      if (showAll) return true
      const b = bucketOf(i)
      if (modo === 'cero') return b === 'negativo' || b === 'intermedio'
      return b !== 'otro'
    })
    return [...scoped].sort((a, b) => {
      const ba = bucketOf(a), bb = bucketOf(b)
      if (order[ba] !== order[bb]) return order[ba] - order[bb]
      if (ba === 'negativo') return a.current_qty - b.current_qty
      const da = daysSince(a.last_counted_at) ?? 9999, db = daysSince(b.last_counted_at) ?? 9999
      return db - da || a.name.localeCompare(b.name)
    })
  }, [countable, showAll, modo, done])

  const grouped = useMemo(() => {
    const g: Record<Bucket, Item[]> = { negativo: [], intermedio: [], critico: [], vencido: [], otro: [] }
    for (const it of plan) g[bucketOf(it)].push(it)
    return g
  }, [plan])

  const total = plan.length
  const counted = plan.filter((i) => done[i.id] !== undefined).length
  const pct = total > 0 ? Math.round((counted / total) * 100) : 0

  async function saveCount(item: Item) {
    const raw = inputs[item.id]
    if (raw == null || raw.trim() === '') { toast.error('Ingresá la cantidad contada'); return }
    const newQty = parseFloat(raw.replace(',', '.'))
    if (isNaN(newQty) || newQty < 0) { toast.error('Cantidad inválida'); return }
    const noteGiven = notes[item.id]?.trim() || ''
    const bigDiff = needsNote(item.current_qty, newQty, item.unit)
    if (bigDiff && !noteGiven && modo !== 'cero') {
      toast.error('La diferencia es grande: dejá una nota corta (para auditoría)')
      setNotes((p) => ({ ...p, [item.id]: p[item.id] ?? '' }))
      return
    }
    setSavingId(item.id)
    try {
      const note = noteGiven || (modo === 'cero' ? DEFAULT_CERO_NOTE : undefined)
      const res = await fetch('/api/stock/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockItemId: item.id, newQty, reason: 'physical_count', note }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error ?? 'No se pudo guardar')
      setDone((prev) => ({ ...prev, [item.id]: newQty }))
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, current_qty: newQty, last_counted_at: new Date().toISOString() } : i)))
      toast.success(`${item.name}: ${newQty} ${item.unit}${data.fudoSynced ? ' → Fudo ✓' : ''}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSavingId(null)
    }
  }

  const title = modo === 'cero' ? 'Puesta a cero' : 'Conteo de hoy'
  const TitleIcon = modo === 'cero' ? RotateCcw : ClipboardList

  return (
    <div className="mx-auto max-w-2xl px-4 pb-28 pt-4">
      <div className="mb-3 flex items-center gap-3">
        <Link href={`/stock${area !== 'all' ? `?area=${area}` : ''}`} className="rounded-full p-1.5 hover:bg-black/5">
          <ArrowLeft className="size-5 text-[#3d2c24]" />
        </Link>
        <div className="flex items-center gap-2">
          <TitleIcon className="size-5 text-[#006d5a]" />
          <h1 className="font-display text-xl font-bold text-[#3d2c24]">{title}</h1>
        </div>
      </div>

      <p className="mb-3 text-[13px] leading-relaxed text-[#7d6c64]">
        {modo === 'cero'
          ? 'Contá lo que hay físicamente: el número real se escribe en Fudo y borra los negativos. Empezá por lo producido y lo negativo.'
          : 'Lo que toca contar según su frecuencia: producidos y dulces a diario, proteínas cada 3 días, barra semanal. Cada número confirmado va a Fudo.'}
      </p>

      {/* Áreas */}
      <div className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-0.5 scrollbar-none">
        {[{ value: 'all' as const, label: 'Todo', icon: '🏠' }, ...STOCK_AREAS.filter((a) => a.value !== 'otros')].map((a) => (
          <button
            key={a.value}
            onClick={() => selectArea(a.value)}
            className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold ring-1 transition-all ${area === a.value ? 'bg-[#3d2c24] text-white ring-[#3d2c24]' : 'bg-white text-[#3d2c24] ring-[#ebe6df]'}`}
          >
            <span>{a.icon}</span>{a.label}
          </button>
        ))}
      </div>

      {!loading && total > 0 && (
        <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#ebe6df]">
          <div className="mb-2 flex items-center justify-between text-[13px]">
            <span className="font-semibold text-[#3d2c24]">{counted} de {total} contados</span>
            <span className="text-[#7d6c64]">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-[#f5f2ee]">
            <div className="h-2 rounded-full bg-[#006d5a] transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {loading ? (
        <LoadingState message="Preparando el recorrido..." />
      ) : total === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-[#ebe6df]">
          <Check className="mx-auto mb-2 size-8 text-[#006d5a]" />
          <p className="text-[14px] text-[#3d2c24]">Nada pendiente de contar {area !== 'all' ? 'en esta área' : ''}. Todo al día.</p>
          <button onClick={() => setShowAll(true)} className="mt-3 text-[12px] font-semibold text-[#006d5a]">Ver todo igual</button>
        </div>
      ) : (
        <FadeIn>
          <div className="space-y-6">
            {(Object.keys(BUCKET_META) as Bucket[]).map((bucket) => {
              const list = grouped[bucket]
              if (list.length === 0) return null
              const meta = BUCKET_META[bucket]
              return (
                <div key={bucket}>
                  <div className="mb-1 flex items-center gap-2">
                    <h2 className="text-[12px] font-bold uppercase tracking-wider" style={{ color: meta.tone }}>
                      {meta.label} <span className="text-[#a39e97]">({list.length})</span>
                    </h2>
                  </div>
                  <p className="mb-2 text-[11px] text-[#a39e97]">{meta.hint}</p>
                  <div className="space-y-2">
                    {list.map((item) => {
                      const isDone = done[item.id] !== undefined
                      const saving = savingId === item.id
                      const neg = item.current_qty < 0
                      const since = daysSince(item.last_counted_at)
                      const raw = inputs[item.id]
                      const parsed = raw != null && raw.trim() !== '' ? parseFloat(raw.replace(',', '.')) : null
                      const bigDiff = parsed !== null && !isNaN(parsed) && needsNote(item.current_qty, parsed, item.unit)
                      const showNote = notes[item.id] !== undefined || (bigDiff && modo !== 'cero')
                      return (
                        <div key={item.id} className={`rounded-2xl bg-white p-3.5 shadow-sm ring-1 transition-colors ${isDone ? 'ring-[#006d5a]/40' : 'ring-[#ebe6df]'}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[14px] font-semibold text-[#3d2c24]">{item.name}</p>
                              <p className="mt-0.5 text-[11px] text-[#7d6c64]">
                                En sistema: <span className={neg ? 'font-bold text-[#ea504c]' : 'font-semibold'}>{item.current_qty} {item.unit}</span>
                                {item.min_qty > 0 && <span className="text-[#a39e97]"> · mín {item.min_qty}</span>}
                                <span className="text-[#a39e97]"> · {since === null ? 'nunca contado' : since === 0 ? 'contado hoy' : `hace ${since}d`}</span>
                              </p>
                            </div>
                            {isDone ? (
                              <div className="flex shrink-0 items-center gap-1.5 text-[13px] font-semibold text-[#006d5a]">
                                <Check className="size-4" /> {done[item.id]} {item.unit}
                              </div>
                            ) : (
                              <div className="flex shrink-0 items-center gap-2">
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  placeholder="real"
                                  value={raw ?? ''}
                                  onChange={(e) => setInputs((p) => ({ ...p, [item.id]: e.target.value }))}
                                  onKeyDown={(e) => { if (e.key === 'Enter') void saveCount(item) }}
                                  className="w-20 rounded-xl border border-[#ebe6df] px-2.5 py-2 text-right text-[14px] font-semibold text-[#3d2c24] outline-none focus:border-[#006d5a]"
                                />
                                <button
                                  onClick={() => void saveCount(item)}
                                  disabled={saving}
                                  className="flex size-9 items-center justify-center rounded-xl bg-[#006d5a] text-white disabled:opacity-50"
                                >
                                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                                </button>
                              </div>
                            )}
                          </div>
                          {!isDone && showNote && (
                            <input
                              value={notes[item.id] ?? ''}
                              onChange={(e) => setNotes((p) => ({ ...p, [item.id]: e.target.value }))}
                              placeholder={bigDiff ? 'Diferencia grande: ¿por qué? (obligatorio)' : 'Nota (opcional)'}
                              className={`mt-2 w-full rounded-xl border px-3 py-2 text-[12px] text-[#3d2c24] outline-none ${bigDiff && !(notes[item.id] ?? '').trim() ? 'border-[#d4943a]' : 'border-[#ebe6df] focus:border-[#006d5a]'}`}
                            />
                          )}
                          {!isDone && neg && (
                            <p className="mt-2 flex items-center gap-1 text-[11px] text-[#d4943a]">
                              <AlertTriangle className="size-3" />
                              Al confirmar, el negativo se reemplaza por lo que contaste.
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <button
            onClick={() => setShowAll((v) => !v)}
            className="mt-6 w-full rounded-xl border border-dashed border-[#ebe6df] py-2.5 text-[13px] font-medium text-[#7d6c64]"
          >
            {showAll ? 'Ver solo lo que toca hoy' : `Ver todos los vinculados a Fudo (${countable.length})`}
          </button>
        </FadeIn>
      )}
    </div>
  )
}
