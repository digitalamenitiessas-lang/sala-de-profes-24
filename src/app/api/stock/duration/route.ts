import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Cálculo de duración (compartido por GET y POST)
// ---------------------------------------------------------------------------
// La RPC stock_duration de LVE no existe en esta base: el cálculo se hace acá
// con el mismo criterio que tenía.
//
//   consumo diario  = salidas de los últimos `days` días / days
//   días restantes  = current_qty / consumo diario
//   semáforo        = ≤1 critico · ≤3 bajo · ≤7 atención · resto ok
//                     (sin salidas en la ventana → sin_historial)
//
// Salidas = consumo real: uso (insumo de producción), out (venta Fudo) y merma.
// Los ajustes por conteo NO cuentan (corrigen el stock, no son consumo).
// stock_movements.qty se guarda en valor absoluto; el signo lo da movement_type.
//
// Las ventas de Fudo bajan current_qty sin dejar movimiento: para los insumos
// sin salidas registradas se usa la caída de stock desde la primera foto
// diaria de la ventana (+ lo que entró en el medio), igual que
// stockDropConsumption en src/lib/stock/consumption.ts.
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONSUMO_TYPES = ['uso', 'out', 'merma']
const PAGE_SIZE = 1000

type AdminClient = ReturnType<typeof createAdminClient>

type DurationSemaphore = 'critico' | 'bajo' | 'atención' | 'ok' | 'sin_historial'

type DurationResult = {
  success: boolean
  stock_item_id: string
  name: string
  current_qty: number
  unit: string
  days_lookback: number
  total_consumed: number
  daily_avg_consumption: number
  days_remaining: number | null
  semaphore: DurationSemaphore
  note: string | null
}

/** Ventana en días: entero positivo, default 30, tope 365. */
function parseDays(raw: unknown): number {
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n > 0 ? Math.min(n, 365) : 30
}

/** Pagina de a 1000 (PostgREST corta en 1000 por default). */
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 0; page < 50; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await query(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return rows
}

function round(n: number, decimals: number) {
  const f = 10 ** decimals
  return Math.round(n * f) / f
}

/**
 * Duración de stock de los items activos pedidos (todos los activos si
 * itemIds es null). Dos consultas: items + salidas de la ventana (paginadas),
 * sumadas en memoria por insumo.
 */
async function computeDurations(
  admin: AdminClient,
  itemIds: string[] | null,
  days: number,
): Promise<DurationResult[]> {
  const items = await fetchAll<{ id: string; name: string; current_qty: number; unit: string }>((from, to) => {
    let q = admin.from('stock_items').select('id, name, current_qty, unit').eq('is_active', true)
    if (itemIds) q = q.in('id', itemIds)
    return q.order('id', { ascending: true }).range(from, to)
  })
  if (items.length === 0) return []

  const cutoffISO = new Date(Date.now() - days * 86400000).toISOString()
  const movements = await fetchAll<{ stock_item_id: string; qty: number }>((from, to) => {
    let q = admin
      .from('stock_movements')
      .select('stock_item_id, qty')
      .in('movement_type', CONSUMO_TYPES)
      .gte('created_at', cutoffISO)
    if (itemIds) q = q.in('stock_item_id', itemIds)
    return q.order('id', { ascending: true }).range(from, to)
  })

  const consumedByItem = new Map<string, number>()
  for (const m of movements) {
    consumedByItem.set(m.stock_item_id, (consumedByItem.get(m.stock_item_id) ?? 0) + Math.abs(Number(m.qty ?? 0)))
  }

  // Respaldo por caída de stock: primera foto diaria de la ventana + entradas
  const { data: snaps } = await admin
    .from('stock_snapshots')
    .select('snapshot_date, items')
    .eq('snapshot_type', 'daily')
    .gte('snapshot_date', cutoffISO.slice(0, 10))
    .order('snapshot_date', { ascending: true })
    .limit(1)
  const firstSnap = (snaps ?? [])[0]
  const pastQty = new Map<string, number>()
  const receivedByItem = new Map<string, number>()
  let snapDays = days
  if (firstSnap) {
    for (const i of (firstSnap.items as { id: string; current_qty: number }[] | null) ?? []) {
      if (typeof i.current_qty === 'number') pastQty.set(i.id, Number(i.current_qty))
    }
    snapDays = Math.max(1, Math.round((Date.now() - new Date(firstSnap.snapshot_date + 'T12:00:00').getTime()) / 86400000))
    const entradas = await fetchAll<{ stock_item_id: string; qty: number }>((from, to) => {
      let q = admin
        .from('stock_movements')
        .select('stock_item_id, qty')
        .eq('movement_type', 'entrada')
        .gte('created_at', firstSnap.snapshot_date + 'T12:00:00')
      if (itemIds) q = q.in('stock_item_id', itemIds)
      return q.order('id', { ascending: true }).range(from, to)
    })
    for (const m of entradas) {
      receivedByItem.set(m.stock_item_id, (receivedByItem.get(m.stock_item_id) ?? 0) + Math.abs(Number(m.qty ?? 0)))
    }
  }

  return items.map((item) => {
    const currentQty = Number(item.current_qty ?? 0)
    let totalConsumed = consumedByItem.get(item.id) ?? 0
    let windowDays = days
    let estimado = false
    if (totalConsumed === 0 && pastQty.has(item.id)) {
      const drop = pastQty.get(item.id)! + (receivedByItem.get(item.id) ?? 0) - currentQty
      if (drop > 0.01) {
        totalConsumed = drop
        windowDays = snapDays
        estimado = true
      }
    }
    const dailyAvg = totalConsumed > 0 ? totalConsumed / windowDays : 0
    // Stock negativo (desfasaje con Fudo) cuenta como 0 días
    const daysRemaining = dailyAvg > 0 ? Math.max(0, currentQty / dailyAvg) : null

    const semaphore: DurationSemaphore =
      daysRemaining === null ? 'sin_historial'
      : daysRemaining <= 1 ? 'critico'
      : daysRemaining <= 3 ? 'bajo'
      : daysRemaining <= 7 ? 'atención'
      : 'ok'

    return {
      success: true,
      stock_item_id: item.id,
      name: item.name,
      current_qty: currentQty,
      unit: item.unit,
      days_lookback: windowDays,
      total_consumed: round(totalConsumed, 3),
      daily_avg_consumption: round(dailyAvg, 4),
      days_remaining: daysRemaining !== null ? round(daysRemaining, 1) : null,
      semaphore,
      note: dailyAvg === 0
        ? `Sin historial de consumo en los últimos ${days} días`
        : estimado ? `Estimado por la caída de stock de los últimos ${windowDays} días` : null,
    }
  })
}

