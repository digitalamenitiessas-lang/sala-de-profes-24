import type { SupabaseClient } from '@supabase/supabase-js'
import { fudoHttp } from '@/lib/fudoClient'
import { notifyEvent } from '@/lib/push/notify-event'

// ---------------------------------------------------------------------------
// Salud de la conexión con Fudo
// ---------------------------------------------------------------------------
// El pulso (cada 10 min) hace una consulta mínima a Fudo y guarda el
// resultado en fudo_salud. Si Fudo no responde hace más de CAIDA_MIN, avisa
// UNA vez a socios; cuando vuelve, avisa que volvió.
// ---------------------------------------------------------------------------

export const CAIDA_MIN = 30

export type Salud = {
  ultimo_ok_at: string | null
  ultimo_error_at: string | null
  ultimo_error: string | null
  fallas_seguidas: number
  caida_avisada_at: string | null
  ultima_lectura_stock_at: string | null
  ultimo_menu_at: string | null
}

export async function leerSalud(admin: SupabaseClient): Promise<Salud> {
  const { data } = await admin.from('fudo_salud').select('*').eq('id', 1).maybeSingle()
  return (data ?? { ultimo_ok_at: null, ultimo_error_at: null, ultimo_error: null, fallas_seguidas: 0, caida_avisada_at: null, ultima_lectura_stock_at: null, ultimo_menu_at: null }) as Salud
}

export async function actualizarSalud(admin: SupabaseClient, cambios: Partial<Salud>) {
  await admin.from('fudo_salud').upsert({ id: 1, ...cambios, updated_at: new Date().toISOString() })
}

/** Consulta mínima a Fudo. Devuelve null si respondió bien, o el error. */
export async function probarFudo(): Promise<string | null> {
  try {
    const res = await fudoHttp('https://api.fu.do/v1alpha1/payment-methods?page[size]=1', {}, 15_000)
    if (!res.ok) return `Fudo respondió ${res.status}`
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'Fudo no respondió'
  }
}

/** Registra el resultado y avisa si se cayó o si volvió. */
export async function registrarPrueba(admin: SupabaseClient, error: string | null): Promise<{ ok: boolean; aviso: 'caida' | 'volvio' | null }> {
  const s = await leerSalud(admin)
  const ahora = new Date()
  if (!error) {
    await actualizarSalud(admin, { ultimo_ok_at: ahora.toISOString(), fallas_seguidas: 0, caida_avisada_at: null })
    if (s.caida_avisada_at) {
      const min = Math.round((ahora.getTime() - Date.parse(s.ultimo_ok_at ?? s.caida_avisada_at)) / 60_000)
      await notifyEvent(admin, 'fudo_problema', {
        title: '✅ Fudo volvió a responder',
        body: `Estuvo sin responder unos ${min} minutos. Lo que quedó pendiente se está mandando solo.`,
        url: '/admin/fudo/salud',
      }).catch(() => {})
      return { ok: true, aviso: 'volvio' }
    }
    return { ok: true, aviso: null }
  }

  await actualizarSalud(admin, { ultimo_error_at: ahora.toISOString(), ultimo_error: error.slice(0, 300), fallas_seguidas: s.fallas_seguidas + 1 })
  const desde = s.ultimo_ok_at ? Date.parse(s.ultimo_ok_at) : null
  const caida = desde !== null && ahora.getTime() - desde >= CAIDA_MIN * 60_000
  if (caida && !s.caida_avisada_at) {
    // Reservar el aviso para mandarlo una sola vez
    const { data } = await admin.from('fudo_salud').update({ caida_avisada_at: ahora.toISOString() }).eq('id', 1).is('caida_avisada_at', null).select('id')
    if (data?.length) {
      await notifyEvent(admin, 'fudo_problema', {
        title: '⚠️ Fudo no responde',
        body: `Hace más de ${CAIDA_MIN} minutos que la app no se puede conectar con Fudo (${error.slice(0, 80)}). Recepciones, mermas y producción quedan guardadas y se mandan solas cuando vuelva.`,
        url: '/admin/fudo/salud',
      }).catch(() => {})
      return { ok: false, aviso: 'caida' }
    }
  }
  return { ok: false, aviso: null }
}
