import { createHash, timingSafeEqual } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { claveNombre } from '@/lib/fudo/create-from-fudo'
import { syncToFudo } from '@/lib/fudo/stock-sync'
import { convertQty } from '@/lib/produccion/units'
import { sendPushToUser } from '@/lib/push/send'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Envíos de producción de Santa Fe a la 24 (aprobado el 12/11/2026)
// ---------------------------------------------------------------------------
// La 24 no produce: todo lo elabora la cocina de Santa Fe. Cada app escribe
// solo en su base y en su Fudo, y se hablan con una clave compartida
// (ENVIOS_CLAVE, la misma en los dos servidores):
//
//   Santa Fe → POST   /api/envios/entrantes            (registra el envío)
//   Santa Fe → GET    /api/envios/entrantes/<envio_id> (¿llegó? ¿con faltantes?)
//   Santa Fe → DELETE /api/envios/entrantes/<envio_id> (lo anula, si no llegó)
//
// Santa Fe baja su stock al enviar. Acá queda "En camino desde Santa Fe"
// hasta que encargado o socio toca «Llegó» (POST /api/envios): ahí sube el
// stock en la app y en el Fudo de la 24, como recepción pero sin gasto ni
// deuda (no es una compra). Los productos no son una lista fija: Santa Fe
// manda lo que produce; la primera vez se elige a qué insumo de la 24
// corresponde y queda guardado (envios_vinculos).
// ---------------------------------------------------------------------------

export const ORIGEN = 'santa_fe'
const TZ = 'America/Argentina/Buenos_Aires'
const MAX_ITEMS = 100

// ---- Clave compartida -------------------------------------------------------

const sha = (s: string) => createHash('sha256').update(s).digest()

/** ¿El pedido trae la clave compartida? (comparación en tiempo constante) */
export function verificarClave(request: Request): 'ok' | 'sin_configurar' | 'invalida' {
  const clave = process.env.ENVIOS_CLAVE ?? ''
  if (clave.length < 32) return 'sin_configurar'
  const auth = request.headers.get('authorization') ?? ''
  const recibida = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!recibida) return 'invalida'
  return timingSafeEqual(sha(recibida), sha(clave)) ? 'ok' : 'invalida'
}

// ---- Validación del envío que manda Santa Fe --------------------------------

export type ItemEnviado = { item_id: string; nombre: string; unidad: string; cantidad: number; costo_unitario: number | null }
export type EnvioRecibido = { envio_id: string; enviado_at: string; enviado_por: string | null; nota: string | null; items: ItemEnviado[]; avisar: boolean }

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function validarEnvio(body: unknown): { ok: true; envio: EnvioRecibido } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const envioId = texto(b.envio_id, 100)
  if (!envioId) return { ok: false, error: 'Falta envio_id' }
  const enviadoAt = typeof b.enviado_at === 'string' && !Number.isNaN(Date.parse(b.enviado_at)) ? new Date(b.enviado_at).toISOString() : new Date().toISOString()
  if (!Array.isArray(b.items) || b.items.length === 0) return { ok: false, error: 'El envío no tiene productos' }
  if (b.items.length > MAX_ITEMS) return { ok: false, error: `Como mucho ${MAX_ITEMS} productos por envío` }
  const items: ItemEnviado[] = []
  for (const [i, raw] of b.items.entries()) {
    const it = (raw ?? {}) as Record<string, unknown>
    const itemId = texto(it.item_id, 100)
    const nombre = texto(it.nombre, 200)
    const unidad = texto(it.unidad, 20)
    const cantidad = Number(it.cantidad)
    const costo = it.costo_unitario == null ? null : Number(it.costo_unitario)
    if (!itemId || !nombre || !unidad) return { ok: false, error: `Producto ${i + 1}: faltan item_id, nombre o unidad` }
    if (!Number.isFinite(cantidad) || cantidad <= 0) return { ok: false, error: `${nombre}: la cantidad tiene que ser mayor a 0` }
    if (costo != null && (!Number.isFinite(costo) || costo <= 0)) return { ok: false, error: `${nombre}: costo_unitario inválido` }
    items.push({ item_id: itemId, nombre, unidad, cantidad: Math.round(cantidad * 1000) / 1000, costo_unitario: costo })
  }
  if (new Set(items.map((i) => i.item_id)).size !== items.length) return { ok: false, error: 'Un producto está repetido en el envío' }
  return { ok: true, envio: { envio_id: envioId, enviado_at: enviadoAt, enviado_por: texto(b.enviado_por, 100) || null, nota: texto(b.nota, 500) || null, items, avisar: b.avisar !== false } }
}

