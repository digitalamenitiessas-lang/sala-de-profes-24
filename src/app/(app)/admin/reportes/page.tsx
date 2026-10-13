'use client'

import Link from 'next/link'
import { Users, CalendarDays, Package, BarChart2, ArrowRight, Wallet, Armchair, Bell, TrendingUp } from 'lucide-react'
import { FadeIn, StaggerList, StaggerItem, ScalePress } from '@/components/ui/motion'

const REPORTS = [
  { href: '/admin/reportes/ventas', icon: BarChart2, label: 'Ventas', description: 'Food cost por producto · tabla descargable · momentos', color: '#d4943a' },
  { href: '/admin/reportes/asistencia', icon: Users, label: 'Asistencia', description: 'Ingresos, egresos, horas por empleado', color: '#006d5a' },
  { href: '/admin/reportes/turnos', icon: CalendarDays, label: 'Turnos', description: 'Distribución por rol y cobertura', color: '#8b5e34' },
  { href: '/admin/reportes/stock', icon: Package, label: 'Stock', description: 'Semáforo, categorías, items críticos', color: '#ea504c' },
  { href: '/admin/reportes/liquidacion', icon: Wallet, label: 'Liquidación', description: 'Horas y sueldos por empleado del período', color: '#8b5e34' },
  { href: '/admin/reportes/control', icon: TrendingUp, label: 'Control del personal', description: 'Asistencia, encargados y sueldos contra ventas', color: '#006d5a' },
  { href: '/admin/reportes/salon', icon: Armchair, label: 'Tiempos de servicio', description: 'Cuánto tarda una mesa, por franja', color: '#4a90d9' },
  { href: '/admin/reportes/notificaciones', icon: Bell, label: 'Notificaciones', description: 'Qué avisos se enviaron y a quién', color: '#a39e97' },
]

export default function ReportesHubPage() {
  return (
    <div className="space-y-5">
      <FadeIn>
        <h2 className="font-display text-xl tracking-tight text-[#3d2c24]">Reportes</h2>
        <p className="section-label mt-1">Informes operativos de La Vieja Escuela</p>
      </FadeIn>

      <StaggerList className="flex flex-col gap-3" staggerDelay={0.06}>
        {REPORTS.map((report) => (
          <StaggerItem key={report.href}>
            <ScalePress>
              <Link href={report.href}>
                <div className="card-interactive flex items-center overflow-hidden rounded-xl">
                  <div className="w-1.5 self-stretch" style={{ backgroundColor: report.color }} />
                  <div className="flex flex-1 items-center justify-between px-4 py-4">
                    <span className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-xl" style={{ backgroundColor: `${report.color}10` }}>
                        <report.icon className="size-5" style={{ color: report.color }} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#3d2c24]">{report.label}</p>
                        <p className="text-xs text-[#a39e97]">{report.description}</p>
                      </div>
                    </span>
                    <ArrowRight className="size-4 text-[#d1cdc7]" />
                  </div>
                </div>
              </Link>
            </ScalePress>
          </StaggerItem>
        ))}
      </StaggerList>
    </div>
  )
}
