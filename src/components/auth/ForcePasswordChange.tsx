'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Checks if the current user has `must_change_password` in their metadata.
 * If so, redirects to /cambiar-clave (unless already there).
 */
export function ForcePasswordChange() {
  const router = useRouter()
  const pathname = usePathname()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (checked) return

    async function check() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (
        user?.user_metadata?.must_change_password === true &&
        pathname !== '/cambiar-clave'
      ) {
        router.replace('/cambiar-clave')
      }
      setChecked(true)
    }

    check()
  }, [checked, pathname, router])

  return null
}
