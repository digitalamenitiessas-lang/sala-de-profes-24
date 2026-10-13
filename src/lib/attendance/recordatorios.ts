import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa, instanteDe } from '@/lib/attendance/jornada'
import { sendPushToUser } from '@/lib/push/send'
import { idsConRolEnTurno, ROLES_ENCARGADO_TURNO } from '@/lib/turnos/rol-del-turno'

// ---------------------------------------------------------------------------
// Avisos de entrada sin marcar
// ---------------------------------------------------------------------------
// La liquidación sale de los fichajes: quien trabaja y no ficha, no suma horas.
//   turno + 5'  → a la persona: "Marcá tu entrada"
//   turno + 30' → al encargado de turno: "No fichó: Fulano (cocina 10:00)…"
//                 (puede marcarle "Llegó" desde Equipo)
// Una vez por turno cada aviso (se reserva en shifts.aviso_*_at antes de mandar).
// Lo corre el reloj de fichajes cada 15'.
// ---------------------------------------------------------------------------

const AVISO_PERSONA_MIN = 5
const AVISO_ENCARGADO_MIN = 30
const VENTANA_MAX_MIN = 180 // más tarde ya no tiene sentido avisar

type Turno = {
  id: string; user_id: string; start_time: string; shift_role: string | null
  aviso_ingreso_at: string | null; aviso_encargado_at: string | null
}

export async function avisarIngresosSinMarcar(admin: SupabaseClient, ahora = new Date()): Promise<{ personas: number; encargados: number }> {
  const fecha = fechaOperativa(ahora)
  const [{ data: turnos }, { data: logs }, { data: perfiles }, { data: ausencias }] = await Promise.all([
    admin.from('shifts').select('id, user_id, start_time, shift_role, aviso_ingreso_at, aviso_encargado_at').eq('shift_date', fecha),
    admin.from('attendance_logs').select('user_id').eq('operative_date', fecha),
    admin.from('profiles').select('id, first_name, role, is_active'),
    admin.from('ausencias').select('user_id').eq('fecha', fecha),
  ])
  const ficharon = new Set((logs ?? []).map((l: { user_id: string }) => l.user_id))
  // Con motivo anotado (licencia, franco…) no se avisa: ya se sabe por qué no está
  for (const a of (ausencias ?? []) as { user_id: string }[]) ficharon.add(a.user_id)
  const perfil = new Map(((perfiles ?? []) as { id: string; first_name: string | null; role: string; is_active: boolean }[]).map((p) => [p.id, p]))
  const t0 = ahora.getTime()

  const reservar = async (id: string, campo: 'aviso_ingreso_at' | 'aviso_encargado_at') => {
    const { data } = await admin.from('shifts').update({ [campo]: ahora.toISOString() }).eq('id', id).is(campo, null).select('id')
    return (data ?? []).length > 0
  }

  let personas = 0
  const paraEncargado: string[] = []
  for (const t of (turnos ?? []) as Turno[]) {
    const p = perfil.get(t.user_id)
    if (!p?.is_active || p.role === 'socio' || !t.start_time || ficharon.has(t.user_id)) continue
    const min = (t0 - instanteDe(fecha, t.start_time).getTime()) / 60_000
    if (min < AVISO_PERSONA_MIN || min > VENTANA_MAX_MIN) continue

    if (!t.aviso_ingreso_at && await reservar(t.id, 'aviso_ingreso_at')) {
      await sendPushToUser(t.user_id, {
        title: '⏰ Marcá tu entrada',
        body: `Tu turno empezó a las ${t.start_time.slice(0, 5)}. Si no fichás, esas horas no se cuentan.`,
        url: '/mi-turno',
      }).catch(() => {})
      personas++
    }
    if (min >= AVISO_ENCARGADO_MIN && !t.aviso_encargado_at && await reservar(t.id, 'aviso_encargado_at')) {
      paraEncargado.push(`${p.first_name ?? 'Alguien'} (${t.shift_role ?? p.role} ${t.start_time.slice(0, 5)})`)
    }
  }

  if (paraEncargado.length > 0) {
    let destino = await idsConRolEnTurno(admin, ROLES_ENCARGADO_TURNO, ahora)
    if (destino.length === 0) {
      const { data } = await admin.from('profiles').select('id').eq('is_active', true).eq('role', 'encargado')
      destino = (data ?? []).map((d: { id: string }) => d.id)
    }
    const titulo = paraEncargado.length === 1 ? '👀 No fichó la entrada' : `👀 ${paraEncargado.length} no ficharon la entrada`
    await Promise.allSettled(destino.map((id) => sendPushToUser(id, {
      title: titulo,
      body: `${paraEncargado.slice(0, 5).join(', ')}${paraEncargado.length > 5 ? '…' : ''}. Si ya llegaron, marcales "Llegó" en Equipo.`,
      url: '/equipo',
    })))
  }
  return { personas, encargados: paraEncargado.length }
}
