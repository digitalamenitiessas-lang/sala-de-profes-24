'use client'

import { MapPin, Camera, Shield, Wifi } from 'lucide-react'
import { cn } from '@/lib/utils'

type BadgeStatus = 'verde' | 'amber' | 'rojo' | 'grey'

type Props = {
  geo?: BadgeStatus
  selfie?: BadgeStatus
  device?: BadgeStatus
  network?: BadgeStatus
  size?: 'sm' | 'md'
}

const colorMap: Record<BadgeStatus, string> = {
  verde: 'text-[#006d5a]',
  amber: 'text-[#d4943a]',
  rojo: 'text-[#ea504c]',
  grey: 'text-[#ccc7c0]',
}

export default function SecurityBadge({ geo = 'grey', selfie = 'grey', device = 'grey', network = 'grey', size = 'sm' }: Props) {
  const s = size === 'sm' ? 'size-3.5' : 'size-4'

  return (
    <div className="flex items-center gap-1.5">
      <MapPin  className={cn(s, colorMap[geo])} />
      <Camera  className={cn(s, colorMap[selfie])} />
      <Shield  className={cn(s, colorMap[device])} />
      <Wifi    className={cn(s, colorMap[network])} />
    </div>
  )
}
