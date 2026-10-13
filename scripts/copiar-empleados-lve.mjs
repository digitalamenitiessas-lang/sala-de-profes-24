// ---------------------------------------------------------------------------
// Copia empleados de LVE (Santa Fe) a la 24 con la MISMA contraseña.
//
// Para los que trabajan en las dos sucursales: entran a la 24 con el mismo
// email y la misma clave que usan en LVE. Se copia la contraseña CIFRADA
// (bcrypt, auth.users.encrypted_password) con el password_hash del admin de
// Supabase: nadie ve la clave. Si después la cambian en una app, en la otra
// no cambia (son cuentas separadas).
//
// Se copian: nombre, apellido, rol (o el que diga la lista), teléfono y datos
// personales (CUIT, dirección, DNI, nacimiento, contacto de emergencia).
// Se conserva el mismo id que en LVE. No se copian fichajes, turnos ni nada más.
//
// Lista: scripts/empleados-24.txt (no se sube a git). Una persona por línea:
//   email@ejemplo.com
//   Nombre Apellido
//   Nombre Apellido ; cajero        ← rol distinto en la 24
// Las líneas que empiezan con # se ignoran.
//
// Uso:
//   node scripts/copiar-empleados-lve.mjs            ← solo muestra qué haría
//   node scripts/copiar-empleados-lve.mjs --aplicar  ← crea las cuentas en la 24
//   node scripts/copiar-empleados-lve.mjs --resincronizar           ← muestra quién tiene otra clave
//   node scripts/copiar-empleados-lve.mjs --resincronizar --aplicar ← le copia la clave actual de LVE
// --resincronizar no crea cuentas: a quien ya existe en la 24 y cambió la clave en LVE
// después de la copia, le vuelve a copiar la contraseña cifrada actual de LVE.
// Sin lista (scripts/empleados-24.txt) revisa a todos los activos de LVE.
//
// Necesita en .env.local: LVE_DB_URL (solo lectura), SUPABASE_DB_URL,
// NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (los de la 24).
// ---------------------------------------------------------------------------

import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const REF_LVE = 'tumbcpizdqlnuevplawr'
const REF_24 = 'hmoqksbyfemzprpsxovu'
const ROLES = ['socio', 'encargado', 'cajero', 'chef', 'cocina', 'barista', 'runner', 'bacha']
const APLICAR = process.argv.includes('--aplicar')
const RESINCRONIZAR = process.argv.includes('--resincronizar')

function loadEnvLocal() {
  const envPath = join(projectRoot, '.env.local')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const i = trimmed.indexOf('=')
    if (i === -1) continue
    const key = trimmed.slice(0, i).trim()
    if (process.env[key] !== undefined) continue // no pisar lo que ya viene del shell
    process.env[key] = trimmed.slice(i + 1).trim().replace(/^"(.*)"$/, '$1')
  }
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

function leerLista() {
  const path = join(__dirname, 'empleados-24.txt')
  if (!existsSync(path) && RESINCRONIZAR) return null // sin lista: todos los activos de LVE
  if (!existsSync(path)) {
    console.error('❌ Falta scripts/empleados-24.txt (una persona por línea: email o "Nombre Apellido", opcional "; rol").')
    process.exit(1)
  }
  return readFileSync(path, 'utf-8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const [quien, rol] = l.split(';').map((x) => x.trim())
    return { quien, rol: rol ? rol.toLowerCase() : null }
  })
}

function exigirRef(url, ref, nombre) {
  if (!url) { console.error(`❌ Falta ${nombre} en .env.local`); process.exit(1) }
  if (!url.includes(ref)) { console.error(`❌ ${nombre} no apunta a la base esperada (${ref}). Freno.`); process.exit(1) }
}

