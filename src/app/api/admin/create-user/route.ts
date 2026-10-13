import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { ENCARGADO_MANAGED_ROLES } from '@/lib/roles'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// POST /api/admin/create-user
// ---------------------------------------------------------------------------
// Crea un usuario nuevo en Supabase Auth + perfil en profiles.
// Socios y encargados (el encargado crea de encargado para abajo, no socios).
//
// Si el email ya tiene cuenta:
//   · cuenta desactivada (alguien que vuelve a trabajar) → se REACTIVA con
//     los datos nuevos (nombre, rol, teléfono y contraseña).
//   · cuenta activa → error diciendo de quién es.
// Cada intento que falla queda en audit_trail ('create_user_error') con el
// motivo, para poder ver qué pasó.
//
// Body: { email, password, firstName, lastName, role, phone? }
// ---------------------------------------------------------------------------

// 'cajero': la base lo guarda como encargado (permisos) con puesto cajero
const VALID_ROLES: AppRole[] = ['socio', 'encargado', 'cajero', 'chef', 'cocina', 'barista', 'runner', 'bacha']

export async function POST(request: NextRequest) {
  const adminClient = createAdminClient()
  let callerId: string | null = null
  let callerName: string | null = null
  let emailPedido: string | null = null

  // Respuesta de error que además queda registrada con el motivo
  const fallar = (error: string, status: number) => {
    if (callerId) {
      void logAudit(adminClient, {
        userId: callerId,
        userName: callerName,
        action: 'create_user_error',
        module: 'equipo',
        entityType: 'profile',
        description: `No se pudo crear usuario${emailPedido ? ` (${emailPedido})` : ''}: ${error}`,
        metadata: { email: emailPedido, status },
      })
    }
    return NextResponse.json({ error }, { status })
  }

  try {
    // 1) Verificar que el caller es socio o encargado
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Tu sesión venció: cerrá sesión y volvé a entrar' }, { status: 401 })
    }
    callerId = user.id

    const { data: callerProfile } = await adminClient
      .from('profiles')
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .single()
    callerName = [callerProfile?.first_name, callerProfile?.last_name].filter(Boolean).join(' ') || null

    if (!callerProfile || (callerProfile.role !== 'encargado' && callerProfile.role !== 'socio')) {
      return fallar('Solo socios y encargados pueden crear usuarios', 403)
    }

    // 2) Parsear y validar body
    const body = await request.json().catch(() => null)

    if (!body) {
      return fallar('Body inválido', 400)
    }

    const { password, firstName, lastName, role, phone } = body as {
      password?: string
      firstName?: string
      lastName?: string
      role?: AppRole
      phone?: string
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    emailPedido = email || null

    if (!email || !password || !firstName?.trim() || !lastName?.trim() || !role) {
      return fallar('Faltan datos: nombre, apellido, email, contraseña y rol son obligatorios', 400)
    }

    if (!VALID_ROLES.includes(role)) {
      return fallar(`Rol inválido. Debe ser uno de: ${VALID_ROLES.join(', ')}`, 400)
    }

    // Un encargado no puede dar de alta socios (escalada de privilegios)
    if (callerProfile.role === 'encargado' && !ENCARGADO_MANAGED_ROLES.includes(role)) {
      return fallar('Los encargados no pueden crear socios: eso lo hace un socio', 403)
    }

    if (password.length < 6) {
      return fallar('La contraseña debe tener al menos 6 caracteres', 400)
    }

    // El cajero se guarda como role='encargado' + puesto='cajero' (trigger
    // tg_profiles_cajero). Si el perfil ya existía (lo crea handle_new_user, o
    // es una reactivación), el upsert entra por ON CONFLICT DO UPDATE y el
    // trigger, al ver el cambio de rol, deja puesto en null: se reasigna acá.
    const fijarPuestoCajero = async (profileId: string) => {
      if (role !== 'cajero') return
      const { error } = await adminClient.from('profiles').update({ role: 'cajero' }).eq('id', profileId)
      if (error) console.error('[create-user] puesto cajero:', error)
    }

    const datosPerfil = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      role,
      phone: phone?.trim() || null,
      is_active: true,
    }

    // 3) Crear usuario en Supabase Auth con admin client
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirmar email (no enviar mail de verificación)
    })

    if (authError) {
      const yaExiste = /already been registered|already registered|already exists/i.test(authError.message ?? '')
      if (!yaExiste) {
        console.error('[create-user] Auth error:', authError)
        return fallar(authError.message || 'Supabase no pudo crear la cuenta', 500)
      }

      // El email ya tiene cuenta: ¿de quién es y está activa?
      const existente = await buscarPorEmail(adminClient, email)
      if (!existente) return fallar('Ya existe un usuario con ese email', 409)
      const { data: perfil } = await adminClient
        .from('profiles')
        .select('id, first_name, last_name, role, is_active')
        .eq('id', existente.id)
        .maybeSingle()

      if (perfil?.is_active) {
        const quien = [perfil.first_name, perfil.last_name].filter(Boolean).join(' ')
        return fallar(`Ese email ya es de ${quien} (${perfil.role}), que está activo en la app`, 409)
      }
      // Un encargado no puede reactivar a un socio
      if (callerProfile.role === 'encargado' && perfil && !ENCARGADO_MANAGED_ROLES.includes(perfil.role as AppRole)) {
        return fallar('Ese email es de un socio desactivado: lo tiene que reactivar un socio', 403)
      }

      // Reactivar: contraseña nueva + datos nuevos
      const { error: updErr } = await adminClient.auth.admin.updateUserById(existente.id, {
        password,
        email_confirm: true,
        ban_duration: 'none',
      })
      if (updErr) return fallar(`No se pudo reactivar la cuenta: ${updErr.message}`, 500)
      const { data: reactivado, error: profErr } = await adminClient
        .from('profiles')
        .upsert({ id: existente.id, ...datosPerfil }, { onConflict: 'id' })
        .select()
        .single()
      if (profErr) return fallar(`No se pudo reactivar el perfil: ${profErr.message}`, 500)
      await fijarPuestoCajero(reactivado.id)

      void logAudit(adminClient, {
        userId: user.id,
        userName: callerName,
        action: 'reactivate_user',
        module: 'equipo',
        entityType: 'profile',
        entityId: reactivado.id,
        description: `${callerName ?? 'Alguien'} reactivó a ${datosPerfil.first_name} ${datosPerfil.last_name} (${role})`,
      })
      return NextResponse.json({
        success: true,
        reactivated: true,
        user: { id: reactivado.id, email, first_name: reactivado.first_name, last_name: reactivado.last_name, role: reactivado.role },
      })
    }

    if (!authData.user) {
      return fallar('No se pudo crear el usuario', 500)
    }

    // 4) Upsert del perfil — hay un trigger que puede haberlo creado ya
    //    con defaults; sobreescribimos con los datos correctos.
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .upsert({ id: authData.user.id, ...datosPerfil }, { onConflict: 'id' })
      .select()
      .single()

    if (profileError) {
      console.error('[create-user] Profile error:', profileError)
      // Intentar limpiar: eliminar el usuario auth creado
      await adminClient.auth.admin.deleteUser(authData.user.id).catch(() => {})
      return fallar('Error al crear perfil: ' + profileError.message, 500)
    }
    await fijarPuestoCajero(profile.id)

    // Audit trail (non-blocking)
    void logAudit(adminClient, {
      userId: user.id,
      userName: callerName,
      action: 'create_user',
      module: 'equipo',
      entityType: 'profile',
      entityId: profile.id,
      description: `${callerName ?? 'Admin'} creó usuario: ${datosPerfil.first_name} ${datosPerfil.last_name} (${role})`,
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
    return fallar(error instanceof Error ? error.message : 'Error desconocido', 500)
  }
}

/** Busca la cuenta de Auth por email (el equipo tiene pocas decenas de cuentas). */
async function buscarPorEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) return null
    const u = data.users.find((x) => (x.email ?? '').toLowerCase() === email)
    if (u) return u
    if (data.users.length < 200) return null
  }
  return null
}
