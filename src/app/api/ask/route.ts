import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canCountStock, isManagerOrAbove } from '@/lib/roles'
import { logAudit } from '@/lib/audit'
import { planFromQuestion, runPlan, planNeedsManager, type AskScope } from '@/lib/ai/ask'

// ---------------------------------------------------------------------------
// POST /api/ask — preguntar en castellano desde cualquier pantalla
// ---------------------------------------------------------------------------
// Body: { question: string, scope: 'stock' | 'numeros' | 'control' | 'hoy' }
//
// La IA sólo traduce la pregunta a un plan de consulta; los números salen de la
// base. Las preguntas de plata (ventas, márgenes, compras) son de socio o
// encargado: a cocina y barra se les responde lo operativo.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SCOPES: AskScope[] = ['stock', 'numeros', 'control', 'hoy']

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
    if (!profile || !canCountStock(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const question = typeof body?.question === 'string' ? body.question.trim() : ''
    const scope: AskScope = SCOPES.includes(body?.scope) ? body.scope : 'stock'
    if (!question) return NextResponse.json({ error: 'Escribí una pregunta' }, { status: 400 })
    if (question.length > 300) return NextResponse.json({ error: 'La pregunta es muy larga' }, { status: 400 })

    const { plan, via } = await planFromQuestion(question, scope)

    if (planNeedsManager(plan) && !isManagerOrAbove(profile.role)) {
      return NextResponse.json({
        error: 'Esa consulta es sobre plata (ventas, márgenes o compras) y la ven socio o encargado. Preguntame por stock, pedidos o producción.',
      }, { status: 403 })
    }

    const admin = createAdminClient()
    const result = await runPlan(admin, plan)

    logAudit(admin, {
      userId: user.id,
      userName: `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || null,
      action: 'ask_question',
      module: 'stock',
      entityType: 'consulta',
      description: `Preguntó: "${question}"`,
      metadata: { question, scope, plan, matched: result.matched, via },
    }).catch(() => {})

    return NextResponse.json({ ...result, via })
  } catch (err) {
    console.error('[POST /api/ask]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'No pude resolver la consulta' },
      { status: 500 },
    )
  }
}
