import { redirect } from 'next/navigation'

// Una sola pantalla de fichaje: "Mi turno". Esta vieja esperaba estados que
// el servidor ya no devuelve ("no_record"/"clocked_out") y nunca mostraba el
// botón para fichar; el acceso "Fichar" del inicio llevaba acá.
export default function FichajePage() {
  redirect('/mi-turno')
}
