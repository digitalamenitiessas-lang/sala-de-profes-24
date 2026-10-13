import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// GET /api/fudo/paralelo?days=14 — sólo socio
// ---------------------------------------------------------------------------
// Compara el motor de stock propio (sombra) contra Fudo, día por día.
// Lee sales_engine_daily / sales_engine_state, tablas que llena el cron del
// motor paralelo. No están en types/database.ts (las posee otro agente), por
// eso el acceso va con un cliente sin tipar y tipos locales.
// ---------------------------------------------------------------------------

const TOLERANCIA = 0.05 // |diff| relativo ≤ 5% cuenta como "coincide"

type DailyRow = {
  day: string
  stock_item_id: string
  qty_consumed: number | null
  qty_produced: number | null
  qty_received: number | null
  lve_qty: number | null
  fudo_qty: number | null
  diff: number | null
}

type ResumenDia = {
  day: string
  /** % de items activos con |diff| relativo ≤ 5%. null si no hubo actividad. */
  precision: number | null
  items_total: number
  divergentes: number
}

type Divergente = {
  stock_item_id: string
  name: string
  unit: string
  lve_qty: number
  fudo_qty: number
  diff: number
  qty_consumed: number
  qty_produced: number
  qty_received: number
  cost_per_unit: number | null
  /** |diff| * cost_per_unit — plata en juego. null si el item no tiene costo. */
  impacto: number | null
}

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Item sin movimiento ni diferencia: no ensucia la precisión. */
function sinActividad(r: DailyRow): boolean {
  return (
    num(r.qty_consumed) === 0 &&
    num(r.qty_produced) === 0 &&
    num(r.qty_received) === 0 &&
    num(r.lve_qty) === 0 &&
    num(r.fudo_qty) === 0 &&
    num(r.diff) === 0
  )
}

function coincide(r: DailyRow): boolean {
  return Math.abs(num(r.diff)) / Math.max(1, Math.abs(num(r.fudo_qty))) <= TOLERANCIA
}

/** Resta días a una fecha 'YYYY-MM-DD' sin depender de la TZ del server. */
function restarDias(day: string, dias: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

/** Trae todas las filas de la ventana paginando de a 1000 (límite PostgREST). */
async function fetchDaily(db: SupabaseClient, desde: string): Promise<DailyRow[]> {
  const PAGE = 1000
  const rows: DailyRow[] = []
  for (let from = 0; from < 40_000; from += PAGE) {
    const { data, error } = await db
      .from('sales_engine_daily')
      .select('day, stock_item_id, qty_consumed, qty_produced, qty_received, lve_qty, fudo_qty, diff')
      .gte('day', desde)
      .order('day', { ascending: true })
      .order('stock_item_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as DailyRow[]
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

export async function GET(request: NextRequest) {
  try {
    // --- Auth: sólo socio ---
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || (profile.role !== 'socio' && profile.role !== 'encargado')) {
      return NextResponse.json({ error: 'Solo encargados' }, { status: 403 })
    }

    const daysParam = Number(request.nextUrl.searchParams.get('days'))
    const days = Number.isFinite(daysParam) ? Math.min(60, Math.max(1, Math.trunc(daysParam))) : 14

    const admin = createAdminClient()
    // Las tablas del motor paralelo no existen en Database (types del otro agente).
    const db = admin as unknown as SupabaseClient

    // --- Estado del motor ---
    const [seedRes, lastDayRes] = await Promise.all([
      db
        .from('sales_engine_state')
        .select('seeded_at')
        .order('seeded_at', { ascending: true })
        .limit(1),
      db
        .from('sales_engine_daily')
        .select('day')
        .order('day', { ascending: false })
        .limit(1),
    ])

    // Si las tablas no existen todavía, PostgREST devuelve error: tratarlo
    // igual que vacías — el motor aún no corrió.
    const seededAt: string | null = seedRes.error
      ? null
      : ((seedRes.data?.[0] as { seeded_at: string | null } | undefined)?.seeded_at ?? null)
    const ultimoDia: string | null = lastDayRes.error
      ? null
      : ((lastDayRes.data?.[0] as { day: string } | undefined)?.day ?? null)

    if (!ultimoDia) {
      return NextResponse.json({ estado: 'sin_datos' as const })
    }

    // --- Ventana de comparación ---
    const desde = restarDias(ultimoDia, days - 1)
    const rows = await fetchDaily(db, desde)

    const porDia = new Map<string, DailyRow[]>()
    for (const r of rows) {
      const list = porDia.get(r.day)
      if (list) list.push(r)
      else porDia.set(r.day, [r])
    }

    const resumen: ResumenDia[] = [...porDia.keys()].sort().map((day) => {
      const delDia = porDia.get(day) ?? []
      const activos = delDia.filter((r) => !sinActividad(r))
      const divergentes = activos.filter((r) => !coincide(r)).length
      return {
        day,
        precision: activos.length > 0
          ? Math.round(((activos.length - divergentes) / activos.length) * 1000) / 10
          : null,
        items_total: activos.length,
        divergentes,
      }
    })

    // --- Último día: divergentes priorizados por plata ---
    const hoy = porDia.get(ultimoDia) ?? []
    const sinActividadHoy = hoy.filter(sinActividad).length
    const divergentesHoy = hoy.filter((r) => !sinActividad(r) && !coincide(r))

    // Pre-corte por |diff| crudo para no armar un .in() gigante; después se
    // re-ordena por impacto en plata con el costo del item.
    const candidatos = [...divergentesHoy]
      .sort((a, b) => Math.abs(num(b.diff)) - Math.abs(num(a.diff)))
      .slice(0, 200)

    let items: Record<string, { name: string; unit: string; cost_per_unit: number | null }> = {}
    if (candidatos.length > 0) {
      const { data: itemRows } = await admin
        .from('stock_items')
        .select('id, name, unit, cost_per_unit')
        .in('id', candidatos.map((r) => r.stock_item_id))
      items = Object.fromEntries(
        (itemRows ?? []).map((i) => [i.id, { name: i.name, unit: i.unit, cost_per_unit: i.cost_per_unit }]),
      )
    }

    const divergentes_hoy: Divergente[] = candidatos
      .map((r) => {
        const item = items[r.stock_item_id]
        const cost = item?.cost_per_unit ?? null
        return {
          stock_item_id: r.stock_item_id,
          name: item?.name ?? 'Item desconocido',
          unit: item?.unit ?? 'u',
          lve_qty: num(r.lve_qty),
          fudo_qty: num(r.fudo_qty),
          diff: num(r.diff),
          qty_consumed: num(r.qty_consumed),
          qty_produced: num(r.qty_produced),
          qty_received: num(r.qty_received),
          cost_per_unit: cost,
          impacto: cost != null ? Math.round(Math.abs(num(r.diff)) * cost) : null,
        }
      })
      .sort((a, b) => (b.impacto ?? Math.abs(b.diff)) - (a.impacto ?? Math.abs(a.diff)))
      .slice(0, 20)

    const diasCorriendo = seededAt
      ? Math.max(1, Math.floor((Date.now() - new Date(seededAt).getTime()) / 86_400_000) + 1)
      : resumen.length

    return NextResponse.json({
      estado: {
        desde: seededAt,
        ultimo_dia: ultimoDia,
        dias_corriendo: diasCorriendo,
      },
      resumen,
      divergentes_hoy,
      sin_actividad: sinActividadHoy,
    })
  } catch (error) {
    console.error('[/api/fudo/paralelo]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error al comparar con Fudo' },
      { status: 500 },
    )
  }
}
