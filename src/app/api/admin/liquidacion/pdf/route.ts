import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcularLiquidacion } from '@/lib/liquidacion/calcular'
import { liquidacionPDF } from '@/lib/liquidacion/pdf'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// GET /api/admin/liquidacion/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD
// La liquidación del período en PDF con el diseño de La Vieja Escuela.
// ---------------------------------------------------------------------------

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()
    const { data: profile } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }

    const from = request.nextUrl.searchParams.get('from') ?? ''
    const to = request.nextUrl.searchParams.get('to') ?? ''
    if (!FECHA.test(from) || !FECHA.test(to)) {
      return NextResponse.json({ error: 'Período inválido' }, { status: 400 })
    }

    const quien = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null
    const liq = await calcularLiquidacion(admin, from, to)
    // Logo y fuentes se leen del propio sitio (public/brand y public/fonts)
    const pdf = await liquidacionPDF(liq, request.nextUrl.origin, quien)

    void logAudit(admin, {
      userId: user.id, userName: quien, action: 'liquidacion_pdf', module: 'asistencia', entityType: 'liquidacion',
      entityId: `${from}_${to}`, description: `${quien ?? 'Alguien'} descargó la liquidación del ${from} al ${to} en PDF`,
    })

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Liquidacion LVE 24 y Maipu ${from} a ${to}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[liquidacion/pdf]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo generar el PDF' }, { status: 500 })
  }
}
