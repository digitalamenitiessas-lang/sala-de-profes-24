'use client'

import { useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, KeyRound, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// "Acceso a la app" en la ficha: email y contraseña con los que la persona
// entra. Cambia la misma cuenta, así no se pierde su historial.
// ---------------------------------------------------------------------------

const inputCls =
  'w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] px-3 py-2 text-sm text-[#3d2c24] outline-none focus:border-[#006d5a] focus:ring-1 focus:ring-[#006d5a]'

export function UserAccessCard({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [currentEmail, setCurrentEmail] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [tempPassword, setTempPassword] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/admin/user-access?userId=${encodeURIComponent(userId)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) setBlocked(d.error ?? 'No se pudo cargar el acceso')
        else {
          setBlocked(null)
          setCurrentEmail(d.email ?? null)
          setEmail(d.email ?? '')
        }
      })
      .catch(() => { if (!cancelled) setBlocked('No se pudo cargar el acceso') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])

  const nuevoEmail = email.trim().toLowerCase()
  const cambiaEmail = !!nuevoEmail && nuevoEmail !== (currentEmail ?? '')
  const hayCambios = cambiaEmail || password.length > 0

  async function handleSave() {
    if (!hayCambios) return
    if (password && password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/user-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          ...(cambiaEmail ? { email: nuevoEmail } : {}),
          ...(password ? { password } : {}),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? 'No se pudo cambiar el acceso')
        return
      }
      setCurrentEmail(d.email ?? nuevoEmail)
      setEmail(d.email ?? nuevoEmail)
      setPassword('')
      setShowPassword(false)
      toast.success(
        cambiaEmail && password ? 'Email y contraseña actualizados'
          : cambiaEmail ? 'Email actualizado'
          : 'Contraseña actualizada',
      )
    } catch {
      toast.error('Error de conexión: no se guardó el acceso')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setResetting(true)
    try {
      const res = await fetch('/api/admin/user-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, resetPassword: true }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(d.error ?? 'No se pudo generar la contraseña temporal')
        return
      }
      setTempPassword(d.tempPassword)
      setConfirmReset(false)
    } catch {
      toast.error('Error de conexión: no se generó la contraseña')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="rounded-2xl bg-white px-5 py-5 shadow-sm ring-1 ring-[#ebe6df] space-y-4">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-[#a39e97]">
        <KeyRound className="size-3.5" /> Acceso a la app
      </h2>

      {loading ? (
        <div className="flex justify-center py-2">
          <Loader2 className="size-5 animate-spin text-[#006d5a]" />
        </div>
      ) : blocked ? (
        <p className="text-sm text-[#a39e97]">{blocked}</p>
      ) : (
        <>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[#7d6c64]">Email para entrar</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              placeholder="nombre@gmail.com"
              className={inputCls}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-[#7d6c64]">Contraseña nueva</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Dejar vacío para no cambiarla"
                className={`${inputCls} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-[#a39e97]"
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-[11px] text-[#a39e97]">Mínimo 6 caracteres. Pasásela a la persona para que entre.</p>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !hayCambios}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#006d5a] px-4 py-2.5 text-sm font-semibold text-[#006d5a] transition hover:bg-[#f0f7f5] disabled:border-[#ebe6df] disabled:text-[#a39e97] disabled:hover:bg-transparent"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {saving ? 'Guardando…' : 'Guardar acceso'}
          </button>

          <div className="border-t border-[#ebe6df]" />

          {tempPassword ? (
            <div className="rounded-xl border border-[#c3e0d8] bg-[#f0f7f5] p-3 space-y-2">
              <p className="text-xs font-semibold text-[#006d5a]">Contraseña temporal generada</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-lg border border-[#ebe6df] bg-white px-3 py-2 text-sm font-mono tracking-wider text-[#3d2c24]">
                  {tempPassword}
                </code>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(tempPassword); toast.success('Copiado') }}
                  className="rounded-lg border border-[#ebe6df] bg-white p-2 text-[#7d6c64] hover:bg-[#faf8f5]"
                  aria-label="Copiar contraseña"
                >
                  <Copy className="size-4" />
                </button>
              </div>
              <p className="text-[11px] text-[#7d6c64]">Pasásela en persona. El empleado va a tener que cambiarla cuando entre.</p>
              <button
                type="button"
                onClick={() => setTempPassword(null)}
                className="text-[11px] text-[#a39e97] underline underline-offset-2"
              >
                Listo, ya la anoté
              </button>
            </div>
          ) : confirmReset ? (
            <div className="rounded-xl border border-[#f0d0c0] bg-[#fdf5f0] p-3 space-y-2">
              <p className="text-xs text-[#7d6c64]">¿Generar una contraseña temporal? El empleado va a tener que cambiarla cuando entre.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={resetting}
                  className="flex items-center gap-1.5 rounded-lg bg-[#c0392b] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#a93226] disabled:opacity-60"
                >
                  {resetting && <Loader2 className="size-3 animate-spin" />}
                  {resetting ? 'Generando…' : 'Sí, generar'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  disabled={resetting}
                  className="rounded-lg border border-[#ebe6df] px-3 py-1.5 text-xs text-[#7d6c64] hover:bg-[#faf8f5]"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#ebe6df] px-4 py-2.5 text-sm font-medium text-[#7d6c64] transition hover:bg-[#faf8f5]"
            >
              <RotateCcw className="size-3.5" />
              Generar contraseña temporal
            </button>
          )}
        </>
      )}
    </div>
  )
}
