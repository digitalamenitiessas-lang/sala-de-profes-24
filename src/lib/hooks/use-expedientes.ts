'use client'

import useSWR from 'swr'
import { SWR_KEYS } from '@/lib/swr/keys'
import { apiFetcher } from '@/lib/swr/fetchers'
import type { ExpedienteWithPeople } from '@/types/expedientes'

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useExpedientes(params: { status?: string; type?: string; search?: string }) {
  const searchParams = new URLSearchParams()
  if (params.status) searchParams.set('status', params.status)
  if (params.type) searchParams.set('type', params.type)
  if (params.search?.trim()) searchParams.set('search', params.search.trim())

  const paramsObj = Object.fromEntries(searchParams)
  const url = `/api/expedientes?${searchParams}`

  const { data, error, isLoading, mutate } = useSWR(
    SWR_KEYS.expedientes(paramsObj),
    () => apiFetcher<{ data: ExpedienteWithPeople[] }>(url).then(r => r.data),
    {
      revalidateOnFocus: true,
      dedupingInterval: 10_000,
      keepPreviousData: true,
    },
  )

  return {
    expedientes: data ?? [],
    error,
    isLoading,
    mutate,
  }
}
