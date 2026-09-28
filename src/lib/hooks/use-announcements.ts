'use client'

import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { SWR_KEYS } from '@/lib/swr/keys'

// ---------------------------------------------------------------------------
// Hook — count of unread announcements via the existing RPC
// ---------------------------------------------------------------------------

export function useAnnouncements() {
  const { data, error, isLoading, mutate } = useSWR(
    SWR_KEYS.announcements(),
    async () => {
      const supabase = createClient()
      const { data, error } = await supabase.rpc('get_my_announcements')
      if (error) throw error
      return (data ?? []) as { id: string }[]
    },
    {
      revalidateOnFocus: true,
      dedupingInterval: 60_000,
    },
  )

  return {
    announcements: data ?? [],
    count: data?.length ?? 0,
    error,
    isLoading,
    mutate,
  }
}
