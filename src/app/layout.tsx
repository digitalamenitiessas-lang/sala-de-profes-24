import type { Metadata, Viewport } from 'next'
import { Toaster } from '@/components/ui/sonner'
import { RegisterSW } from '@/components/pwa/register-sw'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sala de Profes 24 — La Vieja Escuela',
  description: 'Gestión interna de La Vieja Escuela — 24 y Maipú',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Profes 24',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Color de la sucursal (--sucursal en globals.css)
  themeColor: '#1f3a5f',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body
        className="font-sans antialiased"
      >
        <RegisterSW />
        {children}
        <Toaster
          position="top-center"
          // Debajo de la hora y la batería del iPhone (app instalada)
          offset={{ top: 'calc(env(safe-area-inset-top) + 24px)' }}
          mobileOffset={{ top: 'calc(env(safe-area-inset-top) + 16px)' }}
          toastOptions={{
            style: {
              borderRadius: '0.875rem',
              fontFamily: 'var(--font-barlow), sans-serif',
            },
          }}
        />
      </body>
    </html>
  )
}
