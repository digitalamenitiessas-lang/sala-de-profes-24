import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { sendPushToUser } from '@/lib/push/send'
import { idsConRolEnTurno, ROLES_ENCARGADO_TURNO } from '@/lib/turnos/rol-del-turno'

// ---------------------------------------------------------------------------
// Avisos operativos al encargado (una vez por día cada uno)
// ---------------------------------------------------------------------------
//   · Pedido "en camino" hace 2 días o más → "¿Llegó el pedido de X?"
//     (si llegó y nadie lo marcó, la mercadería nunca se sumó al stock)
//   · Producción esperando validación hace más de 12 h → "Validala o rechazala"
//   · Recetas de Fudo importadas hace más de 30 días → una vez por semana
//     (las recetas de los platos se cambian en Fudo y la app las trae del Excel)
//   · Compras recibidas sin precio → no están en Fudo como gasto (una vez por día)
//   · Gastos con insumos cargados directo en Fudo (no por la app) → a socios
//     y encargados, un resumen con los nuevos: las compras se cargan en la
//     app, y si además se marcó "Llegó", el stock se sumó dos veces
// Solo de 10 a 20 h (no de noche). La clave del día va a avisos_enviados y se
// reserva antes de mandar, así sale una sola vez aunque corran dos procesos.
// Lo corre el pulso de Fudo cada 10 minutos.
// ---------------------------------------------------------------------------

const DIAS_PEDIDO = 2
const HORAS_PRODUCCION = 12
const DIAS_RECETAS = 30

async function destinatarios(admin: SupabaseClient, ahora: Date): Promise<string[]> {
  const enTurno = await idsConRolEnTurno(admin, ROLES_ENCARGADO_TURNO, ahora)
  if (enTurno.length) return enTurno
  const { data } = await admin.from('profiles').select('id').eq('is_active', true).eq('role', 'encargado')
  return (data ?? []).map((d: { id: string }) => d.id)
}

async function reservar(admin: SupabaseClient, clave: string): Promise<boolean> {
  const { data } = await admin.from('avisos_enviados').upsert({ clave }, { onConflict: 'clave', ignoreDuplicates: true }).select('clave')
  return (data ?? []).length > 0
}

const ddmm = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' })

