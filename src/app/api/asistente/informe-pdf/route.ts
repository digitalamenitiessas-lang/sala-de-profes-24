import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { esquemaInforme } from '@/lib/informes/esquema'
import { informePDF, nombreArchivo } from '@/lib/informes/pdf'
import { logAudit } from '@/lib/audit'
import { APP_URL } from '@/lib/app-url'

// ---------------------------------------------------------------------------
// POST /api/asistente/informe-pdf — el botón "Descargar PDF" del chat.
// Recibe el informe que armó La Vieja en esa respuesta y devuelve el PDF con el
// diseño de LVE. No guarda nada: el informe viaja en el pedido. Los datos ya
// vienen filtrados por rol (La Vieja solo ve lo que el rol puede ver).
// ---------------------------------------------------------------------------

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SITIO = APP_URL

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const admin = createAdminClient()
    const { data: perfil } = await admin.from('profiles').select('first_name, last_name, is_active').eq('id', user.id).maybeSingle()
    if (!perfil?.is_active) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

    const body = await request.json().catch(() => null) as { informe?: unknown } | null
    const r = esquemaInforme.safeParse(body?.informe)
    if (!r.success) return NextResponse.json({ error: 'El informe no tiene un formato válido. Pedíselo de nuevo a La Vieja.' }, { status: 400 })

    const quien = [perfil.first_name, perfil.last_name].filter(Boolean).join(' ') || null
    // Logo y fuentes del propio sitio (public/brand y public/fonts)
    const pdf = await informePDF(r.data, SITIO, quien)
    void logAudit(admin, {
      userId: user.id, userName: quien, action: 'informe_pdf', module: 'configuracion', entityType: 'informe', entityId: 'asistente',
      description: `${quien ?? 'Alguien'} descargó el informe «${r.data.titulo}» de La Vieja`,
    })
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nombreArchivo(r.data.titulo)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[informe-pdf]', error)
    return NextResponse.json({ error: 'No se pudo armar el PDF' }, { status: 500 })
  }
}
