import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { asegurarVentasDeHoy } from '@/lib/fudo/ventas-intradia'
import { calcularPlanProduccion, type PlanProduccion } from '@/lib/produccion/plan'

// ---------------------------------------------------------------------------
// GET /api/produccion/sugerencias — "¿Qué producir hoy?" con datos duros.
// El cálculo vive en src/lib/produccion/plan.ts y es el mismo que usa Hoy.
// Roles cocina. Cache en memoria de módulo: 10 minutos.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 10 * 60 * 1000
let cached: { at: number; payload: PlanProduccion } | null = null

export async function GET() {
  try {
    const auth = await requireRole(['socio', 'encargado', 'chef', 'cocina'])
    if (auth.response) return auth.response

    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json(cached.payload)
    }

    const admin = createAdminClient()
    // Ventas de hoy al día (máx. 6 s de espera; si Fudo tarda, sigue sin ellas)
    await asegurarVentasDeHoy(admin, { timeoutMs: 6000 })
    const payload = await calcularPlanProduccion(admin)
    cached = { at: Date.now(), payload }
    return NextResponse.json(payload)
  } catch (err) {
    console.error('[GET /api/produccion/sugerencias]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
