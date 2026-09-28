'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useProfileContext } from '@/lib/hooks/use-profile'

export default function CambiarClavePage() {
  const router = useRouter()
  const { profile } = useProfileContext()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)

  const isValid = password.length >= 6 && password === confirm

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || loading) return

    setLoading(true)
    try {
      const supabase = createClient()

      // Update password
      const { error: pwError } = await supabase.auth.updateUser({
        password,
      })
      if (pwError) throw pwError

      // Clear must_change_password flag
      const { error: metaError } = await supabase.auth.updateUser({
        data: { must_change_password: false },
      })
      if (metaError) throw metaError

      toast.success('Contraseña actualizada correctamente')
      router.push('/')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al cambiar contraseña'
      toast.error('Error', { description: message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-[#f0f7f5]">
            <ShieldCheck className="size-8 text-[#006d5a]" />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold text-[#3d2c24]">
            Cambiá tu contraseña
          </h1>
          <p className="mt-2 text-sm text-[#a39e97]">
            {profile?.first_name ? `Hola ${profile.first_name}, ` : ''}
            por seguridad necesitás crear una contraseña nueva antes de continuar.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* New password */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[#a39e97]">
              Nueva contraseña
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="h-12 w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] pl-10 pr-10 text-sm focus:border-[#006d5a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#006d5a]"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a39e97] hover:text-[#3d2c24]"
              >
                {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {password.length > 0 && password.length < 6 && (
              <p className="text-xs text-[#ea504c]">Mínimo 6 caracteres</p>
            )}
          </div>

          {/* Confirm password */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[#a39e97]">
              Confirmar contraseña
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#a39e97]" />
              <input
                type={showPw ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repetí la contraseña"
                className="h-12 w-full rounded-xl border border-[#ebe6df] bg-[#faf8f5] pl-10 pr-4 text-sm focus:border-[#006d5a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#006d5a]"
              />
            </div>
            {confirm.length > 0 && password !== confirm && (
              <p className="text-xs text-[#ea504c]">Las contraseñas no coinciden</p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!isValid || loading}
            className="h-12 w-full rounded-xl bg-[#006d5a] text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#005a4a] disabled:opacity-50"
          >
            {loading ? 'Actualizando...' : 'Guardar nueva contraseña'}
          </button>
        </form>
      </div>
    </div>
  )
}
