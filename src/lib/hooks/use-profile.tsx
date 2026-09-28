'use client'

import {
  createContext,
  useContext,
  type ReactNode,
} from 'react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types/database'

// ---------------------------------------------------------------------------
// Hook — now backed by SWR for caching + dedup + background revalidation
// ---------------------------------------------------------------------------

type UseProfileReturn = {
  profile: Profile | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

async function fetchProfile(): Promise<Profile | null> {
  const supabase = createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) throw userError
  if (!user) return null

  const { data, error: profileError } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, role, avatar_url, phone, is_active, settings, created_at, updated_at')
    .eq('id', user.id)
    .single()

  if (profileError) throw profileError
  return data
}

export function useProfile(): UseProfileReturn {
  const { data, error, isLoading, mutate } = useSWR(
    'profile',
    fetchProfile,
    {
      revalidateOnFocus: true,
      dedupingInterval: 60_000,
      errorRetryCount: 2,
    },
  )

  return {
    profile: data ?? null,
    loading: isLoading,
    error: error ? (error instanceof Error ? error.message : 'Error al cargar el perfil') : null,
    refresh: async () => { await mutate() },
  }
}

// ---------------------------------------------------------------------------
// Context — same API surface, zero breaking changes across 15+ consumers
// ---------------------------------------------------------------------------

type ProfileContextValue = UseProfileReturn

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined)

export { ProfileContext }

type ProfileProviderProps = {
  children: ReactNode
}

export function ProfileProvider({ children }: ProfileProviderProps) {
  const profileValue = useProfile()

  return (
    <ProfileContext.Provider value={profileValue}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfileContext(): ProfileContextValue {
  const context = useContext(ProfileContext)

  if (context === undefined) {
    throw new Error(
      'useProfileContext must be used within a ProfileProvider',
    )
  }

  return context
}
