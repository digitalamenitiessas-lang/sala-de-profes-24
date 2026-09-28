import { redirect } from 'next/navigation'

// La puesta a cero es el conteo guiado en modo "cero": intermedios y
// negativos primero, escribiendo el número real a Fudo.
export default function PuestaACeroRedirect() {
  redirect('/stock/conteo?modo=cero')
}
