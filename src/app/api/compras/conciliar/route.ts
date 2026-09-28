import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { matchOrdersWithExpenses, loadLinkedExpenseIds } from '@/lib/compras/conciliar'
import { fetchFudoExpenses } from '@/lib/fudo/expenses'

// ---------------------------------------------------------------------------
// GET /api/compras/conciliar
//   Para cada pedido "en camino", el gasto de Fudo que mejor lo explica (mismo
//   proveedor, fecha posterior al envío, insumo incluido). Además devuelve los
//   últimos gastos de Fudo por proveedor para elegir a mano.
//   ?fresh=1 → saltea el cache de 30 min de gastos (botón "Actualizar gastos").
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRole(['socio', 'encargado'])
    if (auth.response) return auth.response

    const admin = createAdminClient()
    const days = Math.min(60, Math.max(7, Number(request.nextUrl.searchParams.get('days') ?? 21) || 21))
    const fresh = request.nextUrl.searchParams.get('fresh') === '1'
    const { matches, orders, expenses_considered } = await matchOrdersWithExpenses(admin, { sinceDays: days, forceExpenses: fresh })

    // Gastos recientes (para conciliar a mano): sólo los de proveedores con
    // pedidos en camino, y SIN los ya vinculados a otro pedido (si no, el
    // mismo gasto de Fudo aparecía para vincular dos veces).
    const supplierIds = [...new Set(orders.map((o) => o.supplier_id).filter((x): x is string => Boolean(x)))]
    const [{ data: suppliers }, linkedIds] = await Promise.all([
      supplierIds.length
        ? admin.from('suppliers').select('id, name, fudo_provider_id').in('id', supplierIds)
        : Promise.resolve({ data: [] as { id: string; name: string; fudo_provider_id: string | null }[] }),
      loadLinkedExpenseIds(admin),
    ])
    const providerIds = new Set((suppliers ?? []).map((s) => s.fudo_provider_id).filter(Boolean))
    const sinceISO = new Date(Date.now() - days * 86_400_000).toISOString()
    // matchOrdersWithExpenses ya refrescó el cache si fresh=1 (salvo sin
    // pedidos en camino, caso en el que providerIds queda vacío igual).
    const expenses = (await fetchFudoExpenses(sinceISO))
      .filter((e) => e.providerId && providerIds.has(e.providerId) && !linkedIds.has(e.id))
      .slice(0, 80)

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      days,
      expenses_considered,
      matches: matches.map((m) => ({
        order_id: m.order_id,
        source: m.source,
        strength: m.strength,
        why: m.why,
        expense: {
          id: m.expense.id,
          provider: m.expense.provider,
          providerId: m.expense.providerId,
          date: m.expense.date,
          amount: m.expense.amount,
          // ids de insumos del gasto: el diálogo solo sugiere precio unitario
          // con gastos MONO-insumo (length === 1)
          ingredientIds: m.expense.ingredientIds,
          ingredientNames: m.expense.ingredientNames,
        },
      })),
      expenses: expenses.map((e) => ({
        id: e.id,
        provider: e.provider,
        providerId: e.providerId,
        date: e.date,
        amount: e.amount,
        ingredientIds: e.ingredientIds,
        ingredientNames: e.ingredientNames,
      })),
    })
  } catch (err) {
    console.error('[GET /api/compras/conciliar]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
