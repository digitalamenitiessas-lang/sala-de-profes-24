import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// POST /api/fudo/apply-sale
// ---------------------------------------------------------------------------
// Aplica manualmente la deducción de stock para una venta de Fudo.
//
// Body: { saleId: number }
//
// En producción, el trigger `trg_fudo_sales_after_insert` ya ejecuta esta
// lógica automáticamente al insertar ventas. Este endpoint existe para:
//   - Testing manual
//   - Re-procesar ventas que fallaron
//   - Debug
//
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['encargado', 'socio'].includes(profile.role)) {
      return NextResponse.json({ success: false, error: 'Sin permisos' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)

    if (!body || typeof body.saleId !== 'number') {
      return NextResponse.json(
        { success: false, error: 'Body inválido. Se requiere { saleId: number }' },
        { status: 400 },
      )
    }

    const { saleId } = body as { saleId: number }

    const { data, error } = await supabase.rpc('deduct_stock_on_sale', {
      p_sale_id: saleId,
    })

    if (error) {
      console.error('[/api/fudo/apply-sale] RPC error:', error)
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 },
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('[/api/fudo/apply-sale] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 },
    )
  }
}
