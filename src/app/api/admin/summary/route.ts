import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'
import { countBySemaphore } from '@/lib/contracts/stock'

// ---------------------------------------------------------------------------
// Executive Summary API — generates a structured operational summary
// Uses Claude Haiku with real data from Supabase
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const supabase = await createClient()

    // Verify encargado role
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'encargado' && profile?.role !== 'socio') {
      return NextResponse.json({ error: 'Acceso restringido' }, { status: 403 })
    }

    // Gather operational data
    const context = await gatherExecutiveContext(supabase)

    // Try Claude API for executive summary
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (apiKey) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 800,
            system: `Sos el sistema de reportes de La Vieja Escuela, un restaurante/café en Salta, Argentina.
Generá un resumen ejecutivo BREVE del estado operativo del día.
REGLAS:
- Máximo 6 bullets/puntos
- Tono profesional, claro, ejecutivo
- Resaltá problemas primero, luego estado normal
- Si no hay incidencias, decilo claramente sin forzar hallazgos
- Si hay datos de ayer para comparar, mencionalo brevemente
- Usá español argentino
- NO inventes datos, solo usá la información provista
- Formato: bullets cortos, sin encabezados largos`,
            messages: [
              { role: 'user', content: `Generá el resumen ejecutivo del día con estos datos:\n\n${context}` },
            ],
          }),
        })

        if (response.ok) {
          const data = await response.json()
          const text = data.content?.[0]?.text
          if (text) {
            return NextResponse.json({ summary: text, source: 'ai' })
          }
        }
      } catch {
        // Fallback to data-driven summary
      }
    }

    // Fallback: generate summary from data directly
    const summary = generateFallbackSummary(context)
    return NextResponse.json({ summary, source: 'data' })

  } catch (err) {
    console.error('Error generating summary:', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Data gathering (reuses chatbot pattern)
// ---------------------------------------------------------------------------

async function gatherExecutiveContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const yesterdayStr = format(new Date(today.getTime() - 86400000), 'yyyy-MM-dd')
  const sections: string[] = []

  sections.push(`FECHA: ${format(today, "EEEE d 'de' MMMM yyyy", { locale: es })}`)

  // Attendance today
  const { data: todayAttendance } = await supabase
    .from('attendance_logs')
    .select('user_id, clock_in_at, clock_out_at, status')
    .eq('operative_date', todayStr)

  const { data: yesterdayAttendance } = await supabase
    .from('attendance_logs')
    .select('user_id')
    .eq('operative_date', yesterdayStr)

  const todayLogs = todayAttendance ?? []
  const presentToday = new Set(todayLogs.map((l) => l.user_id)).size
  const missingCheckouts = todayLogs.filter((l) => l.status === 'open' && !l.clock_out_at).length
  const presentYesterday = new Set((yesterdayAttendance ?? []).map((l) => l.user_id)).size

  sections.push(`ASISTENCIA: ${presentToday} presentes hoy (ayer: ${presentYesterday}). ${missingCheckouts} sin marcar egreso.`)

  // Shifts
  const { count: shiftsToday } = await supabase
    .from('shifts')
    .select('id', { count: 'exact', head: true })
    .eq('shift_date', todayStr)

  sections.push(`TURNOS HOY: ${shiftsToday ?? 0} programados`)

  // Stock
  const { data: stockItems } = await supabase
    .from('stock_items')
    .select('name, current_qty, min_qty, unit')
    .eq('is_active', true)

  const items = stockItems ?? []
  const counts = countBySemaphore(items)

  sections.push(`STOCK: ${counts.total} items — ${counts.red} críticos, ${counts.yellow} en atención, ${counts.green} normales`)
  if (counts.red > 0) {
    const redItems = items.filter((s) => s.current_qty <= s.min_qty || s.current_qty <= 0)
    sections.push(`ITEMS CRÍTICOS: ${redItems.map((r) => `${r.name} (${r.current_qty}/${r.min_qty} ${r.unit})`).join(', ')}`)
  }

  // Announcements
  const { count: activeAnnouncements } = await supabase
    .from('announcements')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${today.toISOString()}`)

  const { count: urgentAnnouncements } = await supabase
    .from('announcements')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('priority', 'critica')
    .or(`expires_at.is.null,expires_at.gt.${today.toISOString()}`)

  sections.push(`NOTIFICACIONES: ${activeAnnouncements ?? 0} activas, ${urgentAnnouncements ?? 0} urgentes`)

  return sections.join('\n')
}

// ---------------------------------------------------------------------------
// Fallback summary (when Claude API unavailable)
// ---------------------------------------------------------------------------

function generateFallbackSummary(context: string): string {
  const lines = context.split('\n')
  const bullets: string[] = []

  for (const line of lines) {
    if (line.startsWith('ASISTENCIA:')) {
      bullets.push(`• ${line.replace('ASISTENCIA: ', '')}`)
    }
    if (line.startsWith('TURNOS HOY:')) {
      bullets.push(`• ${line.replace('TURNOS HOY: ', 'Turnos: ')}`)
    }
    if (line.startsWith('STOCK:')) {
      bullets.push(`• ${line.replace('STOCK: ', 'Inventario: ')}`)
    }
    if (line.startsWith('ITEMS CRÍTICOS:')) {
      bullets.push(`• ⚠️ ${line.replace('ITEMS CRÍTICOS: ', 'Stock crítico: ')}`)
    }
    if (line.startsWith('NOTIFICACIONES:')) {
      bullets.push(`• ${line.replace('NOTIFICACIONES: ', 'Avisos: ')}`)
    }
  }

  if (bullets.length === 0) {
    return '• Sin datos suficientes para generar el resumen.'
  }

  return bullets.join('\n')
}
