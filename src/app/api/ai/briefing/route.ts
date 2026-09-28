import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { gatherBriefingContext, generateBriefingText } from '@/lib/ai/briefing'
import type { BriefingResult } from '@/lib/ai/briefing'

// ---------------------------------------------------------------------------
// GET /api/ai/briefing — generates daily operational briefing
// ---------------------------------------------------------------------------
// Only for socio/encargado. Combines Supabase data + optional FUDO ventas.
// Returns AI-generated text + structured data + sources.
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    // Auth check
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['socio', 'encargado'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    // Gather context
    const data = await gatherBriefingContext()

    // Try to get FUDO ventas
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3007'
      const ventasRes = await fetch(`${baseUrl}/api/fudo/auto-sync`, {
        headers: { 'x-internal-call': process.env.CRON_SECRET ?? '' },
      })
      if (ventasRes.ok) {
        const ventasJson = await ventasRes.json()
        if (ventasJson.today) {
          data.ventas = {
            total: ventasJson.today.totalFacturado ?? 0,
            tickets: ventasJson.today.totalTickets ?? 0,
            topProduct: ventasJson.today.topProducts?.[0]?.name ?? '',
          }
        }
      }
    } catch {
      // FUDO unavailable — proceed without ventas
    }

    // Generate AI briefing
    const { text, model } = await generateBriefingText(data)

    const sources: string[] = ['supabase:stock_items', 'supabase:kitchen_orders', 'supabase:bar_orders', 'supabase:expedientes', 'supabase:attendance_logs', 'supabase:announcements']
    if (data.ventas) sources.push('fudo:sales')

    const result: BriefingResult = {
      text,
      data,
      sources,
      generatedAt: new Date().toISOString(),
      model,
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('[/api/ai/briefing]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
