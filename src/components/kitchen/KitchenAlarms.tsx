'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { Bell, X, Check, Clock, AlertTriangle } from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScheduledTask = {
  id: number
  title: string
  scheduled_time: string
  is_critical: boolean
  status: string
  kitchen_shift_id: number
}

type AlarmData = {
  task: ScheduledTask
  triggeredAt: Date
}

// ---------------------------------------------------------------------------
// Sound: kitchen alarm — 3 beeps
// ---------------------------------------------------------------------------

function playAlarmSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()

    const playBeep = (startTime: number, freq: number, duration: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.frequency.value = freq
      osc.type = 'square'

      gain.gain.setValueAtTime(0.3, startTime)
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration)

      osc.start(startTime)
      osc.stop(startTime + duration)
    }

    // 3 urgent beeps
    playBeep(ctx.currentTime, 880, 0.15)
    playBeep(ctx.currentTime + 0.2, 880, 0.15)
    playBeep(ctx.currentTime + 0.4, 1100, 0.3)
  } catch {
    // Audio not available
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CHECK_INTERVAL = 30_000 // 30 seconds
const ALARM_WINDOW_MINUTES = 3 // Task triggers ±3 min of scheduled time

export function KitchenAlarms() {
  const { profile } = useProfileContext()
  const [activeAlarm, setActiveAlarm] = useState<AlarmData | null>(null)
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set())
  const lastCheckRef = useRef<string>('')

  const isKitchenRole = ['chef', 'cocina', 'socio', 'encargado'].includes(profile?.role ?? '')

  const checkAlarms = useCallback(async () => {
    if (!profile || !isKitchenRole) return
    if (activeAlarm) return // Don't check while showing an alarm

    try {
      const supabase = createClient()
      const today = format(new Date(), 'yyyy-MM-dd')
      const now = new Date()
      const currentTime = format(now, 'HH:mm')

      // Avoid checking the same minute twice
      if (currentTime === lastCheckRef.current) return
      lastCheckRef.current = currentTime

      // Get active shift for today
      const shiftType = now.getHours() < 15 ? 'morning' : 'night'
      const { data: shift } = await supabase
        .from('kitchen_shifts')
        .select('id')
        .eq('date', today)
        .eq('shift_type', shiftType)
        .eq('status', 'in_progress')
        .maybeSingle()

      if (!shift) return // No active shift

      // Get pending scheduled tasks for this shift
      const { data: tasks } = await supabase
        .from('checklist_items')
        .select('id, title, scheduled_time, is_critical, status, kitchen_shift_id')
        .eq('kitchen_shift_id', shift.id)
        .eq('status', 'pending')
        .not('scheduled_time', 'is', null)

      if (!tasks?.length) return

      // Check if any task is due NOW (within ALARM_WINDOW_MINUTES)
      const nowMinutes = now.getHours() * 60 + now.getMinutes()

      for (const task of tasks) {
        if (dismissedIds.has(task.id)) continue

        const [h, m] = (task.scheduled_time as string).split(':').map(Number)
        const taskMinutes = h * 60 + m
        const diff = Math.abs(nowMinutes - taskMinutes)

        if (diff <= ALARM_WINDOW_MINUTES) {
          // ALARM!
          playAlarmSound()
          setActiveAlarm({ task, triggeredAt: now })
          return // Only one alarm at a time
        }
      }
    } catch {
      // Silent fail
    }
  }, [profile, isKitchenRole, activeAlarm, dismissedIds])

  // Poll for alarms
  useEffect(() => {
    if (!isKitchenRole) return

    // Initial check after 5 seconds (let the page load)
    const initialTimeout = setTimeout(checkAlarms, 5000)

    // Then check every 30 seconds
    const interval = setInterval(checkAlarms, CHECK_INTERVAL)

    return () => {
      clearTimeout(initialTimeout)
      clearInterval(interval)
    }
  }, [checkAlarms, isKitchenRole])

  // Dismiss alarm
  const dismissAlarm = () => {
    if (activeAlarm) {
      setDismissedIds(prev => new Set(prev).add(activeAlarm.task.id))
    }
    setActiveAlarm(null)
  }

  // Mark as done
  const markDone = async () => {
    if (!activeAlarm) return
    try {
      const supabase = createClient()
      await supabase
        .from('checklist_items')
        .update({ status: 'done', completed_by: profile?.id })
        .eq('id', activeAlarm.task.id)

      setDismissedIds(prev => new Set(prev).add(activeAlarm.task.id))
      setActiveAlarm(null)
    } catch {
      // Still dismiss
      dismissAlarm()
    }
  }

  if (!activeAlarm) return null

  const task = activeAlarm.task
  const isCritical = task.is_critical

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop — pulsing red for critical */}
      <div
        className={`fixed inset-0 ${isCritical ? 'bg-[#ea504c]/30 animate-pulse' : 'bg-black/40'} backdrop-blur-sm`}
        onClick={dismissAlarm}
      />

      {/* Alarm card */}
      <div className={`relative z-10 w-full max-w-sm overflow-hidden rounded-2xl shadow-2xl ${
        isCritical ? 'ring-4 ring-[#ea504c]' : 'ring-2 ring-[#d4943a]'
      }`}>
        {/* Header */}
        <div className={`px-5 py-4 ${isCritical ? 'bg-[#ea504c]' : 'bg-[#d4943a]'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`flex size-10 items-center justify-center rounded-full ${isCritical ? 'bg-white/20 animate-bounce' : 'bg-white/20'}`}>
                {isCritical ? <AlertTriangle className="size-5 text-white" /> : <Bell className="size-5 text-white" />}
              </div>
              <div>
                <p className="text-base font-bold text-white">
                  {isCritical ? '⚠️ TAREA CRÍTICA' : '🔔 Recordatorio'}
                </p>
                <p className="text-xs text-white/70">
                  Programada para las {task.scheduled_time}
                </p>
              </div>
            </div>
            <button onClick={dismissAlarm} className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white">
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="bg-white p-5">
          <div className="flex items-start gap-3">
            <Clock className="size-5 shrink-0 text-[#a39e97] mt-0.5" />
            <div>
              <p className="text-lg font-bold text-[#3d2c24]">{task.title}</p>
              <p className="mt-1 text-xs text-[#a39e97]">
                {format(activeAlarm.triggeredAt, "HH:mm", { locale: es })} · Turno {new Date().getHours() < 15 ? 'Mañana' : 'Noche'}
              </p>
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              onClick={dismissAlarm}
              className="flex-1 rounded-xl border border-[#ebe6df] py-3 text-sm font-semibold text-[#a39e97] transition-colors hover:bg-[#f3efe9]"
            >
              Después
            </button>
            <button
              onClick={markDone}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-semibold text-white transition-all active:scale-[0.98] ${
                isCritical ? 'bg-[#ea504c] hover:bg-[#d43e3a]' : 'bg-[#006d5a] hover:bg-[#005a4a]'
              }`}
            >
              <Check className="size-4" />
              Hecho
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
