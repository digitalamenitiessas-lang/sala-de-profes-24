'use client'

import { useProfileContext } from '@/lib/hooks/use-profile'
import { isManagerOrAbove } from '@/lib/roles'
import { ShieldAlert } from 'lucide-react'
import { AdminSubNav } from '@/components/admin/AdminSubNav'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useProfileContext()

  if (loading) return null

  if (!isManagerOrAbove(profile?.role)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <ShieldAlert className="size-10 text-[#ea504c]/40" />
        <p className="font-display text-lg font-semibold text-[#3d2c24]">Acceso restringido</p>
        <p className="text-sm text-[#a39e97]">Este módulo es exclusivo para encargados.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <AdminSubNav />
      {children}
    </div>
  )
}
