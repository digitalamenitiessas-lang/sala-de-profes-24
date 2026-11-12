import type { SupabaseClient } from '@supabase/supabase-js'
import { fudoHttp } from '@/lib/fudoClient'
import { claveNombre } from '@/lib/fudo/create-from-fudo'
import { resolveItemIncidents } from '@/lib/fudo/sync-events'
import { sendPushToUser } from '@/lib/push/send'
import { logAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// Ingredientes borrados en Fudo
// ---------------------------------------------------------------------------
// Cuando en Fudo se borra un ingrediente (por ejemplo, un duplicado), el
// insumo de la app que apuntaba a él quedaba activo con el vínculo roto: salía
// en "Toca contar" y al cargar el conteo daba "Vínculo Fudo roto" (12/11/2026:
// "Queso Muzzarella" #31, borrado en Fudo porque estaba repetido con "Queso
// Mozzarella" #124). Ahora se resuelve solo:
//   · si en Fudo hay otro ingrediente que se llama igual y no está vinculado,
//     se vincula a ese (lo borraron y lo volvieron a crear)
//   · si no, y el insumo no está en uso (pedidos abiertos, recetas,
//     producciones, menú, descartables), se desactiva
//   · si está en uso no se toca: se avisa para que lo creen de nuevo en Fudo o
//     lo reemplacen
// Solo con un 404 de Fudo para ese ingrediente: cualquier otra respuesta no
// prueba que se haya borrado. A socios y encargados les llega un aviso, una
// vez por insumo.
// ---------------------------------------------------------------------------

export type VinculoRoto = { id: string; name: string; fudo_ingredient_id: string | null }

export type ArregloVinculo = {
  itemId: string
  nombre: string
  fudoIdViejo: string
  accion: 'revinculado' | 'desactivado' | 'en_uso'
  fudoIdNuevo?: string
  fudoNombreNuevo?: string
  usos?: string[]
}

/** Más que esto de una vez es raro: puede ser Fudo respondiendo mal, no se toca nada */
const MAX_POR_VEZ = 5

/** ¿Fudo confirma que el ingrediente no existe? */
async function borradoEnFudo(fudoId: string): Promise<boolean> {
  const res = await fudoHttp(`https://api.fu.do/v1alpha1/ingredients/${fudoId}`).catch(() => null)
  return res?.status === 404
}

/** Dónde se usa el insumo (si se usa, no se desactiva) */
async function usosDelInsumo(admin: SupabaseClient, itemId: string): Promise<string[]> {
  const contar = async (tabla: string, columna: string, extra?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = admin.from(tabla).select(columna, { count: 'exact', head: true }).eq(columna, itemId)
    if (extra) q = extra(q)
    const { count, error } = await q
    // Si no se pudo leer, se cuenta como en uso: ante la duda, no se desactiva
    return error ? 1 : (count ?? 0)
  }
  const [cocina, barra, recetas, salidaReceta, plantillas, salidasPlantilla, insumoPlantilla, menu, descartables] = await Promise.all([
    contar('kitchen_orders', 'stock_item_id', (q) => q.in('status', ['pending', 'ordered'])),
    contar('bar_orders', 'stock_item_id', (q) => q.in('status', ['pending', 'ordered'])),
    contar('recipe_ingredients', 'stock_item_id'),
    contar('recipes', 'output_stock_item_id'),
    contar('production_template_inputs', 'stock_item_id'),
    contar('production_template_outputs', 'stock_item_id'),
    contar('production_templates', 'default_input_stock_item_id'),
    contar('menu_items', 'consumo_stock_item_id'),
    contar('descartables_producto', 'stock_item_id'),
  ])
  return [
    cocina + barra ? 'pedidos sin recibir' : null,
    recetas + salidaReceta ? 'recetas' : null,
    plantillas + salidasPlantilla + insumoPlantilla ? 'producciones' : null,
    menu ? 'el menú' : null,
    descartables ? 'descartables' : null,
  ].filter((x): x is string => Boolean(x))
}

/** true si la clave es nueva (y queda guardada): cada cosa se avisa una vez */
async function primeraVez(admin: SupabaseClient, clave: string): Promise<boolean> {
  const { data } = await admin.from('avisos_enviados').upsert({ clave }, { onConflict: 'clave', ignoreDuplicates: true }).select('clave')
  return (data ?? []).length > 0
}

export function textoArreglo(a: ArregloVinculo): string {
  if (a.accion === 'revinculado') return `«${a.nombre}» se borró en Fudo y estaba creado de nuevo: quedó unido a «${a.fudoNombreNuevo}» (#${a.fudoIdNuevo}).`
  if (a.accion === 'desactivado') return `«${a.nombre}» ya no existe en Fudo (lo borraron): lo sacamos de Sala de Profes, no se cuenta ni se pide más.`
  return `«${a.nombre}» ya no existe en Fudo pero se usa en ${a.usos?.join(', ')}: créenlo de nuevo en Fudo (y toquen Crear todos en LVE) o reemplácenlo.`
}

/**
 * Revisa los insumos cuyo ingrediente de Fudo no aparece y arregla los que
 * Fudo confirma borrados. `ingredientesFudo`: la lista completa de Fudo.
 */
export async function arreglarVinculosRotos(
  admin: SupabaseClient,
  items: VinculoRoto[],
  ingredientesFudo: { id: string; name: string }[],
): Promise<ArregloVinculo[]> {
  const candidatos = items.filter((i) => i.fudo_ingredient_id)
  if (candidatos.length === 0) return []
  if (candidatos.length > MAX_POR_VEZ) {
    console.warn(`[vinculos-rotos] ${candidatos.length} insumos sin su ingrediente en Fudo: demasiados de una vez, no se toca nada`)
    return []
  }

  const { data: activos } = await admin.from('stock_items').select('fudo_ingredient_id').eq('is_active', true).not('fudo_ingredient_id', 'is', null)
  const ocupados = new Set(((activos ?? []) as { fudo_ingredient_id: string }[]).map((x) => String(x.fudo_ingredient_id)))
  const ahora = () => new Date().toISOString()

  const arreglos: ArregloVinculo[] = []
  for (const it of candidatos) {
    const viejo = String(it.fudo_ingredient_id)
    if (!(await borradoEnFudo(viejo))) continue

    const clave = claveNombre(it.name)
    const mismo = clave ? ingredientesFudo.find((i) => String(i.id) !== viejo && !ocupados.has(String(i.id)) && claveNombre(i.name) === clave) : undefined
    let arreglo: ArregloVinculo
    if (mismo) {
      const { error } = await admin.from('stock_items').update({ fudo_ingredient_id: String(mismo.id), updated_at: ahora() }).eq('id', it.id).eq('fudo_ingredient_id', viejo)
      if (error) continue
      ocupados.add(String(mismo.id))
      arreglo = { itemId: it.id, nombre: it.name, fudoIdViejo: viejo, accion: 'revinculado', fudoIdNuevo: String(mismo.id), fudoNombreNuevo: mismo.name }
    } else {
      const usos = await usosDelInsumo(admin, it.id)
      if (usos.length > 0) {
        arreglo = { itemId: it.id, nombre: it.name, fudoIdViejo: viejo, accion: 'en_uso', usos }
      } else {
        const { error } = await admin.from('stock_items').update({ is_active: false, updated_at: ahora() }).eq('id', it.id).eq('fudo_ingredient_id', viejo)
        if (error) continue
        arreglo = { itemId: it.id, nombre: it.name, fudoIdViejo: viejo, accion: 'desactivado' }
      }
    }
    if (arreglo.accion !== 'en_uso') await resolveItemIncidents(admin, it.id).catch(() => null)
    void logAudit(admin, {
      userId: null, userName: 'Sistema', action: `fudo_vinculo_roto_${arreglo.accion}`, module: 'stock', entityType: 'stock_item', entityId: it.id,
      description: textoArreglo(arreglo), metadata: arreglo,
    })
    arreglos.push(arreglo)
  }

  // Aviso a socios y encargados, una vez por insumo
  const nuevos: ArregloVinculo[] = []
  for (const a of arreglos) if (await primeraVez(admin, `fudo_vinculo_roto:${a.itemId}:${a.fudoIdViejo}`)) nuevos.push(a)
  if (nuevos.length > 0) {
    const { data: perfiles } = await admin.from('profiles').select('id').eq('is_active', true).in('role', ['socio', 'encargado'])
    await Promise.allSettled(((perfiles ?? []) as { id: string }[]).map((p) => sendPushToUser(p.id, {
      title: nuevos.length === 1 ? '🔗 Fudo: borraron un insumo' : `🔗 Fudo: borraron ${nuevos.length} insumos`,
      body: nuevos.map(textoArreglo).join('\n').slice(0, 600),
      url: '/stock',
    })))
  }
  return arreglos
}

/** Para cuando una escritura en Fudo da 404: arregla ese insumo y dice qué pasó */
export async function arreglarVinculoDeItem(admin: SupabaseClient, stockItemId: string, fudoIngredientId: string): Promise<ArregloVinculo | null> {
  const { data: item } = await admin.from('stock_items').select('id, name, fudo_ingredient_id, is_active').eq('id', stockItemId).maybeSingle()
  if (!item || !item.is_active || String(item.fudo_ingredient_id) !== String(fudoIngredientId)) return null
  const { getFudoIngredientsCached } = await import('@/lib/fudo/create-from-fudo')
  const ingredientes = await getFudoIngredientsCached().catch(() => [])
  const [arreglo] = await arreglarVinculosRotos(admin, [item as VinculoRoto], ingredientes)
  return arreglo ?? null
}
