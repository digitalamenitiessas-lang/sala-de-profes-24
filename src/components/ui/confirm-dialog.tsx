'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from '@/components/ui/motion'
import { AlertTriangle } from 'lucide-react'

type ConfirmDialogProps = {
  trigger: ReactNode
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'default'
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    setLoading(true)
    try {
      await onConfirm()
    } finally {
      setLoading(false)
      setOpen(false)
    }
  }

  const colors = {
    danger: { bg: '#fef2f2', color: '#ea504c', btnClass: 'bg-[#ea504c] hover:bg-[#d43d3a]' },
    warning: { bg: '#fdf6ec', color: '#d4943a', btnClass: 'bg-[#d4943a] hover:bg-[#c08530]' },
    default: { bg: '#e8f5f1', color: '#006d5a', btnClass: 'bg-[#006d5a] hover:bg-[#004d3f]' },
  }[variant]

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => !loading && setOpen(false)} />
            <motion.div
              className="relative z-10 mx-3 mb-[calc(0.5rem+env(safe-area-inset-bottom))] w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl sm:mx-auto sm:mb-0"
              initial={{ opacity: 0, y: 50, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: colors.bg }}
                >
                  <AlertTriangle className="size-5" style={{ color: colors.color }} />
                </div>
                <div>
                  <p className="font-display text-base font-semibold text-[#3d2c24]">{title}</p>
                  {description && (
                    <p className="mt-1 text-sm text-[#a39e97]">{description}</p>
                  )}
                </div>
              </div>
              <div className="mt-5 flex gap-2.5">
                <Button
                  variant="outline"
                  className="h-12 flex-1"
                  onClick={() => setOpen(false)}
                  disabled={loading}
                >
                  {cancelLabel}
                </Button>
                <Button
                  className={`h-12 flex-1 text-white ${colors.btnClass}`}
                  onClick={handleConfirm}
                  disabled={loading}
                >
                  {loading ? '...' : confirmLabel}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
