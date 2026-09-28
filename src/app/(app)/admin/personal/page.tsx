import { redirect } from 'next/navigation'

// El consumo del personal ahora vive en Números (/ventas?m=personal).
// Este redirect mantiene funcionando los links viejos a /admin/personal.
export default function Page() {
  redirect('/ventas?m=personal')
}
