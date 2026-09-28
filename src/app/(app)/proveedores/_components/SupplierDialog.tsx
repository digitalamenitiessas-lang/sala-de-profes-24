'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import type { Supplier, SupplierFormData } from './types'
import { DOW_SHORT } from './types'

type Props = {
  open: boolean
  onClose: (open: boolean) => void
  editingSupplier: Supplier | null
  formData: SupplierFormData
  onFormChange: (patch: Partial<SupplierFormData>) => void
  onSubmit: (e: React.FormEvent) => void
  saving: boolean
}

export function SupplierDialog({ open, onClose, editingSupplier, formData, onFormChange, onSubmit, saving }: Props) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg text-[#3d2c24]">
            {editingSupplier ? 'Editar Proveedor' : 'Nuevo Proveedor'}
          </DialogTitle>
          <DialogDescription className="text-[#a39e97]">
            {editingSupplier ? 'Modifica los datos del proveedor' : 'Completa los datos del nuevo proveedor'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="supplier-name" className="text-xs font-semibold text-[#3d2c24]">Nombre *</Label>
            <Input
              id="supplier-name"
              value={formData.name}
              onChange={(e) => onFormChange({ name: e.target.value })}
              placeholder="Nombre del proveedor"
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-contact" className="text-xs font-semibold text-[#3d2c24]">Persona de contacto</Label>
            <Input
              id="supplier-contact"
              value={formData.contact_name}
              onChange={(e) => onFormChange({ contact_name: e.target.value })}
              placeholder="Nombre del contacto"
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-phone" className="text-xs font-semibold text-[#3d2c24]">Telefono</Label>
            <Input
              id="supplier-phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => onFormChange({ phone: e.target.value })}
              placeholder="+54 11 1234-5678"
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-email" className="text-xs font-semibold text-[#3d2c24]">Email</Label>
            <Input
              id="supplier-email"
              type="email"
              value={formData.email}
              onChange={(e) => onFormChange({ email: e.target.value })}
              placeholder="proveedor@email.com"
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-[#3d2c24]">Días de pedido</Label>
            <p className="text-[11px] text-[#a39e97]">¿Qué días se le hace pedido a este proveedor?</p>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
                const active = formData.order_days.includes(dow)
                return (
                  <button
                    key={dow}
                    type="button"
                    onClick={() => onFormChange({
                      order_days: active
                        ? formData.order_days.filter((d) => d !== dow)
                        : [...formData.order_days, dow].sort(),
                    })}
                    className={`flex-1 rounded-lg py-2 text-[11px] font-bold transition-all ${
                      active ? 'bg-[#006d5a] text-white' : 'bg-[#f3efe9] text-[#a39e97]'
                    }`}
                  >
                    {DOW_SHORT[dow]}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-lead" className="text-xs font-semibold text-[#3d2c24]">Demora de entrega (días)</Label>
            <Input
              id="supplier-lead"
              type="number"
              inputMode="numeric"
              min="0"
              value={formData.lead_time_days}
              onChange={(e) => onFormChange({ lead_time_days: e.target.value })}
              placeholder="Ej: 2 (pide lunes, llega miércoles)"
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-notes" className="text-xs font-semibold text-[#3d2c24]">Notas</Label>
            <Textarea
              id="supplier-notes"
              value={formData.notes}
              onChange={(e) => onFormChange({ notes: e.target.value })}
              placeholder="Notas adicionales..."
              className="rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-[#006d5a]"
            />
          </div>
          <DialogFooter className="gap-2 pt-2">
            <DialogClose render={<Button variant="outline" className="rounded-xl border-[#ebe6df] text-[#3d2c24] hover:bg-[#faf8f5]" />}>
              Cancelar
            </DialogClose>
            <Button type="submit" disabled={saving} className="rounded-xl bg-[#006d5a] text-white hover:bg-[#004d3f]">
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editingSupplier ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
