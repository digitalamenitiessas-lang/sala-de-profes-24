import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'

// ---------------------------------------------------------------------------
// GET /api/compras/cuentas-export?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Excel de lo adeudado a proveedores (recibos "a pagar") para el pago de los
// martes. Hoja "Resumen" (un renglón por proveedor) y "Detalle" (cada
// producto con su factura). Sale de los recibos de Sala de Profes, no de los
// comprobantes de Fudo. Sin fechas = todo lo adeudado. Encargados y socios.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

const FECHA = /^\d{4}-\d{2}-\d{2}$/

type Fila = {
  id: number
  received_date: string
  qty: number | null
  unit: string | null
  cost_total: number | null
  payment_method: string | null
  note: string | null
  fudo_expense_id: string | null
  comprobante_tipo: string | null
  comprobante_numero: string | null
  stock_items: { name: string } | null
  suppliers: { name: string } | null
}

/** "Pedido: Tomate Cherry (1 kg)" → "Tomate Cherry (1 kg)" */
const productoDe = (r: Fila) => r.stock_items?.name ?? (r.note ?? '').replace(/^Pedido:\s*/i, '').split(' — ')[0] ?? ''

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!isManagerOrAbove(profile?.role)) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const desde = searchParams.get('desde')
  const hasta = searchParams.get('hasta')
  if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta))) {
    return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 })
  }

  const admin = createAdminClient()
  let q = admin
    .from('stock_receipts')
    .select('id, received_date, qty, unit, cost_total, payment_method, note, fudo_expense_id, comprobante_tipo, comprobante_numero, stock_items(name), suppliers!stock_receipts_supplier_id_fkey(name)')
    .eq('payment_status', 'a_pagar')
    .order('received_date', { ascending: true })
    .order('id', { ascending: true })
    .limit(5000)
  if (desde) q = q.gte('received_date', desde)
  if (hasta) q = q.lte('received_date', hasta)
  const { data, error } = await q
  if (error) {
    console.error('[cuentas-export]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const filas = (data ?? []) as unknown as Fila[]

  const factura = (r: Fila) => r.comprobante_numero ? `${r.comprobante_tipo ? `${r.comprobante_tipo} ` : ''}${r.comprobante_numero}` : ''
  const detalle = filas.map((r) => ({
    Proveedor: r.suppliers?.name?.trim() ?? 'Sin proveedor',
    Fecha: r.received_date,
    Factura: factura(r),
    Producto: productoDe(r),
    Cantidad: r.qty ?? '',
    Unidad: r.unit ?? '',
    Monto: r.cost_total != null && Number(r.cost_total) > 0 ? Number(r.cost_total) : '',
    'Falta precio': r.cost_total != null && Number(r.cost_total) > 0 ? '' : 'Sí',
    'Gasto Fudo': r.fudo_expense_id ? `#${r.fudo_expense_id}` : '',
    Recibo: r.id,
  }))

  const porProveedor = new Map<string, { recibos: number; total: number; sinPrecio: number; facturas: Set<string>; desde: string; hasta: string }>()
  for (const d of detalle) {
    const p = porProveedor.get(d.Proveedor) ?? { recibos: 0, total: 0, sinPrecio: 0, facturas: new Set<string>(), desde: d.Fecha, hasta: d.Fecha }
    p.recibos++
    if (typeof d.Monto === 'number') p.total += d.Monto
    else p.sinPrecio++
    if (d.Factura) p.facturas.add(d.Factura)
    if (d.Fecha < p.desde) p.desde = d.Fecha
    if (d.Fecha > p.hasta) p.hasta = d.Fecha
    porProveedor.set(d.Proveedor, p)
  }
  const resumen = [...porProveedor.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([proveedor, p]) => ({
      Proveedor: proveedor,
      'Total adeudado': Math.round(p.total * 100) / 100,
      Recibos: p.recibos,
      Facturas: [...p.facturas].join(', '),
      'Sin precio': p.sinPrecio || '',
      Desde: p.desde,
      Hasta: p.hasta,
    }))
  const total = Math.round(resumen.reduce((a, r) => a + r['Total adeudado'], 0) * 100) / 100
  resumen.push({ Proveedor: 'TOTAL', 'Total adeudado': total, Recibos: filas.length, Facturas: '', 'Sin precio': '', Desde: '', Hasta: '' })

  const wb = XLSX.utils.book_new()
  const wsR = XLSX.utils.json_to_sheet(resumen)
  wsR['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 9 }, { wch: 40 }, { wch: 10 }, { wch: 12 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, wsR, 'Resumen')
  const wsD = XLSX.utils.json_to_sheet(detalle)
  wsD['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 18 }, { wch: 34 }, { wch: 9 }, { wch: 8 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 8 }]
  XLSX.utils.book_append_sheet(wb, wsD, 'Detalle')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const nombre = `cuentas_a_pagar_${desde ?? 'inicio'}_${hasta ?? 'hoy'}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nombre}"`,
    },
  })
}
