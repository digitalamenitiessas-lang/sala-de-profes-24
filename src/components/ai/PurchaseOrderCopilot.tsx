'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Truck, Sparkles, Copy, Check, Send, Phone,
  AlertTriangle, ChevronDown, ChevronUp, Loader2,
  ExternalLink, RefreshCw, Package,
} from 'lucide-react'
import { toast } from 'sonner'
import type { PurchaseOrder } from '@/lib/ai/purchase-order'

type PurchaseItem = PurchaseOrder['items'][number]

type OrderResult = {
  orders: PurchaseOrder[]
  unassigned: PurchaseItem[]
  generatedAt: string
}

const PRIORITY_STYLES = {
  alta: { border: 'border-l-[#ea504c]', badge: 'bg-[#fef2f2] text-[#ea504c]', label: 'Urgente' },
  media: { border: 'border-l-[#d4943a]', badge: 'bg-[#fdf6ec] text-[#d4943a]', label: 'Media' },
  baja: { border: 'border-l-[#006d5a]', badge: 'bg-[#e8f5f1] text-[#006d5a]', label: 'Normal' },
}

export function PurchaseOrderCopilot() {
  const [data, setData] = useState<OrderResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null)
  const [messages, setMessages] = useState<Record<string, string>>({})
  const [generatingMsg, setGeneratingMsg] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [markingSent, setMarkingSent] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ai/purchase-order')
      if (!res.ok) throw new Error()
      setData(await res.json())
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const generateMessage = async (order: PurchaseOrder) => {
    setGeneratingMsg(order.supplier_id)
    try {
      const res = await fetch('/api/ai/purchase-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_message', order }),
      })
      if (!res.ok) throw new Error()
      const { message } = await res.json()
      setMessages(prev => ({ ...prev, [order.supplier_id]: message }))
      setExpandedOrder(order.supplier_id)
    } catch {
      toast.error('Error al generar mensaje')
    } finally {
      setGeneratingMsg(null)
    }
  }

  const copyMessage = (supplierId: string) => {
    const msg = messages[supplierId]
    if (!msg) return
    navigator.clipboard.writeText(msg)
    setCopiedId(supplierId)
    toast.success('Copiado al portapapeles')
    setTimeout(() => setCopiedId(null), 2000)
  }

  const openWhatsApp = (order: PurchaseOrder) => {
    const msg = messages[order.supplier_id]
    if (!msg || !order.supplier_phone) return
    const phone = order.supplier_phone.replace(/\D/g, '')
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const markAsSent = async (order: PurchaseOrder) => {
    setMarkingSent(order.supplier_id)
    try {
      const res = await fetch('/api/ai/purchase-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_sent',
          supplier_id: order.supplier_id,
          supplier_name: order.supplier_name,
          items: order.items,
          message_sent: !!messages[order.supplier_id],
        }),
      })
      if (!res.ok) throw new Error()
      toast.success(`Pedido a ${order.supplier_name} registrado`)
      fetchOrders()
    } catch {
      toast.error('Error')
    } finally {
      setMarkingSent(null)
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-[#006d5a]/10 bg-[#f0f7f5] p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-[#006d5a] animate-pulse" />
          <span className="text-xs font-semibold text-[#006d5a]">Analizando stock y proveedores...</span>
        </div>
        <div className="mt-2 space-y-1.5">
          <div className="h-3 w-3/4 animate-pulse rounded bg-[#006d5a]/10" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-[#006d5a]/10" />
        </div>
      </div>
    )
  }

  if (!data || (data.orders.length === 0 && data.unassigned.length === 0)) {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-[#e8f5f1]">
          <Check className="size-5 text-[#006d5a]" />
        </div>
        <p className="mt-3 text-sm font-semibold text-[#3d2c24]">Sin pedidos sugeridos</p>
        <p className="mt-1 text-xs text-[#a39e97]">Stock por encima del mínimo</p>
      </div>
    )
  }

  // Proveedores cuyo día de pedido (suppliers.order_days) es HOY — lo primero que hay que ver
  const orderDayNames = data.orders.filter(o => o.is_order_day).map(o => o.supplier_name)

  return (
    <div className="space-y-3">
      {/* Franja "hoy toca pedir" — respuesta en 5 segundos: ¿a quién le pido hoy? */}
      {orderDayNames.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-[#3d2c24] px-3 py-2.5">
          <span className="shrink-0 text-sm">📅</span>
          <p className="text-xs text-white/80">
            Hoy toca pedir:{' '}
            <span className="font-bold text-white">{orderDayNames.join(', ')}</span>
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="size-3.5 text-[#006d5a]" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-[#006d5a]">
            Copiloto IA · {data.orders.length} proveedor{data.orders.length !== 1 ? 'es' : ''}
          </span>
        </div>
        <button onClick={fetchOrders} className="rounded-lg p-1.5 hover:bg-[#f3efe9]">
          <RefreshCw className="size-3 text-[#a39e97]" />
        </button>
      </div>

      {/* Unassigned warning */}
      {data.unassigned.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[#ea504c]/20 bg-[#fef2f2] px-3 py-2">
          <AlertTriangle className="size-3.5 text-[#ea504c]" />
          <span className="flex-1 text-[11px] font-medium text-[#ea504c]">
            {data.unassigned.length} item{data.unassigned.length > 1 ? 's' : ''} sin proveedor
          </span>
          <a href="/proveedores" className="text-[10px] font-semibold text-[#006d5a] hover:underline">
            Asignar
          </a>
        </div>
      )}

      {/* Orders by supplier */}
      {data.orders.map((order) => {
        const style = PRIORITY_STYLES[order.priority]
        const isExpanded = expandedOrder === order.supplier_id
        const msg = messages[order.supplier_id]
        const isGenerating = generatingMsg === order.supplier_id
        const isSending = markingSent === order.supplier_id

        return (
          <div key={order.supplier_id} className={`rounded-xl border bg-card overflow-hidden border-l-4 ${style.border}`}>
            {/* Supplier header */}
            <button
              onClick={() => setExpandedOrder(isExpanded ? null : order.supplier_id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#f0f7f5]">
                <Truck className="size-3.5 text-[#006d5a]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#3d2c24]">{order.supplier_name}</p>
                <p className="text-[10px] text-[#a39e97]">
                  {order.total_items} item{order.total_items > 1 ? 's' : ''}
                  {order.coverage_days != null && ` · la compra cubre ${order.coverage_days} días`}
                </p>
              </div>
              {order.is_order_day && (
                <span className="rounded-full bg-[#3d2c24] px-2 py-0.5 text-[9px] font-bold text-white">
                  📅 Hoy toca pedir
                </span>
              )}
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${style.badge}`}>{style.label}</span>
              {isExpanded ? <ChevronUp className="size-3.5 text-[#a39e97]" /> : <ChevronDown className="size-3.5 text-[#a39e97]" />}
            </button>

            {isExpanded && (
              <div className="border-t px-4 py-3 space-y-3">
                {/* Items */}
                <div className="space-y-1">
                  {order.items.map((item) => (
                    <div key={item.item_id} className="flex items-center justify-between rounded-lg bg-[#faf8f5] px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-[#3d2c24] truncate">{item.item_name}</p>
                        <p className="text-[10px] text-[#a39e97]">
                          Tiene {item.current_qty} · Mín {item.min_qty}
                          {item.days_left != null && (
                            <span className={item.days_left <= 2 ? 'font-bold text-[#ea504c]' : ''}>
                              {' '}· ~{item.days_left} días de stock
                            </span>
                          )}
                        </p>
                      </div>
                      <span className="ml-2 rounded-full bg-[#006d5a] px-2.5 py-0.5 text-[10px] font-bold text-white">
                        {item.suggested_qty} {item.unit}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Message */}
                {msg ? (
                  <div className="space-y-2">
                    <div className="rounded-lg border bg-white p-3">
                      <p className="text-xs leading-relaxed text-[#3d2c24] whitespace-pre-wrap">{msg}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyMessage(order.supplier_id)}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-[#006d5a] h-9 text-[11px] font-semibold text-[#006d5a] hover:bg-[#e8f5f1]"
                      >
                        {copiedId === order.supplier_id ? <Check className="size-3" /> : <Copy className="size-3" />}
                        {copiedId === order.supplier_id ? 'Copiado' : 'Copiar'}
                      </button>
                      {order.supplier_phone && (
                        <button
                          onClick={() => openWhatsApp(order)}
                          className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#25D366] h-9 text-[11px] font-semibold text-white"
                        >
                          <Phone className="size-3" /> WhatsApp
                        </button>
                      )}
                      <button
                        onClick={() => markAsSent(order)}
                        disabled={isSending}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#006d5a] h-9 text-[11px] font-semibold text-white disabled:opacity-50"
                      >
                        {isSending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                        Enviado
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => generateMessage(order)}
                    disabled={isGenerating}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] h-10 text-xs font-semibold text-white hover:bg-[#005a4a] disabled:opacity-50"
                  >
                    {isGenerating ? (
                      <><Loader2 className="size-3.5 animate-spin" /> Redactando...</>
                    ) : (
                      <><Sparkles className="size-3.5" /> Generar mensaje</>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      <p className="text-center text-[9px] text-[#a39e97]">
        Copiloto IA · Cantidades sugeridas · Confirmar antes de enviar
      </p>
    </div>
  )
}
