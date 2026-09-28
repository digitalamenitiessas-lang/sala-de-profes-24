import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import * as XLSX from 'xlsx'
import { startOfWeek, addDays, format } from 'date-fns'
import { DIAS, ROLES_SECCION, buscarEmpleado, leerHorario, normalizar } from '@/lib/turnos/planilla'

// ---------------------------------------------------------------------------
// POST /api/shifts/upload — Upload Excel/CSV file with shifts
// ---------------------------------------------------------------------------
// Supports TWO formats:
//
// FORMAT A — Weekly grid (LVE style):
//   RUNNERS  | Lunes       | Martes      | ... | Domingo
//   Sebastian| 15:30 A 00  | 14:00 A 00  | ... | 15:30 A 00
//   BARISTAS
//   Patricia | 07 A 16     | 07 A 16     | ... | 16:30 A 00
//   (horarios y nombres: ver lib/turnos/planilla.ts)
//
// FORMAT B — Row per shift:
//   Nombre | Fecha | Inicio | Fin | Rol
// ---------------------------------------------------------------------------

const ROLE_MAP = ROLES_SECCION
const DAY_NAMES = DIAS

// Detect if this is a weekly grid format
function isWeeklyGrid(headers: string[]): boolean {
  const lower = headers.map(h => String(h ?? '').toLowerCase().replace(/[^a-záéíóúñ]/g, ''))
  const dayCount = DAY_NAMES.filter(d => lower.some(h => h.includes(d))).length
  return dayCount >= 5 // At least 5 day columns found
}

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const weekStartParam = formData.get('weekStart') as string | null // yyyy-MM-dd
    const replaceMode = formData.get('replace') === 'true'
    const checkOnly = formData.get('checkOnly') === 'true' // Just check if shifts exist
    const dryRun = formData.get('dryRun') === 'true' // Parse but no insert

    if (!file && !checkOnly) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
    }

    // Check-only mode: return if shifts exist for the week
    if (checkOnly && weekStartParam) {
      const weekEnd = format(addDays(new Date(weekStartParam + 'T12:00:00'), 6), 'yyyy-MM-dd')
      const { count } = await admin.from('shifts').select('id', { count: 'exact', head: true })
        .gte('shift_date', weekStartParam).lte('shift_date', weekEnd)
      return NextResponse.json({ exists: (count ?? 0) > 0, count: count ?? 0 })
    }

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true })

    if (rows.length < 2) {
      return NextResponse.json({ error: 'El archivo está vacío' }, { status: 400 })
    }

    // Load employees
    const { data: employees } = await admin
      .from('profiles')
      .select('id, first_name, last_name, role')
      .eq('is_active', true)

    if (!employees?.length) {
      return NextResponse.json({ error: 'No hay empleados activos' }, { status: 400 })
    }

    const headers = (rows[0] as string[]).map(h => String(h ?? '').trim())

    if (isWeeklyGrid(headers)) {
      // If replace mode, delete existing shifts for the week first
      // (no delete en dryRun — es solo preview)
      if (replaceMode && weekStartParam && !dryRun) {
        const weekEnd = format(addDays(new Date(weekStartParam + 'T12:00:00'), 6), 'yyyy-MM-dd')
        const { count } = await admin.from('shifts').select('id', { count: 'exact', head: true })
          .gte('shift_date', weekStartParam).lte('shift_date', weekEnd)
        if ((count ?? 0) > 0) {
          await admin.from('shifts').delete()
            .gte('shift_date', weekStartParam).lte('shift_date', weekEnd)

          // Audit trail (non-blocking)
          logAudit(admin, {
            userId: user.id,
            userName: null,
            action: 'delete_shifts_week',
            module: 'turnos',
            entityType: 'shift',
            description: `Admin borró turnos de semana ${weekStartParam} para reemplazar`,
          })
        }
      }
      return processWeeklyGrid(rows, headers, employees, user.id, weekStartParam, admin, dryRun)
    } else {
      return processRowPerShift(rows, headers, employees, user.id, admin, dryRun)
    }
  } catch (error) {
    console.error('[/api/shifts/upload] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error procesando archivo' },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// FORMAT A — Weekly grid
// ---------------------------------------------------------------------------
async function processWeeklyGrid(
  rows: unknown[][],
  headers: string[],
  employees: { id: string; first_name: string; last_name: string; role: string }[],
  createdBy: string,
  weekStartParam: string | null,
  admin: ReturnType<typeof createAdminClient>,
  dryRun: boolean = false,
) {
  // Determine which columns map to which days
  const dayColumns: { dayIndex: number; colIndex: number }[] = []
  const headersLower = headers.map(h => h.toLowerCase().replace(/[áà]/g, 'a').replace(/[éè]/g, 'e').replace(/[íì]/g, 'i').replace(/[óò]/g, 'o').replace(/[úù]/g, 'u'))

  for (let ci = 1; ci < headers.length; ci++) {
    const h = headersLower[ci]
    const dayIdx = DAY_NAMES.findIndex(d => h.includes(d))
    if (dayIdx >= 0) {
      dayColumns.push({ dayIndex: dayIdx, colIndex: ci })
    }
  }

  if (dayColumns.length === 0) {
    return NextResponse.json({ error: 'No se encontraron columnas de días (Lunes-Domingo)' }, { status: 400 })
  }

  // Week start: use param, or default to current week's Monday
  const weekMonday = weekStartParam
    ? new Date(weekStartParam + 'T12:00:00')
    : startOfWeek(new Date(), { weekStartsOn: 1 })

  const created: string[] = []
  const errors: string[] = []
  const skipped: string[] = []

  // Check if first header cell is also a role (e.g. "RUNNERS")
  const firstHeaderRole = ROLE_MAP[normalizar(headers[0]).replace(/[^a-z]/g, '')] ?? ''
  let currentRole = firstHeaderRole

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row || row.length === 0) continue

    const firstCell = String(row[0] ?? '').trim()
    if (!firstCell) continue

    // Check if this is a section header (RUNNERS, BARISTAS, COCINA, etc.)
    const roleKey = normalizar(firstCell).replace(/[^a-z]/g, '')
    const restoVacio = row.slice(1).every((c) => String(c ?? '').trim() === '')
    if (ROLE_MAP[roleKey] && restoVacio) {
      currentRole = ROLE_MAP[roleKey]
      continue
    }

    // This is an employee row
    const quien = buscarEmpleado(firstCell, employees)
    if ('error' in quien) {
      errors.push(`Fila ${i + 1}: ${quien.error}`)
      continue
    }
    const match = quien.ok as { id: string; first_name: string; last_name: string; role: string }

    const shiftRole = currentRole || match.role

    // Process each day column
    for (const { dayIndex, colIndex } of dayColumns) {
      const cellValue = String(row[colIndex] ?? '').trim()
      const timeRange = leerHorario(cellValue)
      if (timeRange === 'descanso') continue
      if (!timeRange) {
        // Antes se ignoraba en silencio y el turno no se cargaba
        errors.push(`Fila ${i + 1} (${firstCell}), ${headers[colIndex]}: no se entiende "${cellValue}" — escribilo como 7 a 16 o 15:30 a 00`)
        continue
      }

      const date = format(addDays(weekMonday, dayIndex), 'yyyy-MM-dd')

      // Check duplicate
      const { data: existing } = await admin
        .from('shifts')
        .select('id')
        .eq('user_id', match.id)
        .eq('shift_date', date)
        .eq('start_time', timeRange.start)
        .limit(1)

      if (existing && existing.length > 0) {
        skipped.push(`${match.first_name} ${match.last_name} — ${date}`)
        continue
      }

      if (dryRun) {
        created.push(`${match.first_name} ${match.last_name} — ${date} ${timeRange.start}-${timeRange.end}`)
      } else {
        const { error: insertError } = await admin.from('shifts').insert({
          user_id: match.id,
          shift_date: date,
          start_time: timeRange.start,
          end_time: timeRange.end,
          shift_role: shiftRole,
          created_by: createdBy,
        })

        if (insertError) {
          errors.push(`${match.first_name} ${date}: ${insertError.message}`)
        } else {
          created.push(`${match.first_name} ${match.last_name} — ${date} ${timeRange.start}-${timeRange.end}`)
        }
      }
    }
  }

  // Audit trail (non-blocking)
  if (created.length > 0) {
    logAudit(admin, {
      userId: createdBy,
      userName: null,
      action: 'upload_shifts',
      module: 'turnos',
      entityType: 'shift',
      description: `Admin subió ${created.length} turnos para semana ${format(weekMonday, 'yyyy-MM-dd')}`,
    })
  }

  return NextResponse.json({
    success: true,
    dryRun,
    format: 'weekly_grid',
    weekStart: format(weekMonday, 'yyyy-MM-dd'),
    created: created.length,
    skipped: skipped.length,
    errors: errors.length,
    details: { created, skipped, errors },
  })
}

