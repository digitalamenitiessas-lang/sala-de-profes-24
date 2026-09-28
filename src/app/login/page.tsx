'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Coffee, Lock, Mail, Loader2, ArrowLeft } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'framer-motion'
import { signOutBrowserSession } from '@/lib/push/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSplash, setShowSplash] = useState(() => {
    if (typeof window === 'undefined') return true
    return !sessionStorage.getItem('splash-shown')
  })
  const [showReset, setShowReset] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  // Splash screen → login form transition (only first visit per session)
  useEffect(() => {
    if (!showSplash) return
    const timer = setTimeout(() => {
      setShowSplash(false)
      sessionStorage.setItem('splash-shown', '1')
    }, 1200)
    return () => clearTimeout(timer)
  }, [showSplash])

  // Kicked by middleware for being inactive
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('inactive') === '1') {
      void signOutBrowserSession().finally(() => {
        toast.error('Tu cuenta está desactivada. Contactá al encargado.')
        const url = new URL(window.location.href)
        url.searchParams.delete('inactive')
        window.history.replaceState({}, '', url.toString())
      })
    }
  }, [])

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!resetEmail) {
      toast.error('Ingresa tu correo electrónico')
      return
    }
    setResetLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      })
      if (error) {
        toast.error(error.message)
        return
      }
      setResetSent(true)
      toast.success('Te enviamos un email para restablecer tu contraseña')
    } catch {
      toast.error('Error inesperado. Intenta de nuevo.')
    } finally {
      setResetLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!email || !password) {
      toast.error('Por favor, completa todos los campos')
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        if (error.message === 'Invalid login credentials') {
          toast.error('Credenciales incorrectas. Revisa tu email y contraseña.')
        } else {
          toast.error(error.message)
        }
        return
      }

      toast.success('Bienvenido de vuelta!')
      router.push('/')
      router.refresh()
    } catch {
      toast.error('Error inesperado. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-[#faf8f5] px-5 py-10">
      <AnimatePresence mode="wait">
        {showSplash ? (
          /* ============================================================= */
          /* Splash screen — "Tranqui profe..." + café spinning            */
          /* ============================================================= */
          <motion.div
            key="splash"
            className="flex cursor-pointer flex-col items-center gap-8"
            onClick={() => setShowSplash(false)}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {/* Logo grande */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.6 }}
            >
              <Image
                src="/Logos/logo positivo (1).png"
                alt="La Vieja Escuela"
                width={220}
                height={220}
                className="h-40 sm:h-52 w-auto"
                priority
              />
            </motion.div>

            {/* Spinning coffee + text */}
            <motion.div
              className="flex flex-col items-center gap-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.5 }}
            >
              <span className="animate-coffee text-4xl">☕</span>
              <p className="font-display text-2xl tracking-tight text-[#3d2c24]">
                Tranqui profe...
              </p>
              <p className="text-sm text-[#a39e97]">
                Preparando tu espacio
              </p>
            </motion.div>
          </motion.div>
        ) : (
          /* ============================================================= */
          /* Login form                                                     */
          /* ============================================================= */
          <motion.div
            key="login"
            className="w-full max-w-[22rem] sm:max-w-sm"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {/* Logo & Brand */}
            <div className="mb-10 flex flex-col items-center gap-4 text-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, duration: 0.4, type: 'spring', stiffness: 200 }}
              >
                <Image
                  src="/Logos/logo positivo (1).png"
                  alt="La Vieja Escuela"
                  width={200}
                  height={200}
                  className="h-44 w-auto"
                  priority
                />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.4 }}
              >
                <h1 className="font-display text-3xl tracking-tight text-[#3d2c24]">
                  Sala de Profes
                </h1>
                <p className="section-label mt-2">
                  La Vieja Escuela
                </p>
              </motion.div>
            </div>

            {/* Login Card */}
            <motion.div
              className="card-elevated-lg px-6 py-8"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.4 }}
            >
              <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                {/* Email */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="email" className="text-sm font-medium text-[#3d2c24]">
                    <Mail className="size-4 text-[#a39e97]" />
                    Correo electrónico
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="tu@correo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    disabled={loading}
                    className="h-12 rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-2 focus-visible:ring-[#006d5a]"
                  />
                </div>

                {/* Password */}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password" className="text-sm font-medium text-[#3d2c24]">
                    <Lock className="size-4 text-[#a39e97]" />
                    Contraseña
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Tu contraseña"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={loading}
                    className="h-12 rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-2 focus-visible:ring-[#006d5a]"
                  />
                </div>

                {/* Submit */}
                <Button
                  type="submit"
                  size="lg"
                  disabled={loading}
                  className="mt-2 h-12 w-full rounded-xl bg-[#006d5a] text-sm font-semibold text-white shadow-md transition-all hover:bg-[#004d3f] hover:shadow-lg active:scale-[0.98]"
                >
                  {loading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Entrando...
                    </>
                  ) : (
                    <>
                      <Coffee className="size-4" />
                      Iniciar sesión
                    </>
                  )}
                </Button>

                {/* Forgot password link */}
                <button
                  type="button"
                  onClick={() => { setShowReset(true); setResetEmail(email) }}
                  className="text-center text-xs font-medium text-[#006d5a] hover:underline"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </form>
            </motion.div>

            {/* Reset password modal */}
            <AnimatePresence>
              {showReset && (
                <motion.div
                  className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div
                    className="fixed inset-0 bg-black/40 backdrop-blur-[2px]"
                    onClick={() => { setShowReset(false); setResetSent(false) }}
                  />
                  <motion.div
                    className="relative z-10 mx-3 mb-[calc(0.5rem+env(safe-area-inset-bottom))] w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl sm:mx-auto sm:mb-0"
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {resetSent ? (
                      <div className="flex flex-col items-center gap-4 py-4 text-center">
                        <div className="flex size-14 items-center justify-center rounded-full bg-[#e8f5f1] text-2xl">
                          ✉️
                        </div>
                        <h3 className="font-display text-lg font-semibold text-[#3d2c24]">
                          Revisa tu correo
                        </h3>
                        <p className="text-sm text-[#a39e97]">
                          Te enviamos un link a <strong className="text-[#3d2c24]">{resetEmail}</strong> para restablecer tu contraseña.
                        </p>
                        <Button
                          onClick={() => { setShowReset(false); setResetSent(false) }}
                          className="mt-2 h-12 w-full rounded-xl bg-[#006d5a] text-white hover:bg-[#004d3f]"
                        >
                          Volver al login
                        </Button>
                      </div>
                    ) : (
                      <form onSubmit={handleResetPassword} className="flex flex-col gap-5">
                        <button
                          type="button"
                          onClick={() => setShowReset(false)}
                          className="icon-btn flex items-center justify-center rounded-full text-[#a39e97] hover:bg-[#f3efe9] hover:text-[#3d2c24]"
                          aria-label="Volver"
                        >
                          <ArrowLeft className="size-5" />
                        </button>

                        <div className="text-center">
                          <h3 className="font-display text-lg font-semibold text-[#3d2c24]">
                            Restablecer contraseña
                          </h3>
                          <p className="mt-1 text-xs text-[#a39e97]">
                            Te enviaremos un email con un link para crear una nueva contraseña
                          </p>
                        </div>

                        <div className="flex flex-col gap-2">
                          <Label htmlFor="reset-email" className="text-sm font-medium text-[#3d2c24]">
                            <Mail className="size-4 text-[#a39e97]" />
                            Correo electrónico
                          </Label>
                          <Input
                            id="reset-email"
                            type="email"
                            placeholder="tu@correo.com"
                            value={resetEmail}
                            onChange={(e) => setResetEmail(e.target.value)}
                            autoComplete="email"
                            disabled={resetLoading}
                            className="h-12 rounded-xl border-[#ebe6df] bg-[#faf8f5] text-[#3d2c24] placeholder:text-[#a39e97] focus-visible:ring-2 focus-visible:ring-[#006d5a]"
                          />
                        </div>

                        <Button
                          type="submit"
                          disabled={resetLoading}
                          className="h-12 w-full rounded-xl bg-[#006d5a] text-sm font-semibold text-white hover:bg-[#004d3f]"
                        >
                          {resetLoading ? (
                            <>
                              <Loader2 className="size-4 animate-spin" />
                              Enviando...
                            </>
                          ) : (
                            'Enviar link de recuperación'
                          )}
                        </Button>
                      </form>
                    )}
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Footer */}
            <motion.p
              className="mt-8 text-center text-xs tracking-wide text-[#a39e97]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.4 }}
            >
              Acceso exclusivo para el equipo de La Vieja Escuela
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
