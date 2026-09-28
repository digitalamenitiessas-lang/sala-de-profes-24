import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { probarFudo, registrarPrueba, leerSalud, actualizarSalud } from '@/lib/fudo/salud'
import { procesarReintentos } from '@/lib/fudo/reintentos'
import { asegurarVentasDeHoy } from '@/lib/fudo/ventas-intradia'
import { syncFromFudo } from '@/lib/fudo/stock-sync'
import { sincronizarMenu } from '@/lib/fudo/menu-sync'

// ---------------------------------------------------------------------------
// GET /api/cron/fudo-pulso — cada 10 minutos (pg_cron en Supabase)
// ---------------------------------------------------------------------------
// Mantiene la app enlazada con Fudo todo el día (Vercel Hobby solo permite
// crons diarios, por eso lo dispara la base):
//   1. ¿Fudo responde? → si no responde hace 30 min, avisa (y cuando vuelve)
//   2. Reintenta lo que no pudo entrar a Fudo (producción, recepciones…)
//   3. Ventas de hoy: se traen si la última importación tiene más de 10 min
//   4. Stock de Fudo: se lee cada hora
//   5. Menú y precios: una vez por día
//   6. Limpia registros colgados y cierra errores que eran solo de conexión
// Cada paso es independiente: si uno falla, los demás siguen.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const STOCK_CADA_MIN = 55
const MENU_CADA_HORAS = 20

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (process.env.NODE_ENV === 'production' && (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createAdminClient()
  const out: Record<string, unknown> = {}
  const paso = async (nombre: string, fn: () => Promise<unknown>) => {
    try { out[nombre] = await fn() } catch (err) { out[nombre] = { error: err instanceof Error ? err.message : 'error' } }
  }

  // 1. Conexión
  const error = await probarFudo()
  out.conexion = await registrarPrueba(admin, error)

  // 6. Eventos colgados (quedaron "pendiente" porque el proceso se cortó)
  await paso('colgados', async () => {
    const { data } = await admin.from('fudo_sync_events')
      .update({ status: 'failed', error_message: 'Se cortó sin terminar (tiempo máximo)', completed_at: new Date().toISOString() })
      .eq('status', 'pending').lt('created_at', new Date(Date.now() - 60 * 60_000).toISOString()).select('id')
    return data?.length ?? 0
  })

  if (error) return NextResponse.json({ ok: false, fudo: error, ...out })

  // Fudo responde: los errores que eran solo de conexión (no de datos) se
  // cierran. Si no, un corte puntual dejaba el conteo bloqueado sin salida.
  await paso('errores_de_conexion', async () => {
    const { data } = await admin.from('fudo_sync_incidents')
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('status', 'open')
      .in('code', ['fudo_write_exception', 'fudo_product_write_exception', 'fudo_read_failed', 'fudo_sales_import_failed', 'fudo_read_before_write_failed'])
      .lt('last_seen_at', new Date(Date.now() - 15 * 60_000).toISOString())
      .select('id')
    return data?.length ?? 0
  })

  // 2. Reintentos
  await paso('reintentos', () => procesarReintentos(admin))

  // 3. Ventas de hoy
  await paso('ventas', () => asegurarVentasDeHoy(admin, { maxAgeMin: 10 }))

  const salud = await leerSalud(admin)

  // 4. Stock de Fudo cada hora
  const stockViejo = !salud.ultima_lectura_stock_at || Date.now() - Date.parse(salud.ultima_lectura_stock_at) > STOCK_CADA_MIN * 60_000
  if (stockViejo) {
    await paso('stock', async () => {
      const r = await syncFromFudo(admin)
      await actualizarSalud(admin, { ultima_lectura_stock_at: new Date().toISOString() })
      return { synced: r.synced, total: r.total, errores: r.errors.length }
    })
  }

  // 5. Menú y precios una vez por día
  const menuViejo = !salud.ultimo_menu_at || Date.now() - Date.parse(salud.ultimo_menu_at) > MENU_CADA_HORAS * 3_600_000
  if (menuViejo) {
    await paso('menu', async () => {
      const r = await sincronizarMenu(admin)
      await actualizarSalud(admin, { ultimo_menu_at: new Date().toISOString() })
      return { productos: r.importedProducts, cambiados: r.cambiados, nuevos: r.nuevos, borrados_en_fudo: r.borradosEnFudo }
    })
  }

  return NextResponse.json({ ok: true, ...out })
}
