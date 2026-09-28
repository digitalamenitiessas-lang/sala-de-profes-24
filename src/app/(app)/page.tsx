'use client'

import { useState } from 'react'
import { ActivarAvisos } from '@/components/push/ActivarAvisos'
import { isManagerOrAbove, mustClockIn } from '@/lib/roles'
import Link from 'next/link'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import {
  CalendarDays,
  Bell,
  Clock,
  LogIn,
  ArrowRight,
  BarChart3,
  ShieldAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useProfileContext } from '@/lib/hooks/use-profile'
import { useMyAttendance } from '@/lib/hooks/use-attendance'
import { useNextShift } from '@/lib/hooks/use-shifts'
import { useDashboardData } from '@/lib/hooks/use-dashboard'
import { DashboardSkeleton } from '@/components/ui/skeleton'
import { AnnouncementPopup } from '@/components/notifications/AnnouncementPopup'
import { PulseCarousel } from '@/components/home/PulseCarousel'
import { BirthdayBanner } from '@/components/home/BirthdayBanner'
import { ShiftReminder } from '@/components/notifications/ShiftReminder'
import { FadeIn, StaggerList, StaggerItem, ScalePress } from '@/components/ui/motion'

// ---------------------------------------------------------------------------
// Action card — patrón "accesos rápidos" de /control: barra de acento +
// card-interactive + ícono + descripción de una línea + flecha.
// ---------------------------------------------------------------------------

type HomeAction = {
  href: string
  icon: LucideIcon
  label: string
  description: string
}

