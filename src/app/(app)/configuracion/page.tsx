'use client'

import { useState, useEffect } from 'react'
import {
  LogOut, Loader2, Save, Bell, BellOff, Mail, MailX,
  Volume2, VolumeX, Shield, Key, ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { ROLES } from '@/lib/constants'
import { logAuditClient } from '@/lib/audit'
import { signOutBrowserSession } from '@/lib/push/client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RoleBadge } from '@/components/ui/RoleBadge'
import { isSocio } from '@/lib/roles'
import { PushDeviceToggle } from '@/components/push/PushDeviceToggle'

// ---------------------------------------------------------------------------
// Settings type
// ---------------------------------------------------------------------------

type UserSettings = {
  notify_app?: boolean      // In-app notifications
  notify_email?: boolean    // Email notifications
  notify_sound?: boolean    // Sound on clock in/out
  notify_orders?: boolean   // Order status notifications
  notify_expedientes?: boolean // Expediente updates
}

const DEFAULT_SETTINGS: UserSettings = {
  notify_app: true,
  notify_email: true,
  notify_sound: true,
  notify_orders: true,
  notify_expedientes: true,
}

// ---------------------------------------------------------------------------
// Toggle component
// ---------------------------------------------------------------------------

function Toggle({ enabled, onChange, label, description, icon: Icon, iconOff: IconOff }: {
  enabled: boolean
  onChange: (v: boolean) => void
  label: string
  description: string
  icon: React.ElementType
  iconOff: React.ElementType
}) {
  const ActiveIcon = enabled ? Icon : IconOff
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[#faf8f5] active:bg-[#f3efe9]"
    >
      <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${enabled ? 'bg-[#e8f5f1]' : 'bg-[#f3efe9]'}`}>
        <ActiveIcon className={`size-4 ${enabled ? 'text-[#006d5a]' : 'text-[#a39e97]'}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[#3d2c24]">{label}</p>
        <p className="text-[11px] text-[#a39e97]">{description}</p>
      </div>
      <div className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-[#006d5a]' : 'bg-[#d1cdc7]'}`}>
        <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ConfiguracionPage() {
  const { profile, loading: profileLoading, refresh } = useProfileContext()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [saving, setSaving] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  // Initialize form once profile loads
  if (profile && !initialized) {
    setFirstName(profile.first_name ?? '')
    setLastName(profile.last_name ?? '')
    setPhone(profile.phone ?? '')
    const saved = profile.settings as UserSettings | undefined
    setSettings({ ...DEFAULT_SETTINGS, ...(saved ?? {}) })
    setInitialized(true)
  }

  // -------------------------------------------------------------------------
  // Save profile + settings
  // -------------------------------------------------------------------------

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    if (!firstName.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }

    setSaving(true)
    try {
      const supabase = createClient()
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim() || null,
          settings: settings as Record<string, unknown>,
        })
        .eq('id', profile.id)

      if (error) throw error
      toast.success('Configuración guardada')
      logAuditClient({
        action: 'update_settings',
        module: 'configuracion',
        entityType: 'profile',
        description: 'User actualizó su configuración',
      })
      await refresh()
    } catch (err) {
      console.error(err)
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  // -------------------------------------------------------------------------
  // Change password
  // -------------------------------------------------------------------------

  async function handlePasswordChange() {
    if (newPassword.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Las contraseñas no coinciden')
      return
    }

    setChangingPassword(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      toast.success('Contraseña actualizada')
      setShowPasswordChange(false)
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      console.error(err)
      toast.error('Error al cambiar contraseña')
    } finally {
      setChangingPassword(false)
    }
  }

  // -------------------------------------------------------------------------
  // Logout
  // -------------------------------------------------------------------------

  function handleLogout() {
    setLoggingOut(true)
    void signOutBrowserSession().finally(() => {
      window.location.href = '/login'
    })
    setTimeout(() => { window.location.href = '/login' }, 1500)
  }

  // -------------------------------------------------------------------------
  // Update a single setting
  // -------------------------------------------------------------------------

  function updateSetting(key: keyof UserSettings, value: boolean) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (profileLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-[#006d5a]" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#a39e97]">No se pudo cargar el perfil.</p>
      </div>
    )
  }

  const roleConfig = ROLES[profile.role]
  const initials = (profile.first_name?.[0] ?? '').toUpperCase() + (profile.last_name?.[0] ?? '').toUpperCase()

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-md space-y-5 px-1 pb-12">
      {/* Header */}
      <h1 className="font-display text-xl font-semibold tracking-tight text-[#3d2c24]">
        Configuración
      </h1>

      {/* Profile card — compact */}
      <div className="card-elevated-lg flex items-center gap-4 p-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: roleConfig?.bg ?? '#f0f7f5' }}>
          <span className="font-display text-lg font-bold" style={{ color: roleConfig?.color ?? '#006d5a' }}>
            {initials || '?'}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-[#3d2c24]">
            {profile.first_name} {profile.last_name}
          </p>
          <RoleBadge role={profile.role} size="sm" />
        </div>
      </div>

      {/* Profile form */}
      <form onSubmit={handleSave} className="space-y-5">
        <div className="card-elevated-lg p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#a39e97] mb-3">Datos personales</h2>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-fn" className="text-sm font-medium text-[#3d2c24]">Nombre</Label>
              <Input
                id="cfg-fn"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Tu nombre"
                autoComplete="given-name"
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] h-12 focus-visible:ring-2 focus-visible:ring-[#006d5a]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-ln" className="text-sm font-medium text-[#3d2c24]">Apellido</Label>
              <Input
                id="cfg-ln"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Tu apellido"
                autoComplete="family-name"
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] h-12 focus-visible:ring-2 focus-visible:ring-[#006d5a]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-ph" className="text-sm font-medium text-[#3d2c24]">Teléfono</Label>
              <Input
                id="cfg-ph"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+54 381 1234567"
                autoComplete="tel"
                inputMode="tel"
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] h-12 focus-visible:ring-2 focus-visible:ring-[#006d5a]"
              />
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="card-elevated-lg overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#a39e97]">Notificaciones</h2>
          </div>
          <div className="divide-y divide-[#f3efe9]">
            <PushDeviceToggle />
            <Toggle
              enabled={settings.notify_app ?? true}
              onChange={(v) => updateSetting('notify_app', v)}
              label="Notificaciones in-app"
              description="Avisos dentro de la aplicación"
              icon={Bell}
              iconOff={BellOff}
            />
            <Toggle
              enabled={settings.notify_email ?? true}
              onChange={(v) => updateSetting('notify_email', v)}
              label="Notificaciones por email"
              description="Recibir emails de expedientes y pedidos"
              icon={Mail}
              iconOff={MailX}
            />
            <Toggle
              enabled={settings.notify_sound ?? true}
              onChange={(v) => updateSetting('notify_sound', v)}
              label="Sonido al fichar"
              description="Timbre de escuela al marcar ingreso/egreso"
              icon={Volume2}
              iconOff={VolumeX}
            />
            <Toggle
              enabled={settings.notify_orders ?? true}
              onChange={(v) => updateSetting('notify_orders', v)}
              label="Pedidos"
              description="Avisar cuando un pedido cambia de estado"
              icon={Bell}
              iconOff={BellOff}
            />
            <Toggle
              enabled={settings.notify_expedientes ?? true}
              onChange={(v) => updateSetting('notify_expedientes', v)}
              label="Expedientes"
              description="Avisar al asignar o comentar"
              icon={Bell}
              iconOff={BellOff}
            />
          </div>
        </div>

        {/* Save button */}
        <Button
          type="submit"
          disabled={saving}
          className="w-full rounded-xl bg-[#006d5a] h-12 text-white shadow-sm hover:bg-[#005a4a]"
        >
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />}
          Guardar cambios
        </Button>
      </form>

      {/* Admin section — solo socio */}
      {isSocio(profile?.role) && (
        <div className="card-elevated-lg overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#a39e97]">Administración</h2>
          </div>
          <Link
            href="/configuracion/notificaciones"
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#faf8f5]"
          >
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#e8f5f1]">
              <Bell className="size-4 text-[#006d5a]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[#3d2c24]">Notificaciones push</p>
              <p className="text-[11px] text-[#a39e97]">Qué eventos avisan al celular/PC y a quién</p>
            </div>
            <ChevronRight className="size-4 text-[#a39e97]" />
          </Link>
        </div>
      )}

      {/* Security section */}
      <div className="card-elevated-lg overflow-hidden">
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#a39e97]">Seguridad</h2>
        </div>

        {/* Change password toggle */}
        <button
          onClick={() => setShowPasswordChange(!showPasswordChange)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#faf8f5]"
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#fdf6ec]">
            <Key className="size-4 text-[#8b5e34]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#3d2c24]">Cambiar contraseña</p>
            <p className="text-[11px] text-[#a39e97]">Actualizar tu contraseña de acceso</p>
          </div>
          <ChevronRight className={`size-4 text-[#a39e97] transition-transform ${showPasswordChange ? 'rotate-90' : ''}`} />
        </button>

        {showPasswordChange && (
          <div className="border-t border-[#f3efe9] px-4 py-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-np" className="text-sm font-medium text-[#3d2c24]">Nueva contraseña</Label>
              <Input
                id="cfg-np"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                autoComplete="new-password"
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] h-12 focus-visible:ring-2 focus-visible:ring-[#006d5a]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-cp" className="text-sm font-medium text-[#3d2c24]">Confirmar contraseña</Label>
              <Input
                id="cfg-cp"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repetir contraseña"
                autoComplete="new-password"
                className="rounded-xl border-[#ebe6df] bg-[#faf8f5] h-12 focus-visible:ring-2 focus-visible:ring-[#006d5a]"
              />
            </div>
            {newPassword && newPassword.length < 6 && (
              <p className="text-xs text-[#ea504c]">Mínimo 6 caracteres</p>
            )}
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="text-xs text-[#ea504c]">Las contraseñas no coinciden</p>
            )}
            <Button
              onClick={handlePasswordChange}
              disabled={changingPassword || newPassword.length < 6 || newPassword !== confirmPassword}
              className="w-full rounded-xl bg-[#8b5e34] h-12 text-white hover:bg-[#7a5230] disabled:opacity-50"
            >
              {changingPassword ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Shield className="mr-2 size-4" />}
              Actualizar contraseña
            </Button>
          </div>
        )}
      </div>

      {/* Logout */}
      <Button
        onClick={handleLogout}
        disabled={loggingOut}
        className="w-full rounded-xl bg-[#ea504c] h-12 text-sm font-semibold text-white shadow-sm hover:bg-[#d43d39]"
      >
        {loggingOut ? <Loader2 className="mr-2 size-4 animate-spin" /> : <LogOut className="mr-2 size-4" />}
        Cerrar Sesión
      </Button>

      {/* App version */}
      <p className="text-center text-[10px] text-[#d1cdc7]">
        Sala de Profes v1.0 — La Vieja Escuela
      </p>
    </div>
  )
}
