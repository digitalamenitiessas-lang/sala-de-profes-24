'use client'

// ---------------------------------------------------------------------------
// HOY — el ciclo operativo completo en una pantalla, en el orden del papel
// de cocina: pedir → recibir → producir → contar. Cada bloque muestra lo
// mínimo para decidir y un botón para ir a hacerlo.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import { ActivarAvisos } from '@/components/push/ActivarAvisos'
import { ProtocolosHoy } from '@/components/protocolos/ProtocolosHoy'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ShoppingCart, Truck, ChefHat, ClipboardList, ChevronRight,
  AlertTriangle, Check, Loader2, Sparkles, Minus, Plus, Ban, Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import { isStockCritical } from '@/lib/contracts/stock'
import { LoadingState } from '@/components/ui/LoadingState'
import { FadeIn, StaggerList, StaggerItem } from '@/components/ui/motion'
import { AskBar } from '@/components/ai/AskBar'

type PurchaseOrderLite = {
  supplier_id: string
  supplier_name: string
  total_items: number
  is_order_day: boolean
  priority: 'alta' | 'media' | 'baja'
}

type PlanItem = { stock_item_id: string; name: string; unit: string; suggested_qty: number; reason: string }

type HoyData = {
  orderToday: PurchaseOrderLite[]
  otherOrders: number
  incoming: { id: number; product_name: string; quantity: string; source: string }[]
  plan: { items: PlanItem[]; sellingWithoutStock: { name: string }[]; analysis: string } | null
  /** todo lo que la casa produce — para armar el plan a mano */
  producedItems: { id: string; name: string; unit: string; current_qty: number }[]
  countNegative: { id: string; name: string; current_qty: number; unit: string }[]
  countCritical: number
  /** conteo diario de elaborados: cuántos se contaron hoy */
  conteoHoy: { contados: number; total: number; ultimo: string | null } | null
}

// La vista se cachea para que volver desde un paso sea instantáneo,
// y el plan armado se guarda POR FECHA: entrás a un paso, volvés, y está igual.
const CACHE_KEY = 'hoy-cache-v1'
const CACHE_TTL_MS = 10 * 60 * 1000
const planKey = () => `hoy-plan-${new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)}`

