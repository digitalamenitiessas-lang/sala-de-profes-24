import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Skeleton — Base pulse loader que imita la forma del contenido
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-lg bg-[#ebe6df]/60',
        className,
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// DashboardSkeleton — Skeleton completo del dashboard
// ---------------------------------------------------------------------------

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-lg space-y-6 pb-28">
      {/* Greeting */}
      <div className="space-y-2 pt-1">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Hero KPI card */}
      <Skeleton className="h-40 w-full rounded-2xl" />

      {/* Two column grid */}
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>

      {/* Encargado row */}
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>

      {/* Quick actions */}
      <div className="space-y-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AttendanceSkeleton — Skeleton para lista de asistencia
// ---------------------------------------------------------------------------

export function AttendanceSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl bg-white p-4 ring-1 ring-[#ebe6df]">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// CardSkeleton — Card genérica
// ---------------------------------------------------------------------------

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-3 rounded-2xl bg-white p-5 ring-1 ring-[#ebe6df]', className)}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-3 w-40" />
    </div>
  )
}
