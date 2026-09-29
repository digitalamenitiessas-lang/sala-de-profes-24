import { redirect } from 'next/navigation'

// La vieja pantalla de asistencia leía tablas que en esta base no existen
// (clock_events, attendance_anomalies, attendance_corrections,
// device_registrations, wifi_access_points). La asistencia vive en
// /equipo/asistencia; este redirect mantiene funcionando los links viejos.
export default function Page() {
  redirect('/equipo/asistencia')
}
