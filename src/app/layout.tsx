import type { Metadata, Viewport } from 'next'
import { Toaster } from '@/components/ui/sonner'
import { RegisterSW } from '@/components/pwa/register-sw'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sala de Profes — La Vieja Escuela',
  description: 'Gestión interna de La Vieja Escuela',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Sala de Profes',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#006d5a',
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