// ---------------------------------------------------------------------------
// GET /api/stock/duration
// ---------------------------------------------------------------------------
// Calcula cuántos días durará el stock de un insumo según consumo histórico.
//
// Query params:
//   item_id      (required) — ID (uuid) del stock_item
//   days         (optional, default 30) — ventana de historial en días
//
// Ejemplo:
//   /api/stock/duration?item_id=<uuid>&days=30
//   → { days_remaining: 4.2, daily_avg_consumption: 1.19, semaphore: "bajo", ... }
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef', 'cocina'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const itemId = request.nextUrl.searchParams.get('item_id')
    const days = parseDays(request.nextUrl.searchParams.get('days') ?? 30)

    if (!itemId || !UUID.test(itemId)) {
      return NextResponse.json({ error: 'Parámetro item_id requerido (uuid)' }, { status: 400 })
    }

    const admin = createAdminClient()
    const [result] = await computeDurations(admin, [itemId], days)

    if (!result) {
      return NextResponse.json(
        { success: false, error: `Stock item ${itemId} no encontrado o inactivo` },
        { status: 404 },
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[/api/stock/duration]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/stock/duration
// ---------------------------------------------------------------------------
// Calcula duración para MÚLTIPLES items o para todos los items activos.
//
// Body (todos opcionales):
//   item_ids   (string[]) — lista de IDs (uuid); si vacío, procesa todos los activos
//   days       (number, default 30) — ventana de historial
//   only_at_risk (bool, default false) — solo retorna items con semáforo != ok
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const days = parseDays(body?.days ?? 30)
    const onlyAtRisk: boolean = body?.only_at_risk ?? false
    const rawIds: unknown[] = Array.isArray(body?.item_ids) ? body.item_ids : []
    const itemIds = rawIds.filter((id): id is string => typeof id === 'string' && UUID.test(id))

    if (rawIds.length > 0 && itemIds.length === 0) {
      return NextResponse.json({ error: 'item_ids inválidos (se esperan uuid)' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Sin IDs específicos → todos los items activos
    const valid = await computeDurations(admin, itemIds.length > 0 ? itemIds : null, days)

    if (valid.length === 0) {
      return NextResponse.json({ success: true, items: [], total: 0 })
    }

    // Filter if only_at_risk
    const filtered = onlyAtRisk
      ? valid.filter(r => r.semaphore !== 'ok' && r.semaphore !== 'sin_historial')
      : valid

    // Sort by days_remaining ascending (most urgent first)
    const sorted = [...filtered].sort((a, b) => {
      if (a.days_remaining === null) return 1
      if (b.days_remaining === null) return -1
      return a.days_remaining - b.days_remaining
    })

    const semaphoreCount = {
      critico: sorted.filter(r => r.semaphore === 'critico').length,
      bajo: sorted.filter(r => r.semaphore === 'bajo').length,
      atencion: sorted.filter(r => r.semaphore === 'atención').length,
      ok: sorted.filter(r => r.semaphore === 'ok').length,
      sin_historial: sorted.filter(r => r.semaphore === 'sin_historial').length,
    }

    return NextResponse.json({
      success: true,
      days_lookback: days,
      only_at_risk: onlyAtRisk,
      total: sorted.length,
      semaphore_counts: semaphoreCount,
      items: sorted,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/stock/duration POST]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
