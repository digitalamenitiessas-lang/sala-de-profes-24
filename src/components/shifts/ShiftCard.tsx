'use client'

import { format, isToday } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { Clock, StickyNote, User } from 'lucide-react'
import { ROLES } from '@/lib/constants'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShiftCardData = {
  id: string
  shift_date: string
  start_time: string
  end_time: string
  shift_role: AppRole
  notes: string | null
  user_id: string
  profile?: {
    first_name: string
    last_name: string
  } | null
}

type ShiftCardProps = {
  shift: ShiftCardData
  showPerson?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatShiftDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00')
  return format(date, "EEEE d 'de' MMMM", { locale: es })
}

function formatTime(timeStr: string): string {
  return timeStr.slice(0, 5)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShiftCard({ shift, showPerson = false }: ShiftCardProps) {
  const roleConfig = ROLES[shift.shift_role]
  const isTodayShift = isToday(new Date(shift.shift_date + 'T12:00:00'))

  return (
    <div
      className={`rounded-xl border bg-card p-3.5 transition-shadow hover:shadow-sm ${
        isTodayShift ? 'border-[#006d5a]/30 bg-[#f0f7f5]/40 ring-1 ring-[#006d5a]/10' : 'border-border'
      }`}
      style={{ borderLeftWidth: '3px', borderLeftColor: roleConfig.color }}
    >
      {/* Date */}
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold capitalize text-foreground">
          {formatShiftDate(shift.shift_date)}
        </p>
        {isTodayShift && (
          <span className="rounded-full bg-[#006d5a] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
            Hoy
          </span>
        )}
      </div>

      {/* Time range */}
      <div className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock className="size-3.5" />
        <span className="tabular-nums">
          {formatTime(shift.start_time)} – {formatTime(shift.end_time)}
        </span>
      </div>

      {/* Role badge */}
      <div className="mt-2 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ backgroundColor: roleConfig.bg, color: roleConfig.color }}
        >
          {roleConfig.emoji} {roleConfig.label}
        </span>
      </div>

      {/* Person name (encargado view) */}
      {showPerson && shift.profile && (
        <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <User className="size-3.5" />
          <span>
            {shift.profile.first_name} {shift.profile.last_name}
          </span>
        </div>
      )}

      {/* Notes */}
      {shift.notes && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <StickyNote className="mt-0.5 size-3 shrink-0" />
          <span>{shift.notes}</span>
        </div>
      )}
    </div>
  )
}
