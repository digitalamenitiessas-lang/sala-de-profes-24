import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// PATCH /api/recipes/pending-links/[id]
// ---------------------------------------------------------------------------
// Resuelve un pending link: aprobar, asignar manualmente o descartar.
//
// Body:
//   action: 'approve' | 'manual' | 'reject'
//
//   Si 'approve':
//     Usa suggested_stock_item_id + cantidad del corpus. Calcula qty_per_portion
//     con la misma lógica de conversión del ingest.
//
//   Si 'manual':
//     stock_item_id  (string, required) — item Fudo/stock a vincular
//     qty_per_portion (number, required) — cantidad por porción
//     unit           (string, required)  — unidad
//
//   Si 'reject':
//     Sin params extra. Marca como rejected.
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!profile || !['socio', 'encargado', 'chef'].includes(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const { id: idParam } = await params
    const id = Number(idParam)
    if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const action: 'approve' | 'manual' | 'reject' = body?.action

    if (!['approve', 'manual', 'reject'].includes(action)) {
      return NextResponse.json({ error: "action debe ser 'approve', 'manual' o 'reject'" }, { status: 400 })
    }

    const admin = createAdminClient()

    // Fetch the pending link
    const { data: link, error: fetchError } = await admin
      .from('recipe_ingredient_pending_links')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !link) {
      return NextResponse.json({ error: 'Pending link no encontrado' }, { status: 404 })
    }

    if (link.status !== 'pending') {
      return NextResponse.json({
        error: `Este link ya fue resuelto (status: ${link.status})`,
        current_status: link.status,
      }, { status: 409 })
    }

    // --- REJECT ---
    if (action === 'reject') {
      const { error } = await admin
        .from('recipe_ingredient_pending_links')
        .update({
          status: 'rejected',
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (error) throw error

      return NextResponse.json({
        success: true,
        action: 'rejected',
        message: `Ingrediente "${link.ingredient_name}" descartado`,
      })
    }

    // --- APPROVE ---
    if (action === 'approve') {
      if (!link.suggested_stock_item_id) {
        return NextResponse.json({
          error: 'No hay stock_item sugerido para aprobar. Usá action: "manual".',
        }, { status: 400 })
      }

      // Get stock item to resolve unit
      const { data: stockItem } = await admin
        .from('stock_items')
        .select('id, name, unit')
        .eq('id', link.suggested_stock_item_id)
        .single()

      if (!stockItem) {
        return NextResponse.json({ error: 'Stock item sugerido ya no existe' }, { status: 404 })
      }

      // Convert quantity using same logic as ingest
      const converted = convertQtyToStockUnit(link.cantidad, link.unidad, stockItem.unit)

      if (converted === null) {
        return NextResponse.json({
          error: `No se puede convertir "${link.unidad}" a "${stockItem.unit}" automáticamente. Usá action: "manual" con qty_per_portion y unit.`,
        }, { status: 400 })
      }

      // Insert into recipe_ingredients
      if (link.recipe_id) {
        const { error: insertError } = await admin
          .from('recipe_ingredients')
          .upsert({
            recipe_id: link.recipe_id,
            stock_item_id: link.suggested_stock_item_id,
            qty_per_portion: converted.qty,
            ingredient_unit: converted.unit,
            notes: converted.converted
              ? `Aprobado desde pending_links. Convertido: ${link.cantidad}${link.unidad} → ${converted.qty}${converted.unit}`
              : `Aprobado desde pending_links`,
          }, { onConflict: 'recipe_id,stock_item_id' })

        if (insertError) throw insertError
      }

      // Update link status
      const { error: updateError } = await admin
        .from('recipe_ingredient_pending_links')
        .update({
          status: 'approved',
          resolved_stock_item_id: link.suggested_stock_item_id,
          resolved_qty_per_portion: converted.qty,
          resolved_unit: converted.unit,
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (updateError) throw updateError

      return NextResponse.json({
        success: true,
        action: 'approved',
        message: `"${link.ingredient_name}" → "${stockItem.name}" (${converted.qty} ${converted.unit}/porción)`,
        recipe_ingredient: {
          recipe_id: link.recipe_id,
          stock_item_id: link.suggested_stock_item_id,
          stock_item_name: stockItem.name,
          qty_per_portion: converted.qty,
          unit: converted.unit,
        },
      })
    }

    // --- MANUAL ---
    if (action === 'manual') {
      const stockItemId = body?.stock_item_id != null ? String(body.stock_item_id).trim() : ''
      const qtyPerPortion: number = body?.qty_per_portion != null ? Number(body.qty_per_portion) : 0
      const unit: string = body?.unit

      if (!stockItemId || !Number.isFinite(qtyPerPortion) || qtyPerPortion <= 0 || !unit) {
        return NextResponse.json({
          error: 'Manual requiere: stock_item_id, qty_per_portion positivo y unit',
        }, { status: 400 })
      }

      // Validate stock item exists
      const { data: stockItem } = await admin
        .from('stock_items')
        .select('id, name')
        .eq('id', stockItemId)
        .single()

      if (!stockItem) {
        return NextResponse.json({ error: 'stock_item_id no encontrado' }, { status: 404 })
      }

      // Insert into recipe_ingredients
      if (link.recipe_id) {
        const { error: insertError } = await admin
          .from('recipe_ingredients')
          .upsert({
            recipe_id: link.recipe_id,
            stock_item_id: stockItemId,
            qty_per_portion: qtyPerPortion,
            ingredient_unit: unit,
            notes: `Asignado manualmente desde pending_links (id: ${id})`,
          }, { onConflict: 'recipe_id,stock_item_id' })

        if (insertError) throw insertError
      }

      // Update link status
      const { error: updateError } = await admin
        .from('recipe_ingredient_pending_links')
        .update({
          status: 'manual',
          resolved_stock_item_id: stockItemId,
          resolved_qty_per_portion: qtyPerPortion,
          resolved_unit: unit,
          resolved_by: user.id,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', id)

      if (updateError) throw updateError

      return NextResponse.json({
        success: true,
        action: 'manual',
        message: `"${link.ingredient_name}" → "${stockItem.name}" (${qtyPerPortion} ${unit}/porción)`,
        recipe_ingredient: {
          recipe_id: link.recipe_id,
          stock_item_id: stockItemId,
          stock_item_name: stockItem.name,
          qty_per_portion: qtyPerPortion,
          unit,
        },
      })
    }

    return NextResponse.json({ error: 'Acción no reconocida' }, { status: 400 })
  } catch (error) {
    console.error('[PATCH /api/recipes/pending-links/[id]]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Unit conversion helper (mirror of ingest/route.ts)
// ---------------------------------------------------------------------------

function convertQtyToStockUnit(
  corpusQty: number | null,
  corpusUnit: string | null,
  stockUnit: string,
): { qty: number; unit: string; converted: boolean } | null {
  if (corpusQty === null || corpusUnit === null) return null

  const cu = corpusUnit.toLowerCase().trim()
  const su = stockUnit.toLowerCase().trim()

  if (cu === su) return { qty: corpusQty, unit: su, converted: false }
  if ((cu === 'gr' || cu === 'g') && (su === 'kg' || su === 'kilo' || su === 'kilogramo')) {
    return { qty: corpusQty / 1000, unit: su, converted: true }
  }
  if (cu === 'kg' && (su === 'gr' || su === 'g')) {
    return { qty: corpusQty * 1000, unit: su, converted: true }
  }
  if (cu === 'ml' && (su === 'lt' || su === 'l' || su === 'litro' || su === 'litros')) {
    return { qty: corpusQty / 1000, unit: su, converted: true }
  }
  if ((cu === 'lt' || cu === 'l' || cu === 'litro' || cu === 'litros') && su === 'ml') {
    return { qty: corpusQty * 1000, unit: su, converted: true }
  }
  if ((cu === 'gr' || cu === 'g') && (su === 'gr' || su === 'g')) {
    return { qty: corpusQty, unit: su, converted: false }
  }
  if ((cu === 'lt' || cu === 'l' || cu === 'litro') && (su === 'lt' || su === 'l' || su === 'litro')) {
    return { qty: corpusQty, unit: su, converted: false }
  }
  if (cu === 'unidad' || cu === 'unidades' || cu === 'u') {
    return { qty: corpusQty, unit: 'unidad', converted: false }
  }
  if (cu === 'feta' || cu === 'fetas') {
    return { qty: corpusQty, unit: 'unidad', converted: false }
  }
  return null
}
