'use client'

// ---------------------------------------------------------------------------
// /pedidos/cuentas — Cuentas por pagar (manager-only)
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  ArrowLeft, Wallet, ChevronDown, ChevronUp, Check,
  Loader2, Package, AlertTriangle, X, Phone, Pencil,
} from 'lucide-react'
import { toast } from 'sonner'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { FadeIn } from '@/components/ui/motion'
import type { CanceladoEnFudo, ResultadoPagosFudo } from '@/lib/compras/pagos-fudo'
import { SinPrecioSection, faltaPrecio } from '../_components/SinPrecio'

type Receipt = {
  id: number
  supplier_id: string | null
  qty: number
  unit: string | null
  cost_total: number | null
  note: string | null
  received_date: string
  payment_status: 'pagado' | 'a_pagar'
  paid_at: string | null
  payment_method: string | null
  supplier_name: string
  supplier_phone: string | null
  supplier_contact: string | null
}

type PayState = { id: number; method: 'efectivo' | 'transferencia' | 'tarjeta' | null }

const PAY_METHODS: { key: 'efectivo' | 'transferencia' | 'tarjeta'; label: string }[] = [
  { key: 'efectivo', label: 'Efectivo' },
  { key: 'transferencia', label: 'Transf.' },
  { key: 'tarjeta', label: 'Tarjeta' },
]

const fmtMoney = (n: number) => `$${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`

function methodLabel(m: string | null) {
  if (!m) return null
  if (m === 'cuenta_corriente') return 'cta. cte.'
  if (m === 'transferencia') return 'transf.'
  return m
}

