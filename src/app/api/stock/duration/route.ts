import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/stock/duration
// ---------------------------------------------------------------------------
// Calcula cuántos días durará el stock de un insumo según consumo histórico.
// Llama a la RPC stock_duration(p_stock_item_id, p_days_lookback).
//
// Query params:
//   item_id      (required) — ID del stock_item
//   days         (optional, default 30) — ventana de historial en días
//
// Ejemplo:
//   /api/stock/duration?item_id=12&days=30
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
    const days = request.nextUrl.searchParams.get('days') ?? '30'

    if (!itemId || isNaN(Number(itemId))) {
      return NextResponse.json({ error: 'Parámetro item_id requerido (número)' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin.rpc('stock_duration', {
      p_stock_item_id: Number(itemId),
      p_days_lookback: Number(days),
    })

    if (error) throw error

    return NextResponse.json(data)
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
//   item_ids   (number[]) — lista de IDs; si vacío, procesa todos los activos
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
    const days: number = body?.days ?? 30
    const onlyAtRisk: boolean = body?.only_at_risk ?? false
    let itemIds: number[] = body?.item_ids ?? []

    const admin = createAdminClient()

    // If no specific IDs, use all active items that have movements
    if (itemIds.length === 0) {
      const { data: items } = await admin
        .from('stock_items')
        .select('id')
        .eq('is_active', true)
      itemIds = (items ?? []).map(i => i.id)
    }

    if (itemIds.length === 0) {
      return NextResponse.json({ success: true, items: [], total: 0 })
    }

    // Batch calls to stock_duration RPC
    const results = await Promise.all(
      itemIds.map(async (id) => {
        const { data } = await admin.rpc('stock_duration', {
          p_stock_item_id: id,
          p_days_lookback: days,
        })
        return data
      })
    )

    type DurationResult = {
      success: boolean
      name: string
      semaphore: string
      days_remaining: number | null
      daily_avg_consumption: number
    }

    const valid = results.filter(Boolean) as DurationResult[]

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
