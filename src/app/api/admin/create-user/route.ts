import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// POST /api/admin/create-user
// ---------------------------------------------------------------------------
// Crea un usuario nuevo en Supabase Auth + perfil en profiles.
// Solo accesible por encargados.
//
// Body: {
//   email: string,
//   password: string,
//   firstName: string,
//   lastName: string,
//   role: AppRole,
//   phone?: string
// }
// ---------------------------------------------------------------------------

const VALID_ROLES: AppRole[] = ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner']

export async function POST(request: NextRequest) {
  try {
    // 1) Verificar que el caller es encargado
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!callerProfile || (callerProfile.role !== 'encargado' && callerProfile.role !== 'socio')) {
      return NextResponse.json(
        { error: 'Solo socios y encargados pueden crear usuarios' },
        { status: 403 },
      )
    }

    // 2) Parsear y validar body
    const body = await request.json().catch(() => null)

    if (!body) {
      return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
    }

    const { email, password, firstName, lastName, role, phone } = body as {
      email?: string
      password?: string
      firstName?: string
      lastName?: string
      role?: AppRole
      phone?: string
    }

    if (!email || !password || !firstName || !lastName || !role) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: email, password, firstName, lastName, role' },
        { status: 400 },
      )
    }

    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { error: `Rol inválido. Debe ser uno de: ${VALID_ROLES.join(', ')}` },
        { status: 400 },
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 6 caracteres' },
        { status: 400 },
      )
    }

    // 3) Crear usuario en Supabase Auth con admin client
    const adminClient = createAdminClient()

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirmar email (no enviar mail de verificación)
    })

    if (authError) {
      // Manejar duplicados
      if (authError.message?.includes('already been registered')) {
        return NextResponse.json(
          { error: 'Ya existe un usuario con ese email' },
          { status: 409 },
        )
      }
      console.error('[create-user] Auth error:', authError)
      return NextResponse.json({ error: authError.message }, { status: 500 })
    }

    if (!authData.user) {
      return NextResponse.json({ error: 'No se pudo crear el usuario' }, { status: 500 })
    }

    // 4) Upsert del perfil — hay un trigger que puede haberlo creado ya
    //    con defaults; sobreescribimos con los datos correctos.
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .upsert(
        {
          id: authData.user.id,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          role,
          phone: phone?.trim() || null,
          is_active: true,
        },
        { onConflict: 'id' },
      )
      .select()
      .single()

    if (profileError) {
      console.error('[create-user] Profile error:', profileError)
      // Intentar limpiar: eliminar el usuario auth creado
      await adminClient.auth.admin.deleteUser(authData.user.id).catch(() => {})
      return NextResponse.json(
        { error: 'Error al crear perfil: ' + profileError.message },
        { status: 500 },
      )
    }

    // Audit trail (non-blocking)
    logAudit(adminClient, {
      userId: user.id,
      userName: null,
      action: 'create_user',
      module: 'equipo',
      entityType: 'profile',
      entityId: profile.id,
      description: `Admin creó usuario: ${firstName.trim()} ${lastName.trim()} (${role})`,
    })

    return NextResponse.json({
      success: true,
      user: {
        id: profile.id,
        email,
        first_name: profile.first_name,
        last_name: profile.last_name,
        role: profile.role,
      },
    })
  } catch (error) {
    console.error('[create-user] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 },
    )
  }
}
