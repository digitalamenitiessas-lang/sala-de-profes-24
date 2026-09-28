'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Send, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { EXPEDIENTE_TYPES, EXPEDIENTE_AREAS, EXPEDIENTE_URGENCIES } from '@/lib/constants/expedientes'
import { FadeIn } from '@/components/ui/motion'
import type { ExpedienteType, ExpedienteArea, ExpedienteUrgency } from '@/types/expedientes'

const STORAGE_KEY = 'lve-expediente-draft'

type DraftState = {
  title: string
  description: string
  reason: string
  type: ExpedienteType | ''
  urgency: ExpedienteUrgency
  areas: ExpedienteArea[]
  targetDate: string
}

const EMPTY_DRAFT: DraftState = {
  title: '', description: '', reason: '', type: '', urgency: 'media', areas: [], targetDate: '',
}

export default function NuevoExpedientePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [reason, setReason] = useState('')
  const [type, setType] = useState<ExpedienteType | ''>('')
  const [urgency, setUrgency] = useState<ExpedienteUrgency>('media')
  const [areas, setAreas] = useState<ExpedienteArea[]>([])
  const [targetDate, setTargetDate] = useState('')

  // Load draft from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const draft: DraftState = JSON.parse(saved)
        if (draft.title || draft.description || draft.type) {
          setTitle(draft.title)
          setDescription(draft.description)
          setReason(draft.reason)
          setType(draft.type)
          setUrgency(draft.urgency)
          setAreas(draft.areas)
          setTargetDate(draft.targetDate)
          setHasDraft(true)
        }
      }
    } catch { /* corrupted data, ignore */ }
  }, [])

  // Auto-save draft on every change (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      const draft: DraftState = { title, description, reason, type, urgency, areas, targetDate }
      const hasContent = title || description || type
      if (hasContent) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [title, description, reason, type, urgency, areas, targetDate])

  const clearDraft = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setTitle('')
    setDescription('')
    setReason('')
    setType('')
    setUrgency('media')
    setAreas([])
    setTargetDate('')
    setHasDraft(false)
    toast.success('Borrador limpiado')
  }, [])

  const toggleArea = (area: ExpedienteArea) => {
    setAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area],
    )
  }

  const handleSubmit = async () => {
    if (!title.trim()) { toast.error('El título es obligatorio'); return }
    if (!type) { toast.error('Seleccioná un tipo'); return }
    if (areas.length === 0) { toast.error('Seleccioná al menos un área'); return }

    setLoading(true)
    try {
      const res = await fetch('/api/expedientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          reason: reason.trim(),
          type,
          areas,
          urgency,
          target_date: targetDate || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al crear')

      // Clear draft on success
      localStorage.removeItem(STORAGE_KEY)
      toast.success(`Expediente ${data.data.code} creado`)
      router.push(`/expedientes/${data.data.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <FadeIn className="px-5 pb-28 pt-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/expedientes"
          aria-label="Volver a expedientes"
          className="flex size-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="flex-1">
          <h1 className="font-display text-xl font-bold text-foreground">
            Nuevo Expediente
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Cargar idea, tarea o proyecto
          </p>
        </div>
        {hasDraft && (
          <button
            onClick={clearDraft}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-[#ea504c] hover:bg-[#fef2f2]"
          >
            <Trash2 className="size-3" />
            Limpiar
          </button>
        )}
      </div>

      {/* Draft banner */}
      {hasDraft && (
        <div className="mb-4 rounded-xl border border-[#d4943a]/30 bg-[#fdf6ec] px-3 py-2 text-xs text-[#d4943a] font-medium">
          📝 Borrador recuperado. Tus cambios se guardan automáticamente.
        </div>
      )}

      <div className="space-y-5">
        {/* Title */}
        <div>
          <label htmlFor="exp-title" className="form-label block text-xs font-semibold text-foreground mb-1.5">
            Título *
          </label>
          <input
            id="exp-title"
            type="text"
            placeholder="Ej: Renovar carta de meriendas"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-12 w-full rounded-xl border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
          />
        </div>

        {/* Type */}
        <div>
          <label className="form-label block text-xs font-semibold text-foreground mb-1.5">
            Tipo de expediente *
          </label>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(EXPEDIENTE_TYPES).map(([key, config]) => (
              <button
                key={key}
                type="button"
                onClick={() => setType(key as ExpedienteType)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition-all ${
                  type === key
                    ? 'border-[#006d5a] bg-[#e8f5f1] ring-1 ring-[#006d5a]'
                    : 'border-border hover:bg-muted'
                }`}
              >
                <span>{config.icon}</span>
                {config.label}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label htmlFor="exp-desc" className="form-label block text-xs font-semibold text-foreground mb-1.5">
            Descripción
          </label>
          <textarea
            id="exp-desc"
            placeholder="Describí la idea, problema o tarea..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
          />
        </div>

        {/* Reason */}
        <div>
          <label htmlFor="exp-reason" className="form-label block text-xs font-semibold text-foreground mb-1.5">
            ¿Por qué?
          </label>
          <textarea
            id="exp-reason"
            placeholder="Motivo, fundamento o contexto..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
          />
        </div>

        {/* Areas */}
        <div>
          <label className="form-label block text-xs font-semibold text-foreground mb-1.5">
            Áreas involucradas *
          </label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(EXPEDIENTE_AREAS).map(([key, config]) => {
              const selected = areas.includes(key as ExpedienteArea)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleArea(key as ExpedienteArea)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                    selected
                      ? 'border-[#006d5a] bg-[#e8f5f1] text-[#006d5a]'
                      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {config.icon} {config.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Urgency */}
        <div>
          <label className="form-label block text-xs font-semibold text-foreground mb-1.5">
            Urgencia
          </label>
          <div className="flex gap-2">
            {Object.entries(EXPEDIENTE_URGENCIES).map(([key, config]) => (
              <button
                key={key}
                type="button"
                onClick={() => setUrgency(key as ExpedienteUrgency)}
                className={`flex-1 rounded-xl border px-2 py-2 text-xs font-semibold transition-all ${
                  urgency === key
                    ? 'ring-1'
                    : 'border-border hover:bg-muted'
                }`}
                style={urgency === key ? { borderColor: config.color, backgroundColor: config.bg, color: config.color, boxShadow: `0 0 0 1px ${config.color}` } : {}}
              >
                {config.label}
              </button>
            ))}
          </div>
        </div>

        {/* Target date */}
        <div>
          <label htmlFor="exp-date" className="form-label block text-xs font-semibold text-foreground mb-1.5">
            Fecha objetivo (opcional)
          </label>
          <input
            id="exp-date"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'f' || e.key === 'F') {
                e.preventDefault()
                setTargetDate(new Date().toISOString().split('T')[0])
              }
            }}
            className="h-12 w-full rounded-xl border border-border bg-background px-3 text-sm focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">Presioná <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] font-semibold">F</kbd> para fecha de hoy</p>
        </div>

        {/* Submit */}
        <button
          disabled={loading || !title.trim() || !type || areas.length === 0}
          onClick={handleSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006d5a] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#005a4a] disabled:opacity-50"
        >
          <Send className="size-4" />
          {loading ? 'Creando...' : 'Crear Expediente'}
        </button>
      </div>
    </FadeIn>
  )
}
