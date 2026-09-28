'use client'

import { Loader2, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog'

// ---------------------------------------------------------------------------
// PreviewDialog — shows client-side parsed Excel data before uploading
// ---------------------------------------------------------------------------

type PreviewData = { name: string; shifts: { day: string; time: string }[] }[]

type PreviewDialogProps = {
  open: boolean
  onClose: (open: boolean) => void
  previewData: PreviewData | null
  onConfirm: () => void
  onCancel: () => void
}

export function PreviewDialog({ open, onClose, previewData, onConfirm, onCancel }: PreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[80vh] flex-col overflow-hidden rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold text-[#3d2c24]">Preview del archivo</DialogTitle>
          <DialogDescription className="text-[#a39e97]">
            {previewData?.length ?? 0} empleados detectados. Verificá antes de importar.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 space-y-2 overflow-y-auto py-2">
          {previewData?.map((emp, i) => (
            <div key={i} className="rounded-xl border border-[#ebe6df] bg-white p-3">
              <p className="text-sm font-semibold text-[#3d2c24]">{emp.name}</p>
              <div className="mt-1.5 grid grid-cols-7 gap-1">
                {emp.shifts.map((s, j) => {
                  const isDescanso = s.time.toLowerCase().includes('descanso') || s.time.toLowerCase().includes('franco') || s.time === '-' || s.time === 'X'
                  return (
                    <div key={j} className="text-center">
                      <p className="text-[8px] font-semibold text-[#a39e97]">{s.day.slice(0, 3)}</p>
                      <p className={`mt-0.5 text-[9px] font-bold ${isDescanso ? 'text-[#a39e97]' : 'text-[#3d2c24]'}`}>
                        {isDescanso ? 'D' : s.time.replace(/ [Aa] /g, '-').slice(0, 9)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1 rounded-xl border-[#ebe6df] text-[#a39e97]" onClick={onCancel}>
            Cancelar
          </Button>
          <Button className="flex-1 rounded-xl bg-[#006d5a] text-white hover:bg-[#005a4a]" onClick={onConfirm}>
            <CheckCircle className="mr-1 size-4" />
            Importar turnos
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// ReplaceConfirmDialog — asks whether to replace or add on top of existing shifts
// ---------------------------------------------------------------------------

type ReplaceConfirmDialogProps = {
  open: boolean
  onClose: (open: boolean) => void
  existingCount: number
  onReplace: () => void
  onAdd: () => void
  onCancel: () => void
}

export function ReplaceConfirmDialog({ open, onClose, existingCount, onReplace, onAdd, onCancel }: ReplaceConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold text-[#3d2c24]">Ya hay turnos cargados</DialogTitle>
          <DialogDescription className="text-[#a39e97]">
            Esta semana ya tiene <strong className="text-[#3d2c24]">{existingCount} turnos</strong> cargados.
            ¿Qué querés hacer?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 pt-2">
          <Button className="w-full rounded-xl bg-[#ea504c] text-white hover:bg-[#d4413e]" onClick={onReplace}>
            Reemplazar todos los turnos de la semana
          </Button>
          <Button variant="outline" className="w-full rounded-xl border-[#ebe6df] text-[#3d2c24]" onClick={onAdd}>
            Agregar sin borrar los existentes
          </Button>
          <Button variant="outline" className="w-full rounded-xl border-[#ebe6df] text-[#a39e97]" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// UploadResultBanner
// ---------------------------------------------------------------------------

type UploadResult = {
  created: number; skipped: number; errors: number
  details: { created: string[]; skipped: string[]; errors: string[] }
}

type UploadResultBannerProps = {
  result: UploadResult
  onClose: () => void
}

export function UploadResultBanner({ result, onClose }: UploadResultBannerProps) {
  return (
    <div className="rounded-xl border border-[#ebe6df] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[#3d2c24]">Resultado de carga</span>
        <button onClick={onClose} className="text-xs text-[#a39e97] hover:text-[#3d2c24]">Cerrar</button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-[#e8f5f1] p-2">
          <p className="font-bold text-[#006d5a]">{result.created}</p>
          <p className="text-[#006d5a]">Creados</p>
        </div>
        <div className="rounded-lg bg-[#fdf6ec] p-2">
          <p className="font-bold text-[#d4943a]">{result.skipped}</p>
          <p className="text-[#d4943a]">Duplicados</p>
        </div>
        <div className="rounded-lg bg-[#fef2f2] p-2">
          <p className="font-bold text-[#ea504c]">{result.errors}</p>
          <p className="text-[#ea504c]">Errores</p>
        </div>
      </div>
      {result.details.errors.length > 0 && (
        <div className="mt-2 max-h-24 overflow-y-auto rounded-lg bg-[#fef2f2] p-2 text-[11px] text-[#ea504c]">
          {result.details.errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}
    </div>
  )
}
