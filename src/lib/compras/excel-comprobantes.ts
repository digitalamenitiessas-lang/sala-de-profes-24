import type { SupabaseClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { fudoFetch } from '@/lib/fudoClient'
import { diaDeCompra, fetchFudoExpenses, fudoPaymentMethodId, type FudoExpense } from '@/lib/fudo/expenses'
import { DESDE_COMPRAS_EN_APP } from '@/lib/avisos/operativos'
import { COMPROBANTES } from '@/lib/compras/datos-gasto'

// ---------------------------------------------------------------------------
// Excel de comprobantes (GET /api/compras/comprobantes/export)
// ---------------------------------------------------------------------------
// Excel de comprobantes para conciliar y pagar a proveedores (9/11: todo se
// carga en Fudo y se refleja acá). Sale de Fudo, que es la fuente: una fila
// por comprobante con tipo, número, categoría, total, si está pagado y la
// deuda. Hojas: Comprobantes, Por proveedor (total, pagado, a pagar), Pagos
// del período (lo que se pagó en esas fechas, aunque la compra sea de antes)
// y Detalle (productos). Lo cargado solo en la app (sin gasto en Fudo) va al
// final de Comprobantes. La ruta controla el rol.
// ---------------------------------------------------------------------------

type JsonApi = { data?: { id: string; attributes?: Record<string, unknown> }[] }

const TZ = 'America/Argentina/Buenos_Aires'
const redondo = (n: number) => Math.round(n * 100) / 100
const diaAR = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })
const ddmmaaaa = (dia: string | null) => (dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}` : '')

async function nombres(path: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let page = 1; page <= 10; page++) {
    // Fudo no acepta páginas de más de 200 en algunas listas (categorías)
    const res = await fudoFetch<JsonApi>(`${path}${path.includes('?') ? '&' : '?'}page[size]=200&page[number]=${page}`).catch(() => null)
    const data = res?.data ?? []
    for (const x of data) out.set(String(x.id), String(x.attributes?.name ?? x.id))
    if (data.length < 200) break
  }
  return out
}

/** Arma el Excel (from/to: YYYY-MM-DD, fecha de la compra). Tira error si Fudo no responde. */
export async function excelComprobantes(admin: SupabaseClient, from: string, to: string): Promise<Buffer> {
  let gastos: FudoExpense[]
  let tipos: Map<string, string>, categorias: Map<string, string>, medios: Map<string, string>
  let ctaCte: string | null
  try {
    // Desde que la app carga compras: los pagos del período pueden ser de compras viejas
    ;[gastos, tipos, categorias, medios, ctaCte] = await Promise.all([
      fetchFudoExpenses(DESDE_COMPRAS_EN_APP, { force: true }),
      nombres('/receipt-types'),
      // Sin fields Fudo manda las categorías sin atributos (quedaba el número)
      nombres('/expense-categories?fields[expenseCategory]=name'),
      nombres('/payment-methods'),
      fudoPaymentMethodId('cuenta_corriente').catch(() => null),
    ])
  } catch (err) {
    throw new Error(`Fudo no respondió: ${err instanceof Error ? err.message : 'error'}`)
  }

  const pagosReales = (g: FudoExpense) => g.pagos.filter((p) => p.paymentMethodId !== ctaCte)
  const saldo = (g: FudoExpense) => (g.status === 'PAID' ? 0 : redondo(Math.max(0, g.montoGasto - pagosReales(g).reduce((t, p) => t + p.amount, 0))))
  const delPeriodo = gastos
    .map((g) => ({ g, dia: diaDeCompra(g) }))
    .filter(({ dia }) => dia >= from && dia <= to)
    .sort((a, b) => a.dia.localeCompare(b.dia) || (a.g.provider ?? '').localeCompare(b.g.provider ?? ''))

  const comprobantes: Record<string, string | number>[] = delPeriodo.map(({ g, dia }) => {
    const pagos = pagosReales(g)
    return {
      Fecha: ddmmaaaa(dia),
      Proveedor: g.provider ?? 'Sin proveedor',
      Tipo: g.tipoComprobanteId ? tipos.get(g.tipoComprobanteId) ?? '' : 'Sin comprobante',
      Número: g.numero ?? '',
      Categoría: g.categoriaId ? categorias.get(g.categoriaId) ?? '' : '',
      Descripción: g.descripcion ?? '',
      Total: g.montoGasto,
      Estado: g.status === 'PAID' ? 'Pagado' : 'A pagar',
      'A pagar': saldo(g),
      'Pagado el': g.status === 'PAID' && pagos.length ? ddmmaaaa(diaAR(pagos[pagos.length - 1].createdAt)) : '',
      Medio: [...new Set(pagos.map((p) => (p.paymentMethodId ? medios.get(p.paymentMethodId) : '') ?? ''))].filter(Boolean).join(', '),
      Vence: ddmmaaaa(g.vence),
      'Gasto Fudo': `#${g.id}`,
    }
  })

  // Lo cargado solo en la app (sin gasto en Fudo): para que no quede afuera
  const { data: soloApp } = await admin.from('stock_receipts')
    .select('received_date, cost_total, payment_status, payment_method, paid_at, comprobante_tipo, comprobante_numero, expense_category_name, note, suppliers!stock_receipts_supplier_id_fkey(name)')
    .is('fudo_expense_id', null).gt('cost_total', 0).gte('received_date', from).lte('received_date', to)
    .order('received_date')
  for (const r of (soloApp ?? []) as unknown as { received_date: string; cost_total: number; payment_status: string; payment_method: string | null; paid_at: string | null; comprobante_tipo: string | null; comprobante_numero: string | null; expense_category_name: string | null; note: string | null; suppliers: { name: string } | null }[]) {
    comprobantes.push({
      Fecha: ddmmaaaa(r.received_date),
      Proveedor: r.suppliers?.name ?? 'Sin proveedor',
      Tipo: COMPROBANTES.find((c) => c.key === r.comprobante_tipo)?.label ?? 'Sin comprobante',
      Número: r.comprobante_numero ?? '',
      Categoría: r.expense_category_name ?? '',
      Descripción: r.note ?? '',
      Total: redondo(Number(r.cost_total)),
      Estado: r.payment_status === 'pagado' ? 'Pagado' : 'A pagar',
      'A pagar': r.payment_status === 'pagado' ? 0 : redondo(Number(r.cost_total)),
      'Pagado el': r.paid_at ? ddmmaaaa(diaAR(r.paid_at)) : '',
      Medio: r.payment_method ?? '',
      Vence: '',
      'Gasto Fudo': 'solo en Sala de Profes',
    })
  }

  // Por proveedor
  const porProv = new Map<string, { n: number; total: number; aPagar: number }>()
  for (const c of comprobantes) {
    const p = porProv.get(String(c.Proveedor)) ?? { n: 0, total: 0, aPagar: 0 }
    p.n++; p.total += Number(c.Total); p.aPagar += Number(c['A pagar'])
    porProv.set(String(c.Proveedor), p)
  }
  const resumen: Record<string, string | number>[] = [...porProv].sort((a, b) => b[1].aPagar - a[1].aPagar || b[1].total - a[1].total)
    .map(([Proveedor, p]) => ({ Proveedor, Comprobantes: p.n, Total: redondo(p.total), Pagado: redondo(p.total - p.aPagar), 'A pagar': redondo(p.aPagar) }))
  const tot = resumen.reduce<{ n: number; t: number; d: number }>((a, r) => ({ n: a.n + Number(r.Comprobantes), t: a.t + Number(r.Total), d: a.d + Number(r['A pagar']) }), { n: 0, t: 0, d: 0 })
  resumen.push({ Proveedor: 'TOTAL', Comprobantes: tot.n, Total: redondo(tot.t), Pagado: redondo(tot.t - tot.d), 'A pagar': redondo(tot.d) })

  // Pagos hechos en el período (aunque la compra sea de antes)
  const pagosPeriodo = gastos.flatMap((g) => pagosReales(g).filter((p) => { const d = diaAR(p.createdAt); return d >= from && d <= to }).map((p) => ({
    dia: diaAR(p.createdAt),
    fila: {
      'Fecha de pago': ddmmaaaa(diaAR(p.createdAt)),
      Proveedor: g.provider ?? 'Sin proveedor',
      Comprobante: [g.tipoComprobanteId ? tipos.get(g.tipoComprobanteId) : '', g.numero ? `N° ${g.numero}` : ''].filter(Boolean).join(' ') || 'Sin comprobante',
      'Fecha de compra': ddmmaaaa(diaDeCompra(g)),
      Monto: redondo(p.amount),
      Medio: p.paymentMethodId ? medios.get(p.paymentMethodId) ?? '' : '',
      'Gasto Fudo': `#${g.id}`,
    } as Record<string, string | number>,
  }))).sort((a, b) => a.dia.localeCompare(b.dia)).map((x) => x.fila)

  // Detalle de productos de los comprobantes del período
  const detalle: Record<string, string | number>[] = delPeriodo.flatMap(({ g, dia }) => [...g.items, ...g.productItems].map((i) => ({
    Fecha: ddmmaaaa(dia),
    Proveedor: g.provider ?? 'Sin proveedor',
    Número: g.numero ?? '',
    Producto: i.name,
    Cantidad: i.qty,
    'Total renglón': redondo(i.price),
    'Gasto Fudo': `#${g.id}`,
  })))

  const hoja = (filas: Record<string, string | number>[], anchos: number[], vacio: string) => {
    const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': vacio }])
    ws['!cols'] = anchos.map((wch) => ({ wch }))
    return ws
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, hoja(comprobantes, [11, 26, 14, 18, 22, 24, 13, 9, 13, 11, 18, 11, 12], 'Sin comprobantes en el período'), 'Comprobantes')
  XLSX.utils.book_append_sheet(wb, hoja(resumen, [28, 13, 14, 14, 14], 'Sin datos'), 'Por proveedor')
  XLSX.utils.book_append_sheet(wb, hoja(pagosPeriodo, [13, 26, 26, 15, 13, 18, 12], 'Sin pagos en el período'), 'Pagos del período')
  XLSX.utils.book_append_sheet(wb, hoja(detalle, [11, 26, 18, 30, 10, 14, 12], 'Sin productos'), 'Detalle')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
