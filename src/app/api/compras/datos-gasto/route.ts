import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { fetchFudoExpenseCategories } from '@/lib/fudo/expenses'
import type { CategoriaGasto } from '@/lib/compras/datos-gasto'

// ---------------------------------------------------------------------------
// GET /api/compras/datos-gasto?supplier_id=…
// Para "Llegó" / "Llegó todo": las categorías de gasto de Fudo y la última
// categoría y comprobante que se usaron con ese proveedor (se preseleccionan).
// Si Fudo no responde, categorias viene vacío y el diálogo no la exige.
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireRole(['socio', 'encargado'])
  if (auth.response) return auth.response

  let categorias: CategoriaGasto[] = []
  let error: string | null = null
  try {
    categorias = await fetchFudoExpenseCategories()
  } catch (err) {
    error = err instanceof Error ? err.message : 'Fudo no respondió'
    console.warn('[datos-gasto] categorías de Fudo:', error)
  }

  let ultima: { categoriaId: string | null; comprobante: string | null } | null = null
  const supplierId = new URL(request.url).searchParams.get('supplier_id')
  if (supplierId && /^[0-9a-f-]{36}$/i.test(supplierId)) {
    // Columnas de la migración 20261005: si no existen todavía, no hay "última"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (createAdminClient().from('stock_receipts') as any)
      .select('expense_category_id, comprobante_tipo')
      .eq('supplier_id', supplierId)
      .not('expense_category_id', 'is', null)
      .order('id', { ascending: false })
      .limit(1)
    const r = (data ?? [])[0] as { expense_category_id: string | null; comprobante_tipo: string | null } | undefined
    if (r && categorias.some((c) => c.id === r.expense_category_id)) {
      ultima = { categoriaId: r.expense_category_id, comprobante: r.comprobante_tipo }
    }
  }

  return NextResponse.json({ categorias, ultima, error })
}
