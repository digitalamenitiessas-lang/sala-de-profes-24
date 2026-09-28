'use client'

import { useState, useEffect } from 'react'
import { mustClockIn } from '@/lib/roles'
import { fechaOperativa } from '@/lib/attendance/jornada'
import Link from 'next/link'
import { Clock, X } from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'

/**
 * Shows a one-time reminder popup to clock in when the user hasn't yet.
 * Only for non-socio roles. Dismissed for the session on close or tap.
 */
export function ShiftReminder() {
  const { profile } = useProfileContext()
  const [show, setShow] = useState(false)
  const [hasClockedIn, setHasClockedIn] = useState<boolean | null>(null)

  useEffect(() => {
    if (!profile) return
    // Solo quien tiene que fichar (socios no, salvo excepción en roles.ts)
    if (!mustClockIn(profile)) return
    // Check session storage — only show once per session
    if (sessionStorage.getItem('shift-reminder-dismissed')) return

    // ¿Tiene turno hoy y todavía no fichó? (día operativo, corte 06:00 AR;
    // antes usaba la fecha UTC y a partir de las 21 h avisaba de más)
    const checkAttendance = async () => {
      const { createClient } = await import('@/lib/supabase/client')
      const supabase = createClient()
      const today = fechaOperativa()
      const [{ data: turno }, { data }] = await Promise.all([
        supabase.from('shifts').select('id').eq('user_id', profile.id).eq('shift_date', today).limit(1).maybeSingle(),
        supabase.from('attendance_logs').select('id').eq('user_id', profile.id).eq('operative_date', today).limit(1).maybeSingle(),
      ])
      if (!turno) { setHasClockedIn(true); return } // sin turno hoy: no molestar

      if (!data) {
        // No clock-in today — show reminder after a short delay
        setHasClockedIn(false)
        setTimeout(() => setShow(true), 1500)
      } else {
        setHasClockedIn(true)
      }
    }
    checkAttendance()
  }, [profile])

  const dismiss = () => {
    setShow(false)
    sessionStorage.setItem('shift-reminder-dismissed', '1')
  }

  if (!show || hasClockedIn !== false) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px]" onClick={dismiss} />
      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="bg-[#006d5a] px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-white/20">
                <Clock className="size-5 text-white" />
              </div>
              <div>
                <p className="text-base font-bold text-white">¡No te olvides, profe!</p>
                <p className="text-xs text-white/70">Marcá tu ingreso</p>
              </div>
            </div>
            <button onClick={dismiss} className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white">
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 text-center">
          <p className="text-sm text-[#3d2c24]">
            Todavía no marcaste el turno de hoy.
          </p>
          <p className="mt-1 text-xs text-[#a39e97]">
            Recordá fichar tu ingreso al llegar.
          </p>

          <div className="mt-4 flex gap-2">
            <button
              onClick={dismiss}
              className="flex-1 rounded-xl border border-[#ebe6df] py-2.5 text-sm font-semibold text-[#a39e97] transition-colors hover:bg-[#f3efe9]"
            >
              Después
            </button>
            <Link
              href="/mi-turno"
              onClick={dismiss}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#006d5a] py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#005a4a] active:scale-[0.98]"
            >
              <Clock className="size-3.5" />
              Fichar ahora
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
