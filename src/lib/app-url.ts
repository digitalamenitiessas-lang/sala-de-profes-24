// ---------------------------------------------------------------------------
// Dirección pública de la app de la 24
// ---------------------------------------------------------------------------
// En la VPS se define NEXT_PUBLIC_APP_URL (/etc/salaprofes24/app.env). Como
// es NEXT_PUBLIC_*, se fija al compilar: si cambia, hay que recompilar. Sin la
// variable queda el dominio de la 24.
// La usa el PDF de los informes de La Vieja (logo y fuentes de public/).
// ---------------------------------------------------------------------------

export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lve24.com.ar').replace(/\/+$/, '')
