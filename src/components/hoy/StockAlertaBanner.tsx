'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Loader2, Package } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

type AlertItem = {
  id: string
  alert_type: string
  message: string
  triggered_at: string
  stock_items: { id: string; name: string; unit: string; current_qty: number } | null
}

type PedidoInfo = {
  user_name: string
  created_at: string
  description: string
} | null

type AlertsData = {
  alerts: AlertItem[]
  pedido: PedidoInfo
}

export function StockAlertaBanner() {
  const [data, setData] = useState<AlertsData | null>(null)
  const [pedidoLocal, setPedidoLocal] = useState<{ by: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void fetchData()
    const iv = setInterval(() => { void fetchData() }, 60_000)
    return () => clearInterval(iv)
  }, [])

  async function fetchData() {
    try {
      const res = await fetch('/api/stock/alertas')
      if (!res.ok) return
      const d = await res.json() as AlertsData
      setData(d)
    } catch { /* silencioso */ }
  }

  async function handlePedido() {
    setSaving(true)
    try {
      const res = await fetch('/api/stock/pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const d = await res.json() as { by?: string; error?: string }
      if (!res.ok) throw new Error(d.error ?? 'Error')
      setPedidoLocal({ by: d.by ?? 'vos' })
      toast.success('Confirmado — quedó registrado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo registrar')
    } finally {
      setSaving(false)
    }
  }

  if (!data || data.alerts.length === 0) return null

  const pedido = pedidoLocal ? { user_name: pedidoLocal.by } : data.pedido

  // Nombres únicos de insumos (de la join con stock_items, sin nulls)
  const uniqueNames = [
    ...new Set(data.alerts.map((a) => a.stock_items?.name).filter((n): n is string => Boolean(n))),
  ]

  return (
    <div
      className={`rounded-2xl ring-1 p-4 ${
        pedido
          ? 'bg-[#fff8ee] ring-[#f1dfba]'
          : 'bg-[#fff5f5] ring-[#ea504c]/30'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
            pedido ? 'bg-[#fdf6ec]' : 'bg-[#fdecea]'
          }`}
        >
          {pedido ? (
            <Check className="size-4 text-[#d4943a]" />
          ) : (
            <AlertTriangle className="size-4 text-[#ea504c]" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {pedido ? (
            <>
              <p className="text-[13px] font-bold text-[#d4943a]">Pedido en proceso</p>
              <p className="mt-0.5 text-[11px] leading-snug text-[#7d6c64]">
                {pedido.user_name} confirmó que ya lo pidió.{' '}
                {data.alerts.length} insumo{data.alerts.length !== 1 ? 's' : ''} todavía bajo —
                la alerta se cierra cuando llegue la mercadería.
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] font-bold text-[#ea504c]">
                {data.alerts.length} insumo{data.alerts.length !== 1 ? 's' : ''} no alcanzan para mañana
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-[#7d6c64]">
                {uniqueNames.slice(0, 4).join(', ')}
                {uniqueNames.length > 4 ? ` y ${uniqueNames.length - 4} más` : ''}
              </p>
            </>
          )}
        </div>
      </div>

      {!pedido && (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => void handlePedido()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl bg-[#ea504c] px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-60 active:scale-95"
          >
            {saving
              ? <Loader2 className="size-3.5 animate-spin" />
              : <Check className="size-3.5" />}
            Ya pedí
          </button>
          <Link
            href="/control"
            className="flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-[13px] font-semibold text-[#3d2c24] ring-1 ring-[#ea504c]/30"
          >
            <Package className="size-3.5" />
            Ver todo
          </Link>
        </div>
      )}
    </div>
  )
}
