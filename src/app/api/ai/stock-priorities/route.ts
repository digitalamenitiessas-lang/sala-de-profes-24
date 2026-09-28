import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateStockPriorities, explainPrioritiesWithAI } from '@/lib/ai/stock-priorities'

// GET /api/ai/stock-priorities — prioritized stock items with AI explanation
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const priorities = await generateStockPriorities()
    const aiExplanation = await explainPrioritiesWithAI(priorities)

    return NextResponse.json({
      priorities,
      aiExplanation,
      total: priorities.length,
      critical: priorities.filter(p => p.status === 'critico').length,
      noSupplier: priorities.filter(p => p.supplier_status === 'sin_proveedor').length,
      generatedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[/api/ai/stock-priorities]', error)
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}