// ---- A qué insumo de la 24 corresponde --------------------------------------

export type Insumo24 = { id: string; name: string; unit: string; area: string | null; enFudo: boolean }

const palabras = (s: string) => claveNombre(s).split(' ').filter(Boolean)
// Mismas 5 primeras letras: "medallon"/"medallones", "hamburguesa"/"hamburgesas"
const parecida = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 5) === b.slice(0, 5))
function puntaje(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const usadas = new Set<number>()
  let iguales = 0
  for (const p of a) {
    const j = b.findIndex((q, k) => !usadas.has(k) && parecida(p, q))
    if (j >= 0) { usadas.add(j); iguales++ }
  }
  return iguales / Math.max(a.length, b.length)
}

/** Insumo de la 24 con el mismo nombre; solo si hay uno claramente mejor */
export function sugerirInsumo(nombre: string, insumos: Insumo24[]): string | null {
  const a = palabras(nombre)
  const conPuntaje = insumos.map((i) => ({ id: i.id, p: puntaje(a, palabras(i.name)) })).sort((x, y) => y.p - x.p)
  const [mejor, segundo] = conPuntaje
  if (!mejor || mejor.p < 0.75) return null
  if (segundo && segundo.p === mejor.p) return null
  return mejor.id
}

export async function insumosDeLa24(admin: SupabaseClient): Promise<Insumo24[]> {
  const { data } = await admin.from('stock_items').select('id, name, unit, area, fudo_ingredient_id, fudo_product_id, fudo_skip').eq('is_active', true).order('name')
  return ((data ?? []) as { id: string; name: string; unit: string; area: string | null; fudo_ingredient_id: string | null; fudo_product_id: string | null; fudo_skip: boolean | null }[])
    .map((s) => ({ id: s.id, name: s.name, unit: s.unit, area: s.area, enFudo: Boolean(s.fudo_ingredient_id || s.fudo_product_id || s.fudo_skip) }))
}

// ---- Llega un envío de Santa Fe ---------------------------------------------

const cant = (n: number, unidad: string) => `${Number(n.toFixed(3)).toLocaleString('es-AR')} ${unidad}`
const resumen = (items: { nombre: string; cantidad: number; unidad: string }[]) =>
  items.slice(0, 4).map((i) => `${cant(i.cantidad, i.unidad)} ${i.nombre}`).join(', ') + (items.length > 4 ? ` y ${items.length - 4} más` : '')

async function avisarEncargados(admin: SupabaseClient, payload: { title: string; body: string; url: string }) {
  const { data: perfiles } = await admin.from('profiles').select('id').eq('is_active', true).in('role', ['socio', 'encargado'])
  await Promise.allSettled(((perfiles ?? []) as { id: string }[]).map((p) => sendPushToUser(p.id, payload)))
}

