import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Helpers para toasts consistentes con contexto útil al usuario
// ---------------------------------------------------------------------------

/** Extrae un mensaje legible de un unknown/Error */
export function humanizeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return 'Ocurrió un error inesperado.'
}

/**
 * Toast de error con contexto.
 *
 * @param title     Qué estaba intentando hacer el usuario ("No se pudo guardar el egreso")
 * @param err       El error crudo (Error, string, etc.)
 * @param opts.retry  Si se pasa, agrega un botón "Reintentar" que ejecuta la callback
 */
export function errorToast(
  title: string,
  err: unknown,
  opts?: { retry?: () => void | Promise<void> },
) {
  const description = humanizeError(err)
  toast.error(title, {
    description,
    action: opts?.retry
      ? { label: 'Reintentar', onClick: () => { void opts.retry!() } }
      : undefined,
  })
}

/** Toast de éxito con contexto opcional */
export function successToast(title: string, description?: string) {
  toast.success(title, description ? { description } : undefined)
}
