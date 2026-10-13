import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Mensajes de la app por Telegram (resúmenes de turno)
// ---------------------------------------------------------------------------
// TELEGRAM_BOT_TOKEN (o TELEGRAM_JOB_BOT) en Vercel = la clave del bot que manda.
// Sucursal 24: usar un bot PROPIO, no el de LVE (@LVE_Job_Bot): "vincular" lee
// getUpdates, que es la misma cola para todas las apps que usan esa clave, y
// sumaría a la 24 los chats que le escribieron al bot de LVE. Los chats que
// reciben se guardan en app_settings 'telegram_resumenes' al vincular (el
// socio le escribe /start al bot y abre /api/admin/telegram/vincular).
// ---------------------------------------------------------------------------

const CLAVE = 'telegram_resumenes'

export async function chatsTelegram(admin: SupabaseClient): Promise<string[]> {
  const { data } = await admin.from('app_settings').select('value').eq('key', CLAVE).maybeSingle()
  const guardados = ((data?.value as { chat_ids?: string[] } | null)?.chat_ids ?? []).map(String)
  const env = (process.env.TELEGRAM_CHAT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return [...new Set([...guardados, ...env])]
}

export async function guardarChatsTelegram(admin: SupabaseClient, chatIds: string[], userId: string | null): Promise<void> {
  await admin.from('app_settings').upsert({ key: CLAVE, value: { chat_ids: [...new Set(chatIds)] }, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'key' })
}

export async function llamarTelegram<T = unknown>(metodo: string, body?: Record<string, unknown>): Promise<T> {
  // En LVE quedó como TELEGRAM_JOB_BOT; se aceptan los dos nombres
  const crudo = process.env.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_JOB_BOT ?? ''
  // Solo la clave (número:letras), por si se pegó con texto alrededor ("HTTP API: …", el nombre del bot)
  const token = crudo.match(/\d{6,}:[A-Za-z0-9_-]{30,}/)?.[0]
  if (!token) throw new Error(crudo ? 'La clave del bot (TELEGRAM_JOB_BOT) no tiene el formato de Telegram' : 'Falta la clave del bot (TELEGRAM_JOB_BOT) en Vercel')
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({})) as { ok?: boolean; result?: T; description?: string }
  if (!r.ok || !j.ok) throw new Error(j.description ?? `Telegram respondió ${r.status}`)
  return j.result as T
}

/** Manda uno o varios mensajes (en orden) a cada chat vinculado. */
export async function enviarTelegram(admin: SupabaseClient, texto: string | string[]): Promise<{ ok: boolean; enviados: number; error?: string }> {
  const partes = Array.isArray(texto) ? texto : [texto]
  const chats = await chatsTelegram(admin)
  if (!chats.length) return { ok: false, enviados: 0, error: 'No hay chats vinculados' }
  let enviados = 0
  const errores: string[] = []
  for (const chat_id of chats) {
    try {
      for (const text of partes) await llamarTelegram('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true })
      enviados++
    } catch (err) {
      errores.push(err instanceof Error ? err.message : 'Error')
    }
  }
  return { ok: enviados > 0, enviados, error: errores[0] }
}
