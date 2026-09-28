import { redirect } from 'next/navigation'

// Las alertas de fichaje ahora viven en el Centro de control (/control).
// Este redirect mantiene funcionando los links viejos a /equipo/alertas.
export default function Page() {
  redirect('/control')
}
