import { redirect } from 'next/navigation'

// El costo por producción ahora vive en Números (/ventas?m=produccion).
// Este redirect mantiene funcionando los links viejos a /stock/produccion/costos.
export default function Page() {
  redirect('/ventas?m=produccion')
}
