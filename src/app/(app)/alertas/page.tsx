import { redirect } from 'next/navigation'

// Las alertas de stock ahora viven en el Centro de control (/control).
// Este redirect mantiene funcionando los links viejos a /alertas.
export default function Page() {
  redirect('/control')
}