export default function CuentasPage() {
  const { profile } = useProfileContext()
  const [loading, setLoading] = useState(true)
  const [migrationMissing, setMigrationMissing] = useState(false)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [payState, setPayState] = useState<PayState | null>(null)
  const [confirming, setConfirming] = useState(false)
  /** "Saldar todo" de un proveedor: UN medio de pago para todos los recibos */
  const [groupPay, setGroupPay] = useState<{ key: string; method: 'efectivo' | 'transferencia' | 'tarjeta' | null } | null>(null)
  const [payingAll, setPayingAll] = useState<string | null>(null)
  const [undoing, setUndoing] = useState<number | null>(null)
  const [showPaid, setShowPaid] = useState(false)
  const [editState, setEditState] = useState<{ id: number; costTotal: string; note: string } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [canceladosFudo, setCanceladosFudo] = useState<CanceladoEnFudo[]>([])

  const canManage = isManagerOrAbove(profile?.role)

  const fetchData = useCallback(async () => {
    const { createClient } = await import('@/lib/supabase/client')
    const supabase = createClient()
    const { data, error } = await supabase
      .from('stock_receipts')
      .select('id, supplier_id, qty, unit, cost_total, note, received_date, payment_status, paid_at, payment_method, suppliers!stock_receipts_supplier_id_fkey(name, phone, contact_name)')
      // Sin filtrar por cost_total: los "a pagar" sin precio también se traen
      // (van a "Falta el precio"); los pagados sin monto se descartan abajo.
      .order('received_date', { ascending: false })
      .limit(300)

    if (error) {
      if (/payment_status|paid_at|payment_method/.test(error.message)) setMigrationMissing(true)
      setLoading(false)
      return
    }

    setReceipts(((data ?? []) as unknown as (Omit<Receipt, 'supplier_name' | 'supplier_phone' | 'supplier_contact'> & { suppliers: { name: string; phone: string | null; contact_name: string | null } | null })[])
      .map((r) => ({
        ...r,
        supplier_name: r.suppliers?.name ?? 'Sin proveedor',
        supplier_phone: r.suppliers?.phone ?? null,
        supplier_contact: r.suppliers?.contact_name ?? null,
      })))
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Lo que ya se pagó en Fudo (orden de pago a proveedores) se marca pagado acá
  useEffect(() => {
    if (!canManage) return
    let alive = true
    fetch('/api/compras/pagos-fudo', { method: 'POST' })
      .then((r) => (r.ok ? r.json() as Promise<ResultadoPagosFudo> : null))
      .then((r) => {
        if (!alive || !r) return
        setCanceladosFudo(r.cancelados ?? [])
        if (r.recibosPagados > 0) {
          toast.success(`${r.recibosPagados} recibo${r.recibosPagados !== 1 ? 's' : ''} ya pagado${r.recibosPagados !== 1 ? 's' : ''} en Fudo: marcado${r.recibosPagados !== 1 ? 's' : ''} como pagado${r.recibosPagados !== 1 ? 's' : ''}`)
          void fetchData()
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [canManage, fetchData])

  const pending = useMemo(() => receipts.filter((r) => r.payment_status === 'a_pagar' && !faltaPrecio(r.cost_total)), [receipts])
  // Cuenta corriente que llegó sin monto: aparte, sin sumar al saldo en $
  const sinPrecio = useMemo(() => receipts.filter((r) => r.payment_status === 'a_pagar' && faltaPrecio(r.cost_total)), [receipts])
  const paid = useMemo(() => receipts.filter((r) => r.payment_status === 'pagado' && r.cost_total != null).slice(0, 15), [receipts])
  const totalPending = useMemo(() => pending.reduce((acc, r) => acc + (Number(r.cost_total) || 0), 0), [pending])

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; phone: string | null; contact: string | null; receipts: Receipt[]; total: number; oldestDate: string }>()
    for (const r of pending) {
      const key = r.supplier_id ?? 'none'
      const g = map.get(key) ?? { name: r.supplier_name, phone: r.supplier_phone, contact: r.supplier_contact, receipts: [], total: 0, oldestDate: r.received_date }
      g.receipts.push(r)
      g.total += Number(r.cost_total) || 0
      if (r.received_date < g.oldestDate) g.oldestDate = r.received_date
      map.set(key, g)
    }
    return Array.from(map.entries())
      .map(([key, g]) => ({ key, ...g }))
      .sort((a, b) => b.total - a.total)
  }, [pending])

  function diasDesde(dateStr: string): number {
    return Math.floor((Date.now() - new Date(`${dateStr}T12:00:00`).getTime()) / 86_400_000)
  }

  function labelDias(d: number): string {
    if (d === 0) return 'Hoy'
    if (d === 1) return 'Hace 1 día'
    return `Hace ${d} días`
  }

  /** PATCH de estado de pago. Devuelve el json (fudoSynced / fudoPaymentLinked). */
  async function patchStatus(receiptId: number, status: 'pagado' | 'a_pagar', method?: 'efectivo' | 'transferencia' | 'tarjeta') {
    const res = await fetch(`/api/stock/receipts/${receiptId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(status === 'pagado'
        ? { payment_status: 'pagado', payment_method: method ?? null }
        : { payment_status: 'a_pagar' }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Error al actualizar el pago')
    return json as { fudoSynced?: boolean; fudoPaymentLinked?: boolean }
  }

  async function markPaid(receipt: Receipt, method: 'efectivo' | 'transferencia' | 'tarjeta') {
    setConfirming(true)
    try {
      const json = await patchStatus(receipt.id, 'pagado', method)
      const fudoMsg = json.fudoSynced ? ' — imputado en Fudo' : ''
      toast.success(`Pagado (${methodLabel(method)}) — ${receipt.supplier_name}${fudoMsg}${receipt.cost_total != null ? ` · ${fmtMoney(Number(receipt.cost_total))}` : ''}`)
      setPayState(null)
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar el pago')
    } finally {
      setConfirming(false)
    }
  }

  /** Deshace un pago marcado por error: el recibo vuelve a "a pagar". */
  async function deshacer(receipt: Receipt) {
    setUndoing(receipt.id)
    try {
      const json = await patchStatus(receipt.id, 'a_pagar')
      toast.success(`Volvió a "a pagar" — ${receipt.supplier_name}`)
      if (json.fudoPaymentLinked) {
        toast.warning('Ojo: el pago ya imputado en Fudo no se revierte solo — corregilo en Fudo si hace falta')
      }
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar el pago')
    } finally {
      setUndoing(null)
    }
  }

  async function saveEdit() {
    if (!editState) return
    setSavingEdit(true)
    try {
      const cost = parseFloat(editState.costTotal.replace(',', '.'))
      const res = await fetch(`/api/stock/receipts/${editState.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(Number.isFinite(cost) && cost > 0 ? { cost_total: cost } : {}),
          note: editState.note.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al guardar')
      toast.success('Recibo actualizado')
      setEditState(null)
      fetchData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSavingEdit(false)
    }
  }

  /** Salda TODOS los recibos pendientes de un proveedor con UN medio de pago. */
  async function saldarTodo(group: { key: string; name: string; phone: string | null; contact: string | null; receipts: Receipt[]; total: number; oldestDate: string }, method: 'efectivo' | 'transferencia' | 'tarjeta') {
    setPayingAll(group.key)
    let saldados = 0
    let fallidos = 0
    let enFudo = 0
    for (const r of group.receipts) {
      try {
        const json = await patchStatus(r.id, 'pagado', method)
        saldados++
        if (json.fudoSynced) enFudo++
      } catch { fallidos++ }
    }
    setPayingAll(null)
    setGroupPay(null)
    if (fallidos === 0) toast.success(`${group.name}: ${saldados} recibo${saldados !== 1 ? 's' : ''} saldado${saldados !== 1 ? 's' : ''} (${fmtMoney(group.total)})${enFudo > 0 ? ` — ${enFudo} imputado${enFudo !== 1 ? 's' : ''} en Fudo` : ''}`)
    else toast.error(`${group.name}: ${saldados} saldado${saldados !== 1 ? 's' : ''}, ${fallidos} con error — revisá la lista`)
    fetchData()
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-[#006d5a]" /></div>
  }

  if (!canManage) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <AlertTriangle className="mx-auto size-8 text-[#d4943a]" />
        <p className="mt-3 text-sm font-medium text-[#a39e97]">Solo encargados pueden ver las cuentas por pagar</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-28">
      <FadeIn>
        <div className="flex items-center gap-3">
          <Link href="/pedidos" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-[#ebe6df] active:scale-95">
            <ArrowLeft className="size-4 text-[#3d2c24]" />
          </Link>
          <div>
            <h1 className="font-display text-xl tracking-tight text-[#3d2c24]">Cuentas por pagar</h1>
            <p className="section-label mt-0.5">Gastos de compras por proveedor</p>
          </div>
        </div>
      </FadeIn>

      {migrationMissing && (
        <FadeIn>
          <div className="rounded-2xl bg-[#fdf6ec] px-4 py-3 ring-1 ring-[#d4943a]/30">
            <p className="text-sm font-semibold text-[#d4943a]">Falta aplicar la migración de pagos</p>
            <p className="mt-0.5 text-xs text-[#a39e97]">
              Aplicá <code>20260723_receipt_payments.sql</code> en Supabase para habilitar el estado de pago de los gastos.
            </p>
          </div>
        </FadeIn>
      )}

      {canceladosFudo.length > 0 && (
        <FadeIn>
          <div className="rounded-2xl bg-[#fef2f2] px-4 py-3 ring-1 ring-[#ea504c]/20">
            <p className="text-sm font-semibold text-[#ea504c]">Cancelados en Fudo, pendientes acá</p>
            <p className="mt-0.5 text-xs text-[#7d6c64]">Revisá si hay que anular la compra en Sala de Profes o si el gasto se canceló por error en Fudo.</p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-[#3d2c24]">
              {canceladosFudo.map((c) => (
                <li key={c.expenseId}>· {c.proveedor ?? 'Sin proveedor'} — {fmtMoney(c.total)} <span className="text-[#a39e97]">(gasto #{c.expenseId} en Fudo)</span></li>
              ))}
            </ul>
          </div>
        </FadeIn>
      )}

      {!migrationMissing && (
        <FadeIn delay={0.05}>
          <div className="rounded-2xl bg-white p-4 ring-1 ring-[#ebe6df]">
            <div className="flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#fdf6ec]">
                <Wallet className="size-5 text-[#8b5e34]" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Saldo pendiente</p>
                <p className="font-display text-2xl font-bold tabular-nums text-[#3d2c24]">{fmtMoney(totalPending)}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold tabular-nums text-[#d4943a]">{pending.length}</p>
                <p className="text-[9px] font-semibold uppercase tracking-wider text-[#a39e97]">recibos</p>
              </div>
            </div>
            {sinPrecio.length > 0 && (
              <p className="mt-2 text-[11px] font-semibold text-[#d4943a]">
                + {sinPrecio.length} recibo{sinPrecio.length !== 1 ? 's' : ''} sin precio (no sumado{sinPrecio.length !== 1 ? 's' : ''} al saldo)
              </p>
            )}
          </div>
        </FadeIn>
      )}

      {!migrationMissing && sinPrecio.length > 0 && (
        <FadeIn>
          <SinPrecioSection recibos={sinPrecio} onSaved={() => void fetchData()} />
        </FadeIn>
      )}

      {!migrationMissing && groups.map((group) => {
        const isExpanded = expanded === group.key
        const dias = diasDesde(group.oldestDate)
        const urgente = dias >= 14
        return (
          <FadeIn key={group.key}>
            <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
              <button
                onClick={() => setExpanded(isExpanded ? null : group.key)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', urgente ? 'bg-[#fdf6ec]' : 'bg-[#e8f5f1]')}>
                  <Package className={cn('size-4', urgente ? 'text-[#d4943a]' : 'text-[#006d5a]')} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-[#3d2c24]">{group.name}</p>
                    {group.phone && (
                      <a
                        href={`tel:${group.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 rounded-full p-1 text-[#a39e97] hover:bg-[#faf8f5] hover:text-[#006d5a]"
                        title={group.contact ? `${group.contact} — ${group.phone}` : group.phone}
                      >
                        <Phone className="size-3.5" />
                      </a>
                    )}
                  </div>
                  <p className="text-[11px] text-[#a39e97]">
                    {group.receipts.length} recibo{group.receipts.length > 1 ? 's' : ''} · <span className={urgente ? 'font-semibold text-[#d4943a]' : ''}>{labelDias(dias)}</span>
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-[#d4943a]">{fmtMoney(group.total)}</span>
                {isExpanded ? <ChevronUp className="size-4 text-[#a39e97]" /> : <ChevronDown className="size-4 text-[#a39e97]" />}
              </button>

              {isExpanded && (
                <div className="divide-y border-t">
                  {/* Saldar todo el proveedor: UN medio de pago para todos los recibos */}
                  {group.receipts.length > 1 && (
                    <div className="bg-[#faf8f5] px-4 py-2">
                      {groupPay?.key !== group.key ? (
                        <div className="flex justify-end">
                          <button
                            onClick={() => setGroupPay({ key: group.key, method: null })}
                            disabled={payingAll === group.key}
                            className="flex items-center gap-1.5 rounded-lg bg-[#006d5a] px-3 py-1.5 text-[11px] font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
                          >
                            {payingAll === group.key ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                            Saldar todo ({fmtMoney(group.total)})
                          </button>
                        </div>
                      ) : (
                        <div>
                          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">¿Cómo se paga todo? ({fmtMoney(group.total)})</p>
                          <div className="flex items-center gap-2">
                            {PAY_METHODS.map((m) => (
                              <button
                                key={m.key}
                                onClick={() => setGroupPay((p) => p ? { ...p, method: m.key } : null)}
                                className={cn(
                                  'flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-all',
                                  groupPay?.method === m.key
                                    ? 'bg-[#006d5a] text-white'
                                    : 'bg-[#f3efe9] text-[#7d6c64] active:scale-95',
                                )}
                              >
                                {m.label}
                              </button>
                            ))}
                            <button
                              onClick={() => {
                                if (groupPay?.method) void saldarTodo(group, groupPay.method)
                              }}
                              disabled={!groupPay?.method || payingAll === group.key}
                              className="flex shrink-0 items-center gap-1 rounded-lg bg-[#3d2c24] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                            >
                              {payingAll === group.key ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                              OK
                            </button>
                            <button
                              onClick={() => setGroupPay(null)}
                              className="flex shrink-0 items-center justify-center rounded-lg bg-[#f3efe9] p-1.5 text-[#a39e97]"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {group.receipts.map((r) => {
                    const isPaying = payState?.id === r.id
                    return (
                      <div key={r.id} className="px-4 py-2.5">
                        {/* Fila principal */}
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-[#3d2c24]">
                              {r.note ?? `${r.qty} ${r.unit ?? ''}`}
                            </p>
                            <p className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-[#a39e97]">
                              <span>{format(new Date(`${r.received_date}T12:00:00`), 'd MMM yyyy', { locale: es })}</span>
                              <span>· {r.qty} {r.unit ?? 'u'}</span>
                              {r.payment_method && (
                                <span className="rounded-full bg-[#fdf6ec] px-1.5 py-0.5 font-semibold text-[#d4943a]">
                                  {methodLabel(r.payment_method)}
                                </span>
                              )}
                            </p>
                          </div>
                          <span className="shrink-0 text-xs font-bold tabular-nums text-[#3d2c24]">
                            {fmtMoney(Number(r.cost_total) || 0)}
                          </span>
                          {!isPaying && editState?.id !== r.id && (
                            <button
                              onClick={() => setEditState({ id: r.id, costTotal: String(r.cost_total ?? ''), note: r.note ?? '' })}
                              className="flex shrink-0 items-center justify-center rounded-lg border border-[#ebe6df] p-1.5 text-[#a39e97] hover:bg-[#faf8f5]"
                              title="Editar monto o nota"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          )}
                          {!isPaying && editState?.id !== r.id && (
                            <button
                              onClick={() => setPayState({ id: r.id, method: null })}
                              className="flex shrink-0 items-center gap-1 rounded-lg bg-[#006d5a] px-2.5 py-1.5 text-[11px] font-semibold text-white transition-all active:scale-95"
                            >
                              <Check className="size-3" />
                              Pagar
                            </button>
                          )}
                          {(isPaying || editState?.id === r.id) && (
                            <button
                              onClick={() => { setPayState(null); setEditState(null) }}
                              className="flex shrink-0 items-center justify-center rounded-lg bg-[#f3efe9] p-1.5 text-[#a39e97]"
                            >
                              <X className="size-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Selector de medio de pago (aparece al tocar Pagar) */}
                        {isPaying && (
                          <div className="mt-2 border-t border-[#f5f0ea] pt-2">
                            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">¿Cómo se paga?</p>
                            <div className="flex items-center gap-2">
                              {PAY_METHODS.map((m) => (
                                <button
                                  key={m.key}
                                  onClick={() => setPayState((p) => p ? { ...p, method: m.key } : null)}
                                  className={cn(
                                    'flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-all',
                                    payState?.method === m.key
                                      ? 'bg-[#006d5a] text-white'
                                      : 'bg-[#f3efe9] text-[#7d6c64] active:scale-95',
                                  )}
                                >
                                  {m.label}
                                </button>
                              ))}
                              <button
                                onClick={() => {
                                  if (payState?.method) void markPaid(r, payState.method)
                                }}
                                disabled={!payState?.method || confirming}
                                className="flex shrink-0 items-center gap-1 rounded-lg bg-[#3d2c24] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                              >
                                {confirming ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                                OK
                              </button>
                            </div>
                          </div>
                        )}
                        {editState?.id === r.id && (
                          <div className="mt-2 border-t border-[#f5f0ea] pt-2 space-y-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Editar recibo</p>
                            <div className="grid gap-1.5 sm:grid-cols-2">
                              <label className="block">
                                <span className="text-[10px] font-semibold text-[#7d6c64]">Monto ($)</span>
                                <input
                                  type="number"
                                  value={editState.costTotal}
                                  onChange={(e) => setEditState((es) => es ? { ...es, costTotal: e.target.value } : null)}
                                  className="mt-0.5 w-full rounded-lg border border-[#ebe6df] bg-white px-2 py-1.5 text-xs focus:border-[#006d5a] focus:outline-none"
                                />
                              </label>
                              <label className="block">
                                <span className="text-[10px] font-semibold text-[#7d6c64]">Nota</span>
                                <input
                                  value={editState.note}
                                  onChange={(e) => setEditState((es) => es ? { ...es, note: e.target.value } : null)}
                                  placeholder="Opcional"
                                  className="mt-0.5 w-full rounded-lg border border-[#ebe6df] bg-white px-2 py-1.5 text-xs focus:border-[#006d5a] focus:outline-none"
                                />
                              </label>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => void saveEdit()}
                                disabled={savingEdit}
                                className="flex items-center gap-1 rounded-lg bg-[#006d5a] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60"
                              >
                                {savingEdit ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                                Guardar
                              </button>
                              <button
                                onClick={() => setEditState(null)}
                                className="rounded-lg border border-[#ebe6df] px-3 py-1.5 text-[11px] text-[#7d6c64]"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </FadeIn>
        )
      })}

      {!migrationMissing && pending.length === 0 && sinPrecio.length === 0 && (
        <FadeIn>
          <div className="flex flex-col items-center py-10 text-center">
            <Wallet className="size-10 text-[#ebe6df]" />
            <p className="mt-4 text-sm font-medium text-[#a39e97]">No hay deudas con proveedores</p>
            <p className="mt-1 text-xs text-[#a39e97]/70">
              Los gastos que se reciban como &quot;a pagar&quot; aparecen acá, agrupados por proveedor
            </p>
          </div>
        </FadeIn>
      )}

      {!migrationMissing && paid.length > 0 && (
        <FadeIn>
          <button
            onClick={() => setShowPaid((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 py-1 text-[11px] font-semibold text-[#a39e97]"
          >
            {showPaid ? 'Ocultar pagados recientes' : `Ver pagados recientes (${paid.length})`}
            {showPaid ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
          {showPaid && (
            <div className="mt-2 overflow-hidden rounded-2xl bg-white ring-1 ring-[#ebe6df]">
              <div className="divide-y">
                {paid.map((r) => (
                  <div key={r.id} className={cn('flex items-center gap-3 px-4 py-2.5 opacity-70')}>
                    <Check className="size-3.5 shrink-0 text-[#006d5a]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-[#3d2c24]">{r.supplier_name} — {r.note ?? `${r.qty} ${r.unit ?? ''}`}</p>
                      <p className="text-[10px] text-[#a39e97]">
                        Pagado {r.paid_at ? format(new Date(r.paid_at), 'd MMM', { locale: es }) : ''}
                        {r.payment_method ? ` · ${methodLabel(r.payment_method)}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-[#006d5a]">
                      {fmtMoney(Number(r.cost_total) || 0)}
                    </span>
                    <button
                      onClick={() => void deshacer(r)}
                      disabled={undoing === r.id}
                      title="Volver a a pagar (si lo marcaste por error)"
                      className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold text-[#7d6c64] ring-1 ring-[#ebe6df] transition-all active:scale-95 disabled:opacity-60"
                    >
                      {undoing === r.id ? <Loader2 className="size-3 animate-spin" /> : 'Deshacer'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </FadeIn>
      )}
    </div>
  )
}