async function run() {
  loadEnvLocal()
  exigirRef(process.env.LVE_DB_URL, REF_LVE, 'LVE_DB_URL')
  exigirRef(process.env.SUPABASE_DB_URL, REF_24, 'SUPABASE_DB_URL')
  exigirRef(process.env.NEXT_PUBLIC_SUPABASE_URL, REF_24, 'NEXT_PUBLIC_SUPABASE_URL')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error('❌ Falta SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

  const lista = leerLista()
  const lve = new pg.Client({ connectionString: process.env.LVE_DB_URL, ssl: { rejectUnauthorized: false } })
  const db24 = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await lve.connect()
  await db24.connect()
  // En LVE solo se lee
  await lve.query('set session characteristics as transaction read only')

  const { rows: empleados } = await lve.query(`
    select p.id, u.email, u.encrypted_password, p.first_name, p.last_name, p.role::text as role, p.puesto::text as puesto,
           p.phone, p.cuit, p.address, p.dni, p.birth_date, p.emergency_contact_name, p.emergency_contact_phone
    from public.profiles p join auth.users u on u.id = p.id
    where p.is_active and u.email is not null`)
  const { rows: ya24 } = await db24.query('select id, lower(email) as email, md5(encrypted_password) as hash_md5 from auth.users where email is not null')
  const existentes = new Set(ya24.map((r) => r.email))
  const cuenta24 = new Map(ya24.map((r) => [r.email, r]))

  if (RESINCRONIZAR) {
    const quienes = lista ? lista.map((i) => norm(i.quien)) : null
    const md5 = (await import('crypto')).createHash
    const distintos = empleados.filter((e) => {
      const c = cuenta24.get(e.email.toLowerCase())
      if (!c) return false
      if (quienes && !quienes.includes(e.email.toLowerCase()) && !quienes.includes(norm(`${e.first_name} ${e.last_name}`))) return false
      return c.hash_md5 !== md5('md5').update(e.encrypted_password ?? '').digest('hex')
    })
    console.log(`\n${APLICAR ? '✍️  RESINCRONIZANDO' : '👀 SOLO MUESTRA (agregá --aplicar para copiar la clave)'} — ${distintos.length} con contraseña distinta a la de LVE\n`)
    for (const e of distintos) console.log(`  🔑 ${e.first_name} ${e.last_name} <${e.email}>`)
    if (APLICAR && distintos.length) {
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      for (const e of distintos) {
        const id = cuenta24.get(e.email.toLowerCase()).id
        const { error } = await admin.auth.admin.updateUserById(id, { password_hash: e.encrypted_password })
        const { rows: v } = await db24.query('select md5(encrypted_password) = md5($1) as igual from auth.users where id = $2', [e.encrypted_password, id])
        console.log(error ? `  ❌ ${e.email}: ${error.message}` : `  ✅ ${e.first_name} ${e.last_name} · misma contraseña que en LVE: ${v[0]?.igual ? 'sí' : 'NO'}`)
      }
    }
    if (!APLICAR) console.log('\nNo se escribió nada.')
    await lve.end(); await db24.end()
    return
  }

  const plan = []
  for (const item of lista ?? []) {
    const q = norm(item.quien)
    const cand = q.includes('@')
      ? empleados.filter((e) => e.email.toLowerCase() === q)
      : empleados.filter((e) => norm(`${e.first_name} ${e.last_name}`) === q)
    if (cand.length !== 1) {
      plan.push({ item, error: cand.length === 0 ? 'no está entre los activos de LVE' : `hay ${cand.length} con ese nombre: usar el email` })
      continue
    }
    const e = cand[0]
    const rolLve = e.puesto === 'cajero' ? 'cajero' : e.role
    const rol = item.rol ?? rolLve
    if (!ROLES.includes(rol)) { plan.push({ item, error: `rol "${rol}" inválido (${ROLES.join(', ')})` }); continue }
    if (!e.encrypted_password?.startsWith('$2')) { plan.push({ item, error: 'su contraseña en LVE no es bcrypt: darlo de alta a mano' }); continue }
    plan.push({ item, e, rol, rolLve, existe: existentes.has(e.email.toLowerCase()) })
  }

  console.log(`\n${APLICAR ? '✍️  APLICANDO' : '👀 SOLO MUESTRA (agregá --aplicar para crear)'} — ${plan.length} línea(s)\n`)
  for (const p of plan) {
    if (p.error) { console.log(`  ❌ ${p.item.quien}: ${p.error}`); continue }
    const rolTxt = p.rol === p.rolLve ? p.rol : `${p.rolLve} → ${p.rol}`
    console.log(`  ${p.existe ? '⏭️ ' : '➕'} ${p.e.first_name} ${p.e.last_name} <${p.e.email}> · ${rolTxt}${p.existe ? ' · ya tiene cuenta en la 24, se saltea' : ''}`)
  }

  if (!APLICAR) {
    console.log('\nNo se escribió nada. Revisá la lista y corré de nuevo con --aplicar.')
    await lve.end(); await db24.end()
    return
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  let creados = 0
  for (const p of plan) {
    if (p.error || p.existe) continue
    const { e, rol } = p
    let { data, error } = await admin.auth.admin.createUser({ id: e.id, email: e.email, password_hash: e.encrypted_password, email_confirm: true })
    if (error && /id/i.test(error.message)) {
      ;({ data, error } = await admin.auth.admin.createUser({ email: e.email, password_hash: e.encrypted_password, email_confirm: true }))
    }
    if (error || !data?.user) { console.log(`  ❌ ${e.email}: no se pudo crear la cuenta (${error?.message})`); continue }
    const id = data.user.id
    // handle_new_user ya creó el perfil como barista: se completa con los datos de LVE
    const { error: profErr } = await admin.from('profiles').upsert({
      id, first_name: e.first_name, last_name: e.last_name, role: rol === 'cajero' ? 'encargado' : rol, is_active: true,
      phone: e.phone, cuit: e.cuit, address: e.address, dni: e.dni, birth_date: e.birth_date,
      emergency_contact_name: e.emergency_contact_name, emergency_contact_phone: e.emergency_contact_phone,
    }, { onConflict: 'id' })
    if (profErr) { console.log(`  ❌ ${e.email}: cuenta creada pero falló el perfil (${profErr.message})`); continue }
    // Cajero: el trigger tg_profiles_cajero lo guarda como encargado + puesto cajero
    if (rol === 'cajero') await admin.from('profiles').update({ role: 'cajero' }).eq('id', id)
    // Verificación: la contraseña guardada en la 24 es la misma que en LVE (sin mostrarla)
    const { rows: v } = await db24.query('select md5(encrypted_password) = md5($1) as igual from auth.users where id = $2', [e.encrypted_password, id])
    console.log(`  ✅ ${e.first_name} ${e.last_name} · ${rol} · misma contraseña que en LVE: ${v[0]?.igual ? 'sí' : 'NO'}`)
    creados++
  }
  console.log(`\nListo: ${creados} cuenta(s) creada(s) en la 24.`)
  await lve.end(); await db24.end()
}

run().catch((err) => { console.error('❌', err.message); process.exit(1) })
