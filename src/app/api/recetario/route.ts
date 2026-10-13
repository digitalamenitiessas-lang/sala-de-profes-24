import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireRole } from '@/lib/supabase/require-role'
import { ROLES } from '@/lib/constants'
import { costRecipes } from '@/lib/recipes/recipe-cost'
import { avisoCantidad } from '@/lib/recipes/recetario-platos'
import { productosConOpciones } from '@/lib/fudo/opciones'

// ---------------------------------------------------------------------------
// GET /api/recetario — Recetario de platos: cada plato de la carta con su
// receta (qué lleva por porción), costo y si hay algo para revisar.
// Los ingredientes mandan en Fudo (se traen importando el Excel); acá se
// ven, se detectan errores y se edita solo "Cómo se arma".
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireRole(Object.keys(ROLES))
  if (auth.response) return auth.response
  const admin = createAdminClient()

  const [{ data: platos }, { data: categorias }, { data: imp }] = await Promise.all([
    // Solo los platos que existen en Fudo (los demás son restos viejos de la app)
    admin.from('menu_items').select('id, name, recipe_id, sale_price, menu_category_id, fudo_product_id').eq('is_active', true).not('fudo_product_id', 'is', null).order('name'),
    admin.from('menu_categories').select('id, name'),
    admin.from('app_settings').select('value').eq('key', 'fudo_recetas_import').maybeSingle(),
  ])
  type Plato = { id: string; name: string; recipe_id: string | null; sale_price: number | null; menu_category_id: number | null; fudo_product_id: string | null }
  const lista = (platos ?? []) as Plato[]
  const nombreCat = new Map(((categorias ?? []) as { id: number; name: string }[]).map((c) => [c.id, c.name]))

  const recipeIds = [...new Set(lista.map((p) => p.recipe_id).filter((x): x is string => !!x))]
  // De a 100 ids: con ~300 recetas el pedido entero queda demasiado largo
  const tandas: string[][] = []
  for (let i = 0; i < recipeIds.length; i += 100) tandas.push(recipeIds.slice(i, i + 100))
  const [conOpciones, costos, ingsT, recetasT] = await Promise.all([
    productosConOpciones().catch(() => new Map<string, number>()),
    costRecipes(admin, recipeIds).catch(() => new Map()),
    Promise.all(tandas.map((t) => admin.from('recipe_ingredients').select('recipe_id, qty_per_portion, ingredient_unit, stock_items(name, unit)').in('recipe_id', t))),
    Promise.all(tandas.map((t) => admin.from('recipes').select('id, editada_en_app_at').in('id', t))),
  ])
  const ings = ingsT.flatMap((r) => r.data ?? [])
  const recetas = recetasT.flatMap((r) => r.data ?? [])

  // Líneas con cantidades que no parecen reales (ej. 200 kg de molida)
  const revisar = new Map<string, string[]>()
  const cantidad = new Map<string, number>()
  for (const r of ings as unknown as { recipe_id: string; qty_per_portion: number | null; ingredient_unit: string | null; stock_items: { name: string; unit: string } | null }[]) {
    cantidad.set(r.recipe_id, (cantidad.get(r.recipe_id) ?? 0) + 1)
    if (!r.stock_items) continue
    const aviso = avisoCantidad(Number(r.qty_per_portion ?? 0), r.ingredient_unit, r.stock_items.unit, r.stock_items.name)
    if (aviso?.grave) revisar.set(r.recipe_id, [...(revisar.get(r.recipe_id) ?? []), r.stock_items.name])
  }
  const editada = new Map(((recetas) as { id: string; editada_en_app_at: string | null }[]).map((r) => [r.id, r.editada_en_app_at]))

  return NextResponse.json({
    platos: lista.map((p) => {
      const c = p.recipe_id ? costos.get(p.recipe_id) : undefined
      const ingredientes = p.recipe_id ? cantidad.get(p.recipe_id) ?? 0 : 0
      return {
        id: p.id,
        nombre: p.name,
        categoria: p.menu_category_id ? nombreCat.get(p.menu_category_id) ?? 'Sin categoría' : 'Sin categoría',
        precio: p.sale_price != null ? Number(p.sale_price) : null,
        ingredientes,
        costo: c && c.cost > 0 ? c.cost : null,
        costoCompleto: c?.confiable ?? false,
        revisar: p.recipe_id ? revisar.get(p.recipe_id) ?? [] : [],
        editadaEnApp: p.recipe_id ? !!editada.get(p.recipe_id) : false,
        enFudo: !!p.fudo_product_id,
        /** Se arma con opciones de Fudo (ej. el Clásico): no lleva receta fija */
        conOpciones: !!p.fudo_product_id && conOpciones.has(p.fudo_product_id),
      }
    }),
    puedeEditar: ['socio', 'encargado', 'chef'].includes(auth.user.role),
    puedeImportar: ['socio', 'encargado'].includes(auth.user.role),
    ultimaImportacion: (imp?.value as { last_import_at?: string } | null)?.last_import_at ?? null,
  })
}
