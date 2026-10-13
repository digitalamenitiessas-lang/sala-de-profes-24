'use client'

import { puestoDe } from '@/lib/roles'
import { useState, useEffect } from 'react'
import { Loader2, UserCog } from 'lucide-react'
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
import type { AppRole, Profile } from '@/types/database'
import { createClient } from '@/lib/supabase/client'
import { logAuditClient } from '@/lib/audit'

type EditUserDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: Profile | null
  onUpdated: () => void
}

export function EditUserDialog({ open, onOpenChange, user, onUpdated }: EditUserDialogProps) {
  const [saving, setSaving] = useState(false)
  const [role, setRole] = useState<AppRole>('cocina')
  const [phone, setPhone] = useState('')
  const [isActive, setIsActive] = useState(true)

  useEffect(() => {
    if (user) {
      setRole(puestoDe(user))
      setPhone(user.phone ?? '')
      setIsActive(user.is_active)
    }
  }, [user])

  async function handleSave() {
    if (!user) return
    setSaving(true)

    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('profiles')
        .update({
          role,
          phone: phone.trim() || null,
          is_active: isActive,
        })
        .eq('id', user.id)

      if (error) throw error

      toast.success(`Perfil de ${user.first_name} actualizado`)
      logAuditClient({ userId: null, userName: 'Admin', action: 'update_user_profile', module: 'equipo', entityType: 'profile', description: `Admin editó perfil de: ${user.first_name} ${user.last_name}` })
      onOpenChange(false)
      onUpdated()
    } catch (err) {
      errorToast(`No se pudo actualizar a ${user.first_name}`, err)
    } finally {
      setSaving(false)
    }
  }

  if (!user) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#ebe6df] bg-[#fefcf9] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-[#3d2c24]">
            <UserCog className="size-5 text-[#006d5a]" />
            Editar miembro
          </DialogTitle>
          <DialogDescription className="text-[#a39e97]">
            {user.first_name} {user.last_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[#3d2c24]">Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
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
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Opcional"
              className="border-[#ebe6df] bg-white"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-[#ebe6df] bg-white px-4 py-3">
            <div>
              <p className="text-sm font-medium text-[#3d2c24]">Estado</p>
              <p className="text-xs text-[#a39e97]">
                {isActive ? 'Activo — puede iniciar sesión' : 'Inactivo — no puede iniciar sesión'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              onClick={() => setIsActive(!isActive)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                isActive ? 'bg-[#006d5a]' : 'bg-[#d1cdc7]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block size-5 rounded-full bg-white shadow-sm transition-transform ${
                  isActive ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <DialogClose render={<Button type="button" variant="outline" className="border-[#ebe6df]" />}>
            Cancelar
          </DialogClose>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#006d5a] text-white hover:bg-[#005a4a]"
          >
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
