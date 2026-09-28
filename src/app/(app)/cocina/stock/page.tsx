import { redirect } from 'next/navigation'

// Cocina usa la misma pantalla de stock que el encargado, filtrada por su área.
// (Antes había una segunda implementación con otro semáforo y sin nota de
// conteo, así que las diferencias grandes quedaban rechazadas por Fudo.)
export default function CocinaStockRedirect() {
  redirect('/stock?area=cocina')
}