// ---------------------------------------------------------------------------
// FORMAT B — Row per shift
// ---------------------------------------------------------------------------
async function processRowPerShift(
  rows: unknown[][],
  headers: string[],
  employees: { id: string; first_name: string; last_name: string; role: string }[],
  createdBy: string,
  admin: ReturnType<typeof createAdminClient>,
  dryRun: boolean = false,
) {
  function findCol(...candidates: string[]): number {
    for (const c of candidates) {
      const idx = headers.findIndex(h =>
        h.toLowerCase().replace(/[^a-záéíóúñ]/g, '').includes(c.toLowerCase().replace(/[^a-záéíóúñ]/g, ''))
      )
      if (idx >= 0) return idx
    }
    return -1
  }

  const nameCol = findCol('nombre', 'empleado', 'persona')
  const dateCol = findCol('fecha', 'dia', 'día')
  const startCol = findCol('inicio', 'desde', 'entrada')
  const endCol = findCol('fin', 'hasta', 'salida')
  const roleCol = findCol('rol', 'puesto', 'cargo')

  if (nameCol < 0 || dateCol < 0 || startCol < 0 || endCol < 0) {
    return NextResponse.json({
      error: `No se encontraron columnas necesarias. Se necesitan: Nombre, Fecha, Inicio, Fin. Columnas encontradas: ${headers.join(', ')}`,
    }, { status: 400 })
  }

  const created: string[] = []
  const errors: string[] = []
  const skipped: string[] = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    if (!row || row.length === 0) continue

    const nameVal = String(row[nameCol] ?? '').trim()
    if (!nameVal) continue

    const dateRaw = String(row[dateCol] ?? '').trim()
    const startRaw = String(row[startCol] ?? '').trim()
    const endRaw = String(row[endCol] ?? '').trim()

    // Parse date
    let date: string | null = null
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      date = dateRaw
    } else {
      const dmy = dateRaw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
      if (dmy) date = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
    }

    if (!date) {
      errors.push(`Fila ${i + 1}: fecha inválida "${dateRaw}"`)
      continue
    }

    // Parse times
    const normalizeTime = (t: string): string | null => {
      const m = t.match(/^(\d{1,2}):(\d{2})/)
      if (m) return `${m[1].padStart(2, '0')}:${m[2]}`
      const num = Number(t)
      if (!isNaN(num) && num >= 0 && num < 1) {
        const mins = Math.round(num * 24 * 60)
        return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
      }
      return null
    }

    const start = normalizeTime(startRaw)
    const end = normalizeTime(endRaw)
    if (!start || !end) {
      errors.push(`Fila ${i + 1}: horario inválido`)
      continue
    }

    const quien = buscarEmpleado(nameVal, employees)
    if ('error' in quien) {
      errors.push(`Fila ${i + 1}: ${quien.error}`)
      continue
    }
    const match = quien.ok as { id: string; first_name: string; last_name: string; role: string }

    const roleRaw = roleCol >= 0 ? normalizar(String(row[roleCol] ?? '')).replace(/[^a-z]/g, '') : ''
    const role = ROLE_MAP[roleRaw] || match.role

    const { data: existing } = await admin
      .from('shifts')
      .select('id')
      .eq('user_id', match.id)
      .eq('shift_date', date)
      .eq('start_time', start)
      .limit(1)

    if (existing && existing.length > 0) {
      skipped.push(`${match.first_name} — ${date} ${start}`)
      continue
    }

    if (dryRun) {
      created.push(`${match.first_name} ${match.last_name} — ${date} ${start}-${end}`)
    } else {
      const { error: insertError } = await admin.from('shifts').insert({
        user_id: match.id,
        shift_date: date,
        start_time: start,
        end_time: end,
        shift_role: role,
        created_by: createdBy,
      })

      if (insertError) {
        errors.push(`Fila ${i + 1}: ${insertError.message}`)
      } else {
        created.push(`${match.first_name} ${match.last_name} — ${date} ${start}-${end}`)
      }
    }
  }

  // Audit trail (non-blocking)
  if (created.length > 0) {
    logAudit(admin, {
      userId: createdBy,
      userName: null,
      action: 'upload_shifts',
      module: 'turnos',
      entityType: 'shift',
      description: `Admin subió ${created.length} turnos (formato fila por turno)`,
    })
  }

  return NextResponse.json({
    success: true,
    dryRun,
    format: 'row_per_shift',
    created: created.length,
    skipped: skipped.length,
    errors: errors.length,
    details: { created, skipped, errors },
  })
}