export default function HoyPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const [data, setData] = useState<HoyData | null>(null)
  const [loading, setLoading] = useState(true)
  // Armador manual de producción: cantidades editables sobre la sugerencia
  const [planQty, setPlanQty] = useState<Record<string, number>>({})
  const [planLoaded, setPlanLoaded] = useState(false)
  const [sendingPlan, setSendingPlan] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showAiAdvice, setShowAiAdvice] = useState(false)

  // Persistir cada ajuste del armador (sobrevive navegar a los pasos y volver)
  useEffect(() => {
    if (!planLoaded) return
    try { localStorage.setItem(planKey(), JSON.stringify(planQty)) } catch { /* storage lleno */ }
  }, [planQty, planLoaded])

  useEffect(() => {
    if (!profile) return
    const supabase = createClient()

    // 1) Si hay caché fresco, mostrarlo YA (volver de un paso = instantáneo)
    let hadCache = false
    try {
      const raw = sessionStorage.getItem(CACHE_KEY)
      if (raw) {
        const cached = JSON.parse(raw) as { data: HoyData; ts: number }
        if (Date.now() - cached.ts < CACHE_TTL_MS && cached.data) {
          setData(cached.data)
          setLoading(false)
          hadCache = true
        }
      }
    } catch { /* caché inválido, se refetchea */ }

    // Restaurar el plan armado de hoy (si existe) apenas se pueda
    let savedPlan: Record<string, number> | null = null
    try { savedPlan = JSON.parse(localStorage.getItem(planKey()) ?? 'null') } catch { /* ignorar */ }
    if (savedPlan && hadCache) {
      setPlanQty(savedPlan)
      setPlanLoaded(true)
    }

    async function load() {
      const [purchaseRes, planRes, kitchenRes, barRes, stockRes, conteoRes] = await Promise.all([
        fetch('/api/ai/purchase-order', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/ai/production-plan', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
        supabase.from('kitchen_orders').select('id, product_name, quantity').eq('status', 'ordered').limit(10),
        supabase.from('bar_orders').select('id, product_name, quantity').eq('status', 'ordered').limit(10),
        supabase.from('stock_items').select('id, name, current_qty, min_qty, unit, is_produced').eq('is_active', true),
        fetch('/api/stock/conteo-diario', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(j => j?.estado ?? null).catch(() => null),
      ])

      const orders = (purchaseRes?.orders ?? []) as PurchaseOrderLite[]
      const stock = (stockRes.data ?? []) as { id: string; name: string; current_qty: number; min_qty: number; unit: string; is_produced: boolean }[]

      const fresh: HoyData = {
        orderToday: orders.filter(o => o.is_order_day),
        otherOrders: orders.filter(o => !o.is_order_day).length,
        incoming: [
          ...(kitchenRes.data ?? []).map(o => ({ ...o, source: 'cocina' })),
          ...(barRes.data ?? []).map(o => ({ ...o, source: 'barra' })),
        ],
        plan: planRes ? { items: planRes.items ?? [], sellingWithoutStock: planRes.sellingWithoutStock ?? [], analysis: planRes.analysis ?? '' } : null,
        producedItems: stock.filter(i => i.is_produced).map(({ id, name, unit, current_qty }) => ({ id, name, unit, current_qty })),
        countNegative: stock.filter(i => Number(i.current_qty) < 0).slice(0, 6),
        countCritical: stock.filter(i => isStockCritical(Number(i.current_qty ?? 0), Number(i.min_qty ?? 0))).length,
        conteoHoy: conteoRes,
      }

      setData(fresh)
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: fresh, ts: Date.now() })) } catch { /* storage lleno */ }

      // Plan armado: lo guardado HOY manda; la IA solo completa lo que falte
      const initialQty: Record<string, number> = {}
      for (const item of (planRes?.items ?? []) as PlanItem[]) initialQty[item.stock_item_id] = item.suggested_qty
      let saved: Record<string, number> | null = null
      try { saved = JSON.parse(localStorage.getItem(planKey()) ?? 'null') } catch { /* ignorar */ }
      setPlanQty(saved ? { ...initialQty, ...saved } : initialQty)
      setPlanLoaded(true)
      setLoading(false)
    }
    load()
  }, [profile])

  // --- Armador de producción: acciones manuales ---

  async function markAsBought(itemId: string, itemName: string) {
    const supabase = createClient()
    const { error } = await supabase.from('stock_items').update({ is_produced: false }).eq('id', itemId)
    if (error) { toast.error('No se pudo actualizar'); return }
    setData(prev => prev ? {
      ...prev,
      producedItems: prev.producedItems.filter(i => i.id !== itemId),
      plan: prev.plan ? { ...prev.plan, items: prev.plan.items.filter(i => i.stock_item_id !== itemId) } : null,
    } : prev)
    setPlanQty(prev => { const next = { ...prev }; delete next[itemId]; return next })
    toast.success(`${itemName} marcado como comprado a proveedor — va a aparecer en Pedir`)
  }

  async function sendPlanToKitchen() {
    if (!profile || !data) return
    const lines = data.producedItems
      .filter(i => (planQty[i.id] ?? 0) > 0)
      .map(i => `• ${i.name}: ${planQty[i.id]} ${i.unit}`)
    if (lines.length === 0) { toast.error('No hay cantidades cargadas'); return }

    setSendingPlan(true)
    try {
      const supabase = createClient()
      const body = [
        `Plan de producción para hoy ${format(new Date(), "EEEE d 'de' MMMM", { locale: es })}:`,
        '',
        ...lines,
        '',
        'Registrar lo producido en Cocina → Producción.',
      ].join('\n')

      const { error } = await supabase.from('announcements').insert({
        author_id: profile.id,
        type: 'operativo',
        priority: 'alta',
        title: '👨‍🍳 Plan de producción de hoy',
        body,
        scope: 'role',
        target_role: 'cocina',
        is_active: true,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      if (error) throw error
      toast.success('Plan enviado a cocina 📣')
    } catch {
      toast.error('No se pudo enviar el plan')
    } finally {
      setSendingPlan(false)
    }
  }

  if (profileLoading || (loading && !data)) return <LoadingState message="Armando tu día..." />

  if (profile && !isManagerOrAbove(profile.role) && !['chef', 'cocina'].includes(profile.role)) {
    return (
      <div className="mx-auto max-w-lg pb-28 pt-8 text-center">
        <p className="text-sm font-medium text-[#3d2c24]">Esta vista es para encargados y cocina.</p>
      </div>
    )
  }

  if (!data) return <LoadingState />

  const steps = [
    {
      key: 'pedir',
      title: 'Pedir',
      icon: ShoppingCart,
      href: '/pedidos?from=hoy&step=pedir',
      cta: 'Armar pedidos',
      tone: data.orderToday.length > 0 ? 'action' : 'ok',
      body: data.orderToday.length > 0 ? (
        <div className="space-y-1">
          {data.orderToday.map(o => (
            <p key={o.supplier_id} className="text-xs text-[#3d2c24]">
              📅 <span className="font-bold">{o.supplier_name}</span> — hoy es su día de pedido ({o.total_items} item{o.total_items !== 1 ? 's' : ''} sugerido{o.total_items !== 1 ? 's' : ''})
            </p>
          ))}
          {data.otherOrders > 0 && (
            <p className="text-[11px] text-[#a39e97]">+{data.otherOrders} proveedores más con faltantes (no es su día)</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-[#7d6c64]">
          Hoy no es día de pedido de ningún proveedor.
          {data.otherOrders > 0 && ` Ojo: hay ${data.otherOrders} con faltantes por si hace falta adelantar.`}
        </p>
      ),
    },
    {
      key: 'recibir',
      title: 'Recibir',
      icon: Truck,
      href: '/pedidos?from=hoy&step=camino',
      cta: 'Recibir mercadería',
      tone: data.incoming.length > 0 ? 'action' : 'ok',
      body: data.incoming.length > 0 ? (
        <div className="space-y-0.5">
          {data.incoming.slice(0, 4).map(o => (
            <p key={`${o.source}-${o.id}`} className="text-xs text-[#3d2c24]">
              🚚 {o.product_name} <span className="text-[#a39e97]">({o.quantity})</span>
            </p>
          ))}
          {data.incoming.length > 4 && <p className="text-[11px] text-[#a39e97]">+{data.incoming.length - 4} más en camino</p>}
        </div>
      ) : (
        <p className="text-xs text-[#7d6c64]">Nada pendiente de recibir. Cuando llegue un pedido, confirmalo en Pedidos → En camino (la compra se carga una sola vez, en Fudo).</p>
      ),
    },
    {
      key: 'producir',
      title: 'Producir',
      icon: ChefHat,
      href: '/cocina/produccion?from=hoy',
      cta: 'Ver plan y producir',
      tone: (data.plan?.sellingWithoutStock.length ?? 0) > 0 ? 'urgent' : (data.plan?.items.length ?? 0) > 0 ? 'action' : 'ok',
      body: (() => {
        const suggestionById = new Map((data.plan?.items ?? []).map(i => [i.stock_item_id, i]))
        // Filas visibles: lo sugerido por IA + lo agregado a mano (qty en planQty)
        const visibleIds = new Set<string>([
          ...(data.plan?.items ?? []).map(i => i.stock_item_id),
          ...Object.keys(planQty).filter(id => (planQty[id] ?? 0) > 0),
        ])
        const rows = data.producedItems.filter(i => visibleIds.has(i.id))
        const addCandidates = data.producedItems.filter(i =>
          !visibleIds.has(i.id)
          && (!addSearch.trim() || i.name.toLowerCase().includes(addSearch.toLowerCase())),
        )
        const totalPlanned = rows.reduce((s, i) => s + (planQty[i.id] ?? 0), 0)

        return (
          <div className="space-y-2">
            {(data.plan?.sellingWithoutStock.length ?? 0) > 0 && (
              <p className="flex items-center gap-1 text-[11px] font-bold text-[#ea504c]">
                <AlertTriangle className="size-3" />
                Venden sin stock digital: {data.plan!.sellingWithoutStock.slice(0, 3).map(s => s.name).join(', ')} — contar primero
              </p>
            )}

            {rows.length === 0 && (
              <p className="text-xs text-[#7d6c64]">Armá el plan de hoy: agregá productos con el botón de abajo.</p>
            )}

            {rows.map(i => {
              const qty = planQty[i.id] ?? 0
              const suggestion = suggestionById.get(i.id)
              return (
                <div key={i.id} className="flex items-center gap-2 rounded-xl bg-[#faf8f5] px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-[#3d2c24]">{i.name}</p>
                    <p className="truncate text-[10px] text-[#a39e97]">
                      Hay {i.current_qty} {i.unit}
                      {suggestion && <span className="text-[#8b5e34]"> · IA sugiere {suggestion.suggested_qty}</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => setPlanQty(prev => ({ ...prev, [i.id]: Math.max(0, (prev[i.id] ?? 0) - 1) }))}
                      className="flex size-7 items-center justify-center rounded-lg bg-white ring-1 ring-[#ebe6df] active:scale-90"
                    >
                      <Minus className="size-3 text-[#3d2c24]" />
                    </button>
                    <span className={`w-9 text-center text-sm font-bold tabular-nums ${qty > 0 ? 'text-[#006d5a]' : 'text-[#a39e97]'}`}>
                      {qty}
                    </span>
                    <button
                      onClick={() => setPlanQty(prev => ({ ...prev, [i.id]: (prev[i.id] ?? 0) + 1 }))}
                      className="flex size-7 items-center justify-center rounded-lg bg-white ring-1 ring-[#ebe6df] active:scale-90"
                    >
                      <Plus className="size-3 text-[#3d2c24]" />
                    </button>
                    <button
                      onClick={() => markAsBought(i.id, i.name)}
                      title="No se produce acá: se compra a un proveedor"
                      className="ml-1 flex size-7 items-center justify-center rounded-lg bg-white ring-1 ring-[#f3d0cf] active:scale-90"
                    >
                      <Ban className="size-3 text-[#ea504c]" />
                    </button>
                  </div>
                </div>
              )
            })}

            {/* Agregar cualquier producto propio a mano */}
            {showAdd ? (
              <div className="rounded-xl bg-white p-2 ring-1 ring-[#ebe6df]">
                <input
                  autoFocus
                  value={addSearch}
                  onChange={e => setAddSearch(e.target.value)}
                  placeholder="Buscar producto propio..."
                  className="w-full rounded-lg border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-xs focus:border-[#006d5a] focus:outline-none"
                />
                <div className="mt-1 max-h-36 space-y-0.5 overflow-y-auto">
                  {addCandidates.slice(0, 6).map(i => (
                    <button
                      key={i.id}
                      onClick={() => {
                        setPlanQty(prev => ({ ...prev, [i.id]: 1 }))
                        setShowAdd(false)
                        setAddSearch('')
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-[#faf8f5]"
                    >
                      <span className="truncate text-[#3d2c24]">{i.name}</span>
                      <span className="ml-2 shrink-0 text-[10px] text-[#a39e97]">{i.current_qty} {i.unit}</span>
                    </button>
                  ))}
                  {addCandidates.length === 0 && (
                    <p className="px-2 py-1.5 text-[11px] text-[#a39e97]">
                      Sin resultados. Si falta un producto que producen, marcalo como &quot;producción propia&quot; en Stock.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAdd(true)}
                className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-[#d4c8bc] py-2 text-xs font-semibold text-[#7d6c64] active:scale-[0.98]"
              >
                <Plus className="size-3.5" /> Agregar producto
              </button>
            )}

            {totalPlanned > 0 && (
              <button
                onClick={sendPlanToKitchen}
                disabled={sendingPlan}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-2.5 text-xs font-bold text-white active:scale-[0.98] disabled:opacity-50"
              >
                {sendingPlan ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                Enviar plan a cocina ({totalPlanned})
              </button>
            )}
          </div>
        )
      })(),
    },
    {
      key: 'contar',
      title: 'Contar',
      icon: ClipboardList,
      href: data.conteoHoy && data.conteoHoy.contados === 0 ? '/cocina/elaborados?tab=contar' : '/stock?from=hoy',
      cta: data.conteoHoy && data.conteoHoy.contados === 0 ? 'Contar elaborados' : 'Ir a Conteo',
      tone: data.countNegative.length > 0 || (data.conteoHoy?.contados === 0) ? 'urgent' : data.countCritical > 0 ? 'action' : 'ok',
      body: (
        <div className="space-y-1">
          {data.conteoHoy && (
            <p className="text-xs text-[#3d2c24]">
              {data.conteoHoy.contados > 0
                ? <>✅ <span className="font-bold">Conteo de hoy hecho</span>: {data.conteoHoy.contados} elaborados contados</>
                : <>⏳ <span className="font-bold text-[#d4943a]">Falta el conteo de elaborados de hoy</span> — al cargarlo le llega el resumen a todos</>}
            </p>
          )}
          {data.countNegative.length > 0 && (
            <p className="text-xs text-[#3d2c24]">
              <span className="font-bold text-[#ea504c]">{data.countNegative.length} en negativo</span>
              {' '}— {data.countNegative.slice(0, 3).map(i => i.name).join(', ')}{data.countNegative.length > 3 ? '…' : ''}
            </p>
          )}
          <p className="text-xs text-[#7d6c64]">
            {data.countCritical} item{data.countCritical !== 1 ? 's' : ''} en crítico (bajo mínimo) — si queda menos del mínimo: producir o comprar.
          </p>
        </div>
      ),
    },
  ] as const

  const TONE_STYLES: Record<string, { ring: string; iconBg: string; iconColor: string; accent: string }> = {
    urgent: { ring: 'ring-[#f3d0cf]', iconBg: 'bg-[#fef2f2]', iconColor: 'text-[#ea504c]', accent: '#ea504c' },
    action: { ring: 'ring-[#f1dfba]', iconBg: 'bg-[#fdf6ec]', iconColor: 'text-[#d4943a]', accent: '#d4943a' },
    ok: { ring: 'ring-[#ebe6df]', iconBg: 'bg-[#e8f5f1]', iconColor: 'text-[#006d5a]', accent: '#006d5a' },
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-28">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold capitalize leading-[1.05] tracking-tight text-[#3d2c24]">
              Hoy, {format(new Date(), "EEEE d 'de' MMMM", { locale: es })}
            </h1>
            <p className="section-label mt-1.5">Pedir → Recibir → Producir → Contar</p>
          </div>
          {loading && <Loader2 className="size-4 animate-spin text-[#a39e97]" />}
        </div>
      </FadeIn>

      <ActivarAvisos />

      <ProtocolosHoy />

      {/* Preguntar en castellano — cruza stock, pedidos y producción */}
      <FadeIn delay={0.03}>
        <AskBar
          scope="hoy"
          placeholder="Preguntá: qué comprar, qué falta…"
          examples={['¿qué tengo que comprar?', '¿qué me falta en cocina?', '¿qué produje esta semana?']}
        />
      </FadeIn>

      <StaggerList className="space-y-3" staggerDelay={0.05}>
        {steps.map((step, idx) => {
          const style = TONE_STYLES[step.tone]
          const Icon = step.icon
          return (
            <StaggerItem key={step.key}>
              <div className={`relative overflow-hidden rounded-2xl bg-white p-4 pl-5 shadow-sm ring-1 ${style.ring}`}>
                <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: style.accent }} />
                <div className="flex items-start gap-3">
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${style.iconBg}`}>
                    {step.tone === 'ok' && step.key !== 'contar' ? (
                      <Check className={`size-4 ${style.iconColor}`} />
                    ) : (
                      <Icon className={`size-4 ${style.iconColor}`} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ backgroundColor: style.accent }}
                      >
                        {idx + 1}
                      </span>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#a39e97]">Paso {idx + 1}</p>
                    </div>
                    <p className="mt-0.5 font-display text-base font-bold text-[#3d2c24]">{step.title}</p>
                    <div className="mt-1.5">{step.body}</div>
                  </div>
                </div>
                <Link
                  href={step.href}
                  className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl bg-[#f3efe9] py-2 text-xs font-semibold text-[#3d2c24] transition-transform active:scale-[0.98]"
                >
                  {step.cta}
                  <ChevronRight className="size-3.5" />
                </Link>
              </div>
            </StaggerItem>
          )
        })}
      </StaggerList>

      {/* Consejo del plan IA — colapsado, opcional */}
      {data.plan?.analysis && data.plan.items.length > 0 && (
        <FadeIn>
          {showAiAdvice ? (
            <div className="rounded-2xl bg-[#3d2c24] p-4">
              <button onClick={() => setShowAiAdvice(false)} className="flex w-full items-center justify-between">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60">
                  <Sparkles className="size-3" /> Consejo IA de hoy
                </p>
                <span className="text-[10px] text-white/50">ocultar</span>
              </button>
              <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-white/90">{data.plan.analysis}</p>
            </div>
          ) : (
            <button
              onClick={() => setShowAiAdvice(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#f3efe9] py-2 text-[11px] font-semibold text-[#7d6c64] active:scale-[0.98]"
            >
              <Sparkles className="size-3" /> Ver consejo IA de hoy
            </button>
          )}
        </FadeIn>
      )}
    </div>
  )
}
