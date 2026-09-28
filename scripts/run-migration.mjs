// ---------------------------------------------------------------------------
// Aplica un archivo .sql (típicamente supabase/migrations/*.sql) directo
// contra la base de producción.
//
// La conexión NUNCA va hardcodeada acá. Vive en UN solo lugar local:
// SUPABASE_DB_URL dentro de .env.local (gitignoreado, no sale de esta Mac).
//
// El host directo db.<ref>.supabase.co no rutea desde esta red (solo IPv6);
// usar el connection pooler. Formato:
//   SUPABASE_DB_URL=postgresql://postgres.<project-ref>:<password>@aws-0-us-west-2.pooler.supabase.com:5432/postgres
//
// Uso:
//   node scripts/run-migration.mjs supabase/migrations/<archivo>.sql
// ---------------------------------------------------------------------------

import pg from 'pg'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

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
    const value = trimmed.slice(i + 1).trim().replace(/^"(.*)"$/, '$1')
    process.env[key] = value
  }
}

async function run() {
  loadEnvLocal()

  const connectionString = process.env.SUPABASE_DB_URL
  if (!connectionString) {
    console.error('❌ Falta SUPABASE_DB_URL.')
    console.error('   Agregala a .env.local (ver el comentario al inicio de este archivo).')
    process.exit(1)
  }

  const migrationFile = process.argv[2]
  if (!migrationFile) {
    console.log('Uso: node scripts/run-migration.mjs <path-to-sql-file>')
    process.exit(1)
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

  try {
    console.log('🔌 Conectando a Supabase...')
    await client.connect()
    console.log('✅ Conectado\n')

    const sql = readFileSync(resolve(migrationFile), 'utf-8')
    console.log(`📄 Ejecutando: ${migrationFile}`)
    console.log(`   (${sql.length} caracteres)\n`)

    await client.query(sql)
    console.log('✅ Migración ejecutada correctamente\n')
  } catch (err) {
    console.error('❌ Error:', err.message)
    if (err.detail) console.error('   Detail:', err.detail)
    if (err.hint) console.error('   Hint:', err.hint)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

run()
