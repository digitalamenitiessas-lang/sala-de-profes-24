import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagerOrAbove } from '@/lib/roles'
import { STOCK_CATEGORY_OPTIONS } from '@/lib/constants'
import { STOCK_UNITS } from '@/lib/constants'
import type { StockCategoryValue } from '@/types/database'
import { isStockArea } from '@/lib/stock/areas'
import { convertQty } from '@/lib/produccion/units'
import { esErrorColumnaFaltante } from '@/lib/costos/confiable'

const VALID_CATEGORIES = new Set(
  STOCK_CATEGORY_OPTIONS.map((option) => option.value),
)

const VALID_UNITS = new Set(STOCK_UNITS.map((u) => u.value))

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!isManagerOrAbove(profile?.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const admin = createAdminClient()

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if ('shelf_life_days' in body) {
      const value = body.shelf_life_days
      if (value == null || value === '') {
        update.shelf_life_days = null
      } else if (!Number.isInteger(value) || value < 1 || value > 365) {
        return NextResponse.json(
          { error: 'shelf_life_days debe ser un entero entre 1 y 365' },
          { status: 400 },
        )
      } else {
        update.shelf_life_days = value
      }
    }

    if ('notes' in body) {
      if (body.notes == null || body.notes === '') {
        update.notes = null
      } else if (typeof body.notes !== 'string') {
        return NextResponse.json({ error: 'notes debe ser texto' }, { status: 400 })
      } else {
        update.notes = body.notes.trim() || null
      }
    }

    if ('category' in body) {
      if (body.category == null || body.category === '') {
        return NextResponse.json({ error: 'category no puede ser vacío' }, { status: 400 })
      }
      if (!VALID_CATEGORIES.has(body.category)) {
        return NextResponse.json({ error: 'category inválida' }, { status: 400 })
      }
      update.category = body.category as StockCategoryValue
    }

    if ('unit' in body) {
      if (!body.unit || typeof body.unit !== 'string' || !VALID_UNITS.has(body.unit)) {
        return NextResponse.json({ error: 'Unidad inválida' }, { status: 400 })
      }
      update.unit = body.unit
    }

    if ('min_qty' in body) {
      const value = body.min_qty == null || body.min_qty === '' ? 0 : Number(body.min_qty)
      if (!Number.isFinite(value) || value < 0 || value > 999999) {
        return NextResponse.json(
          { error: 'min_qty debe ser un número mayor o igual a 0' },
          { status: 400 },
        )
      }
      update.min_qty = value
    }

    if ('purchase_lead_time_days' in body) {
      const value = body.purchase_lead_time_days
      if (value == null || value === '') {
        update.purchase_lead_time_days = null
      } else if (!Number.isInteger(value) || value < 0 || value > 60) {
        return NextResponse.json(
          { error: 'purchase_lead_time_days debe ser un entero entre 0 y 60' },
          { status: 400 },
        )
      } else {
        update.purchase_lead_time_days = value
      }
    }

    if ('supplier_id' in body) {
      const value = body.supplier_id
      if (value == null || value === '') {
        update.supplier_id = null
      } else {
        const supplierId = String(value)

        const { data: supplier, error: supplierError } = await admin
          .from('suppliers')
          .select('id')
          .eq('id', supplierId)
          .eq('is_active', true)
          .maybeSingle()

        if (supplierError) throw supplierError
        if (!supplier) {
          return NextResponse.json({ error: 'Proveedor no encontrado o inactivo' }, { status: 400 })
        }

        update.supplier_id = supplierId
      }
    }

    // Área operativa fijada a mano → el sync de Fudo no la pisa (area_locked)
    let areaUpdate: Record<string, unknown> | null = null
    if ('area' in body) {
      if (!isStockArea(body.area)) {
        return NextResponse.json({ error: 'Área inválida' }, { status: 400 })
      }
      areaUpdate = { area: body.area, area_locked: true }
    }

    // Costo real cargado a mano (manager) → fuente CONFIABLE 'manual'.
    // Con cambio de unidad en el mismo PATCH:
    //  - masa↔masa o vol↔vol → el costo existente se reexpresa ($/kg → $/g ÷1000)
    //  - incompatible (kg → unidad) → el costo pierde sentido: se borra
    let costUpdate: Record<string, unknown> | null = null
    let aviso: string | null = null
    if ('cost_per_unit' in body) {
      const raw = body.cost_per_unit
      if (raw == null || raw === '') {
        // Borrar el costo a mano también es una decisión: queda "sin dato"
        costUpdate = { cost_per_unit: null, cost_source: null, cost_updated_at: new Date().toISOString() }
      } else {
        const value = Number(raw)
        if (!Number.isFinite(value) || value <= 0 || value > 99999999) {
          return NextResponse.json(
            { error: 'cost_per_unit debe ser un número mayor a 0' },
            { status: 400 },
          )
        }
        costUpdate = {
          cost_per_unit: Math.round(value * 100) / 100,
          cost_source: 'manual',
          cost_updated_at: new Date().toISOString(),
        }
      }
    }

    // Cambio de unidad SIN costo nuevo en el mismo PATCH: reexpresar (o borrar)
    // el costo guardado para que no quede un número en la unidad vieja.
    if ('unit' in body && !costUpdate) {
      const { data: current } = await admin
        .from('stock_items')
        .select('unit, cost_per_unit')
        .eq('id', id)
        .maybeSingle()
      const oldUnit = current?.unit
      const oldCost = Number(current?.cost_per_unit ?? 0)
      if (oldUnit && oldUnit !== body.unit && oldCost > 0) {
        // $/unidad vieja → $/unidad nueva: factor = cuántas unidades viejas es 1 nueva
        const factor = convertQty(1, body.unit as string, oldUnit)
        if (factor != null) {
          costUpdate = { cost_per_unit: Math.round(oldCost * factor * 10000) / 10000 }
        } else {
          costUpdate = { cost_per_unit: null, cost_source: null }
          aviso = `El costo guardado estaba en $/${oldUnit} y "${body.unit}" no es convertible: quedó sin costo real. Cargalo de nuevo si lo tenés.`
        }
      }
    }

    if (Object.keys(update).length === 1 && !areaUpdate && !costUpdate) {
      return NextResponse.json({ error: 'No hay cambios para guardar' }, { status: 400 })
    }

    let { data, error } = await admin
      .from('stock_items')
      .update({ ...update, ...(areaUpdate ?? {}), ...(costUpdate ?? {}) })
      .eq('id', id)
      .select('id, name, unit, category, min_qty, supplier_id, purchase_lead_time_days, shelf_life_days, notes')
      .single()

    // Migración de cost_source pendiente: reintentar sin las columnas nuevas
    if (error && costUpdate && esErrorColumnaFaltante(error.message, ['cost_source', 'cost_updated_at'])) {
      const legacyCost: Record<string, unknown> = { cost_per_unit: costUpdate.cost_per_unit ?? null }
      ;({ data, error } = await admin
        .from('stock_items')
        .update({ ...update, ...(areaUpdate ?? {}), ...legacyCost })
        .eq('id', id)
        .select('id, name, unit, category, min_qty, supplier_id, purchase_lead_time_days, shelf_life_days, notes')
        .single())
    }

    // Migración de áreas pendiente: guardar el resto igual
    if (error && areaUpdate && /area/i.test(error.message)) {
      ({ data, error } = await admin
        .from('stock_items')
        .update({ ...update, ...(costUpdate ?? {}) })
        .eq('id', id)
        .select('id, name, unit, category, min_qty, supplier_id, purchase_lead_time_days, shelf_life_days, notes')
        .single())
    }

    // LAS DOS migraciones pendientes (áreas 20260906 + costo 20260909): los
    // reintentos de arriba sacan un grupo pero reponen el otro. Último intento
    // sin ninguna de las columnas nuevas (solo cost_per_unit, que es legacy).
    if (
      error && areaUpdate && costUpdate
      && (esErrorColumnaFaltante(error.message, ['cost_source', 'cost_updated_at']) || /area/i.test(error.message))
    ) {
      const legacyCost: Record<string, unknown> = 'cost_per_unit' in costUpdate
        ? { cost_per_unit: costUpdate.cost_per_unit ?? null }
        : {}
      ;({ data, error } = await admin
        .from('stock_items')
        .update({ ...update, ...legacyCost })
        .eq('id', id)
        .select('id, name, unit, category, min_qty, supplier_id, purchase_lead_time_days, shelf_life_days, notes')
        .single())
    }

    if (error) throw error

    const { logAudit } = await import('@/lib/audit')
    logAudit(admin, {
      userId: user.id,
      userName: null,
      action: 'update_stock_item_settings',
      module: 'stock',
      entityType: 'stock_item',
      entityId: id,
      description: `${data?.name ?? id}: configuración actualizada (${Object.keys({ ...update, ...(areaUpdate ?? {}), ...(costUpdate ?? {}) }).filter((k) => k !== 'updated_at' && k !== 'cost_updated_at').join(', ')})`,
      metadata: { ...update, ...(areaUpdate ?? {}), ...(costUpdate ?? {}) },
    }).catch(() => {})

    return NextResponse.json({ success: true, item: data, ...(aviso ? { aviso } : {}) })
  } catch (error) {
    console.error('[PATCH /api/stock/items/[id]]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error interno' },
      { status: 500 },
    )
  }
}
