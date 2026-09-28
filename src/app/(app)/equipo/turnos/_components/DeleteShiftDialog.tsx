'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import type { ShiftCardData } from '@/components/shifts/ShiftCard'

type Props = {
  open: boolean
  onClose: (open: boolean) => void
  shift: (ShiftCardData & { created_by: string }) | null
  onConfirm: () => void
  deleting: boolean
}

export function DeleteShiftDialog({ open, onClose, shift, onConfirm, deleting }: Props) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold text-[#3d2c24]">Eliminar turno</DialogTitle>
          <DialogDescription className="text-[#a39e97]">
            Esta accion no se puede deshacer. Se eliminara el turno de{' '}
            <strong className="text-[#3d2c24]">
              {shift?.profile ? `${shift.profile.first_name} ${shift.profile.last_name}` : 'este empleado'}
            </strong>{' '}
            del dia{' '}
            <strong className="text-[#3d2c24]">
              {shift ? format(new Date(shift.shift_date + 'T12:00:00'), "d 'de' MMMM", { locale: es }) : ''}
            </strong>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose render={<Button variant="outline" className="rounded-xl border-[#ebe6df] text-[#3d2c24]" />}>
            Cancelar
          </DialogClose>
          <Button variant="destructive" className="rounded-xl bg-[#ea504c] hover:bg-[#d4413e]" onClick={onConfirm} disabled={deleting}>
            {deleting && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
