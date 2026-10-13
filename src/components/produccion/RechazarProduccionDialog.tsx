'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, XCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog'

// ---------------------------------------------------------------------------
// Rechazar una producción que espera validación
// ---------------------------------------------------------------------------
// Solo socio/encargado. El motivo es obligatorio y le llega por push a quien
// la cargó. Como la producción todavía no movió stock, no se toca LVE ni Fudo.
// ---------------------------------------------------------------------------

const MOTIVOS_RAPIDOS = [
  'Cantidades mal cargadas',
  'Insumo equivocado',
  'Producción duplicada',
  'No se hizo',
]

export function RechazarProduccionDialog({ orden, onClose, onDone }: {
  orden: { id: number; name: string }
  onClose: () => void
  onDone: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const motivoOk = motivo.trim().length >= 3

  async function rechazar() {
    if (!motivoOk) return
    setEnviando(true)
    try {
      const res = await fetch(`/api/produccion/orders/${orden.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: motivo.trim() }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) throw new Error(json?.error ?? 'No se pudo rechazar la producción')
      toast.success('Producción rechazada. Le avisamos a quien la cargó.')
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al rechazar la producción')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !enviando) onClose() }}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <XCircle className="size-4 text-[#ea504c]" /> Rechazar &quot;{orden.name}&quot;
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-[12.5px] text-[#7d6c64]">
            No se toca el stock ni Fudo. Quien la cargó recibe el aviso con el motivo y puede cargarla de nuevo bien.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS_RAPIDOS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMotivo(m)}
                className="rounded-full bg-white px-3 py-1 text-[11.5px] font-medium text-[#7d6c64] ring-1 ring-[#ebe6df]"
              >
                {m}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="text-[11px] font-semibold text-[#3d2c24]">Motivo (obligatorio)</span>
            <textarea
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="¿Qué estuvo mal?"
              className="mt-1 w-full resize-none rounded-xl border border-[#ebe6df] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#ea504c]"
            />
          </label>
        </div>

        <DialogFooter className="mt-2 gap-2">
          <DialogClose disabled={enviando} className="rounded-xl px-4 py-2 text-sm font-medium text-[#7d6c64]">Volver</DialogClose>
          <button
            onClick={() => void rechazar()}
            disabled={enviando || !motivoOk}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#ea504c] px-5 py-2 text-sm font-semibold text-white active:scale-[0.98] disabled:opacity-60"
          >
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <XCircle className="size-4" />}
            Rechazar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
