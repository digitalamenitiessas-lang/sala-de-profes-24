'use client'

import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-50">
            <AlertTriangle className="size-7 text-amber-500" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Algo salió mal</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Hubo un error inesperado. Intentá recargar la página.
            </p>
          </div>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary/90"
          >
            <RefreshCw className="size-4" />
            Recargar
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
