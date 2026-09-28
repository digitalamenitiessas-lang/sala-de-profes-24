'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'

type Props = {
  open: boolean
  onClose: (open: boolean) => void
  supplierName: string | undefined
  onConfirm: () => void
  deleting: boolean
}

export function DeleteSupplierDialog({ open, onClose, supplierName, onConfirm, deleting }: Props) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9]">
        <DialogHeader>
          <DialogTitle className="font-display text-lg text-[#3d2c24]">Eliminar proveedor</DialogTitle>
          <DialogDescription className="text-[#a39e97]">
            Estas seguro de que deseas eliminar a{' '}
            <span className="font-medium text-[#3d2c24]">{supplierName}</span>
            ? Esta accion se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 pt-2">
          <DialogClose render={<Button variant="outline" className="rounded-xl border-[#ebe6df] text-[#3d2c24] hover:bg-[#faf8f5]" />}>
            Cancelar
          </DialogClose>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting} className="rounded-xl">
            {deleting && <Loader2 className="size-4 animate-spin" />}
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
