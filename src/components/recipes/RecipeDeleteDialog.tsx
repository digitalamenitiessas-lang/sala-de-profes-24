'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'

type RecipeDeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipeName: string
  deleting: boolean
  onConfirm: () => void
}

export function RecipeDeleteDialog({
  open,
  onOpenChange,
  recipeName,
  deleting,
  onConfirm,
}: RecipeDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold text-[#3d2c24]">
            Eliminar receta
          </DialogTitle>
          <DialogDescription className="text-[#a39e97]">
            Esta accion no se puede deshacer. Se eliminara la receta{' '}
            <strong className="text-[#3d2c24]">{recipeName}</strong>.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose
            render={
              <Button
                variant="outline"
                className="rounded-xl border-[#ebe6df] text-[#3d2c24]"
              />
            }
          >
            Cancelar
          </DialogClose>
          <Button
            variant="destructive"
            className="rounded-xl bg-[#ea504c] hover:bg-[#d4413e]"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            Eliminar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
