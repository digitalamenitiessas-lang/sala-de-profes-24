import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// El peso cargado en el protocolo "Control de tolva" pasa solo al registro de
// la tolva (tolva_logs: por día y turno TM/TT, inicio / agregado / final):
//   antes de las 12  → inicio del turno mañana (TM)
//   de 12 a 20       → fin de TM e inicio del turno tarde (TT)  (cambio de turno)
//   desde las 20     → fin de TT
// Lo agregado se sigue cargando en la pantalla Tolva. Si el turno ya tenía un
// valor, el peso nuevo lo reemplaza (es la medición más reciente).
// ---------------------------------------------------------------------------

type Turno = 'TM' | 'TT'

export async function registrarPesoTolva(admin: SupabaseClient, fecha: string, hora: string, gramos: number, userId: string): Promise<string> {
  const h = Number(hora.slice(0, 2))
  const cambios: { shift: Turno; campo: 'start_gr' | 'end_gr' }[] =
    h >= 6 && h < 12 ? [{ shift: 'TM', campo: 'start_gr' }]
      : h >= 12 && h < 20 ? [{ shift: 'TM', campo: 'end_gr' }, { shift: 'TT', campo: 'start_gr' }]
        : [{ shift: 'TT', campo: 'end_gr' }]

  for (const c of cambios) {
    const { data: actual } = await admin.from('tolva_logs').select('id').eq('log_date', fecha).eq('shift', c.shift).maybeSingle()
    if (actual) {
      await admin.from('tolva_logs').update({ [c.campo]: gramos, updated_at: new Date().toISOString() }).eq('id', actual.id)
    } else {
      await admin.from('tolva_logs').insert({ log_date: fecha, shift: c.shift, [c.campo]: gramos, added_gr: 0, created_by: userId, updated_at: new Date().toISOString() })
    }
  }
  return cambios.map((c) => `${c.campo === 'start_gr' ? 'inicio' : 'fin'} ${c.shift === 'TM' ? 'mañana' : 'tarde'}`).join(' y ')
}
