'use client'

// ---------------------------------------------------------------------------
// Tolva de café — el cuaderno de los baristas, hecho app.
// Igual que el papel: Inicio / Agregado / Final por turno (TM 8-16, TT 16-cierre),
// pero el inicio se arrastra solo del turno anterior y el consumo se calcula.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, subDays } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { Coffee, Check, Loader2, Sun, Moon, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { LoadingState } from '@/components/ui/LoadingState'
import { FadeIn } from '@/components/ui/motion'

type TolvaLog = {
  id: number
  log_date: string
  shift: 'TM' | 'TT'
  start_gr: number | null
  added_gr: number
  end_gr: number | null
  notes: string | null
}

// Fecha y turno actuales en hora argentina (TM hasta las 16, TT después)
function nowInArgentina() {
  const dateStr = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false })) % 24
  return { dateStr, shift: (hour < 16 ? 'TM' : 'TT') as 'TM' | 'TT' }
}

const consumption = (l: Pick<TolvaLog, 'start_gr' | 'added_gr' | 'end_gr'>) =>
  l.start_gr != null && l.end_gr != null ? Math.round((l.start_gr + Number(l.added_gr) - l.end_gr) * 10) / 10 : null

export default function TolvaPage() {
  const { profile, loading: profileLoading } = useProfileContext()
  const supabase = useMemo(() => createClient(), [])

  const [{ dateStr, shift }] = useState(nowInArgentina)
  const [logs, setLogs] = useState<TolvaLog[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [startGr, setStartGr] = useState('')
  const [addedGr, setAddedGr] = useState('')
  const [endGr, setEndGr] = useState('')

  const fetchLogs = useCallback(async () => {
    const since = format(subDays(new Date(), 14), 'yyyy-MM-dd')
    const { data } = await supabase
      .from('tolva_logs')
      .select('id, log_date, shift, start_gr, added_gr, end_gr, notes')
      .gte('log_date', since)
      .order('log_date', { ascending: false })
      .order('shift', { ascending: false })
    const rows = (data ?? []) as TolvaLog[]
    setLogs(rows)

    // Turno actual: si ya existe, cargar sus valores; si no, arrastrar el
    // final del último turno registrado como inicio (como hacen en el cuaderno)
    const current = rows.find(l => l.log_date === dateStr && l.shift === shift)
    if (current) {
      setStartGr(current.start_gr?.toString() ?? '')
      setAddedGr(current.added_gr ? current.added_gr.toString() : '')
      setEndGr(current.end_gr?.toString() ?? '')
    } else {
      const previous = rows.find(l => !(l.log_date === dateStr && l.shift === shift))
      if (previous?.end_gr != null) setStartGr(previous.end_gr.toString())
    }
    setLoading(false)
  }, [supabase, dateStr, shift])

  useEffect(() => { if (profile) fetchLogs() }, [profile, fetchLogs])

  async function save() {
    if (!profile) return
    const start = startGr === '' ? null : Number(startGr)
    const added = addedGr === '' ? 0 : Number(addedGr)
    const end = endGr === '' ? null : Number(endGr)
    if (start == null && end == null) { toast.error('Cargá al menos el inicio'); return }

    setSaving(true)
    try {
      const { error } = await supabase
        .from('tolva_logs')
        .upsert(
          { log_date: dateStr, shift, start_gr: start, added_gr: added, end_gr: end, created_by: profile.id, updated_at: new Date().toISOString() },
          { onConflict: 'log_date,shift' },
        )
      if (error) throw error
      toast.success(end != null ? `Turno cerrado — consumo: ${consumption({ start_gr: start, added_gr: added, end_gr: end })} gr ☕` : 'Guardado ✓')
      fetchLogs()
    } catch {
      toast.error('No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  // Promedios de consumo por turno (últimos 14 días con datos completos)
  const stats = useMemo(() => {
    const byShift: Record<'TM' | 'TT', number[]> = { TM: [], TT: [] }
    for (const l of logs) {
      const c = consumption(l)
      if (c != null && c >= 0) byShift[l.shift].push(c)
    }
    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null
    return { tm: avg(byShift.TM), tt: avg(byShift.TT) }
  }, [logs])

  if (profileLoading || loading) return <LoadingState message="Cargando tolva..." />

  const liveConsumption = consumption({
    start_gr: startGr === '' ? null : Number(startGr),
    added_gr: addedGr === '' ? 0 : Number(addedGr),
    end_gr: endGr === '' ? null : Number(endGr),
  })

  return (
    <div className="mx-auto max-w-lg space-y-4 pb-28">
      <FadeIn>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-[#8b5e34]/10">
            <Coffee className="size-5 text-[#8b5e34]" />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-[#3d2c24]">Tolva de café</h1>
            <p className="text-xs text-[#a39e97]">Inicio, agregado y final del turno — el consumo se calcula solo</p>
          </div>
        </div>
      </FadeIn>

      {/* Turno actual */}
      <FadeIn delay={0.05}>
        <div className="rounded-2xl bg-white p-4 ring-1 ring-[#ebe6df]">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-bold capitalize text-[#3d2c24]">
              {shift === 'TM' ? <Sun className="size-4 text-[#d4943a]" /> : <Moon className="size-4 text-[#4a90d9]" />}
              {format(new Date(dateStr + 'T12:00:00'), "EEEE d 'de' MMMM", { locale: es })} · Turno {shift === 'TM' ? 'mañana' : 'tarde'}
            </p>
            <span className="rounded-full bg-[#f3efe9] px-2.5 py-1 text-[10px] font-bold text-[#7d6c64]">{shift}</span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Inicio (gr)</label>
              <input
                type="number" inputMode="decimal" value={startGr}
                onChange={e => setStartGr(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2.5 text-center text-sm font-bold focus:border-[#8b5e34] focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Agregado (gr)</label>
              <input
                type="number" inputMode="decimal" value={addedGr} placeholder="0"
                onChange={e => setAddedGr(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2.5 text-center text-sm font-bold focus:border-[#8b5e34] focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[#a39e97]">Final (gr)</label>
              <input
                type="number" inputMode="decimal" value={endGr} placeholder="al cerrar"
                onChange={e => setEndGr(e.target.value)}
                className="mt-1 w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2.5 text-center text-sm font-bold focus:border-[#8b5e34] focus:outline-none"
              />
            </div>
          </div>

          {liveConsumption != null && (
            <p className={`mt-2 text-center text-xs font-bold ${liveConsumption < 0 ? 'text-[#ea504c]' : 'text-[#8b5e34]'}`}>
              {liveConsumption < 0
                ? '⚠️ El final no puede ser mayor que inicio + agregado — revisá los números'
                : `Consumo del turno: ${liveConsumption} gr`}
            </p>
          )}

          <button
            onClick={save}
            disabled={saving || (liveConsumption != null && liveConsumption < 0)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#8b5e34] py-2.5 text-sm font-bold text-white active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Guardar turno
          </button>
          <p className="mt-1.5 text-center text-[10px] text-[#a39e97]">
            Al arrancar cargá el inicio (viene solo del turno anterior). Al cerrar, el final.
          </p>
        </div>
      </FadeIn>

      {/* Promedios */}
      {(stats.tm != null || stats.tt != null) && (
        <FadeIn delay={0.08}>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-[#fdf6ec] p-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#d4943a]">Promedio TM</p>
              <p className="font-display text-xl font-bold text-[#d4943a]">{stats.tm ?? '—'} gr</p>
            </div>
            <div className="rounded-2xl bg-[#eef4fc] p-3 text-center">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#4a90d9]">Promedio TT</p>
              <p className="font-display text-xl font-bold text-[#4a90d9]">{stats.tt ?? '—'} gr</p>
            </div>
          </div>
        </FadeIn>
      )}

      {/* Historial */}
      <FadeIn delay={0.1}>
        <div className="rounded-2xl bg-white ring-1 ring-[#ebe6df]">
          <p className="flex items-center gap-1.5 px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#a39e97]">
            <TrendingUp className="size-3" /> Últimos turnos
          </p>
          <div className="divide-y divide-[#ebe6df]/60">
            {logs.map(l => {
              const c = consumption(l)
              return (
                <div key={l.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-xs font-semibold capitalize text-[#3d2c24]">
                      {format(new Date(l.log_date + 'T12:00:00'), 'EEE d/M', { locale: es })} · {l.shift}
                    </p>
                    <p className="text-[10px] text-[#a39e97]">
                      {l.start_gr ?? '—'} gr {l.added_gr > 0 && `+ ${l.added_gr}`} → {l.end_gr ?? 'abierto'}
                    </p>
                  </div>
                  {c != null ? (
                    <span className="rounded-full bg-[#8b5e34]/10 px-2.5 py-1 text-[11px] font-bold text-[#8b5e34]">{c} gr</span>
                  ) : (
                    <span className="rounded-full bg-[#f3efe9] px-2.5 py-1 text-[10px] font-semibold text-[#a39e97]">sin cerrar</span>
                  )}
                </div>
              )
            })}
            {logs.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-[#a39e97]">Todavía no hay registros. Este turno es el primero 🎉</p>
            )}
          </div>
        </div>
      </FadeIn>
    </div>
  )
}
