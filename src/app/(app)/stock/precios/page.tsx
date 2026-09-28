import { redirect } from 'next/navigation'

// Los precios de compra ahora viven en Números (/ventas?m=precios).
// Este redirect mantiene funcionando los links viejos a /stock/precios.
export default function Page() {
  redirect('/ventas?m=precios')
}