export async function avisosOperativos(admin: SupabaseClient, ahora = new Date()): Promise<{ pedidos: number; producciones: number; recetas: number; sinPrecio: number; gastosFudo: number }> {
  const out = { pedidos: 0, producciones: 0, recetas: 0, sinPrecio: 0, gastosFudo: 0 }
  const hora = Number(ahora.toLocaleString('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false })) % 24
  if (hora < 10 || hora >= 20) return out
  const hoy = fechaOperativa(ahora)
  let para: string[] | null = null
  const getPara = async () => (para ??= await destinatarios(admin, ahora))

  // ---- Pedidos en camino hace días (cocina y barra) ----
  const limite = new Date(ahora.getTime() - DIAS_PEDIDO * 86_400_000).toISOString()
  const [{ data: k }, { data: b }, { data: provs }] = await Promise.all([
    admin.from('kitchen_orders').select('supplier_id, ordered_at, created_at').eq('status', 'ordered').lt('created_at', limite),
    admin.from('bar_orders').select('supplier_id, created_at').eq('status', 'ordered').lt('created_at', limite),
    admin.from('suppliers').select('id, name'),
  ])
  const nombreProv = new Map(((provs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]))
  const grupos = new Map<string, { proveedor: string; desde: string; n: number }>()
  for (const o of [...(k ?? []), ...(b ?? [])] as { supplier_id: string | null; ordered_at?: string | null; created_at: string }[]) {
    const desde = o.ordered_at ?? o.created_at
    if (desde > limite) continue
    const clave = `${o.supplier_id ?? 'sin'}:${desde.slice(0, 10)}`
    const g = grupos.get(clave) ?? { proveedor: (o.supplier_id && nombreProv.get(o.supplier_id)) || 'proveedor sin cargar', desde, n: 0 }
    g.n++
    grupos.set(clave, g)
  }
  for (const [clave, g] of grupos) {
    if (!(await reservar(admin, `pedido:${clave}:${hoy}`))) continue
    const dias = Math.floor((ahora.getTime() - Date.parse(g.desde)) / 86_400_000)
    await Promise.allSettled((await getPara()).map((id) => sendPushToUser(id, {
      title: `📦 ¿Llegó el pedido de ${g.proveedor}?`,
      body: `${g.n} producto${g.n !== 1 ? 's' : ''} en camino desde el ${ddmm(g.desde)} (hace ${dias} días). Si llegó marcá "Llegó" (si no, no se suma al stock); si no vino, "No vino".`,
      url: '/pedidos',
    })))
    out.pedidos++
  }

  // ---- Producciones esperando validación ----
  const limiteProd = new Date(ahora.getTime() - HORAS_PRODUCCION * 3_600_000).toISOString()
  const { data: prods } = await admin.from('production_orders').select('id, name, submitted_at, created_at').eq('status', 'pending_review')
  for (const p of (prods ?? []) as { id: number; name: string | null; submitted_at: string | null; created_at: string }[]) {
    const desde = p.submitted_at ?? p.created_at
    if (desde > limiteProd) continue
    if (!(await reservar(admin, `produccion:${p.id}:${hoy}`))) continue
    await Promise.allSettled((await getPara()).map((id) => sendPushToUser(id, {
      title: '🍳 Producción sin validar',
      body: `${p.name ?? `Producción #${p.id}`} espera validación desde el ${ddmm(desde)}. Validala (suma el stock) o rechazala con el motivo.`,
      url: '/stock/produccion',
    })))
    out.producciones++
  }

  // ---- Recetas de Fudo desactualizadas (una vez por semana, el lunes o el primer día que toque) ----
  const { data: imp } = await admin.from('app_settings').select('value').eq('key', 'fudo_recetas_import').maybeSingle()
  const ultima = (imp?.value as { last_import_at?: string } | null)?.last_import_at ?? null
  const dias = ultima ? Math.floor((ahora.getTime() - Date.parse(ultima)) / 86_400_000) : null
  if (dias == null || dias > DIAS_RECETAS) {
    const f = new Date(`${hoy}T12:00:00Z`)
    const lunes = new Date(f.getTime() - ((f.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10)
    if (await reservar(admin, `recetas:${lunes}`)) {
      await Promise.allSettled((await getPara()).map((id) => sendPushToUser(id, {
        title: '📋 Actualizá las recetas de Fudo',
        body: `${ultima ? `La última importación fue el ${ddmm(ultima)} (hace ${dias} días)` : 'Nunca se importaron las recetas'}. Si cambiaron recetas en Fudo, exportá el Excel de productos y subilo en Más → Importar recetas.`,
        url: '/admin/fudo/importar',
      })))
      out.recetas++
    }
  }

  // ---- Compras recibidas sin precio (no llegaron a Fudo como gasto) ----
  const hace30 = new Date(ahora.getTime() - 30 * 86_400_000).toISOString()
  const { data: sinPrecio } = await admin.from('stock_receipts').select('id, cost_total').is('fudo_expense_id', null).gte('received_at', hace30)
  const nSinPrecio = ((sinPrecio ?? []) as { cost_total: number | null }[]).filter((r) => !(Number(r.cost_total ?? 0) > 0)).length
  if (nSinPrecio > 0 && (await reservar(admin, `sin_precio:${hoy}`))) {
    await Promise.allSettled((await getPara()).map((id) => sendPushToUser(id, {
      title: `💲 ${nSinPrecio} compra${nSinPrecio !== 1 ? 's' : ''} sin precio`,
      body: 'Se recibieron pero no tienen precio, así que no están en Fudo como gasto. Cargalo en Compras → Pagos → "Falta el precio" y el gasto se crea solo.',
      url: '/pedidos',
    })))
    out.sinPrecio = nSinPrecio
  }

  // ---- Gastos con insumos cargados directo en Fudo (posible stock doble) ----
  out.gastosFudo = await gastosManualesEnFudo(admin, ahora)
  return out
}

/** Desde cuándo rige "las compras se cargan en la app" (no avisar gastos viejos) */
const DESDE_COMPRAS_EN_APP = '2026-10-13T03:00:00Z'

async function gastosManualesEnFudo(admin: SupabaseClient, ahora: Date): Promise<number> {
  const desde = new Date(Math.max(Date.parse(DESDE_COMPRAS_EN_APP), ahora.getTime() - 3 * 86_400_000)).toISOString()
  let gastos: { id: string; provider: string | null; amount: number; date: string; ingredientNames: string[]; itemCount: number }[] = []
  try {
    const { fetchFudoExpenses } = await import('@/lib/fudo/expenses')
    gastos = (await fetchFudoExpenses(desde)).filter((g) => g.itemCount > 0)
  } catch {
    return 0 // Fudo no respondió: se revisa en el próximo pulso
  }
  if (gastos.length === 0) return 0
  // Los que creó o vinculó la app no cuentan
  const ids = gastos.map((g) => g.id)
  const [{ data: r }, { data: k }, { data: b }] = await Promise.all([
    admin.from('stock_receipts').select('fudo_expense_id').in('fudo_expense_id', ids),
    admin.from('kitchen_orders').select('fudo_expense_id').in('fudo_expense_id', ids),
    admin.from('bar_orders').select('fudo_expense_id').in('fudo_expense_id', ids),
  ])
  const deLaApp = new Set([...(r ?? []), ...(k ?? []), ...(b ?? [])].map((x: { fudo_expense_id: string | null }) => x.fudo_expense_id))
  const manuales = gastos.filter((g) => !deLaApp.has(g.id))
  if (manuales.length === 0) return 0

  // Un solo resumen por día con los gastos nuevos (cada gasto se avisa una
  // vez; los que aparezcan después del aviso de hoy van en el de mañana)
  if (!(await reservar(admin, `gastos_manuales_dia:${fechaOperativa(ahora)}`))) return 0
  const nuevos: typeof manuales = []
  for (const g of manuales) if (await reservar(admin, `gasto_manual:${g.id}`)) nuevos.push(g)
  if (nuevos.length === 0) {
    // No había nada nuevo: liberar el turno de hoy para un gasto que aparezca más tarde
    await admin.from('avisos_enviados').delete().eq('clave', `gastos_manuales_dia:${fechaOperativa(ahora)}`)
    return 0
  }
  const { data: perfiles } = await admin.from('profiles').select('id').eq('is_active', true).in('role', ['socio', 'encargado'])
  const provs = [...new Set(nuevos.map((g) => g.provider ?? 'sin proveedor'))]
  await Promise.allSettled((perfiles ?? []).map((p: { id: string }) => sendPushToUser(p.id, {
    title: `⚠️ ${nuevos.length === 1 ? 'Una compra se cargó' : `${nuevos.length} compras se cargaron`} directo en Fudo`,
    body: `${provs.slice(0, 4).join(', ')}${provs.length > 4 ? '…' : ''}. Las compras se cargan en la app ("Llegó"), que crea el gasto en Fudo. Si también se marcaron en la app, el stock se sumó dos veces.`,
    url: '/pedidos',
  })))
  return nuevos.length
}
