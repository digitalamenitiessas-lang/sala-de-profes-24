import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAudit } from '@/lib/audit'
import { ENCARGADO_MANAGED_ROLES } from '@/lib/roles'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// /api/admin/user-access — email y contraseña con los que alguien entra
// ---------------------------------------------------------------------------
// Los primeros usuarios se crearon con emails inventados y una contraseña
// genérica, y desde la app no había forma de cambiarlos: para darle a alguien
// su email real había que crear otra cuenta y su historial (fichajes, turnos,
// horas) quedaba en la vieja. Esto cambia el acceso de la MISMA cuenta.
//
// Mismos permisos que el alta de usuarios: el socio, a cualquiera; el
// encargado, de encargado para abajo (nunca a un socio).
//
// GET  ?userId=…                      → { email }
// POST { userId, email?, password? }  → cambia lo que venga
// ---------------------------------------------------------------------------

type Admin = ReturnType<typeof createAdminClient>

function generarPasswordTemporal(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789' // sin ambiguos: 0,o,1,i,l
  const bytes = randomBytes(8)
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

/** Valida quién llama y si puede tocar el acceso de userId. */
async function autorizar(admin: Admin, userId: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Tu sesión venció: cerrá sesión y volvé a entrar', status: 401 } as const

  const { data: caller } = await admin
    .from('profiles')
    .select('role, first_name, last_name')
    .eq('id', user.id)
    .single()
  if (!caller || (caller.role !== 'socio' && caller.role !== 'encargado')) {
    return { error: 'Solo socios y encargados pueden cambiar el acceso de un usuario', status: 403 } as const
  }

  if (!userId) return { error: 'Falta el usuario', status: 400 } as const
  const { data: target } = await admin
    .from('profiles')
    .select('id, first_name, last_name, role')
    .eq('id', userId)
    .maybeSingle()
  if (!target) return { error: 'Usuario no encontrado', status: 404 } as const

  if (caller.role === 'encargado' && !ENCARGADO_MANAGED_ROLES.includes(target.role as AppRole)) {
    return { error: 'El acceso de un socio lo cambia otro socio', status: 403 } as const
  }

  return {
    callerId: user.id,
    callerName: [caller.first_name, caller.last_name].filter(Boolean).join(' ') || null,
    target,
  } as const
}

export async function GET(request: NextRequest) {
  const admin = createAdminClient()
  const auth = await autorizar(admin, request.nextUrl.searchParams.get('userId'))
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { data, error } = await admin.auth.admin.getUserById(auth.target.id)
  if (error || !data.user) {
    return NextResponse.json({ error: 'Esta persona no tiene cuenta para entrar a la app' }, { status: 404 })
  }
  return NextResponse.json({ email: data.user.email ?? null })
}

export async function POST(request: NextRequest) {
  const admin = createAdminClient()
  const body = await request.json().catch(() => null) as { userId?: string; email?: string; password?: string; resetPassword?: boolean } | null
  if (!body) return NextResponse.json({ error: 'Body inválido' }, { status: 400 })

  const auth = await autorizar(admin, typeof body.userId === 'string' ? body.userId : null)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  if (body.resetPassword === true) {
    const tempPassword = generarPasswordTemporal()
    const { error: updErr } = await admin.auth.admin.updateUserById(auth.target.id, {
      password: tempPassword,
      user_metadata: { must_change_password: true },
    })
    if (updErr) {
      return NextResponse.json({ error: `No se pudo resetear la contraseña: ${updErr.message}` }, { status: 500 })
    }
    const nombre = `${auth.target.first_name} ${auth.target.last_name}`.trim()
    void logAudit(admin, {
      userId: auth.callerId,
      userName: auth.callerName,
      action: 'reset_user_password',
      module: 'equipo',
      entityType: 'profile',
      entityId: auth.target.id,
      description: `${auth.callerName ?? 'Alguien'} generó una contraseña temporal para ${nombre}`,
      metadata: { temporal: true, must_change_password: true },
    })
    return NextResponse.json({ success: true, tempPassword })
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email && !password) {
    return NextResponse.json({ error: 'Poné un email nuevo, una contraseña nueva o las dos' }, { status: 400 })
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'El email no es válido' }, { status: 400 })
  }
  if (password && password.length < 6) {
    return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 })
  }

  const { data: actual, error: getErr } = await admin.auth.admin.getUserById(auth.target.id)
  if (getErr || !actual.user) {
    return NextResponse.json({ error: 'Esta persona no tiene cuenta para entrar a la app' }, { status: 404 })
  }
  const emailAnterior = actual.user.email ?? null
  const cambiaEmail = !!email && email !== emailAnterior

  const { error: updErr } = await admin.auth.admin.updateUserById(auth.target.id, {
    ...(cambiaEmail ? { email, email_confirm: true } : {}),
    ...(password ? { password } : {}),
  })
  if (updErr) {
    const duplicado = /already been registered|already registered|already exists|duplicate/i.test(updErr.message ?? '')
    return NextResponse.json(
      { error: duplicado ? 'Ese email ya lo usa otra cuenta' : `No se pudo cambiar el acceso: ${updErr.message}` },
      { status: duplicado ? 409 : 500 },
    )
  }

  const nombre = `${auth.target.first_name} ${auth.target.last_name}`.trim()
  const cambios = [cambiaEmail && 'email', password && 'contraseña'].filter(Boolean).join(' y ')
  void logAudit(admin, {
    userId: auth.callerId,
    userName: auth.callerName,
    action: 'update_user_access',
    module: 'equipo',
    entityType: 'profile',
    entityId: auth.target.id,
    description: `${auth.callerName ?? 'Alguien'} cambió ${cambios || 'el acceso'} de ${nombre}`,
    // Nunca la contraseña
    metadata: cambiaEmail ? { email_anterior: emailAnterior, email_nuevo: email } : { password: true },
  })

  return NextResponse.json({ success: true, email: cambiaEmail ? email : emailAnterior })
}
