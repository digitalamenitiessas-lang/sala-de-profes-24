'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, Check, Loader2, Minus, Plus, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VinculoSupplier, VinculosPayload } from '@/lib/proveedores/vinculos'
import { DOW, WEEK, ago, useIndex } from './shared'

type Props = {
  data: VinculosPayload
  saveCalendar: (supplierId: string, days: number[], lead: number | null) => Promise<boolean>
}

export function CalendarTab({ data, saveCalendar }: Props) {
  const idx = useIndex(data)
  const [showAll, setShowAll] = useState(false)
  const suggested = new Set(data.review.calendar)

  // Proveedores que efectivamente abastecen algo (principal de ≥1 insumo)
  const withItems = useMemo(
    () => data.suppliers
      .filter((s) => (idx.primaryCountBySupplier.get(s.id) ?? 0) > 0)
      .sort((a, b) => (idx.primaryCountBySupplier.get(b.id) ?? 0) - (idx.primaryCountBySupplier.get(a.id) ?? 0)),
    [data.suppliers, idx],
  )
  const pending = withItems.filter((s) => suggested.has(s.id))
  const configured = withItems.filter((s) => s.order_days.length > 0)
  const rest = withItems.filter((s) => !suggested.has(s.id) && s.order_days.length === 0)

  return (
    <div className="space-y-6">
      <div className="flex gap-3 rounded-2xl bg-[#fef7ed] p-3.5 ring-1 ring-[#d4943a]/20">
        <CalendarDays className="mt-0.5 size-5 shrink-0 text-[#d4943a]" />
        <p className="text-[12.5px] leading-relaxed text-[#7d6c64]">
          Con los días de pedido y lo que tarda en entregar, <b className="text-[#3d2c24]">Pedidos</b> sabe
          qué pedir cada día y para cuántos días tiene que alcanzar.
          Las barritas muestran qué días se registran sus compras en Fudo (suele ser
          el día que llega la mercadería): ajustá los días y la demora si pedís antes.
        </p>
      </div>

      {pending.length > 0 && (
        <Section title={`Sugeridos por Fudo (${pending.length})`} hint="Se les compra seguido y todavía no tienen días de pedido.">
          {pending.map((s) => <SupplierCalendar key={s.id} s={s} items={idx.primaryCountBySupplier.get(s.id) ?? 0} save={saveCalendar} suggestFromFudo />)}
        </Section>
      )}

      {configured.length > 0 && (
        <Section title={`Con calendario (${configured.length})`}>
          {configured.map((s) => <SupplierCalendar key={s.id} s={s} items={idx.primaryCountBySupplier.get(s.id) ?? 0} save={saveCalendar} />)}
        </Section>
      )}

      {rest.length > 0 && (
        <Section title={`Sin calendario (${rest.length})`} hint="Sin días cargados, las sugerencias asumen que el pedido tiene que cubrir 7 días.">
          {(showAll ? rest : rest.slice(0, 6)).map((s) => <SupplierCalendar key={s.id} s={s} items={idx.primaryCountBySupplier.get(s.id) ?? 0} save={saveCalendar} />)}
          {!showAll && rest.length > 6 && (
            <button onClick={() => setShowAll(true)} className="w-full rounded-xl py-2 text-[12px] font-semibold text-[#006d5a] hover:bg-white">
              Ver {rest.length - 6} más
            </button>
          )}
        </Section>
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-[13px] font-bold text-[#3d2c24]">{title}</h2>
        {hint && <p className="text-[11.5px] text-[#a39e97]">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function SupplierCalendar({ s, items, save, suggestFromFudo }: {
  s: VinculoSupplier
  items: number
  save: (supplierId: string, days: number[], lead: number | null) => Promise<boolean>
  suggestFromFudo?: boolean
}) {
  const initialDays = s.order_days.length ? s.order_days : suggestFromFudo ? s.rhythm?.usual_days ?? [] : []
  const [days, setDays] = useState<number[]>(initialDays)
  const [lead, setLead] = useState<number | null>(s.lead_time_days ?? (suggestFromFudo ? 0 : null))
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const dirty = days.slice().sort().join() !== s.order_days.slice().sort().join() || lead !== s.lead_time_days
  const maxDow = Math.max(1, ...(s.rhythm?.by_dow ?? [0]))

  async function onSave() {
    setSaving(true)
    const ok = await save(s.id, [...days].sort(), lead)
    setSaving(false)
    if (ok) setSavedAt(Date.now())
  }

  return (
    <div className={cn('rounded-2xl bg-white p-3.5 shadow-sm ring-1', suggestFromFudo ? 'ring-[#006d5a]/25' : 'ring-[#ebe6df]')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-[#3d2c24]">{s.name}</p>
          <p className="text-[11px] text-[#a39e97]">
            {items} insumo{items === 1 ? '' : 's'}
            {s.rhythm && <> · {s.rhythm.purchases} compras en Fudo, última {ago(s.rhythm.last_at)}</>}
          </p>
        </div>
        {suggestFromFudo && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#e8f5f1] px-2 py-0.5 text-[10px] font-semibold text-[#006d5a]">
            <Sparkles className="size-3" /> Fudo
          </span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {WEEK.map((d) => {
          const on = days.includes(d)
          const count = s.rhythm?.by_dow[d] ?? 0
          const usual = s.rhythm?.usual_days.includes(d)
          return (
            <button
              key={d}
              onClick={() => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}
              aria-pressed={on}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl py-1.5 transition active:scale-95',
                on ? 'bg-[#006d5a] text-white' : 'bg-[#faf8f5] text-[#7d6c64] hover:bg-[#f0ebe4]',
              )}
            >
              {/* barra: cuántas veces se le compró ese día en Fudo */}
              <span className="flex h-5 w-full items-end justify-center">
                <span
                  className={cn('w-1.5 rounded-full', on ? 'bg-white/70' : usual ? 'bg-[#006d5a]/60' : 'bg-[#d9d2c8]')}
                  style={{ height: `${count ? Math.max(15, (count / maxDow) * 100) : 0}%` }}
                />
              </span>
              <span className="text-[11px] font-semibold">{DOW[d]}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-[#7d6c64]">Entrega en</span>
          <div className="flex items-center rounded-lg ring-1 ring-[#ebe6df]">
            <button onClick={() => setLead((l) => (l === null || l <= 0 ? null : l - 1))} aria-label="Menos días" className="p-1.5 text-[#7d6c64]">
              <Minus className="size-3.5" />
            </button>
            <span className="min-w-[3.2rem] text-center text-[12px] font-semibold text-[#3d2c24]">
              {lead === null ? '—' : lead === 0 ? 'el día' : `${lead} día${lead === 1 ? '' : 's'}`}
            </span>
            <button onClick={() => setLead((l) => Math.min(30, (l ?? -1) + 1))} aria-label="Más días" className="p-1.5 text-[#7d6c64]">
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>
        <button
          onClick={onSave}
          disabled={saving || (!dirty && !suggestFromFudo)}
          className={cn(
            'flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold transition active:scale-95 disabled:opacity-40',
            savedAt && !dirty ? 'bg-[#e8f5f1] text-[#006d5a]' : 'bg-[#006d5a] text-white',
          )}
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {savedAt && !dirty ? 'Guardado' : suggestFromFudo && !dirty ? 'Usar estos días' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}
