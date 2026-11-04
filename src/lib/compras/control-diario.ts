import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchFudoExpenses, fudoPaymentMethodId, type FudoExpense } from '@/lib/fudo/expenses'
import { DESDE_COMPRAS_EN_APP } from '@/lib/avisos/operativos'
import { MODO_FACTURA_PENDIENTE } from '@/lib/compras/factura-en-fudo'
import { sendPushToUser } from '@/lib/push/send'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Control diario de compras: Sala de Profes contra Fudo (a las 20, una vez)
// ---------------------------------------------------------------------------
// Lo que hace que no coincidan es casi siempre cómo se carga, no la app. Para
// que se vea el mismo día y no a fin de mes, a socios y encargados les llega
// un aviso con lo que no cierra:
//   · posibles duplicados: dos gastos del mismo proveedor, cargados el mismo
//     día, con el mismo monto y los mismos productos (sin productos no se
//     comparan: "Empleados" tiene varios iguales por día y está bien)
//   · gastos de Fudo cuyos productos suman más que el total (Oyambre #85:
//     productos cargados dos veces, que además suman stock de más)
//   · Facturas A que llegaron hace más de un día y no están en Fudo
//   · "a pagar" de la app distinto de la deuda de Fudo, gasto por gasto
// Duplicados y "no cierran" se avisan una sola vez cada uno; lo pendiente y
// la deuda, todos los días hasta que se arregle. Si todo cierra, no avisa
// (queda en la auditoría).
// ---------------------------------------------------------------------------

export type ControlCompras = {
  duplicados: string[]
  noCierran: string[]
  facturasPendientes: string[]
  deuda: { fudo: number; app: number; distintos: string[]; sinGastoEnFudo: number }
  avisado: boolean
}

