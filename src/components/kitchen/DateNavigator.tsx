'use client'

import { useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, subDays, isToday, format } from 'date-fns'
import { es } from 'date-fns/locale'

type DateNavigatorProps = {
  selectedDate: Date
  onDateChange: (date: Date) => void
}

export function DateNavigator({ selectedDate, onDateChange }: DateNavigatorProps) {
  const today = isToday(selectedDate)

  const goPrev = useCallback(() => onDateChange(subDays(selectedDate, 1)), [selectedDate, onDateChange])
  const goNext = useCallback(() => onDateChange(addDays(selectedDate, 1)), [selectedDate, onDateChange])
  const goToday = useCallback(() => onDateChange(new Date()), [onDateChange])

  // Keyboard navigation: ← → arrows + T for today
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't hijack keys when user is typing in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goNext() }
      else if (e.key === 't' || e.key === 'T') { goToday() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goPrev, goNext, goToday])

  return (
    <div className="card-elevated flex items-center justify-between rounded-xl px-3 py-2.5">
      <button
        onClick={goPrev}
        aria-label="Dia anterior"
        className="flex size-9 items-center justify-center rounded-xl text-[#a39e97] transition-colors hover:bg-secondary hover:text-[#3d2c24]"
      >
        <ChevronLeft className="size-5" />
      </button>

      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold capitalize text-[#3d2c24]">
          {format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
        </span>
        {today && (
          <span className="rounded-full bg-[#e8f5f1] px-2 py-0.5 text-[10px] font-semibold text-[#006d5a]">
            Hoy
          </span>
        )}
        {!today && (
          <button
            onClick={goToday}
            className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-[#a39e97] transition-colors hover:bg-[#e8f5f1] hover:text-[#006d5a]"
          >
            Ir a hoy
          </button>
        )}
      </div>

      <button
        onClick={goNext}
        aria-label="Dia siguiente"
        className="flex size-9 items-center justify-center rounded-xl text-[#a39e97] transition-colors hover:bg-secondary hover:text-[#3d2c24]"
      >
        <ChevronRight className="size-5" />
      </button>
    </div>
  )
}
