'use client'

import { usePushSubscription } from '@/lib/hooks/use-push-subscription'

export function PushSubscriber() {
  usePushSubscription()
  return null
}
