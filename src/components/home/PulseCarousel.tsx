'use client'

// ---------------------------------------------------------------------------
// PulseCarousel — hero rotativo del inicio (solo socio/encargado).
// Va pasando en loop lo importante del negocio: ventas de hoy, balance 7d,
// compras (a pagar + pendientes de pedir) y consumo del personal 7d.
// - Auto-rotación cada 6s, pausable al tocar / hover, con dots indicadores.
// - Carga en paralelo y tolerante a fallas: si un dato no llega, ese slide
//   simplemente no aparece (no rompe el resto).
// Lenguaje visual: tarjeta hero con gradiente verde de /ventas, texto crema.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, BarChart3, Scale, ShoppingCart, UtensilsCrossed } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { motion, AnimatePresence } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VentasHoy = { total: number; tickets: number; peakHour: string | null } | null

type Balance7 = { sold: number; purchased: number; balance: number }
type Compras = { aPagar: number | null; pendientes: number }

type Slide = {
  key: string
  eyebrow: string
  value: string
  valueColor?: string
  detail: string
  href: string
  icon: LucideIcon
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtMoney(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`
  return `${sign}$${Math.round(abs).toLocaleString('es-AR')}`
}

const ROTATE_MS = 6000

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PulseCarousel({ ventasHoy }: { ventasHoy: VentasHoy }) {
  const [balance7, setBalance7] = useState<Balance7 | null>(null)
  const [compras, setCompras] = useState<Compras | null>(null)
  const [consumo7, setConsumo7] = useState<number | null>(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ------------------------------------------------------------------
  // Carga en paralelo, tolerante a fallas por slide
  // ------------------------------------------------------------------
  useEffect(() => {
    let alive = true

    const loadBalance = async () => {
      const res = await fetch('/api/ventas/balance?days=7')
      if (!res.ok) return
      const data = await res.json()
      if (alive && data?.totals) {
        setBalance7({
          sold: Number(data.totals.sold ?? 0),
          purchased: Number(data.totals.purchased ?? 0),
          balance: Number(data.totals.balance ?? 0),
        })
      }
    }

    const loadCompras = async () => {
      const supabase = createClient()
      const [kitchenRes, barRes, receiptsRes] = await Promise.all([
        supabase.from('kitchen_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('bar_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('stock_receipts').select('cost_total').eq('payment_status', 'a_pagar').not('cost_total', 'is', null),
      ])
      const countsOk = !kitchenRes.error || !barRes.error
      if (!countsOk && receiptsRes.error) return // nada útil: el slide no aparece
      const pendientes = (kitchenRes.count ?? 0) + (barRes.count ?? 0)
      // Tolerante a que la migración de payment_status no esté aplicada
      const aPagar = receiptsRes.error
        ? null
        : Math.round((receiptsRes.data ?? []).reduce((acc, r) => acc + (Number((r as { cost_total: number | null }).cost_total) || 0), 0))
      if (alive) setCompras({ aPagar, pendientes })
    }

    const loadConsumo = async () => {
      const res = await fetch('/api/personal/consumo?days=7')
      if (!res.ok) return
      const data = await res.json()
      if (alive && typeof data?.total_cost === 'number') setConsumo7(data.total_cost)
    }

    // Promise.allSettled: una falla no tumba a las demás
    Promise.allSettled([loadBalance(), loadCompras(), loadConsumo()])
    return () => { alive = false }
  }, [])

  // ------------------------------------------------------------------
  // Slides disponibles (solo los que tienen datos)
  // ------------------------------------------------------------------
  const slides = useMemo<Slide[]>(() => {
    const list: Slide[] = []
    if (ventasHoy) {
      list.push({
        key: 'ventas-hoy',
        eyebrow: 'Facturado hoy',
        value: fmtMoney(ventasHoy.total),
        detail: `${ventasHoy.tickets} platos${ventasHoy.peakHour ? ` · pico ${ventasHoy.peakHour}hs` : ''}`,
        href: '/ventas',
        icon: BarChart3,
      })
    }
    if (balance7) {
      const positive = balance7.balance >= 0
      list.push({
        key: 'balance-7d',
        eyebrow: 'Balance 7 días',
        value: `${positive ? '+' : ''}${fmtMoney(balance7.balance)}`,
        valueColor: positive ? undefined : '#ffb4a8',
        detail: `Vendido ${fmtMoney(balance7.sold)} · Comprado ${fmtMoney(balance7.purchased)}`,
        href: '/ventas',
        icon: Scale,
      })
    }
    if (compras) {
      list.push({
        key: 'compras',
        eyebrow: 'Compras',
        value: compras.aPagar !== null ? fmtMoney(compras.aPagar) : `${compras.pendientes}`,
        valueColor: compras.aPagar ? '#ffd9a0' : undefined,
        detail: compras.aPagar !== null
          ? `a pagar · ${compras.pendientes} pendiente${compras.pendientes === 1 ? '' : 's'} de pedir hoy`
          : `pendiente${compras.pendientes === 1 ? '' : 's'} de pedir hoy`,
        href: '/pedidos',
        icon: ShoppingCart,
      })
    }
    if (consumo7 !== null) {
      list.push({
        key: 'consumo-personal',
        eyebrow: 'Consumo del personal · 7d',
        value: fmtMoney(consumo7),
        detail: 'Lo que consumió el equipo esta semana',
        href: '/admin/personal',
        icon: UtensilsCrossed,
      })
    }
    return list
  }, [ventasHoy, balance7, compras, consumo7])

  // Clamp del índice si cambia la cantidad de slides
  useEffect(() => {
    if (index >= slides.length && slides.length > 0) setIndex(0)
  }, [slides.length, index])

  // ------------------------------------------------------------------
  // Auto-rotación (pausable)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (paused || slides.length < 2) return
    const t = setInterval(() => setIndex((i) => (i + 1) % slides.length), ROTATE_MS)
    return () => clearInterval(t)
  }, [paused, slides.length])

  useEffect(() => () => { if (resumeTimer.current) clearTimeout(resumeTimer.current) }, [])

  if (slides.length === 0) return null

  const slide = slides[Math.min(index, slides.length - 1)]
  const Icon = slide.icon

  const pause = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current)
    setPaused(true)
  }
  const resumeSoon = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current)
    resumeTimer.current = setTimeout(() => setPaused(false), 8000)
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl text-white shadow-lg shadow-[#006d5a]/15"
      style={{ background: 'linear-gradient(135deg, #017c66 0%, #006d5a 45%, #00523f 100%)' }}
      onMouseEnter={pause}
      onMouseLeave={resumeSoon}
      onTouchStart={pause}
      onTouchEnd={resumeSoon}
    >
      {/* Texturas decorativas — mismo lenguaje que /ventas */}
      <div className="pointer-events-none absolute -right-12 -top-16 size-48 rounded-full bg-white/[0.06]" />
      <div className="pointer-events-none absolute -bottom-20 -left-10 size-44 rounded-full bg-black/[0.10]" />

      <div className="relative min-h-[132px] p-5 pb-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={slide.key}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            <Link href={slide.href} className="block">
              <div className="flex items-center gap-2">
                <Icon className="size-3.5 text-[#f5efdf]/80" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#f5efdf]/80">
                  {slide.eyebrow}
                </span>
              </div>
              <p
                className="mt-1.5 font-display text-4xl font-bold tabular-nums text-[#faf6ec]"
                style={slide.valueColor ? { color: slide.valueColor } : undefined}
              >
                {slide.value}
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <p className="text-xs text-[#f5efdf]/75">{slide.detail}</p>
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[#f5efdf]">
                  Ver <ArrowRight className="size-3" />
                </span>
              </div>
            </Link>
          </motion.div>
        </AnimatePresence>

        {/* Dots indicadores */}
        {slides.length > 1 && (
          <div className="mt-3 flex items-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.key}
                type="button"
                aria-label={s.eyebrow}
                onClick={() => { setIndex(i); pause(); resumeSoon() }}
                className="flex h-5 items-center px-0.5"
              >
                <span
                  className={`block h-1.5 rounded-full transition-all duration-300 ${
                    i === index ? 'w-5 bg-[#faf6ec]' : 'w-1.5 bg-white/30'
                  }`}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
