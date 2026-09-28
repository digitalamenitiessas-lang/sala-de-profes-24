import type { SupabaseClient } from '@supabase/supabase-js'
import { importFudoSales } from '@/lib/fudo/sales-sync'

// ---------------------------------------------------------------------------
// Ventas de HOY al día, sin cron cada hora
// ---------------------------------------------------------------------------
// El plan de Vercel solo permite crons diarios, y el cron importa ventas a la
// madrugada: durante el día fudo_sales no tenía las ventas de hoy (los avisos
// de las 15 y las 23 salían casi vacíos). Esto trae las de hoy a demanda:
// cuando se arma un aviso de ventas o alguien abre sugerencias/ventas, si la
// última importación tiene más de `maxAgeMin`. La marca de tiempo sale de
// fudo_sync_events, así que vale entre instancias del servidor.
// ---------------------------------------------------------------------------

const SALES_OPS = ['intradia_sales_import', 'cron_sales_import', 'sales_import', 'backfill_subitems', 'manual_sales_import', 'range_fresh']

let enCurso: Promise<void> | null = null

function hoyAR(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
}

export type IntradiaResult = { imported: number; skipped: boolean; error: string | null }

/**
 * Importa las ventas de hoy si la última importación exitosa es más vieja que
 * `maxAgeMin`. Nunca tira: si Fudo falla, devuelve el error y sigue.
 * Con `timeoutMs` no espera más que eso (la importación sigue en segundo plano).
 */
export async function asegurarVentasDeHoy(
  admin: SupabaseClient,
  options: { maxAgeMin?: number; timeoutMs?: number } = {},
): Promise<IntradiaResult> {
  const maxAgeMin = options.maxAgeMin ?? 15
  try {
    const { data: last } = await admin
      .from('fudo_sync_events')
      .select('created_at')
      .eq('entity_type', 'fudo_sales')
      .eq('status', 'success')
      .in('operation', SALES_OPS)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const age = last?.created_at ? Date.now() - Date.parse(last.created_at) : Infinity
    if (age < maxAgeMin * 60_000) return { imported: 0, skipped: true, error: null }
  } catch {
    // si no se puede leer la marca, igual intentamos importar
  }

  let imported = 0
  let error: string | null = null
  if (!enCurso) {
    enCurso = importFudoSales(admin, { from: hoyAR(), operation: 'intradia_sales_import' })
      .then((r) => { imported = r.imported })
      .catch((err) => { error = err instanceof Error ? err.message : 'Fudo no respondió' })
      .finally(() => { enCurso = null })
  }
  const trabajo = enCurso ?? Promise.resolve()
  if (options.timeoutMs) {
    await Promise.race([trabajo, new Promise((r) => setTimeout(r, options.timeoutMs))])
  } else {
    await trabajo
  }
  return { imported, skipped: false, error }
}
