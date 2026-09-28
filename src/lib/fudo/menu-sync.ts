import type { SupabaseClient } from '@supabase/supabase-js'
import { fudo } from '@/lib/fudoClient'

// ---------------------------------------------------------------------------
// Menú desde Fudo: categorías y productos → menu_categories / menu_items
// ---------------------------------------------------------------------------
// Fudo manda en nombre, precio, categoría y si está activo. La app conserva
// receta, costo interno y cómo descuenta stock. Solo se escribe lo que cambió.
// Lo usan el botón de /admin/fudo y el pulso diario (precios al día solos).
// ---------------------------------------------------------------------------

export type MenuSyncResult = { importedCategories: number; importedProducts: number; cambiados: number; nuevos: number; borradosEnFudo: string[]; platosVinculados: unknown }

const igual = (a: unknown, b: unknown) => (a == null && b == null) || String(a) === String(b)

export async function sincronizarMenu(supabase: SupabaseClient): Promise<MenuSyncResult> {
  const [fudoCategories, fudoProducts] = await Promise.all([fudo.getCategories(), fudo.getProducts()])

  // Categorías
  let importedCategories = 0
  if (fudoCategories.length > 0) {
    const { data: existingCats } = await supabase.from('menu_categories').select('id, fudo_category_id, name, sort_order')
    const existing = new Map((existingCats ?? []).filter((c) => c.fudo_category_id).map((c) => [String(c.fudo_category_id), c]))
    for (const [idx, cat] of fudoCategories.entries()) {
      const ex = existing.get(String(cat.id))
      if (ex) {
        if (!igual(ex.name, cat.name) || !igual(ex.sort_order, idx)) {
          await supabase.from('menu_categories').update({ name: cat.name, sort_order: idx }).eq('id', ex.id)
        }
      } else {
        await supabase.from('menu_categories').insert({ name: cat.name, fudo_category_id: cat.id, sort_order: idx })
      }
      importedCategories++
    }
  }

  const { data: allCategories } = await supabase.from('menu_categories').select('id, fudo_category_id')
  const catIdMap = new Map((allCategories ?? []).filter((c) => c.fudo_category_id).map((c) => [String(c.fudo_category_id), c.id]))

  // Productos
  let importedProducts = 0
  let cambiados = 0
  let nuevos = 0
  if (fudoProducts.length > 0) {
    const { data: existingItems } = await supabase.from('menu_items')
      .select('id, fudo_product_id, name, sale_price, menu_category_id, is_active, cost_price, fudo_code')
    type Ex = { id: string; fudo_product_id: string | null; name: string; sale_price: number | null; menu_category_id: string | null; is_active: boolean; cost_price: number | null; fudo_code: string | null }
    const existing = new Map(((existingItems ?? []) as Ex[]).filter((m) => m.fudo_product_id).map((m) => [String(m.fudo_product_id), m]))

    for (const product of fudoProducts) {
      const catRel = product._relationships?.productCategory?.data as { id: string } | null
      const menuCategoryId = catRel?.id ? catIdMap.get(String(catRel.id)) ?? null : null
      const ex = existing.get(String(product.id))

      if (ex) {
        const updateData: Record<string, unknown> = {}
        if (!igual(ex.name, product.name)) updateData.name = product.name
        if (!igual(ex.sale_price, product.price)) updateData.sale_price = product.price
        if (!igual(ex.menu_category_id, menuCategoryId)) updateData.menu_category_id = menuCategoryId
        if (ex.is_active !== (product.active ?? true)) updateData.is_active = product.active ?? true
        if (product.cost != null && !igual(ex.cost_price, product.cost)) updateData.cost_price = product.cost
        if (product.code != null && !igual(ex.fudo_code, product.code)) updateData.fudo_code = product.code
        if (Object.keys(updateData).length > 0) {
          const { error } = await supabase.from('menu_items').update(updateData).eq('id', ex.id)
          if (error) console.error(`Update failed for ${product.name}:`, error.message)
          else cambiados++
        }
        importedProducts++
      } else {
        const row: Record<string, unknown> = {
          name: product.name,
          fudo_product_id: product.id,
          sale_price: product.price,
          category: 'otros',
          menu_category_id: menuCategoryId,
          is_active: product.active ?? true,
        }
        if (product.cost != null) row.cost_price = product.cost
        if (product.code != null) row.fudo_code = product.code
        const { error } = await supabase.from('menu_items').insert(row)
        if (error) {
          delete row.cost_price
          delete row.fudo_code
          const { error: err2 } = await supabase.from('menu_items').insert(row)
          if (err2) { console.error(`Insert failed for ${product.name}:`, err2.message); continue }
        }
        importedProducts++
        nuevos++
      }
    }
  }

  const borradosEnFudo = await desactivarBorradosEnFudo(supabase, new Set(fudoProducts.map((p) => String(p.id))))

  // Platos nuevos → su receta, si el nombre coincide exacto (ej. versión PedidosYa)
  const platosVinculados = await import('@/lib/ventas/vinculos-recetas')
    .then(({ autoVincularPlatos }) => autoVincularPlatos(supabase))
    .catch(() => null)

  return { importedCategories, importedProducts, cambiados, nuevos, borradosEnFudo, platosVinculados }
}

const normNombre = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\b(peya|pedidos ya)\b/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Platos que Fudo borró (a veces los borra y los vuelve a crear con otro
 * número): se desactivan en la app para que no queden viejos. Si el viejo
 * sabía qué descontar y el plato nuevo con el mismo nombre todavía no, le
 * pasa ese vínculo. Con tope de seguridad: si "desaparece" más del 15% del
 * menú, se asume una lectura incompleta de Fudo y no se toca nada.
 */
async function desactivarBorradosEnFudo(supabase: SupabaseClient, idsEnFudo: Set<string>): Promise<string[]> {
  if (idsEnFudo.size < 50) return []
  const { data } = await supabase.from('menu_items')
    .select('id, name, fudo_product_id, recipe_id, consumo_modo, consumo_stock_item_id, consumo_qty, is_active')
    .not('fudo_product_id', 'is', null).eq('is_active', true)
  type Row = { id: string; name: string; fudo_product_id: string; recipe_id: string | null; consumo_modo: string | null; consumo_stock_item_id: string | null; consumo_qty: number | null }
  const activos = (data ?? []) as Row[]
  const borrados = activos.filter((m) => !idsEnFudo.has(String(m.fudo_product_id)))
  if (borrados.length === 0 || borrados.length > activos.length * 0.15) return []

  for (const b of borrados) {
    if (b.consumo_modo) {
      const gemelo = activos.find((m) => m.id !== b.id && idsEnFudo.has(String(m.fudo_product_id)) && normNombre(m.name) === normNombre(b.name) && !m.consumo_modo && !m.recipe_id)
      if (gemelo) {
        await supabase.from('menu_items').update({
          recipe_id: b.recipe_id, consumo_modo: b.consumo_modo, consumo_stock_item_id: b.consumo_stock_item_id, consumo_qty: b.consumo_qty, recipe_link_source: 'auto_nombre',
        }).eq('id', gemelo.id)
      }
    }
    await supabase.from('menu_items').update({ is_active: false }).eq('id', b.id)
  }
  return borrados.map((b) => b.name)
}
