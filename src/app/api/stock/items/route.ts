import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStockItems } from '@/lib/queries/stock'
import { canCountStock, isManagerOrAbove } from '@/lib/roles'
import { isStockArea } from '@/lib/stock/areas'
import { logAudit } from '@/lib/audit'
import { buscarMismoEnFudo } from '@/lib/fudo/create-from-fudo'

// ---------------------------------------------------------------------------
// GET /api/stock/items
// Returns all active stock items. Used by production wizard, search inputs,
// the guided count and other client components.
//
// Query params:
//   preset — 'minimal' | 'summary' | 'full' | 'withSupplier' | 'conteo' (default: summary)
//   'conteo' = campos del conteo guiado (área, último conteo, vínculo Fudo,
//   costo); tolera que la migración de áreas no esté aplicada.
// ---------------------------------------------------------------------------

const CONTEO_BASE = 'id, name, unit, current_qty, min_qty, category, is_produced, fudo_ingredient_id, fudo_product_id, fudo_skip, last_counted_at, cost_per_unit, updated_at'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    // Mismos roles que cuentan stock: la lista aparte dejaba al runner sin poder cargar el conteo
    if (!profile || !canCountStock(profile.role)) {
      return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
    }

    const preset = (request.nextUrl.searchParams.get('preset') ?? 'summary') as
      'minimal' | 'summary' | 'full' | 'withSupplier' | 'conteo'

    if (preset === 'conteo') {
      const admin = createAdminClient()
      let res: { data: unknown[] | null; error: { message: string } | null } = await admin
        .from('stock_items')
        .select(`${CONTEO_BASE}, area, fudo_category`)
        .eq('is_active', true)
        .order('name')
      if (res.error && /area|fudo_category/i.test(res.error.message)) {
        res = await admin.from('stock_items').select(CONTEO_BASE).eq('is_active', true).order('name')
      }
      if (res.error) throw res.error
      return NextResponse.json({ items: res.data ?? [] })
    }

    const { data: items, error } = await getStockItems(preset)
    if (error) throw error

    return NextResponse.json({ items: items ?? [] })
  } catch (err) {
    console.error('[GET /api/stock/items]', err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/stock/items — alta de un producto que NO está en Fudo
// ---------------------------------------------------------------------------
// Descartables, limpieza y otros que solo existen en Sala de Profes (vasos,
// tapas, servilletas…). Queda local (fudo_skip): no se escribe en Fudo. Lo
// que se usa en recetas se da de alta en Fudo y llega solo con el sync. Si
// ya hay un insumo/producto de Fudo con ese nombre, se vincula a ese.
// Encargados y socios. Rechaza un nombre igual a otro activo.
// Body: { name, unit, area, min_qty?, current_qty? }
// ---------------------------------------------------------------------------

const UNIDADES = ['unidad', 'paquete', 'caja', 'kg', 'g', 'l', 'ml']
const CATEGORIA_DE_AREA: Record<string, string> = { descartables: 'desechables', limpieza: 'limpieza', barra: 'bebidas' }

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const admin = createAdminClient()
    const { data: perfil } = await admin.from('profiles').select('role, first_name, last_name').eq('id', user.id).single()
    if (!perfil || !isManagerOrAbove(perfil.role)) {
      return NextResponse.json({ error: 'Solo encargados y socios pueden agregar productos' }, { status: 403 })
    }

    const body = await request.json().catch(() => null) as { name?: unknown; unit?: unknown; area?: unknown; min_qty?: unknown; current_qty?: unknown } | null
    const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
    const unit = typeof body?.unit === 'string' ? body.unit : ''
    const area = body?.area
    const num = (v: unknown) => (v == null || v === '' ? 0 : Number(String(v).replace(',', '.')))
    const minQty = num(body?.min_qty)
    const currentQty = num(body?.current_qty)
    if (name.length < 2 || name.length > 80) return NextResponse.json({ error: 'Poné un nombre (entre 2 y 80 letras)' }, { status: 400 })
    if (!UNIDADES.includes(unit)) return NextResponse.json({ error: 'Elegí la unidad' }, { status: 400 })
    if (!isStockArea(area) || area === 'otros') return NextResponse.json({ error: 'Elegí el área' }, { status: 400 })
    if (![minQty, currentQty].every((n) => Number.isFinite(n) && n >= 0 && n < 1_000_000)) {
      return NextResponse.json({ error: 'Las cantidades tienen que ser números de 0 en adelante' }, { status: 400 })
    }

    // Mismo nombre que otro producto activo → no duplicar
    const { data: iguales } = await admin.from('stock_items').select('id, name').eq('is_active', true).ilike('name', name).limit(1)
    if (iguales && iguales.length > 0) {
      return NextResponse.json({ error: `Ya existe "${iguales[0].name}"`, existente: iguales[0] }, { status: 409 })
    }

    // ¿Está en Fudo? Entonces se vincula a ese en vez de quedar local: así
    // entra en el detalle del gasto y en el stock de Fudo. Si Fudo no
    // responde, se crea local como siempre.
    const enFudo = await buscarMismoEnFudo(name).catch(() => null)
    const colFudo = enFudo ? (enFudo.tipo === 'ingrediente' ? 'fudo_ingredient_id' : 'fudo_product_id') : null
    if (enFudo && colFudo) {
      const { data: vinculado } = await admin.from('stock_items').select('id, name, is_active').eq(colFudo, enFudo.id).limit(1).maybeSingle()
      if (vinculado?.is_active) {
        return NextResponse.json({ error: `Ya existe "${vinculado.name}" (es «${enFudo.name}» de Fudo)`, existente: vinculado }, { status: 409 })
      }
      if (vinculado) {
        // Dado de baja: se reactiva el que ya estaba vinculado
        const { data: item, error } = await admin.from('stock_items')
          .update({ is_active: true, area, area_locked: true, updated_at: new Date().toISOString() })
          .eq('id', vinculado.id).select('id, name, unit, area, current_qty, min_qty, fudo_skip').single()
        if (error) throw error
        return NextResponse.json({ success: true, item, vinculadoAFudo: enFudo.name })
      }
    }
    const qtyInicial = enFudo?.stock != null ? Math.round(enFudo.stock * 100) / 100 : currentQty

    const { data: creado, error } = await admin.from('stock_items').insert({
      name: enFudo?.name ?? name,
      unit: enFudo?.unit ?? unit,
      category: CATEGORIA_DE_AREA[area] ?? 'otros',
      area,
      area_locked: true,
      fudo_skip: !enFudo,
      ...(enFudo && colFudo ? { [colFudo]: enFudo.id } : {}),
      is_active: true,
      min_qty: minQty,
      current_qty: qtyInicial,
      last_counted_at: qtyInicial > 0 ? new Date().toISOString() : null,
    }).select('id, name, unit, area, current_qty, min_qty, fudo_skip').single()
    if (error) throw error

    const quien = [perfil.first_name, perfil.last_name].filter(Boolean).join(' ') || null
    await admin.from('stock_logs').insert({
      stock_item_id: creado.id, user_id: user.id, action: 'manual_adjustment', old_qty: 0, new_qty: qtyInicial,
      note: `Alta de producto (${enFudo ? `vinculado a «${enFudo.name}» de Fudo` : 'no está en Fudo'})${quien ? ` por ${quien}` : ''}`,
    })
    void logAudit(admin, {
      userId: user.id, userName: quien, action: 'stock_item_created', module: 'stock', entityType: 'stock_item', entityId: creado.id,
      description: `${quien ?? 'Alguien'} agregó el producto "${creado.name}" (${creado.unit}, ${area}) con ${qtyInicial} ${creado.unit}${enFudo ? ` · vinculado a Fudo (${enFudo.tipo} #${enFudo.id})` : ''}`,
      metadata: { name, unit, area, min_qty: minQty, current_qty: qtyInicial, ...(enFudo ? { fudo: enFudo } : {}) },
    })
    return NextResponse.json({ success: true, item: creado, ...(enFudo ? { vinculadoAFudo: enFudo.name } : {}) })
  } catch (err) {
    console.error('[POST /api/stock/items]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
