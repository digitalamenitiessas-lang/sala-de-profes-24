import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { sendPushToUser } from '@/lib/push/send'
import { idsConRolEnTurno, ROLES_ENCARGADO_TURNO } from '@/lib/turnos/rol-del-turno'
import type { FudoExpense } from '@/lib/fudo/expenses'

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

  // ---- Gastos con insumos cargados directo en Fudo → importar al stock ----
  out.gastosFudo = await gastosManualesEnFudo(admin, ahora)
  await importarGastosManuales(admin, ahora) // actualiza stock sin esperar al sync de las 3am
  return out
}

// ---------------------------------------------------------------------------
// Alerta a socios: empleados que no marcaron o llegaron tarde
// ---------------------------------------------------------------------------
// Corre cada 10 min (via fudo-pulso). Para cada turno que empezó hace 15-45
// min, verifica si hay un clock_in. Si no hay (o fue tarde), empuja una push
// a todos los socios activos. Dedup: avisos_enviados "marcado_turno:{id}" →
// máximo un aviso por turno aunque el cron pise dos veces la ventana.
// ---------------------------------------------------------------------------

const GRACIA_MARCADO_MIN = 10

export async function verificarMarcadosAtiempo(admin: SupabaseClient, ahora = new Date()): Promise<number> {
  const horaAR = Number(ahora.toLocaleString('en-GB', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false })) % 24
  if (horaAR < 7 || horaAR >= 23) return 0

  const ahoraAR = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }))
  const minAhora = ahoraAR.getHours() * 60 + ahoraAR.getMinutes()

  const ventanaInicio = minAhora - 45
  const ventanaFin = minAhora - 15
  if (ventanaFin < 6 * 60) return 0

  const toHHMM = (m: number) => {
    const n = ((m % (24 * 60)) + 24 * 60) % (24 * 60)
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
  }

  const hoyStr = ahoraAR.toLocaleDateString('en-CA') // 'YYYY-MM-DD'

  type ShiftRow = { id: string; user_id: string; start_time: string }
  const { data: turnos } = await admin
    .from('shifts')
    .select('id, user_id, start_time')
    .eq('shift_date', hoyStr)
    .gte('start_time', toHHMM(Math.max(6 * 60, ventanaInicio)))
    .lte('start_time', toHHMM(ventanaFin))

  if (!turnos?.length) return 0

  // Reservar dedup antes de cualquier consulta cara (skip si ya avisamos)
  const aTratar: ShiftRow[] = []
  for (const t of turnos as ShiftRow[]) {
    if (await reservar(admin, `marcado_turno:${t.id}`)) aTratar.push(t)
  }
  if (!aTratar.length) return 0

  const userIds = [...new Set(aTratar.map((t) => t.user_id))]

  const [{ data: ausenciasRes }, { data: marcadosRes }, { data: perfilesRes }] = await Promise.all([
    admin.from('ausencias').select('user_id').eq('fecha', hoyStr).in('user_id', userIds),
    admin
      .from('attendance_logs')
      .select('user_id, clock_in_at')
      .in('user_id', userIds)
      .eq('operative_date', hoyStr)
      .order('clock_in_at', { ascending: true }),
    admin.from('profiles').select('id, first_name, role').in('id', userIds).eq('is_active', true),
  ])

  const tieneAusencia = new Set((ausenciasRes ?? []).map((a: { user_id: string }) => a.user_id))
  const primerFichaje = new Map<string, string>()
  for (const m of (marcadosRes ?? []) as { user_id: string; clock_in_at: string }[]) {
    if (!primerFichaje.has(m.user_id)) primerFichaje.set(m.user_id, m.clock_in_at)
  }
  const perfil = new Map(
    ((perfilesRes ?? []) as { id: string; first_name: string | null; role: string }[]).map((p) => [p.id, p]),
  )

  const alertas: string[] = []

  for (const t of aTratar) {
    if (tieneAusencia.has(t.user_id)) continue
    const p = perfil.get(t.user_id)
    if (!p || p.role === 'socio') continue

    const nombre = p.first_name ?? 'Empleado'
    const fichaje = primerFichaje.get(t.user_id)

    if (!fichaje) {
      alertas.push(`${nombre}: no marcó (${t.start_time})`)
      continue
    }

    const tardanzaMin = Math.round(
      (Date.parse(fichaje) - Date.parse(`${hoyStr}T${t.start_time}:00-03:00`)) / 60_000,
    )
    if (tardanzaMin > GRACIA_MARCADO_MIN) {
      alertas.push(`${nombre}: ${tardanzaMin} min tarde`)
    }
  }

  if (!alertas.length) return 0

  const { data: socios } = await admin.from('profiles').select('id').eq('is_active', true).eq('role', 'socio')
  const n = alertas.length
  await Promise.allSettled(
    (socios ?? []).map((s: { id: string }) =>
      sendPushToUser(s.id, {
        title: n === 1 ? `⏰ ${alertas[0]}` : `⏰ ${n} empleados: sin marcar o tarde`,
        body: n > 1 ? alertas.join(' · ') : '',
        url: '/fichajes',
      }),
    ),
  )
  return n
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
    title: `📦 ${nuevos.length === 1 ? 'Una compra se cargó' : `${nuevos.length} compras se cargaron`} directo en Fudo`,
    body: `${provs.slice(0, 4).join(', ')}${provs.length > 4 ? '…' : ''}. Se actualizó el stock en la app automáticamente. Para futuras compras, usá "Llegó" en la app.`,
    url: '/pedidos',
  })))
  return nuevos.length
}

