'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

// Redirect old URL to shared chatbot route
export default function ChatbotRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/asistente')
  }, [router])

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Loader2 className="size-6 animate-spin text-[#006d5a]" />
    </div>
  )
}
