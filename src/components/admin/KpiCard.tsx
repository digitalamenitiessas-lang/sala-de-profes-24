'use client'

import type { LucideIcon } from 'lucide-react'
import { AnimatedNumber, ScalePress } from '@/components/ui/motion'
import Link from 'next/link'

type KpiCardProps = {
  label: string
  value: number
  icon: LucideIcon
  color: string
  bg: string
  href?: string
  subtitle?: string
}

export function KpiCard({ label, value, icon: Icon, color, bg, href, subtitle }: KpiCardProps) {
  const content = (
    <div className="card-interactive rounded-xl p-4">
      <div className="flex items-center gap-2">
        <div
          className="flex size-7 items-center justify-center rounded-lg"
          style={{ backgroundColor: bg }}
        >
          <Icon className="size-3.5" style={{ color }} />
        </div>
        <span className="section-label">{label}</span>
      </div>
      <p className="mt-3 font-display text-3xl font-bold tabular-nums text-[#3d2c24]">
        <AnimatedNumber value={value} />
      </p>
      {subtitle && (
        <p className="mt-0.5 text-xs text-[#a39e97]">{subtitle}</p>
      )}
    </div>
  )

  if (href) {
    return (
      <ScalePress>
        <Link href={href}>{content}</Link>
      </ScalePress>
    )
  }

  return content
}
