import { redirect } from 'next/navigation'

// El panel administrativo se fusionó con el Centro de control (/control):
// KPIs del día, resumen ejecutivo, accesos rápidos e historial viven ahí.
// Este redirect mantiene funcionando los links viejos a /admin.
// Los sub-paths (/admin/reportes/*, /admin/fudo, etc.) siguen activos.
export default function Page() {
  redirect('/control')
}