export async function registrarEnvio(admin: SupabaseClient, e: EnvioRecibido): Promise<{ id: string; estado: string; duplicado: boolean }> {
  const existente = async () => {
    const { data } = await admin.from('envios_entrantes').select('id, estado').eq('origen', ORIGEN).eq('envio_id_origen', e.envio_id).maybeSingle()
    return data as { id: string; estado: string } | null
  }
  const ya = await existente()
  if (ya) return { ...ya, duplicado: true }

  // Vínculo guardado de envíos anteriores; si no, un insumo con el mismo nombre
  const insumos = await insumosDeLa24(admin)
  const activos = new Set(insumos.map((i) => i.id))
  const { data: vinculos } = await admin.from('envios_vinculos').select('item_origen_id, stock_item_id').eq('origen', ORIGEN).in('item_origen_id', e.items.map((i) => i.item_id))
  const vinculo = new Map(((vinculos ?? []) as { item_origen_id: string; stock_item_id: string }[]).map((v) => [v.item_origen_id, v.stock_item_id]))

  const { data: envio, error } = await admin.from('envios_entrantes')
    .insert({ origen: ORIGEN, envio_id_origen: e.envio_id, enviado_at: e.enviado_at, enviado_por: e.enviado_por, nota: e.nota })
    .select('id, estado').single()
  if (error) {
    // Dos pedidos iguales al mismo tiempo: el otro ya lo guardó
    const otro = error.code === '23505' ? await existente() : null
    if (otro) return { ...otro, duplicado: true }
    throw new Error(error.message)
  }
  const { error: itemsErr } = await admin.from('envios_entrantes_items').insert(e.items.map((i) => {
    const guardado = vinculo.get(i.item_id)
    return {
      envio_id: envio.id, item_origen_id: i.item_id, nombre: i.nombre, unidad: i.unidad, cantidad: i.cantidad, costo_unitario: i.costo_unitario,
      stock_item_id: guardado && activos.has(guardado) ? guardado : sugerirInsumo(i.nombre, insumos),
    }
  }))
  if (itemsErr) {
    await admin.from('envios_entrantes').delete().eq('id', envio.id)
    throw new Error(itemsErr.message)
  }

  void logAudit(admin, {
    userId: null, userName: e.enviado_por ? `${e.enviado_por} (Santa Fe)` : 'Santa Fe', action: 'envio_santa_fe_en_camino', module: 'pedidos',
    entityType: 'envio_entrante', entityId: envio.id, description: `Santa Fe mandó: ${resumen(e.items)}`, metadata: { envio_id_origen: e.envio_id },
  })
  // avisar: false = sin notificación (para probar la conexión entre las dos apps)
  if (e.avisar) await avisarEncargados(admin, {
    title: '🚚 Santa Fe mandó un envío',
    body: `${resumen(e.items)}. Cuando llegue, confirmalo en Pedidos → En camino.`,
    url: '/pedidos?step=camino',
  })
  return { id: envio.id, estado: envio.estado, duplicado: false }
}

// ---- Lo que ve Santa Fe ------------------------------------------------------

type FilaEnvio = {
  id: string; envio_id_origen: string; estado: string; enviado_at: string; enviado_por: string | null; nota: string | null
  recibido_at: string | null; recibido_por: string | null; nota_recepcion: string | null; anulado_at: string | null
}
type FilaItem = {
  id: string; envio_id: string; item_origen_id: string; nombre: string; unidad: string; cantidad: number
  costo_unitario: number | null; stock_item_id: string | null; cantidad_recibida: number | null; error: string | null
}

