'use client'

import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { SWR_KEYS } from '@/lib/swr/keys'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NextShift = {
  shift_date: string
  start_time: string
  end_time: string
  shift_role: AppRole
}

// ---------------------------------------------------------------------------
// Hook — next upcoming shift for a user
// ---------------------------------------------------------------------------

export function useNextShift(userId: string | undefined, todayStr: string) {
  const { data, error, isLoading, mutate } = useSWR(
    userId ? SWR_KEYS.nextShift(userId) : null,
    async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('shifts')
        .select('shift_date, start_time, end_time, shift_role')
        .eq('user_id', userId!)
        .gte('shift_date', todayStr)
        .order('shift_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as NextShift | null
    },
    {
      revalidateOnFocus: true,
      dedupingInterval: 300_000, // 5 min — shifts don't change often
    },
  )

  return { nextShift: data ?? null, error, isLoading, mutate }
}
