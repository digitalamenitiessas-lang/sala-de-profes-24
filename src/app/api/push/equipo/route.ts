import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'

// GET /api/push/equipo — quién del equipo tiene los avisos activados (socios)
// Para poder pedirle a cada uno que los active: sin eso, las notificaciones
// del conteo diario, pedidos y recordatorios no le llegan.
export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireRole(['socio'])
  if (auth.response) return auth.response
  const admin = createAdminClient()
  const [{ data: perfiles }, { data: subs }] = await Promise.all([
    admin.from('profiles').select('id, first_name, last_name, role').eq('is_active', true).order('first_name'),
    admin.from('push_subscriptions').select('user_id'),
  ])
  const dispositivos = new Map<string, number>()
  for (const s of subs ?? []) dispositivos.set(s.user_id, (dispositivos.get(s.user_id) ?? 0) + 1)
  return NextResponse.json({
    equipo: (perfiles ?? []).map((p) => ({
      id: p.id,
      nombre: [p.first_name, p.last_name].filter(Boolean).join(' '),
      role: p.role,
      dispositivos: dispositivos.get(p.id) ?? 0,
    })),
  })
}
