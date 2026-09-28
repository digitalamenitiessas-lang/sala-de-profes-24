'use client'

import { motion, AnimatePresence } from '@/components/ui/motion'
import { Check } from 'lucide-react'

type SuccessBurstProps = {
  show: boolean
  onComplete?: () => void
}

export function SuccessBurst({ show, onComplete }: SuccessBurstProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          onAnimationComplete={() => {
            setTimeout(() => onComplete?.(), 800)
          }}
        >
          <div className="absolute inset-0 bg-[#006d5a]/10 backdrop-blur-[2px]" />
          <motion.div
            className="relative flex size-24 items-center justify-center rounded-full bg-[#006d5a] shadow-2xl"
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}
          >
            <motion.div
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.3 }}
            >
              <Check className="size-12 text-white" strokeWidth={3} />
            </motion.div>
          </motion.div>
          {/* Ripple rings */}
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="absolute size-24 rounded-full border-2 border-[#006d5a]"
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: 2.5 + i * 0.5, opacity: 0 }}
              transition={{ delay: 0.2 + i * 0.15, duration: 0.8, ease: 'easeOut' }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
