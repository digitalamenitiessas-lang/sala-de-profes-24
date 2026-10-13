import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'

// ---------------------------------------------------------------------------
// GET /api/stock/receipts/export?from=YYYY-MM-DD&to=YYYY-MM-DD
// Excel de recepciones de mercadería. Solo encargados y socios.
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

  const admin = createAdminClient()
  const { data: rows, error } = await admin
    .from('stock_receipts')
    .select(`
      id, received_date, qty, unit, cost_per_unit, cost_total,
      payment_status, payment_method, paid_at, note,
      stock_items!inner(name),
      suppliers(name)
    `)
    .gte('received_date', from)
    .lte('received_date', to)
    .order('received_date', { ascending: true })
    .order('id', { ascending: true })

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
    stock_items: { name: string } | null
    suppliers: { name: string } | null
  }

  const data = (rows as Row[]).map((r) => ({
    Fecha: r.received_date,
    Proveedor: r.suppliers?.name ?? '',
    Insumo: r.stock_items?.name ?? '',
    Cantidad: r.qty,
    Unidad: r.unit ?? '',
    'Costo unitario': r.cost_per_unit ?? '',
    'Costo total': r.cost_total ?? '',
    Estado: r.payment_status === 'a_pagar' ? 'Pendiente' : 'Pagado',
    'Medio de pago': r.payment_method ?? '',
    'Pagado el': r.paid_at ? r.paid_at.slice(0, 10) : '',
    Nota: r.note ?? '',
  }))

  const ws = XLSX.utils.json_to_sheet(data)
  // Anchos de columna aprox
  ws['!cols'] = [
    { wch: 12 }, { wch: 22 }, { wch: 28 }, { wch: 10 }, { wch: 8 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 30 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Recepciones')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  const filename = `recepciones_${from}_${to}.xlsx`

  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
