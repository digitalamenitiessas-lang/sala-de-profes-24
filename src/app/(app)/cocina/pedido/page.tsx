import { redirect } from 'next/navigation'

// Antes "Pedir a compras" (solo cocina); ahora cualquier sector sugiere desde /sugerir-compra
export default function CocinaPedido() {
  redirect('/sugerir-compra')
}
