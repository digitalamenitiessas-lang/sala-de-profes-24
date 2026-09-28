'use client'

import { useState, useMemo } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { STATUS_TRANSITIONS, EXPEDIENTE_STATUSES } from '@/lib/constants/expedientes'
import type { ExpedienteStatus } from '@/types/expedientes'
import type { AppRole } from '@/types/database'

type Props = {
  expedienteId: string
  currentStatus: ExpedienteStatus
  userRole: AppRole
  isAuthor: boolean
  isResponsible: boolean
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

const NEEDS_CLOSE_REASON: ExpedienteStatus[] = ['cumplido', 'cerrado_sin_implementacion']

// Statuses that only socio/encargado can transition TO
const ADMIN_ONLY_TARGETS: ExpedienteStatus[] = [
  'en_revision', 'admitido', 'asignado', 'cumplido', 'cerrado_sin_implementacion', 'archivado',
]

// Statuses that require being responsible (or socio/encargado)
const EXEC_TARGETS: ExpedienteStatus[] = [
  'en_ejecucion', 'pausado', 'pendiente_tercero', 'pendiente_decision', 'revision_final',
]

export function StatusTransitionDialog({
  expedienteId, currentStatus, userRole, isAuthor, isResponsible,
  open, onClose, onSuccess,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [selectedStatus, setSelectedStatus] = useState<ExpedienteStatus | null>(null)
  const [closeReason, setCloseReason] = useState('')

  // Filter transitions by what THIS user can actually perform
  const allowedStatuses = useMemo(() => {
    const isSocio = userRole === 'socio'
    const isSocioOrEnc = isSocio || userRole === 'encargado'

    // Socio can go to ANY status (superadmin) — skip the strict flow
    if (isSocio) {
      const allStatuses = Object.keys(EXPEDIENTE_STATUSES) as ExpedienteStatus[]
      return allStatuses.filter(s => s !== currentStatus && s !== 'archivado')
    }

    // Encargado follows the flow but can access all flow-defined transitions
    const allNext = STATUS_TRANSITIONS[currentStatus] ?? []
    if (userRole === 'encargado') return allNext

    return allNext.filter((status) => {
      // Author can present own borrador
      if (currentStatus === 'borrador' && status === 'presentado' && isAuthor) return true
      // Responsible can do execution transitions
      if (EXEC_TARGETS.includes(status) && isResponsible) return true
      // Admin-only transitions blocked for others
      if (ADMIN_ONLY_TARGETS.includes(status)) return false
      return false
    })
  }, [currentStatus, userRole, isAuthor, isResponsible])

  if (!open) return null

  const handleSubmit = async () => {
    if (!selectedStatus) return
    if (NEEDS_CLOSE_REASON.includes(selectedStatus) && !closeReason.trim()) {
      toast.error('El motivo de cierre es obligatorio')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/expedientes/${expedienteId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: selectedStatus,
          close_reason: closeReason.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')

      toast.success(`Estado actualizado: ${EXPEDIENTE_STATUSES[selectedStatus]?.label}`)
      setSelectedStatus(null)
      setCloseReason('')
      onSuccess()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  const isDestructive = selectedStatus && NEEDS_CLOSE_REASON.includes(selectedStatus)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative z-10 mx-3 mb-[calc(0.5rem+env(safe-area-inset-bottom))] w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl bg-card p-5 shadow-xl sm:mx-auto sm:mb-0">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold">Cambiar Estado</h3>
          <button onClick={onClose} className="icon-btn flex items-center justify-center rounded-full hover:bg-muted" aria-label="Cerrar">
            <X className="size-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          Estado actual: <span className="font-semibold">{EXPEDIENTE_STATUSES[currentStatus]?.label}</span>
        </p>

        {allowedStatuses.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No tenés transiciones disponibles para tu rol
          </p>
        ) : (
          <div className="space-y-2">
            {allowedStatuses.map((status) => {
              const config = EXPEDIENTE_STATUSES[status]
              const isSelected = selectedStatus === status
              const isClose = NEEDS_CLOSE_REASON.includes(status)
              return (
                <button
                  key={status}
                  onClick={() => setSelectedStatus(status)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all ${
                    isSelected
                      ? isClose
                        ? 'border-[#ea504c] bg-[#fef2f2] ring-1 ring-[#ea504c]'
                        : 'border-[#006d5a] bg-[#e8f5f1] ring-1 ring-[#006d5a]'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: config?.color }}
                  />
                  {config?.label ?? status}
                  {isClose && <AlertTriangle className="ml-auto size-3.5 text-[#ea504c]" />}
                </button>
              )
            })}

            {/* Close reason textarea */}
            {selectedStatus && NEEDS_CLOSE_REASON.includes(selectedStatus) && (
              <div className="mt-2">
                <label htmlFor="close-reason" className="block text-xs font-semibold text-foreground mb-1">
                  Motivo de cierre *
                </label>
                <textarea
                  id="close-reason"
                  placeholder="Explicá por qué se cierra este expediente..."
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-[#006d5a] focus:outline-none focus:ring-1 focus:ring-[#006d5a]"
                  rows={3}
                />
              </div>
            )}

            {/* Confirmation warning for destructive actions */}
            {isDestructive && (
              <div className="mt-1 flex items-start gap-2 rounded-lg bg-[#fef2f2] p-2.5 text-xs text-[#ea504c]">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                <span>Esta acción cerrará el expediente. No se podrá revertir sin intervención manual.</span>
              </div>
            )}

            <button
              disabled={!selectedStatus || loading}
              onClick={handleSubmit}
              className={`mt-3 w-full rounded-xl h-12 text-sm font-semibold text-white transition-colors disabled:opacity-50 active:scale-[0.98] ${
                isDestructive
                  ? 'bg-[#ea504c] hover:bg-[#d43f3f]'
                  : 'bg-[#006d5a] hover:bg-[#005a4a]'
              }`}
            >
              {loading ? 'Guardando...' : isDestructive ? 'Cerrar Expediente' : 'Confirmar Cambio'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
