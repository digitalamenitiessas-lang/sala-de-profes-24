'use client'

import { SWRConfig } from 'swr'
import type { ReactNode } from 'react'

const SWR_DEFAULTS = {
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  dedupingInterval: 5000,
  errorRetryCount: 3,
  keepPreviousData: true,
}

export function SWRProvider({ children }: { children: ReactNode }) {
  return <SWRConfig value={SWR_DEFAULTS}>{children}</SWRConfig>
}
