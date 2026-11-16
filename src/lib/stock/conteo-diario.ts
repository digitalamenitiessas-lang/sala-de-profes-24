import type { SupabaseClient } from '@supabase/supabase-js'
import { idsDelCierre } from '@/lib/envios/catalogo'

// ---------------------------------------------------------------------------
// Conteo diario de elaborados — se hace en la app, y la app avisa
// ---------------------------------------------------------------------------
// Antes el conteo se mandaba al grupo de WhatsApp y la app no se enteraba.
// Ahora se carga en Elaborados → Contar y, al guardar, la app manda una
// notificación con el resumen (lo que antes era el mensaje del grupo).
// El conteo del día queda guardado en audit_trail (action 'conteo_diario')
// para mostrarlo en la app: qué se contó, quién y a qué hora.
//
// En la 24 no se produce: lo que se cuenta al cierre son los productos que
// manda Santa Fe (la lista que manda Santa Fe, lib/envios/catalogo), en
// Stock → Conteo de cierre. Santa Fe lee ese stock para armar el envío.
// ---------------------------------------------------------------------------

const PRE_PRODUCTO = /\bpre\s*-?\s*producto\b/i

function inicioDelDiaAR(): string {
  const hoyAR = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)
  return new Date(`${hoyAR}T00:00:00-03:00`).toISOString()
}

/** Dónde se hace el conteo del día: en la 24, el de cierre de lo que manda Santa Fe. */
export type DestinoConteo = { titulo: string; que: string; url: string }
const CIERRE: DestinoConteo = { titulo: 'Conteo de cierre', que: 'productos de Santa Fe', url: '/stock/cierre' }
const ELABORADOS: DestinoConteo = { titulo: 'Conteo de elaborados', que: 'elaborados', url: '/cocina/elaborados?tab=contar' }

/** Productos contados hoy (hora Argentina) sobre los que se cuentan. */
export async function estadoConteoHoy(admin: SupabaseClient): Promise<{ contados: number; total: number; ultimo: string | null; destino: DestinoConteo }> {
  const desde = inicioDelDiaAR()
  const cierre = await idsDelCierre(admin)
  const { data } = cierre.length
    ? await admin.from('stock_items').select('name, last_counted_at').eq('is_active', true).in('id', cierre)
    : await admin.from('stock_items').select('name, last_counted_at').eq('is_active', true).eq('is_produced', true)
  const lista = ((data ?? []) as { name: string; last_counted_at: string | null }[]).filter((i) => cierre.length > 0 || !PRE_PRODUCTO.test(i.name))
  const hoy = lista.filter((i) => i.last_counted_at && i.last_counted_at >= desde)
  const ultimo = hoy.map((i) => i.last_counted_at!).sort().at(-1) ?? null
  return { contados: hoy.length, total: lista.length, ultimo, destino: cierre.length ? CIERRE : ELABORADOS }
}

export type LineaConteoDia = { stock_item_id: string; name: string; unit: string; qty: number; antes: number }
export type ConteoDelDia = { quien: string | null; hora: string; comentario: string | null; lineas: LineaConteoDia[] }

/** Los conteos cargados hoy (el más reciente primero). */
export async function conteosDeHoy(admin: SupabaseClient): Promise<ConteoDelDia[]> {
  const { data } = await admin.from('audit_trail')
    .select('user_name, created_at, metadata')
    .eq('action', 'conteo_diario')
    .gte('created_at', inicioDelDiaAR())
    .order('created_at', { ascending: false })
    .limit(10)
  return ((data ?? []) as { user_name: string | null; created_at: string; metadata: { comentario?: string | null; lineas?: LineaConteoDia[] } | null }[])
    .map((r) => ({ quien: r.user_name, hora: r.created_at, comentario: r.metadata?.comentario ?? null, lineas: r.metadata?.lineas ?? [] }))
}

const num = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })

/** Texto de la notificación: como el mensaje que se mandaba al grupo */
export function resumenParaNotificacion(lineas: LineaConteoDia[], comentario: string | null): string {
  const partes = lineas.map((l) => `${l.name} ${num(l.qty)}`)
  let cuerpo = ''
  for (const p of partes) {
    if ((cuerpo + ' · ' + p).length > 220) { cuerpo += ` · y ${partes.length - cuerpo.split(' · ').length} más`; break }
    cuerpo = cuerpo ? `${cuerpo} · ${p}` : p
  }
  return comentario ? `${comentario.slice(0, 120)}\n${cuerpo}` : cuerpo
}