function ActionCard({ href, icon: Icon, label, description }: HomeAction) {
  return (
    <ScalePress>
      <Link href={href}>
        <div className="card-interactive flex items-center overflow-hidden rounded-2xl">
          <div className="w-1.5 self-stretch bg-[#006d5a]" />
          <div className="flex flex-1 items-center justify-between px-4 py-5">
            <span className="flex items-center gap-3.5">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#f0f7f5]">
                <Icon className="size-5.5 text-[#006d5a]" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-lg leading-tight text-[#3d2c24]">
                  {label}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-[#8d8378]">
                  {description}
                </span>
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-[#d1cdc7]" />
          </div>
        </div>
      </Link>
    </ScalePress>
  )
}

// ---------------------------------------------------------------------------
// Dashboard Page — "1 número + 3 acciones" por rol
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const { profile, loading: profileLoading } = useProfileContext()

  const [today] = useState(() => new Date())
  const todayStr = format(today, 'yyyy-MM-dd')
  const isEncargado = isManagerOrAbove(profile?.role)

  // SWR hooks — cada uno con su cache, dedup y revalidación en background
  const { record: todayAttendance } = useMyAttendance(profile?.id)
  const { nextShift } = useNextShift(profile?.id, todayStr)
  const { data: dashData, isLoading: dashLoading, error: dashError, mutate: refreshDash } = useDashboardData(
    profile?.id,
    todayStr,
    profile?.role,
    isEncargado,
  )

  const ventasHoy = dashData?.ventasHoy ?? null

  const firstName = profile?.first_name ?? ''

  // ------------------------------------------
  // Skeleton while loading
  // ------------------------------------------
  if (profileLoading || (dashLoading && !dashData)) {
    return <DashboardSkeleton />
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-[#a39e97]">No se pudo cargar el perfil.</p>
      </div>
    )
  }

  if (dashError && !dashData) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <p className="text-lg">😕</p>
        <p className="text-sm text-muted-foreground">No se pudieron cargar los datos</p>
        <button onClick={() => refreshDash()} className="rounded-xl bg-[#006d5a] px-4 py-2 text-sm font-medium text-white">
          Reintentar
        </button>
      </div>
    )
  }

  // Attendance status helpers
  const isCompleted = !!todayAttendance?.clock_out_at
  const isInProgress = !!todayAttendance && !todayAttendance.clock_out_at
  const statusColor = isCompleted ? '#006d5a' : isInProgress ? '#d4943a' : '#ebe6df'

  // Turno de HOY (useNextShift arranca desde hoy: si coincide la fecha, es el de hoy)
  const todayShift = nextShift && nextShift.shift_date === todayStr ? nextShift : null

  const managerActions: HomeAction[] = [
    {
      href: '/hoy',
      icon: CalendarDays,
      label: 'Hoy',
      description: 'El día de un vistazo: pedir, recibir, producir y contar',
    },
    {
      href: '/ventas',
      icon: BarChart3,
      label: 'Números',
      description: 'Facturación, tickets y tendencia desde Fudo',
    },
    {
      href: '/control',
      icon: ShieldAlert,
      label: 'Centro de control',
      description: 'Stock crítico, anomalías y fichajes en un solo lugar',
    },
  ]

  const employeeActions: HomeAction[] = [
    {
      href: '/mi-turno',
      icon: LogIn,
      label: 'Fichar',
      description: 'Marcar ingreso o egreso del turno',
    },
    {
      href: '/mi-turno',
      icon: Clock,
      label: 'Mi turno',
      description: 'Estado de hoy y horas trabajadas',
    },
    {
      href: '/notificaciones',
      icon: Bell,
      label: 'Avisos',
      description: 'Comunicados y novedades del equipo',
    },
  ]

  const actions = isEncargado ? managerActions : employeeActions

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-8">
      {/* Avisos push: todo el equipo (se oculta al activarlos) */}
      <ActivarAvisos />
      {/* ---------------------------------------------------------------- */}
      {/* El "1 número": Pulso (managers) / Turno de hoy (empleados)       */}
      {/* ---------------------------------------------------------------- */}
      {isEncargado ? (
        <FadeIn className="pt-1">
          <PulseCarousel
            ventasHoy={ventasHoy ? { total: ventasHoy.total, tickets: ventasHoy.tickets, peakHour: ventasHoy.peakHour } : null}
          />
        </FadeIn>
      ) : (
        <FadeIn className="pt-1">
          <div className="overflow-hidden rounded-2xl bg-[#006d5a] px-5 py-6 text-white shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
              Tu situación de hoy
            </p>
            <p className="mt-2 font-display text-3xl leading-tight tabular-nums">
              {isInProgress && todayAttendance
                ? `En turno desde ${format(new Date(todayAttendance.clock_in_at), 'HH:mm')}`
                : isCompleted
                  ? 'Turno cumplido ✓'
                  : todayShift
                    ? `Tu turno hoy: ${todayShift.start_time.slice(0, 5)}–${todayShift.end_time.slice(0, 5)}`
                    : 'Hoy no tenés turno'}
            </p>
            <p className="mt-1.5 text-xs text-white/75">
              {isInProgress
                ? 'Acordate de marcar el egreso al terminar'
                : isCompleted && todayAttendance?.clock_out_at
                  ? `Saliste a las ${format(new Date(todayAttendance.clock_out_at), 'HH:mm')}`
                  : todayShift
                    ? 'Fichá al llegar para dejarlo registrado'
                    : nextShift
                      ? `Próximo: ${format(new Date(nextShift.shift_date + 'T12:00:00'), 'EEEE d MMM', { locale: es })} · ${nextShift.start_time.slice(0, 5)}–${nextShift.end_time.slice(0, 5)}`
                      : 'Sin turnos asignados esta semana'}
            </p>
          </div>
        </FadeIn>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Birthday banner — managers only                                  */}
      {/* ---------------------------------------------------------------- */}
      {isEncargado && (
        <FadeIn>
          <BirthdayBanner />
        </FadeIn>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Header / Welcome — compact                                       */}
      {/* ---------------------------------------------------------------- */}
      <FadeIn className="pt-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl tracking-tight text-[#3d2c24]">
              Hola, <span className="text-[#006d5a]">{firstName}</span>
            </h1>
            <p className="section-label mt-1 capitalize">
              {format(today, "EEEE d 'de' MMMM", { locale: es })}
            </p>
          </div>
          {/* Compact attendance status / CTA — right aligned */}
          {mustClockIn(profile) && (
            !todayAttendance ? (
              <Link
                href="/mi-turno"
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#006d5a] px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#005a4a] active:scale-[0.98]"
              >
                <LogIn className="size-3.5" />
                Fichar ahora
              </Link>
            ) : (
              <Link
                href="/mi-turno"
                className="flex items-center gap-2 rounded-xl px-3 py-2 transition-colors hover:bg-[#f3efe9]"
              >
                <div className="size-2.5 rounded-full" style={{ backgroundColor: statusColor }} />
                <span className="text-xs font-semibold text-[#3d2c24]">
                  {isCompleted ? 'Turno OK' : 'En turno'}
                </span>
                <span className="text-[10px] tabular-nums text-[#a39e97]">
                  {format(new Date(todayAttendance.clock_in_at), 'HH:mm')}
                </span>
              </Link>
            )
          )}
        </div>
      </FadeIn>

      {/* ---------------------------------------------------------------- */}
      {/* Las 3 acciones                                                   */}
      {/* ---------------------------------------------------------------- */}
      <StaggerList className="flex flex-col gap-3" staggerDelay={0.06}>
        {actions.map((action) => (
          <StaggerItem key={action.href}>
            <ActionCard {...action} />
          </StaggerItem>
        ))}
      </StaggerList>

      {/* ---------------------------------------------------------------- */}
      {/* Announcement Popup — unread urgent/general on load               */}
      {/* ---------------------------------------------------------------- */}
      <AnnouncementPopup />

      {/* Shift Reminder — for non-socios who haven't clocked in */}
      <ShiftReminder />
    </div>
  )
}
