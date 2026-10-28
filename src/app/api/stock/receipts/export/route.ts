import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'

// ---------------------------------------------------------------------------
// GET /api/stock/receipts/export?from=YYYY-MM-DD&to=YYYY-MM-DD
// Excel de las compras recibidas (todas: también las que entraron sin
// insumo). Hoja "Por proveedor" con totales y "Compras" con el detalle.
// Solo encargados y socios.
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!isManagerOrAbove(profile?.role)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const today = new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
  const firstOfMonth = `${today.slice(0, 7)}-01`
  const from = searchParams.get('from') ?? firstOfMonth
  const to = searchParams.get('to') ?? today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: rows, error } = await admin
    .from('stock_receipts')
    .select(`
      id, received_date, qty, unit, cost_per_unit, cost_total,
      payment_status, payment_method, paid_at, note,
      fudo_expense_id, expense_category_name, comprobante_tipo, comprobante_numero,
      stock_items(name),
      suppliers!stock_receipts_supplier_id_fkey(name)
    `)
    .gte('received_date', from)
    .lte('received_date', to)
    .order('received_date', { ascending: true })
    .order('id', { ascending: true })
    .limit(10000)

  if (error) {
    console.error('[receipts/export]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  type Row = {
    id: number
    received_date: string
    qty: number
    unit: string | null
    cost_per_unit: number | null
    cost_total: number | null
    payment_status: string | null
    payment_method: string | null
    paid_at: string | null
    note: string | null
    fudo_expense_id: string | null
    expense_category_name: string | null
    comprobante_tipo: string | null
    comprobante_numero: string | null
    stock_items: { name: string } | null
    suppliers: { name: string } | null
  }

  const MEDIO: Record<string, string> = { cuenta_corriente: 'Cuenta corriente', efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' }
  // Sin insumo (escrito a mano): el producto sale de la nota "Pedido: X (cant)"
  const producto = (r: Row) => r.stock_items?.name ?? (r.note ?? '').replace(/^Pedido:\s*/i, '').split(' — ')[0]
  const data = (rows as unknown as Row[]).map((r) => ({
    Fecha: r.received_date,
    Proveedor: r.suppliers?.name?.trim() ?? 'Sin proveedor',
    Producto: producto(r),
    Cantidad: r.qty,
    Unidad: r.unit ?? '',
    'Costo unitario': r.cost_per_unit ?? '',
    'Costo total': r.cost_total ?? '',
    Factura: r.comprobante_numero ? `${r.comprobante_tipo ? `${r.comprobante_tipo} ` : ''}${r.comprobante_numero}` : '',
    Categoría: r.expense_category_name ?? '',
    Estado: r.payment_status === 'a_pagar' ? 'Pendiente' : 'Pagado',
    'Medio de pago': r.payment_method ? MEDIO[r.payment_method] ?? r.payment_method : '',
    'Pagado el': r.paid_at ? r.paid_at.slice(0, 10) : '',
    'Gasto Fudo': r.fudo_expense_id ? `#${r.fudo_expense_id}` : '',
    'Sin insumo': r.stock_items ? '' : 'Sí',
    Nota: r.note ?? '',
  }))

  // Totales por proveedor (lo comprado, lo pagado y lo pendiente)
  const porProveedor = new Map<string, { compras: number; total: number; pendiente: number }>()
  for (const d of data) {
    const p = porProveedor.get(d.Proveedor) ?? { compras: 0, total: 0, pendiente: 0 }
    const monto = Number(d['Costo total']) || 0
    p.compras++
    p.total += monto
    if (d.Estado === 'Pendiente') p.pendiente += monto
    porProveedor.set(d.Proveedor, p)
  }
  const redondo = (n: number) => Math.round(n * 100) / 100
  const resumen = [...porProveedor.entries()].sort((a, b) => b[1].total - a[1].total).map(([Proveedor, p]) => ({
    Proveedor, Compras: p.compras, 'Total comprado': redondo(p.total), Pagado: redondo(p.total - p.pendiente), Pendiente: redondo(p.pendiente),
  }))
  const tot = resumen.reduce((a, r) => ({ c: a.c + r.Compras, t: a.t + r['Total comprado'], p: a.p + r.Pendiente }), { c: 0, t: 0, p: 0 })
  resumen.push({ Proveedor: 'TOTAL', Compras: tot.c, 'Total comprado': redondo(tot.t), Pagado: redondo(tot.t - tot.p), Pendiente: redondo(tot.p) })

  const wsR = XLSX.utils.json_to_sheet(resumen)
  wsR['!cols'] = [{ wch: 28 }, { wch: 9 }, { wch: 15 }, { wch: 14 }, { wch: 14 }]
  const ws = XLSX.utils.json_to_sheet(data)
  // Anchos de columna aprox
  ws['!cols'] = [
    { wch: 12 }, { wch: 22 }, { wch: 28 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 12 },
    { wch: 18 }, { wch: 22 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 11 }, { wch: 10 }, { wch: 30 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsR, 'Por proveedor')
  XLSX.utils.book_append_sheet(wb, ws, 'Compras')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const filename = `compras_${from}_${to}.xlsx`

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
