'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, sans-serif',
          backgroundColor: '#faf8f5',
          color: '#3d2c24',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem', maxWidth: '400px' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>
            Algo salio mal
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#a39e97', marginBottom: '1.5rem' }}>
            Ocurrio un error inesperado en la aplicacion.
          </p>
          <button
            onClick={reset}
            style={{
              backgroundColor: '#006d5a',
              color: 'white',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.75rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  )
}