// ---------------------------------------------------------------------------
// Importación automática de gastos manuales de Fudo al stock de la app
// ---------------------------------------------------------------------------
// Cuando alguien carga una compra directo en Fudo (con ingredientes), Fudo
// actualiza su propio stock. La app no se entera hasta el sync de las 3am.
// Esta función detecta esos gastos y crea los stock_receipts en la app YA,
// sin esperar al cron nocturno. Corre cada 10 minutos via fudo-pulso.
//
// Dedup: usa fudo_expense_id en stock_receipts. Si ya existe un receipt con ese
// fudo_expense_id para ese stock_item, se saltea (no hay doble conteo).
// ---------------------------------------------------------------------------

async function importarGastosManuales(admin: SupabaseClient, ahora: Date): Promise<void> {
  const desde = new Date(Math.max(Date.parse(DESDE_COMPRAS_EN_APP), ahora.getTime() - 3 * 86_400_000)).toISOString()

  let gastos: FudoExpense[] = []
  try {
    const { fetchFudoExpenses } = await import('@/lib/fudo/expenses')
    gastos = (await fetchFudoExpenses(desde)).filter((g) => g.items.length > 0)
  } catch {
    return // Fudo no respondió
  }

  if (gastos.length === 0) return

  // Cuáles ya fueron importados (fudo_expense_id ya existe en stock_receipts)
  const ids = gastos.map((g) => g.id)
  const [{ data: r }, { data: k }, { data: b }] = await Promise.all([
    admin.from('stock_receipts').select('fudo_expense_id').in('fudo_expense_id', ids),
    admin.from('kitchen_orders').select('fudo_expense_id').in('fudo_expense_id', ids),
    admin.from('bar_orders').select('fudo_expense_id').in('fudo_expense_id', ids),
  ])
  const yaEnApp = new Set([...(r ?? []), ...(k ?? []), ...(b ?? [])].map((x: { fudo_expense_id: string | null }) => x.fudo_expense_id))
  const pendientes = gastos.filter((g) => !yaEnApp.has(g.id))

  if (pendientes.length === 0) return

  // Cargar mapeos en bloque (evita N queries individuales)
  const [{ data: stockItems }, { data: suppliers }] = await Promise.all([
    admin.from('stock_items')
      .select('id, name, unit, current_qty, fudo_ingredient_id')
      .eq('is_active', true)
      .not('fudo_ingredient_id', 'is', null),
    admin.from('suppliers')
      .select('id, fudo_provider_id')
      .not('fudo_provider_id', 'is', null),
  ])

  type StockRow = { id: string; name: string; unit: string; current_qty: number; fudo_ingredient_id: string }
  const itemByIngId = new Map(
    ((stockItems ?? []) as StockRow[]).map((si) => [si.fudo_ingredient_id, { ...si }]),
  )
  const supplierByProvId = new Map(
    ((suppliers ?? []) as { id: string; fudo_provider_id: string }[]).map((s) => [s.fudo_provider_id, s.id]),
  )

  for (const gasto of pendientes) {
    const supplierId = gasto.providerId ? (supplierByProvId.get(gasto.providerId) ?? null) : null
    const fechaAR = gasto.date.slice(0, 10) // 'YYYY-MM-DD'

    for (const item of gasto.items) {
      if (item.qty <= 0) continue
      const si = itemByIngId.get(item.ingredientId)
      if (!si) continue // sin stock_item vinculado → sin match

      // Verificar que no exista ya un receipt para este gasto + insumo
      const { data: dup } = await admin
        .from('stock_receipts')
        .select('id')
        .eq('fudo_expense_id', gasto.id)
        .eq('stock_item_id', si.id)
        .limit(1)
        .maybeSingle()
      if (dup) continue

      const { error: rcptErr } = await admin.from('stock_receipts').insert({
        stock_item_id: si.id,
        supplier_id: supplierId,
        qty: item.qty,
        unit: si.unit,
        cost_per_unit: item.price > 0 ? item.price : null,
        cost_total: item.price > 0 ? Math.round(item.price * item.qty * 100) / 100 : null,
        received_date: fechaAR,
        received_at: gasto.date,
        fudo_expense_id: gasto.id,
        payment_status: 'pagado',
        note: `Importado desde Fudo (${gasto.provider ?? 'proveedor desconocido'}) — entrada directa`,
      })
      if (rcptErr) {
        console.error('[importarGastosManuales] error receipt:', rcptErr.message, { gasto: gasto.id, item: item.ingredientId })
        continue
      }

      // Sumar al stock actual y registrar en stock_logs
      const oldQty = Number(si.current_qty)
      const newQty = Math.round((oldQty + item.qty) * 1000) / 1000
      await Promise.allSettled([
        admin.from('stock_items').update({ current_qty: newQty, updated_at: ahora.toISOString() }).eq('id', si.id),
        admin.from('stock_logs').insert({
          stock_item_id: si.id,
          action: 'receipt',
          old_qty: oldQty,
          new_qty: newQty,
          note: `Compra en Fudo: ${gasto.provider ?? 'proveedor'} — importado automáticamente`,
        }),
      ])

      // Mantener el mapa actualizado para el próximo ítem del mismo insumo
      si.current_qty = newQty
    }
  }
}
