import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyExpedienteToResponsible } from '@/lib/email/send'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// GET  /api/expedientes  — listar con filtros
// POST /api/expedientes  — crear expediente
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const admin = createAdminClient()

    // Get user profile for role check
    const { data: profile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile) return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 404 })

    const params = request.nextUrl.searchParams
    const status = params.get('status')
    const type = params.get('type')
    const urgency = params.get('urgency')
    const search = params.get('search')

    // Lighter query — only select needed fields for list view
    let query = admin
      .from('expedientes')
      .select(`
        id, code, title, type, areas, urgency, priority, status,
        target_date, created_at, updated_at, author_id, responsible_id,
        author:profiles!expedientes_author_id_fkey(first_name, last_name),
        responsible:profiles!expedientes_responsible_id_fkey(first_name, last_name)
      `)
      .order('created_at', { ascending: false })

    // Role-based filtering
    const role = profile.role as string
    if (role !== 'socio' && role !== 'encargado') {
      // Staff: only see own (authored or assigned)
      query = query.or(`author_id.eq.${user.id},responsible_id.eq.${user.id}`)
    }

    // Apply filters
    if (status === 'activos') {
      query = query.not('status', 'in', '("cumplido","cerrado_sin_implementacion","archivado")')
    } else if (status === 'cerrados') {
      query = query.in('status', ['cumplido', 'cerrado_sin_implementacion', 'archivado'])
    } else if (status && status !== 'todos') {
      query = query.eq('status', status)
    }

    if (type) query = query.eq('type', type)
    if (urgency) query = query.eq('urgency', urgency)
    if (search) query = query.or(`title.ilike.%${search}%,code.ilike.%${search}%`)

    const { data, error } = await query.limit(100)

    if (error) throw error
    return NextResponse.json({ data: data ?? [] })
  } catch (error) {
    console.error('[GET /api/expedientes]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const userSupabase = await createClient()
    const { data: { user } } = await userSupabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Body requerido' }, { status: 400 })

    const { title, description, reason, type, areas, urgency, target_date, impact_categories, responsible_id } = body

    if (!title?.trim() || !type) {
      return NextResponse.json({ error: 'Título y tipo son requeridos' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data, error } = await admin.from('expedientes').insert({
      title: title.trim(),
      description: description || '',
      reason: reason || '',
      type,
      areas: areas || [],
      urgency: urgency || 'media',
      impact_categories: impact_categories || [],
      target_date: target_date || null,
      author_id: user.id,
      status: 'borrador',
    }).select('id, code').single()

    if (error) throw error

    // Log creation in comments
    await admin.from('expediente_comments').insert({
      expediente_id: data.id,
      author_id: user.id,
      type: 'status_change',
      body: 'Expediente creado',
      metadata: { to_status: 'borrador' },
    })

    // Get author name and email socios
    const { data: profile } = await admin.from('profiles').select('first_name, last_name').eq('id', user.id).single()
    const authorName = profile ? `${profile.first_name} ${profile.last_name}`.trim() : 'Alguien'
    notifyExpedienteToResponsible({
      responsibleId: responsible_id || null,
      code: data.code,
      title: title.trim(),
      action: 'Expediente creado',
      authorName,
      detail: description?.trim() || undefined,
    }).catch(() => {})

    // Audit trail (non-blocking)
    logAudit(admin, {
      userId: user.id,
      userName: authorName,
      action: 'create_expediente',
      module: 'expedientes',
      entityType: 'expediente',
      entityId: data.id,
      description: `${authorName} creó expediente: ${title.trim()}`,
    }).catch(() => {})

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[POST /api/expedientes]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error' },
      { status: 500 },
    )
  }
}
