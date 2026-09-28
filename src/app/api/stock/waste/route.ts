import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncToFudo } from '@/lib/fudo/stock-sync'

const WASTE_REASONS = ['vencido', 'roto', 'consumo_interno', 'otro'] as const
type WasteReason = (typeof WASTE_REASONS)[number]

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await userSupabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const body = await request.json()
    const { stockItemId, qty, wasteReason, note } = body

    if (!stockItemId || typeof qty !== 'number' || qty <= 0) {
      return NextResponse.json({ error: 'stockItemId y qty > 0 requeridos' }, { status: 400 })
    }
    if (!WASTE_REASONS.includes(wasteReason as WasteReason)) {
      return NextResponse.json({ error: 'Motivo de merma inválido' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: item, error: itemError } = await admin
      .from('stock_items')
      .select('current_qty, name, unit')
      .eq('id', stockItemId)
      .single()

    if (itemError || !item) {
      return NextResponse.json({ error: 'Item no encontrado' }, { status: 404 })
    }

    // Una merma es un MOVIMIENTO: se restan `qty` unidades de lo que haya.
    // No se clampea a 0 para calcular el destino — hacerlo invertía el signo
    // en items negativos (stock −3, merma 2 → destino 0 → ¡sumaba 3 a Fudo!)
    // y anulaba el descuento cuando LVE ya estaba en 0.
    const newQty = Math.round((item.current_qty - qty) * 1000) / 1000
    const fullNote = note?.trim()
      ? `Merma ${wasteReason}: ${note.trim()}`
      : `Merma ${wasteReason}`

    const result = await syncToFudo(admin, stockItemId, newQty, user.id, {
      reason: 'waste',
      note: fullNote,
      deltaOverride: -qty,
    })

    return NextResponse.json({
      success: result.success,
      fudoSynced: result.fudoSynced,
      previousQty: item.current_qty,
      newQty,
      wasteQty: qty,
      error: result.error,
    }, { status: result.success ? 200 : 502 })
  } catch (error) {
    console.error('[stock/waste POST]', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error al registrar merma' },
      { status: 500 },
    )
  }
}
