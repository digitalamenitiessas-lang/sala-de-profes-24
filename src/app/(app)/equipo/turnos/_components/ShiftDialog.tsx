'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { ROLES, ROLE_OPTIONS } from '@/lib/constants'
import type { AppRole } from '@/types/database'

type EmployeeOption = {
  id: string
  first_name: string
  last_name: string
  role: AppRole
}

type Props = {
  open: boolean
  onClose: (open: boolean) => void
  isEditing: boolean
  employees: EmployeeOption[]
  formUserId: string
  setFormUserId: (v: string) => void
  formDate: string
  setFormDate: (v: string) => void
  formStartTime: string
  setFormStartTime: (v: string) => void
  formEndTime: string
  setFormEndTime: (v: string) => void
  formRole: AppRole
  setFormRole: (v: AppRole) => void
  formNotes: string
  setFormNotes: (v: string) => void
  onSave: () => void
  saving: boolean
}

export function ShiftDialog(props: Props) {
  const { open, onClose, isEditing, employees, formUserId, setFormUserId, formDate, setFormDate,
    formStartTime, setFormStartTime, formEndTime, setFormEndTime, formRole, setFormRole,
    formNotes, setFormNotes, onSave, saving } = props

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-2xl border-[#ebe6df] bg-[#fefcf9] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold text-[#3d2c24]">
            {isEditing ? 'Editar Turno' : 'Nuevo Turno'}
          </DialogTitle>
          <DialogDescription className="text-[#a39e97]">
            {isEditing ? 'Modifica los datos del turno.' : 'Completa los datos para crear un nuevo turno.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3">
          <div className="space-y-2">
            <Label htmlFor="shift-employee" className="text-sm font-medium text-[#3d2c24]">Empleado</Label>
            <Select value={formUserId} onValueChange={(v) => v && setFormUserId(v)}>
              <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5]" id="shift-employee">
                <SelectValue placeholder="Seleccionar empleado">
                  {(() => {
                    const emp = employees.find((e) => e.id === formUserId)
                    if (!emp) return null
                    return (
                      <span className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: ROLES[emp.role].bg, color: ROLES[emp.role].color }}>
                          {ROLES[emp.role].emoji}
                        </span>
                        {emp.first_name} {emp.last_name}
                      </span>
                    )
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#ebe6df]">
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>
                    <span className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: ROLES[emp.role].bg, color: ROLES[emp.role].color }}>
                        {ROLES[emp.role].emoji}
                      </span>
                      {emp.first_name} {emp.last_name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="shift-date" className="text-sm font-medium text-[#3d2c24]">Fecha</Label>
            <Input id="shift-date" type="date" className="rounded-xl border-[#ebe6df] bg-[#faf8f5]" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="shift-start" className="text-sm font-medium text-[#3d2c24]">Hora inicio</Label>
              <Input id="shift-start" type="time" className="rounded-xl border-[#ebe6df] bg-[#faf8f5]" value={formStartTime} onChange={(e) => setFormStartTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shift-end" className="text-sm font-medium text-[#3d2c24]">Hora fin</Label>
              <Input id="shift-end" type="time" className="rounded-xl border-[#ebe6df] bg-[#faf8f5]" value={formEndTime} onChange={(e) => setFormEndTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="shift-role" className="text-sm font-medium text-[#3d2c24]">Rol</Label>
            <Select value={formRole} onValueChange={(v) => v && setFormRole(v as AppRole)}>
              <SelectTrigger className="w-full rounded-xl border-[#ebe6df] bg-[#faf8f5]" id="shift-role">
                <SelectValue placeholder="Seleccionar rol" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-[#ebe6df]">
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="shift-notes" className="text-sm font-medium text-[#3d2c24]">Notas (opcional)</Label>
            <Textarea id="shift-notes" placeholder="Notas adicionales..." className="rounded-xl border-[#ebe6df] bg-[#faf8f5]" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <DialogClose render={<Button variant="outline" className="rounded-xl border-[#ebe6df] text-[#3d2c24]" />}>
            Cancelar
          </DialogClose>
          <Button onClick={onSave} disabled={saving} className="rounded-xl bg-[#006d5a] text-white hover:bg-[#005a4a]">
            {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
            {isEditing ? 'Guardar cambios' : 'Crear turno'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
