import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { differenceInMinutes, parseISO } from 'date-fns'

// Hora en Argentina (el servidor corre en UTC: format() mostraba 3 h corridas)
const horaAR = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false })

// ---------------------------------------------------------------------------
// GET /api/admin/liquidacion?from=2026-03-01&to=2026-03-15
// Returns hours worked per employee for the given period
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }

    const from = request.nextUrl.searchParams.get('from')
    const to = request.nextUrl.searchParams.get('to')
    if (!from || !to) {
      return NextResponse.json({ error: 'Parámetros from y to requeridos' }, { status: 400 })
    }

    // Fetch all attendance logs in period
    const [logsRes, profilesRes, ratesRes] = await Promise.all([
      admin.from('attendance_logs')
        .select('id, user_id, operative_date, clock_in_at, clock_out_at, status, clock_out_type')
        .gte('operative_date', from)
        .lte('operative_date', to)
        .order('operative_date'),
      admin.from('profiles')
        .select('id, first_name, last_name, role')
        .eq('is_active', true),
      admin.from('payroll_rates')
        .select('role, hourly_rate, label'),
    ])

    const logs = logsRes.data
    const profiles = profilesRes.data
    const rates = ratesRes.data ?? []

    // Build rate map
    const rateMap = new Map<string, number>()
    for (const r of rates) rateMap.set(r.role, Number(r.hourly_rate))

    if (!logs || !profiles) {
      return NextResponse.json({ error: 'Error al consultar datos' }, { status: 500 })
    }

    // Aggregate per employee
    const empMap = new Map<string, {
      days: Map<string, { hours: number; clockIn: string; clockOut: string | null; status: string; clockOutType: string; attendanceId: string; tramos: number; revisar: boolean }>
      totalHours: number
      totalDays: number
      missingCheckouts: number
      lateArrivals: number
    }>()

    for (const log of logs) {
      if (!empMap.has(log.user_id)) {
        empMap.set(log.user_id, {
          days: new Map(),
          totalHours: 0,
          totalDays: 0,
          missingCheckouts: 0,
          lateArrivals: 0,
        })
      }
      const emp = empMap.get(log.user_id)!

      // Entrada y salida son instantes completos: la diferencia ya cruza la
      // medianoche sola. Si da negativa es un dato mal cargado → 0 h y a revisar
      // (antes sumaba 24 h y pagaba un día de más).
      let hours = 0
      let revisar = false
      if (log.clock_out_at) {
        hours = differenceInMinutes(parseISO(log.clock_out_at), parseISO(log.clock_in_at)) / 60
        if (hours < 0 || hours > 20) { revisar = true; hours = Math.max(0, hours) > 20 ? hours : 0 }
      }

      // Turno cortado: dos fichajes el mismo día se suman en un solo día
      const prev = emp.days.get(log.operative_date)
      const salida = log.clock_out_at ? horaAR(log.clock_out_at) : null
      emp.days.set(log.operative_date, prev
        ? {
            ...prev,
            hours: Math.round((prev.hours + hours) * 100) / 100,
            clockOut: salida ?? prev.clockOut,
            status: log.status === 'open' ? 'open' : prev.status,
            tramos: prev.tramos + 1,
            revisar: prev.revisar || revisar,
          }
        : {
            hours: Math.round(hours * 100) / 100,
            clockIn: horaAR(log.clock_in_at),
            clockOut: salida,
            status: log.status,
            clockOutType: (log as Record<string, unknown>).clock_out_type as string ?? 'manual',
            attendanceId: log.id,
            tramos: 1,
            revisar,
          })

      emp.totalHours += hours
      if (!prev) emp.totalDays++
      if (!log.clock_out_at && log.status === 'open') emp.missingCheckouts++
    }

    // Build result
    const employees = profiles
      .filter(p => empMap.has(p.id))
      .map(p => {
        const emp = empMap.get(p.id)!
        const daysArray = Array.from(emp.days.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, data]) => ({ date, ...data }))

        const hourlyRate = rateMap.get(p.role) ?? 0
        const totalHours = Math.round(emp.totalHours * 100) / 100
        const totalPay = Math.round(totalHours * hourlyRate)

        return {
          id: p.id,
          firstName: p.first_name,
          lastName: p.last_name,
          role: p.role,
          hourlyRate,
          totalHours,
          totalDays: emp.totalDays,
          avgHoursPerDay: emp.totalDays > 0 ? Math.round((emp.totalHours / emp.totalDays) * 10) / 10 : 0,
          missingCheckouts: emp.missingCheckouts,
          totalPay,
          days: daysArray,
        }
      })
      .sort((a, b) => b.totalHours - a.totalHours)

    return NextResponse.json({
      period: { from, to },
      employees,
      rates: rates.map(r => ({ role: r.role, hourlyRate: Number(r.hourly_rate), label: r.label })),
      summary: {
        totalEmployees: employees.length,
        totalHours: Math.round(employees.reduce((s, e) => s + e.totalHours, 0) * 100) / 100,
        totalDays: employees.reduce((s, e) => s + e.totalDays, 0),
        totalPay: employees.reduce((s, e) => s + e.totalPay, 0),
        missingCheckouts: employees.reduce((s, e) => s + e.missingCheckouts, 0),
      },
    })
  } catch (error) {
    console.error('[liquidacion]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