const TZ = 'America/Argentina/Buenos_Aires'
const DIAS_RECIENTES = 7
const redondo = (n: number) => Math.round(n * 100) / 100
const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`
const ddmm = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit' })
const sumaRenglones = (g: FudoExpense) => redondo([...g.items, ...g.productItems].reduce((t, i) => t + Math.max(0, i.price), 0))

/** true si la clave es nueva (y queda guardada): cada cosa se avisa una vez */
async function primeraVez(admin: SupabaseClient, clave: string): Promise<boolean> {
  const { data } = await admin.from('avisos_enviados').upsert({ clave }, { onConflict: 'clave', ignoreDuplicates: true }).select('clave')
  return (data ?? []).length > 0
}

/**
 * soloCalcular: devuelve lo que encontró sin avisar ni guardar nada (para
 * revisarlo a mano). Sin soloCalcular corre solo desde las 20 y una vez por día.
 */
export async function controlDiarioCompras(admin: SupabaseClient, opciones: { ahora?: Date; soloCalcular?: boolean } = {}): Promise<ControlCompras | null> {
  const ahora = opciones.ahora ?? new Date()
  const hora = Number(ahora.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })) % 24
  const hoy = ahora.toLocaleDateString('en-CA', { timeZone: TZ })
  const claveDia = `control_compras:${hoy}`
  if (!opciones.soloCalcular) {
    if (hora < 20) return null
    const { data: hecho } = await admin.from('avisos_enviados').select('clave').eq('clave', claveDia).maybeSingle()
    if (hecho) return null
  }

  // Fresco: a las 20 recién se sincronizaron los pagos de Fudo
  const gastos = await fetchFudoExpenses(DESDE_COMPRAS_EN_APP, { force: true })
  // Por cuándo se cargó (date es el día del primer pago)
  const cargado = (g: FudoExpense) => g.creado ?? g.date
  const recientes = gastos.filter((g) => Date.parse(cargado(g)) >= ahora.getTime() - DIAS_RECIENTES * 86_400_000)

  // 1. Posibles duplicados
  const duplicados: { clave: string; texto: string }[] = []
  const vistos = new Map<string, FudoExpense>()
  for (const g of [...recientes].reverse()) {
    const productos = [...g.items.map((i) => `i${i.ingredientId}`), ...g.productItems.map((i) => `p${i.productId}`)].sort().join(',')
    if (!g.providerId || !productos) continue
    const clave = `${g.providerId}|${new Date(cargado(g)).toLocaleDateString('en-CA', { timeZone: TZ })}|${Math.round(g.montoGasto)}|${productos}`
    const otro = vistos.get(clave)
    if (otro) duplicados.push({ clave: `control_dup:${otro.id}-${g.id}`, texto: `${g.provider ?? 'Sin proveedor'} ${ddmm(cargado(g))} ${$(g.montoGasto)}: gastos #${otro.id} y #${g.id}` })
    else vistos.set(clave, g)
  }

  // 2. Productos que suman más que el total
  const noCierran = recientes
    .filter((g) => sumaRenglones(g) > g.montoGasto + 1)
    .map((g) => ({ clave: `control_nocierra:${g.id}`, texto: `#${g.id} ${g.provider ?? 'Sin proveedor'} ${ddmm(cargado(g))}: productos ${$(sumaRenglones(g))}, total ${$(g.montoGasto)}` }))

  // 3. Facturas A sin cargar en Fudo hace más de un día
  const hace24 = new Date(ahora.getTime() - 86_400_000).toISOString()
  const pendientes: { supplier_id: string | null; product_name: string; received_at: string }[] = []
  for (const tabla of ['kitchen_orders', 'bar_orders'] as const) {
    const { data } = await admin.from(tabla).select('supplier_id, product_name, received_at')
      .eq('status', 'received').eq('received_mode', MODO_FACTURA_PENDIENTE).lt('received_at', hace24)
    pendientes.push(...((data ?? []) as typeof pendientes))
  }
  const idsProv = [...new Set(pendientes.map((p) => p.supplier_id).filter((x): x is string => Boolean(x)))]
  const { data: provs } = idsProv.length ? await admin.from('suppliers').select('id, name').in('id', idsProv) : { data: [] }
  const nombreProv = new Map(((provs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]))
  const porEntrega = new Map<string, string[]>()
  for (const p of pendientes) {
    const k = `${nombreProv.get(p.supplier_id ?? '') ?? 'Sin proveedor'} (llegó el ${ddmm(p.received_at)})`
    porEntrega.set(k, [...(porEntrega.get(k) ?? []), p.product_name])
  }
  const facturasPendientes = [...porEntrega].map(([k, prods]) => `${k}: ${prods.slice(0, 3).join(', ')}${prods.length > 3 ? '…' : ''}`)

  // 4. "A pagar" de la app contra la deuda de Fudo, gasto por gasto
  const ctaCte = await fudoPaymentMethodId('cuenta_corriente').catch(() => null)
  const saldoFudo = new Map(gastos.filter((g) => g.status === 'UNPAID').map((g) => [
    g.id, { saldo: redondo(g.montoGasto - g.pagos.filter((p) => p.paymentMethodId !== ctaCte).reduce((t, p) => t + p.amount, 0)), proveedor: g.provider },
  ]))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: aPagar } = await (admin.from('stock_receipts') as any).select('fudo_expense_id, cost_total').eq('payment_status', 'a_pagar')
  const enApp = new Map<string, number>()
  let sinGastoEnFudo = 0
  for (const r of (aPagar ?? []) as { fudo_expense_id: string | null; cost_total: number | null }[]) {
    if (!r.fudo_expense_id) { if (Number(r.cost_total) > 0) sinGastoEnFudo++; continue }
    enApp.set(String(r.fudo_expense_id), redondo((enApp.get(String(r.fudo_expense_id)) ?? 0) + (Number(r.cost_total) || 0)))
  }
  const distintos: string[] = []
  for (const id of new Set([...saldoFudo.keys(), ...enApp.keys()])) {
    const f = saldoFudo.get(id)?.saldo ?? 0
    const a = enApp.get(id) ?? 0
    if (Math.abs(f - a) > 1) distintos.push(`#${id} ${saldoFudo.get(id)?.proveedor ?? ''}: Fudo ${$(f)}, app ${$(a)}`.replace(' :', ':'))
  }
  const deuda = {
    fudo: redondo([...saldoFudo.values()].reduce((t, x) => t + x.saldo, 0)),
    app: redondo([...enApp.values()].reduce((t, x) => t + x, 0)),
    distintos,
    sinGastoEnFudo,
  }

  const resultado: ControlCompras = {
    duplicados: duplicados.map((d) => d.texto),
    noCierran: noCierran.map((d) => d.texto),
    facturasPendientes,
    deuda,
    avisado: false,
  }
  if (opciones.soloCalcular) return resultado
  if (!(await primeraVez(admin, claveDia))) return null

  // Duplicados y "no cierran": cada uno se avisa una sola vez
  const dupNuevos: string[] = []
  for (const d of duplicados) if (await primeraVez(admin, d.clave)) dupNuevos.push(d.texto)
  const noCierranNuevos: string[] = []
  for (const d of noCierran) if (await primeraVez(admin, d.clave)) noCierranNuevos.push(d.texto)

  const lineas = [
    dupNuevos.length ? `Posible compra cargada dos veces: ${dupNuevos.join('; ')}` : null,
    noCierranNuevos.length ? `Productos que no suman el total (¿cargados dos veces?): ${noCierranNuevos.join('; ')}` : null,
    facturasPendientes.length ? `Facturas A que faltan cargar en Fudo: ${facturasPendientes.join('; ')}` : null,
    distintos.length ? `"A pagar" distinto de Fudo (app ${$(deuda.app)}, Fudo ${$(deuda.fudo)}): ${distintos.slice(0, 4).join('; ')}${distintos.length > 4 ? '…' : ''}` : null,
    sinGastoEnFudo ? `${sinGastoEnFudo} compra${sinGastoEnFudo === 1 ? '' : 's'} a pagar en la app que no ${sinGastoEnFudo === 1 ? 'está' : 'están'} en Fudo` : null,
  ].filter((x): x is string => Boolean(x))

  void logAudit(admin, {
    userId: null, userName: 'Sistema', action: 'control_compras_fudo', module: 'pedidos', entityType: 'stock_receipt',
    description: lineas.length ? `Control de compras con Fudo: ${lineas.join(' · ')}`.slice(0, 1000) : `Control de compras con Fudo: todo coincide ("a pagar" ${$(deuda.app)})`,
    metadata: { ...resultado, dupNuevos, noCierranNuevos },
  })
  if (lineas.length === 0) return resultado

  const { data: perfiles } = await admin.from('profiles').select('id').eq('is_active', true).in('role', ['socio', 'encargado'])
  await Promise.allSettled(((perfiles ?? []) as { id: string }[]).map((p) => sendPushToUser(p.id, {
    title: '🧾 Compras: hay cosas que no coinciden con Fudo',
    body: lineas.join('\n').slice(0, 600),
    url: '/pedidos/cuentas',
  })))
  return { ...resultado, avisado: true }
}
