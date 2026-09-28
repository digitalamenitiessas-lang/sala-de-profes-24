'use client'

import { useState } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { errorToast } from '@/lib/toast-helpers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ROLE_OPTIONS } from '@/lib/constants'
import type { AppRole } from '@/types/database'

type CreateUserDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function CreateUserDialog({ open, onOpenChange, onCreated }: CreateUserDialogProps) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: 'cocina' as AppRole,
    phone: '',
  })

  function resetForm() {
    setForm({
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      role: 'cocina',
      phone: '',
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!form.email || !form.password || !form.firstName || !form.lastName) {
      toast.error('Completá todos los campos obligatorios')
      return
    }

    if (form.password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          firstName: form.firstName,
          lastName: form.lastName,
          role: form.role,
          phone: form.phone || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Error al crear usuario')
      }

      toast.success(`Usuario ${form.firstName} ${form.lastName} creado`)
      resetForm()
      onOpenChange(false)
      onCreated()
    } catch (err) {
      errorToast('No se pudo crear el usuario', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#ebe6df] bg-[#fefcf9] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-[#3d2c24]">
            <UserPlus className="size-5 text-[#006d5a]" />
            Nuevo miembro del equipo
          </DialogTitle>
          <DialogDescription className="text-[#a39e97]">
            Creá una cuenta para un nuevo empleado
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[#3d2c24]">Nombre *</Label>
              <Input
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                placeholder="Nombre"
                className="border-[#ebe6df] bg-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[#3d2c24]">Apellido *</Label>
              <Input
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                placeholder="Apellido"
                className="border-[#ebe6df] bg-white"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[#3d2c24]">Email *</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="usuario@laviejaescuela.com"
              className="border-[#ebe6df] bg-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[#3d2c24]">Contraseña *</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Mínimo 6 caracteres"
              className="border-[#ebe6df] bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[#3d2c24]">Rol *</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm({ ...form, role: v as AppRole })}
              >
                <SelectTrigger className="border-[#ebe6df] bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-[#3d2c24]">Teléfono</Label>
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Opcional"
                className="border-[#ebe6df] bg-white"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <DialogClose render={<Button type="button" variant="outline" className="border-[#ebe6df]" />}>
              Cancelar
            </DialogClose>
            <Button
              type="submit"
              disabled={saving}
              className="bg-[#006d5a] text-white hover:bg-[#005a4a]"
            >
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Crear usuario
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
