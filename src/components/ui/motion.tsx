'use client'

import { motion, useSpring, useTransform, useMotionValue, animate, AnimatePresence } from 'framer-motion'
import type { HTMLMotionProps } from 'framer-motion'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// FadeIn — Fade + slide up al entrar en viewport
// ---------------------------------------------------------------------------

type FadeInProps = HTMLMotionProps<'div'> & {
  delay?: number
  duration?: number
  children: ReactNode
}

export function FadeIn({ delay = 0, duration = 0.4, children, className, ...props }: FadeInProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// StaggerList + StaggerItem — Anima hijos secuencialmente
// ---------------------------------------------------------------------------

type StaggerListProps = {
  children: ReactNode
  className?: string
  staggerDelay?: number
}

export function StaggerList({ children, className, staggerDelay = 0.05 }: StaggerListProps) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{
        hidden: {},
        show: {
          transition: {
            staggerChildren: staggerDelay,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 16 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// SlideIn — Desliza desde una dirección
// ---------------------------------------------------------------------------

type SlideInProps = HTMLMotionProps<'div'> & {
  from?: 'left' | 'right' | 'top' | 'bottom'
  delay?: number
  duration?: number
  children: ReactNode
}

const slideOffsets = {
  left: { x: -30, y: 0 },
  right: { x: 30, y: 0 },
  top: { x: 0, y: -30 },
  bottom: { x: 0, y: 30 },
}

export function SlideIn({ from = 'bottom', delay = 0, duration = 0.4, children, className, ...props }: SlideInProps) {
  const offset = slideOffsets[from]
  return (
    <motion.div
      initial={{ opacity: 0, ...offset }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// ScalePress — Micro-scale feedback al presionar (haptic visual)
// ---------------------------------------------------------------------------

type ScalePressProps = HTMLMotionProps<'div'> & {
  children: ReactNode
  scale?: number
}

export function ScalePress({ children, className, scale = 0.97, ...props }: ScalePressProps) {
  return (
    <motion.div
      whileTap={{ scale }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      className={cn('cursor-pointer', className)}
      {...props}
    >
      {children}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// AnimatedNumber — Counter que sube animado (para KPIs)
// ---------------------------------------------------------------------------

type AnimatedNumberProps = {
  value: number
  className?: string
  duration?: number
}

export function AnimatedNumber({ value, className, duration = 0.8 }: AnimatedNumberProps) {
  const nodeRef = useRef<HTMLSpanElement>(null)
  const motionValue = useMotionValue(0)
  const springValue = useSpring(motionValue, { duration: duration * 1000 })
  const display = useTransform(springValue, (v) => Math.round(v))

  useEffect(() => {
    motionValue.set(value)
  }, [motionValue, value])

  useEffect(() => {
    const unsubscribe = display.on('change', (v) => {
      if (nodeRef.current) {
        nodeRef.current.textContent = String(v)
      }
    })
    return unsubscribe
  }, [display])

  return <span ref={nodeRef} className={className}>0</span>
}

// ---------------------------------------------------------------------------
// AnimatePresenceWrapper — Para transiciones de contenido condicional
// ---------------------------------------------------------------------------

export function AnimatedSwitch({ children, id }: { children: ReactNode; id: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={id}
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        transition={{ duration: 0.2, ease: 'easeInOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

// ---------------------------------------------------------------------------
// PulseRing — Animación de pulso tipo notificación live
// ---------------------------------------------------------------------------

export function PulseRing({ color = '#d4943a', className }: { color?: string; className?: string }) {
  return (
    <span className={cn('relative flex size-2.5', className)}>
      <motion.span
        className="absolute inline-flex size-full rounded-full opacity-75"
        style={{ backgroundColor: color }}
        animate={{ scale: [1, 1.8], opacity: [0.75, 0] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
      />
      <span
        className="relative inline-flex size-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  )
}

// Re-export motion for direct use
export { motion, AnimatePresence }