async function nombreDe(admin: SupabaseClient, userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data } = await admin.from('profiles').select('first_name, last_name').eq('id', userId).maybeSingle()
  return data ? `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || null : null
}

export async function estadoParaOrigen(admin: SupabaseClient, envioIdOrigen: string) {
  const { data: envio } = await admin.from('envios_entrantes').select('*').eq('origen', ORIGEN).eq('envio_id_origen', envioIdOrigen).maybeSingle()
  if (!envio) return null
  const e = envio as FilaEnvio
  const { data: items } = await admin.from('envios_entrantes_items').select('*').eq('envio_id', e.id).order('created_at')
  const { data: insumos } = await admin.from('stock_items').select('id, name, unit').in('id', ((items ?? []) as FilaItem[]).map((i) => i.stock_item_id).filter((x): x is string => Boolean(x)))
  const insumo = new Map(((insumos ?? []) as { id: string; name: string; unit: string }[]).map((s) => [s.id, s]))
  return {
    envio_id: e.envio_id_origen,
    estado: e.estado,
    enviado_at: e.enviado_at,
    recibido_at: e.recibido_at,
    recibido_por: await nombreDe(admin, e.recibido_por),
    nota_recepcion: e.nota_recepcion,
    anulado_at: e.anulado_at,
    items: ((items ?? []) as FilaItem[]).map((i) => ({
      item_id: i.item_origen_id,
      nombre: i.nombre,
      cantidad: Number(i.cantidad),
      unidad: i.unidad,
      // Lo que llegó, en la unidad de la 24 (puede no ser la misma)
      cantidad_recibida: i.cantidad_recibida == null ? null : Number(i.cantidad_recibida),
      unidad_recibida: i.stock_item_id ? insumo.get(i.stock_item_id)?.unit ?? null : null,
      producto_24: i.stock_item_id ? insumo.get(i.stock_item_id)?.name ?? null : null,
    })),
  }
}

export async function anularDesdeOrigen(admin: SupabaseClient, envioIdOrigen: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { data: envio } = await admin.from('envios_entrantes').select('id, estado').eq('origen', ORIGEN).eq('envio_id_origen', envioIdOrigen).maybeSingle()
  if (!envio) return { ok: false, status: 404, error: 'La 24 no tiene ese envío' }
  if (envio.estado === 'anulado') return { ok: true }
  if (envio.estado !== 'en_camino') return { ok: false, status: 409, error: 'La 24 ya lo recibió: no se puede anular' }
  const { data } = await admin.from('envios_entrantes').update({ estado: 'anulado', anulado_at: new Date().toISOString() }).eq('id', envio.id).eq('estado', 'en_camino').select('id')
  if (!data?.length) return { ok: false, status: 409, error: 'La 24 lo acaba de recibir: no se puede anular' }
  void logAudit(admin, { userId: null, userName: 'Santa Fe', action: 'envio_santa_fe_anulado', module: 'pedidos', entityType: 'envio_entrante', entityId: envio.id, description: 'Santa Fe anuló un envío antes de que llegara' })
  return { ok: true }
}

// ---- Lo que ve la 24 ---------------------------------------------------------

export async function enviosParaLa24(admin: SupabaseClient) {
  const desde = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const [{ data: enCamino }, { data: recibidos }, insumos] = await Promise.all([
    admin.from('envios_entrantes').select('*').eq('estado', 'en_camino').order('enviado_at'),
    admin.from('envios_entrantes').select('*').eq('estado', 'recibido').gte('recibido_at', desde).order('recibido_at', { ascending: false }).limit(10),
    insumosDeLa24(admin),
  ])
  const envios = [...((enCamino ?? []) as FilaEnvio[]), ...((recibidos ?? []) as FilaEnvio[])]
  const { data: items } = envios.length ? await admin.from('envios_entrantes_items').select('*').in('envio_id', envios.map((e) => e.id)).order('created_at') : { data: [] }
  const porEnvio = new Map<string, FilaItem[]>()
  for (const i of (items ?? []) as FilaItem[]) porEnvio.set(i.envio_id, [...(porEnvio.get(i.envio_id) ?? []), i])
  const quien = new Map<string, string | null>()
  for (const id of new Set(envios.map((e) => e.recibido_por).filter((x): x is string => Boolean(x)))) quien.set(id, await nombreDe(admin, id))
  const forma = (e: FilaEnvio) => ({
    id: e.id, estado: e.estado, enviado_at: e.enviado_at, enviado_por: e.enviado_por, nota: e.nota,
    recibido_at: e.recibido_at, recibido_por: e.recibido_por ? quien.get(e.recibido_por) ?? null : null, nota_recepcion: e.nota_recepcion,
    items: (porEnvio.get(e.id) ?? []).map((i) => ({
      id: i.id, nombre: i.nombre, unidad: i.unidad, cantidad: Number(i.cantidad), stock_item_id: i.stock_item_id,
      cantidad_recibida: i.cantidad_recibida == null ? null : Number(i.cantidad_recibida), error: i.error,
    })),
  })
  return {
    enCamino: ((enCamino ?? []) as FilaEnvio[]).map(forma),
    recibidos: ((recibidos ?? []) as FilaEnvio[]).map(forma),
    insumos,
  }
}

// ---- «Llegó»: sube el stock de la 24 -----------------------------------------

export type LineaRecibida = { id: string; stock_item_id: string; cantidad: number }

export async function recibirEnvio(admin: SupabaseClient, p: { envioId: string; userId: string; userName: string | null; lineas: LineaRecibida[]; nota: string | null }):
  Promise<{ ok: true; errores: string[]; faltantes: string[] } | { ok: false; status: number; error: string }> {
  const { data: envio } = await admin.from('envios_entrantes').select('*').eq('id', p.envioId).maybeSingle()
  if (!envio) return { ok: false, status: 404, error: 'Envío no encontrado' }
  const e = envio as FilaEnvio
  if (e.estado === 'recibido') return { ok: false, status: 409, error: 'Este envío ya se recibió' }
  if (e.estado === 'anulado') return { ok: false, status: 409, error: 'Santa Fe anuló este envío' }

  const { data: filas } = await admin.from('envios_entrantes_items').select('*').eq('envio_id', e.id)
  const items = (filas ?? []) as FilaItem[]
  const linea = new Map(p.lineas.map((l) => [l.id, l]))
  if (items.length === 0 || items.some((i) => !linea.has(i.id)) || p.lineas.length !== items.length) {
    return { ok: false, status: 400, error: 'Falta confirmar algún producto del envío' }
  }
  const insumos = new Map((await insumosDeLa24(admin)).map((s) => [s.id, s]))
  for (const i of items) {
    const l = linea.get(i.id)!
    const s = insumos.get(l.stock_item_id)
    if (!s) return { ok: false, status: 400, error: `${i.nombre}: elegí a qué producto de la 24 corresponde` }
    if (!Number.isFinite(l.cantidad) || l.cantidad < 0) return { ok: false, status: 400, error: `${i.nombre}: la cantidad que llegó no es válida` }
    if (l.cantidad > 0 && !s.enFudo) return { ok: false, status: 400, error: `${s.name} no está vinculado a Fudo: créenlo en el Fudo de la 24 (con Controlar stock) y toquen Crear todos en LVE` }
  }

  // Lo toma uno solo: dos «Llegó» a la vez no suman el stock dos veces
  const { data: tomado } = await admin.from('envios_entrantes')
    .update({ estado: 'recibido', recibido_at: new Date().toISOString(), recibido_por: p.userId, nota_recepcion: p.nota })
    .eq('id', e.id).eq('estado', 'en_camino').select('id')
  if (!tomado?.length) return { ok: false, status: 409, error: 'Este envío ya se recibió o lo anuló Santa Fe' }

  const dia = new Date(e.enviado_at).toLocaleDateString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit' })
  const errores: string[] = []
  const faltantes: string[] = []
  for (const i of items) {
    const l = linea.get(i.id)!
    const s = insumos.get(l.stock_item_id)!
    const cantidad = Math.round(l.cantidad * 1000) / 1000
    let error: string | null = null
    // Lo mandado, en la unidad de la 24 (si se puede convertir), para ver si faltó algo
    const mandado = convertQty(Number(i.cantidad), i.unidad, s.unit)
    if (mandado != null && cantidad < mandado - 0.0005) faltantes.push(`${s.name}: llegaron ${cant(cantidad, s.unit)} de ${cant(mandado, s.unit)}`)

    if (cantidad > 0) {
      const { data: actual } = await admin.from('stock_items').select('current_qty').eq('id', s.id).single()
      // Costo de Santa Fe por unidad de la 24 (1 unidad de la 24 = x unidades de Santa Fe)
      const factor = i.costo_unitario != null ? convertQty(1, s.unit, i.unidad) : null
      const costo = i.costo_unitario != null && factor != null ? Math.round(Number(i.costo_unitario) * factor * 100) / 100 : null
      const r = await syncToFudo(admin, s.id, Math.round((Number(actual?.current_qty ?? 0) + cantidad) * 1000) / 1000, p.userId, {
        reason: 'reception',
        deltaOverride: cantidad,
        costPerUnit: costo,
        note: `Envío de Santa Fe del ${dia}${e.enviado_por ? ` (mandó ${e.enviado_por})` : ''}: +${cant(cantidad, s.unit)}`,
      })
      if (!r.success) {
        error = r.error ?? 'No se pudo sumar el stock'
        errores.push(`${s.name}: ${error}`)
      }
    }
    await admin.from('envios_entrantes_items').update({ stock_item_id: s.id, cantidad_recibida: cantidad, error }).eq('id', i.id)
    // La próxima vez este producto ya viene vinculado
    await admin.from('envios_vinculos').upsert(
      { origen: ORIGEN, item_origen_id: i.item_origen_id, stock_item_id: s.id, nombre_origen: i.nombre, updated_by: p.userId, updated_at: new Date().toISOString() },
      { onConflict: 'origen,item_origen_id' },
    )
  }

  void logAudit(admin, {
    userId: p.userId, userName: p.userName, action: 'envio_santa_fe_recibido', module: 'pedidos', entityType: 'envio_entrante', entityId: e.id,
    description: `Recibió el envío de Santa Fe del ${dia}${faltantes.length ? ` con faltantes: ${faltantes.join('; ')}` : ' completo'}${errores.length ? ` · errores: ${errores.join('; ')}` : ''}`.slice(0, 1000),
    metadata: { faltantes, errores, nota: p.nota },
  })
  if (faltantes.length) {
    await avisarEncargados(admin, { title: '🚚 Envío de Santa Fe con faltantes', body: faltantes.join('\n').slice(0, 600), url: '/pedidos?step=recibido' })
  }
  return { ok: true, errores, faltantes }
}
