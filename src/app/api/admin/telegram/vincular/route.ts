import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { chatsTelegram, guardarChatsTelegram, llamarTelegram } from '@/lib/telegram/send'

// ---------------------------------------------------------------------------
// GET /api/admin/telegram/vincular — socio. Busca los chats que le escribieron
// al bot (/start) y los guarda para recibir los resúmenes de turno. Les manda
// un mensaje de confirmación.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireRole(['socio'])
  if (auth.response) return auth.response
  const admin = createAdminClient()
  try {
    type Upd = { message?: { chat?: { id: number; type: string; first_name?: string; title?: string } } }
    const upd = await llamarTelegram<Upd[]>('getUpdates')
    const nuevos = new Map<string, string>()
    for (const u of upd) {
      const c = u.message?.chat
      if (c && (c.type === 'private' || c.type === 'group' || c.type === 'supergroup')) nuevos.set(String(c.id), c.first_name ?? c.title ?? String(c.id))
    }
    if (nuevos.size === 0) return NextResponse.json({ ok: false, mensaje: 'Escribile /start al bot desde Telegram y volvé a abrir esta página.' })
    const antes = await chatsTelegram(admin)
    await guardarChatsTelegram(admin, [...antes, ...nuevos.keys()], auth.user.id)
    for (const id of nuevos.keys()) {
      if (antes.includes(id)) continue
      await llamarTelegram('sendMessage', { chat_id: id, text: '✅ Listo: acá te van a llegar los resúmenes de cada turno de Sala de Profes (24 y Maipú).' }).catch(() => {})
    }
    return NextResponse.json({ ok: true, vinculados: [...nuevos.values()] })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 })
  }
}
