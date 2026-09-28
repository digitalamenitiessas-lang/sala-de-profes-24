import { Loader2 } from 'lucide-react'

export function LoadingState({ message = 'Cargando...' }: { message?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      <Loader2 className="size-6 animate-spin text-[#006d5a]" strokeWidth={1.75} />
      <p className="text-[13px] font-medium text-muted-foreground">{message}</p>
    </div>
  )
}
