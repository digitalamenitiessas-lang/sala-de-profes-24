import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mustClockIn } from '@/lib/roles'
import { fechaOperativa } from '@/lib/attendance/jornada'

// ---------------------------------------------------------------------------
// GET /api/attendance/export?from=YYYY-MM-DD&to=YYYY-MM-DD
// CSV de asistencia para liquidar sueldos, calculado directo de los fichajes.
// (Antes llamaba a calculate_employee_hours, que no existe en la base: el CSV
// salía con todo en cero.)
// Horas nocturnas: las trabajadas entre las 22:00 y las 06:00 (hora Argentina).
// ---------------------------------------------------------------------------

const MIN = 60_000

/** Minutos de [ini, fin) que caen entre las 22:00 y las 06:00 AR */
function minutosNocturnos(ini: number, fin: number): number {
  let total = 0
  for (let t = ini; t < fin; t += MIN) {
    const h = new Date(t - 3 * 3_600_000).getUTCHours()
    if (h >= 22 || h < 6) total++
  }
  return total
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['socio', 'encargado'].includes(profile.role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const hoy = fechaOperativa()
  const from = searchParams.get('from') ?? `${hoy.slice(0, 7)}-01`
  const to = searchParams.get('to') ?? hoy

  const admin = createAdminClient()
  const [{ data: empleados }, { data: logs }] = await Promise.all([
    admin.from('profiles').select('id, first_name, last_name, role').eq('is_active', true).order('first_name'),
    admin.from('attendance_logs')
      .select('user_id, operative_date, clock_in_at, clock_out_at, clock_out_type')
      .gte('operative_date', from).lte('operative_date', to),
  ])
  if (!empleados) return NextResponse.json({ error: 'Sin empleados' }, { status: 500 })

  const porEmpleado = new Map<string, { dias: Set<string>; min: number; nocturnos: number; auto: number; abiertos: number }>()
  for (const l of logs ?? []) {
    const e = porEmpleado.get(l.user_id) ?? { dias: new Set<string>(), min: 0, nocturnos: 0, auto: 0, abiertos: 0 }
    e.dias.add(l.operative_date)
    if (l.clock_out_at) {
      const ini = Date.parse(l.clock_in_at), fin = Date.parse(l.clock_out_at)
      if (fin > ini) {
        e.min += Math.round((fin - ini) / MIN)
        e.nocturnos += minutosNocturnos(ini, fin)
      }
      if (l.clock_out_type === 'auto') e.auto++
    } else {
      e.abiertos++
    }
    porEmpleado.set(l.user_id, e)
  }

  const horas = (m: number) => (Math.round((m / 60) * 100) / 100).toString().replace('.', ',')
  const rows: string[][] = [['Empleado', 'Rol', 'Días trabajados', 'Horas totales', 'Horas nocturnas (22 a 6)', 'Salidas no marcadas (cierre automático)', 'Ingresos sin salida']]
  for (const emp of empleados) {
    const e = porEmpleado.get(emp.id)
    if (!e && !mustClockIn(emp)) continue
    rows.push([
      `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim(),
      emp.role,
      String(e?.dias.size ?? 0),
      horas(e?.min ?? 0),
      horas(e?.nocturnos ?? 0),
      String(e?.auto ?? 0),
      String(e?.abiertos ?? 0),
    ])
  }

  // BOM para que Excel abra bien los acentos; separador ";" (Excel en español)
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n')
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="asistencia_${from}_${to}.csv"`,
    },
  })
}
