'use client'

import { format, isSameDay } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { Trash2 } from 'lucide-react'
import { ROLES } from '@/lib/constants'
import { EmptyState } from '@/components/ui/EmptyState'
import { CalendarDays } from 'lucide-react'
import type { ShiftCardData } from '@/components/shifts/ShiftCard'
import type { AppRole } from '@/types/database'

type ShiftWithProfile = ShiftCardData & { created_by: string }

type EmployeeOption = {
  id: string
  first_name: string
  last_name: string
  role: AppRole
}

type Props = {
  weekDays: Date[]
  employees: EmployeeOption[]
  shifts: ShiftWithProfile[]
  onEditShift: (shift: ShiftWithProfile) => void
  onDeleteShift: (shift: ShiftWithProfile) => void
  onCreateForSlot: (userId: string, date: Date, role: AppRole) => void
}

const ROLE_ORDER: AppRole[] = ['encargado', 'cajero', 'chef', 'cocina', 'barista', 'runner', 'bacha']

export function WeekGrid({ weekDays, employees, shifts, onEditShift, onDeleteShift, onCreateForSlot }: Props) {
  // Los socios no usan turnos. Cada persona sale en el grupo de su rol de
  // siempre; el día que trabaja de otra cosa, la celda lo marca.
  const employeesWithShifts = employees.filter(emp => emp.role !== 'socio').map(emp => {
    const weekShifts = weekDays.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd')
      return shifts.find(s => s.user_id === emp.id && s.shift_date === dayStr) ?? null
    })
    return { ...emp, weekShifts }
  })

  const byRole = new Map<string, typeof employeesWithShifts>()
  for (const emp of employeesWithShifts) {
    const list = byRole.get(emp.role) ?? []
    list.push(emp)
    byRole.set(emp.role, list)
  }

  const sortedRoles = ROLE_ORDER.filter(r => byRole.has(r))
  for (const r of byRole.keys()) {
    if (!sortedRoles.includes(r as AppRole)) sortedRoles.push(r as AppRole)
  }

  if (shifts.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="Sin turnos esta semana"
        description="No hay turnos programados para esta semana. Toca el boton + para crear uno."
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Desktop grid */}
      <div className="-mx-4 overflow-x-auto px-4 scrollbar-none">
        <div className="min-w-[700px]">
          {/* Day headers */}
          <div className="grid grid-cols-[140px_repeat(7,1fr)] gap-1">
            <div />
            {weekDays.map(day => {
              const isToday = isSameDay(day, new Date())
              return (
                <div key={day.toISOString()} className={`rounded-lg px-1 py-2 text-center text-[11px] font-semibold ${isToday ? 'bg-[#006d5a] text-white' : 'bg-[#f8f5f0] text-[#3d2c24]'}`}>
                  <span className="uppercase">{format(day, 'EEE', { locale: es })}</span>
                  <span className="ml-1 tabular-nums">{format(day, 'd')}</span>
                </div>
              )
            })}
          </div>

          {/* Roles + employees */}
          {sortedRoles.map(role => {
            const roleEmps = byRole.get(role) ?? []
            if (roleEmps.length === 0) return null
            const roleConfig = ROLES[role] ?? { label: role, emoji: '👤', color: '#a39e97', bg: '#f3efe9' }

            return (
              <div key={role} className="mt-3">
                <div className="mb-1 flex items-center gap-1.5 px-1">
                  <span className="text-sm">{roleConfig.emoji}</span>
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: roleConfig.color }}>
                    {roleConfig.label}s
                  </span>
                  <span className="text-[10px] text-[#a39e97]">({roleEmps.length})</span>
                </div>
                {roleEmps.map(emp => (
                  <div key={emp.id} className="mb-1 grid grid-cols-[140px_repeat(7,1fr)] gap-1">
                    <div className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-2 ring-1 ring-[#ebe6df]">
                      <div className="flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: roleConfig.color }}>
                        {(emp.first_name?.[0] ?? '')}{(emp.last_name?.[0] ?? '')}
                      </div>
                      <span className="truncate text-xs font-medium text-[#3d2c24]">{emp.first_name}</span>
                    </div>
                    {emp.weekShifts.map((shift, i) => {
                      const day = weekDays[i]!
                      const isToday = isSameDay(day, new Date())
                      if (!shift) {
                        return (
                          <div
                            key={day.toISOString()}
                            className={`flex cursor-pointer items-center justify-center rounded-lg text-[10px] text-[#d1cdc7] hover:bg-[#f3efe9] ${isToday ? 'bg-[#f0f7f5] ring-1 ring-[#006d5a]/20' : 'bg-[#faf8f5]'}`}
                            onClick={() => onCreateForSlot(emp.id, day, emp.role)}
                          >
                            —
                          </div>
                        )
                      }
                      const time = `${shift.start_time.slice(0, 5)}-${shift.end_time.slice(0, 5)}`
                      const isDescanso = shift.notes?.toLowerCase().includes('descanso')
                      return (
                        <div
                          key={day.toISOString()}
                          className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-lg px-1 py-1.5 transition-colors hover:ring-[#006d5a]/50 ${
                            isDescanso ? 'bg-[#f3efe9] text-[#a39e97]' : isToday ? 'bg-[#e8f5f1] ring-1 ring-[#006d5a]/30' : 'bg-white ring-1 ring-[#ebe6df]'
                          }`}
                          onClick={() => onEditShift(shift)}
                        >
                          {isDescanso ? (
                            <span className="text-[10px] font-medium">Desc.</span>
                          ) : (
                            <span className="text-[10px] font-bold tabular-nums text-[#3d2c24]">{time}</span>
                          )}
                          {!isDescanso && shift.shift_role && shift.shift_role !== emp.role && (
                            <span className="mt-0.5 rounded px-1 text-[9px] font-bold" style={{ color: ROLES[shift.shift_role]?.color ?? '#b0762a', backgroundColor: ROLES[shift.shift_role]?.bg ?? '#fdf6ec' }}>
                              {ROLES[shift.shift_role]?.label ?? shift.shift_role}
                            </span>
                          )}
                          <button
                            className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-[#ea504c] text-white shadow-sm group-hover:flex"
                            onClick={(e) => { e.stopPropagation(); onDeleteShift(shift) }}
                          >
                            <Trash2 className="size-2.5" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* Mobile list */}
      <div className="space-y-3 md:hidden">
        {sortedRoles.map(role => {
          const roleEmps = byRole.get(role) ?? []
          if (roleEmps.length === 0) return null
          const roleConfig = ROLES[role] ?? { label: role, emoji: '👤', color: '#a39e97', bg: '#f3efe9' }
          return (
            <div key={role}>
              <div className="mb-2 flex items-center gap-1.5">
                <span>{roleConfig.emoji}</span>
                <span className="text-xs font-bold uppercase tracking-wider" style={{ color: roleConfig.color }}>{roleConfig.label}s</span>
              </div>
              {roleEmps.map(emp => (
                <div key={emp.id} className="mb-2 rounded-xl bg-white p-3 ring-1 ring-[#ebe6df]">
                  <p className="text-sm font-semibold text-[#3d2c24]">{emp.first_name} {emp.last_name}</p>
                  <div className="mt-2 grid grid-cols-7 gap-1">
                    {emp.weekShifts.map((shift, i) => {
                      const day = weekDays[i]!
                      const isToday = isSameDay(day, new Date())
                      const dayLabel = format(day, 'EEE', { locale: es }).slice(0, 2).toUpperCase()
                      return (
                        <div key={day.toISOString()} className="text-center">
                          <p className={`text-[9px] font-semibold ${isToday ? 'text-[#006d5a]' : 'text-[#a39e97]'}`}>{dayLabel}</p>
                          {shift ? (
                            <button
                              onClick={() => onEditShift(shift)}
                              className={`mt-0.5 w-full rounded-md px-0.5 py-1 text-[9px] font-bold tabular-nums ${
                                shift.notes?.toLowerCase().includes('descanso') ? 'bg-[#f3efe9] text-[#a39e97]' : isToday ? 'bg-[#e8f5f1] text-[#006d5a]' : 'bg-[#faf8f5] text-[#3d2c24]'
                              }`}
                            >
                              {shift.notes?.toLowerCase().includes('descanso') ? 'D' : `${shift.start_time.slice(0, 2)}-${shift.end_time.slice(0, 2)}`}
                              {shift.shift_role && shift.shift_role !== emp.role && (
                                <span className="block text-[10px] leading-none" title={ROLES[shift.shift_role]?.label}>{ROLES[shift.shift_role]?.emoji}</span>
                              )}
                            </button>
                          ) : (
                            <div className="mt-0.5 rounded-md bg-[#faf8f5] py-1 text-[9px] text-[#d1cdc7]">—</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
