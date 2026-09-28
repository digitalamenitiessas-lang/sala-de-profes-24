'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StockMovementResult = {
  movement_id: number
  stock_item_id: number | string
  change: number
  new_qty: number
  reason: string
}

type ProduceRecipeRpcResult = {
  success: boolean
  recipe_id?: number
  recipe_name?: string
  portions?: number
  ingredients_affected?: number
  movements?: Array<{
    stock_item_id: number
    stock_item_name: string
    qty_deducted: number
    previous_qty: number
    new_qty: number
  }>
  error?: string
}

// ---------------------------------------------------------------------------
// produceRecipe — Usa la RPC `produce_recipe` (transaccional en la DB)
// ---------------------------------------------------------------------------
// Descuenta insumos del stock según una receta y cantidad de porciones.
// Toda la lógica corre dentro de una función PL/pgSQL (transacción atómica).
//
// Uso típico: al confirmar la cocina diaria, se llama por cada receta usada.
// ---------------------------------------------------------------------------

export async function produceRecipe(
  recipeId: number,
  portions: number,
  referenceId?: string,
): Promise<ProduceRecipeRpcResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { fudo } = await import('@/lib/fudoClient')
  const fudoConnection = await fudo.testConnection()
  if (!fudoConnection.ok) {
    return { success: false, error: `Fudo no está disponible: ${fudoConnection.error}` }
  }

  const { data, error } = await supabase.rpc('produce_recipe', {
    p_recipe_id: recipeId,
    p_portions: portions,
    p_reference_id: referenceId ?? null,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  const result = data as ProduceRecipeRpcResult
  if (!result.success) return result

  const movements = (result.movements ?? []).map((movement) => ({
    stock_item_id: movement.stock_item_id,
    change: -movement.qty_deducted,
  }))

  if (movements.length > 0) {
    const admin = createAdminClient()
    try {
      const { syncFromFudo, syncProductionToFudo } = await import('@/lib/fudo/stock-sync')
      const fudoResult = await syncProductionToFudo(admin, movements, user?.id)
      if (fudoResult.errors.length > 0) {
        await syncFromFudo(admin).catch(() => null)
        return {
          success: false,
          error: `Receta producida en LVE, pero Fudo no confirmó stock: ${fudoResult.errors.join('; ')}. LVE se re-sincronizó desde Fudo cuando fue posible.`,
        }
      }
    } catch (err) {
      const { syncFromFudo } = await import('@/lib/fudo/stock-sync')
      await syncFromFudo(admin).catch(() => null)
      return {
        success: false,
        error: `Receta producida en LVE, pero falló la sincronización con Fudo: ${err instanceof Error ? err.message : 'error desconocido'}. LVE se re-sincronizó desde Fudo cuando fue posible.`,
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// adjustStock — ajuste manual de stock (recepción, desperdicio, corrección)
// ---------------------------------------------------------------------------

export async function adjustStock(
  stockItemId: number | string,
  change: number,
  reason: 'received' | 'waste' | 'expired' | 'manual_adjustment',
): Promise<{ success: boolean; data?: StockMovementResult; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }

  const { data: item, error: itemError } = await supabase
    .from('stock_items')
    .select('id, current_qty')
    .eq('id', stockItemId)
    .single()

  if (itemError || !item) {
    return { success: false, error: itemError?.message ?? 'Item no encontrado' }
  }

  const newQty = Math.round((Number(item.current_qty ?? 0) + change) * 100) / 100
  if (newQty < 0) {
    return { success: false, error: 'No se permiten cantidades negativas' }
  }

  const { fudo } = await import('@/lib/fudoClient')
  const fudoConnection = await fudo.testConnection()
  if (!fudoConnection.ok) {
    return { success: false, error: `Fudo no está disponible: ${fudoConnection.error}` }
  }

  const admin = createAdminClient()
  const { syncToFudo } = await import('@/lib/fudo/stock-sync')
  const syncResult = await syncToFudo(admin, String(stockItemId), newQty, user.id)

  if (!syncResult.success) {
    return { success: false, error: syncResult.error ?? 'Fudo no confirmó la actualización' }
  }

  await admin.from('audit_trail').insert({
    user_id: user.id,
    action: 'stock_adjustment_synced',
    module: 'stock',
    entity_type: 'stock_item',
    entity_id: String(stockItemId),
    description: `Ajuste de stock ${reason}: cambio ${change}, nuevo stock ${newQty}`,
    metadata: { reason, change, new_qty: newQty, fudo_synced: syncResult.fudoSynced },
  })

  return {
    success: true,
    data: {
      movement_id: 0,
      stock_item_id: stockItemId,
      change,
      new_qty: newQty,
      reason,
    },
  }
}

// ---------------------------------------------------------------------------
// deductStockOnSale — aplica deducción de stock por una venta de Fudo
// ---------------------------------------------------------------------------
// Normalmente el trigger lo hace automáticamente.
// Esta función es para re-procesar o testing.
// ---------------------------------------------------------------------------

export async function deductStockOnSale(
  saleId: number,
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('deduct_stock_on_sale', {
    p_sale_id: saleId,
  })

  if (error) {
    return { success: false, error: error.message }
  }

  return { success: true, data: data as Record<string, unknown> }
}
