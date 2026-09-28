'use client'

import { useEffect, useState } from 'react'
import { Cake } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export function BirthdayBanner() {
  const [birthdays, setBirthdays] = useState<string[]>([])

  useEffect(() => {
    async function check() {
      const supabase = createClient()
      const { data } = await supabase
        .from('profiles')
        .select('first_name, last_name, birth_date')
        .eq('is_active', true)
        .not('birth_date', 'is', null)
      if (!data) return

      // Hoy en Argentina (UTC-3)
      const nowAR = new Date(Date.now() - 3 * 60 * 60 * 1000)
      const todayMonth = nowAR.getUTCMonth() + 1
      const todayDay = nowAR.getUTCDate()

      const names = data
        .filter((p) => {
          if (!p.birth_date) return false
          const [, mm, dd] = p.birth_date.split('-').map(Number)
          return mm === todayMonth && dd === todayDay
        })
        .map((p) => p.first_name)

      setBirthdays(names)
    }
    check()
  }, [])

  if (birthdays.length === 0) return null

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-[#fdf6ec] px-4 py-3 ring-1 ring-[#d4943a]/30">
      <Cake className="size-5 shrink-0 text-[#d4943a]" />
      <div>
        <p className="text-sm font-semibold text-[#3d2c24]">
          🎂 Hoy cumple{birthdays.length > 1 ? 'n' : ''} años
        </p>
        <p className="text-xs text-[#7d6c64]">
          {birthdays.join(', ')} — ¡felicitalo{birthdays.length > 1 ? 's' : ''}!
        </p>
      </div>
    </div>
  )
}
