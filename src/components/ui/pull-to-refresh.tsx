'use client'

import { useState, useRef, useCallback, type ReactNode } from 'react'
import { Loader2, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type PullToRefreshProps = {
  onRefresh: () => Promise<void>
  children: ReactNode
  className?: string
}

export function PullToRefresh({ onRefresh, children, className }: PullToRefreshProps) {
  const [pulling, setPulling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const startY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const threshold = 60

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const main = containerRef.current?.closest('main')
    if (main && main.scrollTop <= 0) {
      startY.current = e.touches[0].clientY
      setPulling(true)
    }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pulling || refreshing) return
    const diff = e.touches[0].clientY - startY.current
    if (diff > 0) {
      setPullDistance(Math.min(diff * 0.4, 80))
    }
  }, [pulling, refreshing])

  const onTouchEnd = useCallback(async () => {
    if (pullDistance >= threshold && !refreshing) {
      setRefreshing(true)
      setPullDistance(40)
      await onRefresh()
      setRefreshing(false)
    }
    setPulling(false)
    setPullDistance(0)
  }, [pullDistance, refreshing, onRefresh])

  return (
    <div
      ref={containerRef}
      className={className}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull indicator */}
      <div
        className={cn(
          'flex items-center justify-center overflow-hidden transition-all',
          pullDistance > 0 ? 'opacity-100' : 'opacity-0',
        )}
        style={{ height: pullDistance }}
      >
        {refreshing ? (
          <Loader2 className="size-5 animate-spin text-[#006d5a]" />
        ) : (
          <ArrowDown
            className={cn(
              'size-5 text-[#a39e97] transition-transform',
              pullDistance >= threshold && 'rotate-180 text-[#006d5a]',
            )}
          />
        )}
      </div>
      {children}
    </div>
  )
}
