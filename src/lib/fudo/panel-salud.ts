import type { SupabaseClient } from '@supabase/supabase-js'
import { leerSalud, CAIDA_MIN } from '@/lib/fudo/salud'
import { readFudoStock } from '@/lib/fudo/stock-sync'

// ---------------------------------------------------------------------------
// Datos del panel "Salud de Fudo" (/admin/fudo/salud): conexión, cola de
// reintentos, vínculos rotos con acción sugerida, control de stock apagado
// en Fudo y el resto de las diferencias de la auditoría, agrupadas.
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ETIQUETAS: Record<string, string> = {
  stock_mismatch_ge_1: 'Stock distinto entre la app y Fudo',
  name_mismatch: 'Nombre distinto en la app y en Fudo',
  unit_suspect_fractional_unit: 'Se cuenta por unidad pero tiene decimales',
  product_stock_null: 'Producto sin stock informado en Fudo',
  product_stockControl_false: 'Producto con control de stock apagado en Fudo',
  missing_stock_controlled_ingredient_in_lve: 'Insumo de Fudo que no está en la app',
  menu_price_mismatch: 'Precio distinto en la app y en Fudo',
  menu_name_mismatch: 'Nombre de plato distinto',
  menu_active_mismatch: 'Plato activo/inactivo distinto',
  duplicate_product_link: 'Dos insumos vinculados al mismo producto de Fudo',
  duplicate_ingredient_link: 'Dos insumos vinculados al mismo ingrediente de Fudo',
  fudo_write_failed: 'Fudo rechazó una escritura',
  fudo_read_before_write_failed: 'No se pudo leer Fudo antes de escribir',
  fudo_ingredient_not_found: 'Vínculo roto al escribir',
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(pre\s*-?\s*producto|unidad|cocina)\b/g, ' ').replace(/\s+/g, ' ').trim()

type Incidente = { id: string; code: string; severity: string; title: string; detail: string | null; stock_item_id: string | null; fudo_id: string | null; last_seen_at: string }
type Item = { id: string; name: string; unit: string; current_qty: number; is_active: boolean; fudo_ingredient_id: string | null; fudo_product_id: string | null; fudo_skip: boolean | null }

export async function armarPanelSalud(admin: SupabaseClient) {
  const hace7 = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const inicioHoy = new Date(`${new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10)}T00:00:00-03:00`).toISOString()

  const [salud, { data: ventasEv }, { data: stockEv }, { data: pend }, { count: hechos7 }, { data: desc7 }, { data: inc }, { data: ventasHoy }] = await Promise.all([
    leerSalud(admin),
    admin.from('fudo_sync_events').select('created_at, status, error_message').eq('entity_type', 'fudo_sales').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('fudo_sync_events').select('created_at, completed_at, status, error_message').eq('operation', 'stock_read_sync').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('fudo_reintentos').select('id, tipo, origen, delta, nota, intentos, ultimo_error, proximo_intento_at, created_at, stock_items(name, unit)').eq('estado', 'pendiente').order('created_at'),
    admin.from('fudo_reintentos').select('id', { count: 'exact', head: true }).eq('estado', 'hecho').gte('hecho_at', hace7),
    admin.from('fudo_reintentos').select('id, origen, delta, ultimo_error, updated_at, stock_items(name, unit)').eq('estado', 'descartado').gte('updated_at', hace7).order('updated_at', { ascending: false }).limit(20),
    admin.from('fudo_sync_incidents').select('id, code, severity, title, detail, stock_item_id, fudo_id, last_seen_at').eq('status', 'open').order('last_seen_at', { ascending: false }).limit(1000),
    admin.from('fudo_sales').select('fudo_ticket_id').gte('sold_at', inicioHoy).limit(5000),
  ])

  const incidentes = (inc ?? []) as Incidente[]
  const itemIds = [...new Set(incidentes.map((i) => i.stock_item_id).filter((x): x is string => !!x && UUID.test(x)))]
  const { data: itemsData } = itemIds.length
    ? await admin.from('stock_items').select('id, name, unit, current_qty, is_active, fudo_ingredient_id, fudo_product_id, fudo_skip').in('id', itemIds)
    : { data: [] as Item[] }
  const items = new Map(((itemsData ?? []) as Item[]).map((i) => [i.id, i]))

  // ---- Vínculos rotos (Fudo borró el ingrediente/producto) ----
  const rotosInc = incidentes.filter((i) => (i.code === 'fudo_ingredient_missing' || i.code === 'fudo_product_missing' || i.code === 'fudo_ingredient_not_found') && i.stock_item_id && items.get(i.stock_item_id))
  const rotosIds = [...new Set(rotosInc.map((i) => i.stock_item_id!))].filter((id) => {
    const it = items.get(id)!
    // Los inactivos no molestan: no se cuentan ni se reciben
    return it.is_active && !it.fudo_skip && (it.fudo_ingredient_id || it.fudo_product_id)
  })
  let vinculosRotos: unknown[] = []
  if (rotosIds.length > 0) {
    const [{ data: usos }, { data: linked }, fudoIng] = await Promise.all([
      admin.from('recipe_ingredients').select('stock_item_id').in('stock_item_id', rotosIds),
      admin.from('stock_items').select('id, name, unit, current_qty, fudo_ingredient_id').eq('is_active', true).not('fudo_ingredient_id', 'is', null),
      Promise.race([readFudoStock(), new Promise<null>((r) => setTimeout(() => r(null), 12_000))]).catch(() => null),
    ])
    const usoPorItem = new Map<string, number>()
    for (const u of (usos ?? []) as { stock_item_id: string }[]) usoPorItem.set(u.stock_item_id, (usoPorItem.get(u.stock_item_id) ?? 0) + 1)
    const lveDeFudo = new Map(((linked ?? []) as { id: string; name: string; unit: string; current_qty: number; fudo_ingredient_id: string }[]).map((l) => [String(l.fudo_ingredient_id), l]))
    const fudoLista = (fudoIng ?? []) as { id: string | number; name: string }[]

    vinculosRotos = rotosIds.map((id) => {
      const it = items.get(id)!
      const n = norm(it.name)
      const cand = fudoLista.find((f) => norm(String(f.name)) === n)
        ?? fudoLista.find((f) => { const fn = norm(String(f.name)); return fn.length > 4 && (fn.includes(n) || n.includes(fn)) })
      const lve = cand ? lveDeFudo.get(String(cand.id)) : undefined
      // Solo se sugiere unir con la MISMA unidad (si no, las recetas mentirían)
      const sugerido = lve && lve.id !== id && lve.unit === it.unit ? { id: lve.id, nombre: lve.name, unidad: lve.unit, stock: Number(lve.current_qty), fudo_nombre: String(cand!.name), misma_unidad: true } : null
      const recetas = usoPorItem.get(id) ?? 0
      return {
        stock_item_id: id,
        nombre: it.name,
        unidad: it.unit,
        stock: Number(it.current_qty),
        activo: it.is_active,
        fudo_id: it.fudo_ingredient_id ?? it.fudo_product_id,
        recetas,
        sugerido,
        recomendado: sugerido?.misma_unidad ? 'unir' : recetas > 0 || it.is_active ? 'solo_app' : 'desactivar',
      }
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }

  // ---- Control de stock apagado en Fudo (producción y recepciones fallan) ----
  const sinControlInc = incidentes.filter((i) => ['ingredient_stock_null', 'ingredient_stockControl_false'].includes(i.code) && i.stock_item_id && items.get(i.stock_item_id)?.is_active)
  const sinControlIds = [...new Set(sinControlInc.map((i) => i.stock_item_id!))]
  const [{ data: fallas }, { data: movs }] = sinControlIds.length
    ? await Promise.all([
      admin.from('fudo_reintentos').select('stock_item_id').in('stock_item_id', sinControlIds).eq('estado', 'pendiente'),
      // Producción/recepción/merma recientes: son los que de verdad fallan
      admin.from('stock_movements').select('stock_item_id').in('stock_item_id', sinControlIds)
        .in('reason', ['produccion_input', 'produccion_output', 'production', 'reception', 'waste'])
        .gte('created_at', new Date(Date.now() - 30 * 86_400_000).toISOString()).limit(5000),
    ])
    : [{ data: [] }, { data: [] }]
  const movsPorItem = new Map<string, number>()
  for (const m of (movs ?? []) as { stock_item_id: string }[]) movsPorItem.set(m.stock_item_id, (movsPorItem.get(m.stock_item_id) ?? 0) + 1)
  const conFalla = new Set(((fallas ?? []) as { stock_item_id: string }[]).map((f) => f.stock_item_id))
  const sinControl = sinControlIds.map((id) => {
    const i = sinControlInc.find((x) => x.stock_item_id === id)!
    const fudoNombre = (i.detail ?? '').match(/Fudo (.+?):/)?.[1] ?? null
    return { stock_item_id: id, nombre: items.get(id)!.name, fudo_nombre: fudoNombre, fudo_id: i.fudo_id, con_pendientes: conFalla.has(id), movimientos_30d: movsPorItem.get(id) ?? 0 }
  }).sort((a, b) => Number(b.con_pendientes) - Number(a.con_pendientes) || b.movimientos_30d - a.movimientos_30d || a.nombre.localeCompare(b.nombre, 'es'))

  // ---- Productos de Fudo con control de stock que la app no usa ----
  const fudoSinApp = incidentes.filter((i) => i.code === 'missing_stock_controlled_product_in_lve')
    .map((i) => ({ fudo_id: i.fudo_id, nombre: i.title.replace(/^.*?:\s*/, '') }))

  // ---- En la app pero no en Fudo ----
  const enAppNoFudo = await armarEnAppNoFudo(admin)

  // ---- El resto, agrupado ----
  const yaMostrados = new Set(['fudo_ingredient_missing', 'fudo_product_missing', 'fudo_ingredient_not_found', 'ingredient_stock_null', 'ingredient_stockControl_false', 'missing_stock_controlled_product_in_lve'])
  const grupos = new Map<string, Incidente[]>()
  for (const i of incidentes) if (!yaMostrados.has(i.code)) grupos.set(i.code, [...(grupos.get(i.code) ?? []), i])
  const otros = [...grupos.entries()].map(([code, lista]) => ({
    code,
    etiqueta: ETIQUETAS[code] ?? code,
    cantidad: lista.length,
    ejemplos: lista.slice(0, 30).map((i) => ({ titulo: i.title.replace(/:\s*\S+$/, ''), detalle: i.detail })),
  })).sort((a, b) => b.cantidad - a.cantidad)

  // ---- Conexión ----
  const minOk = salud.ultimo_ok_at ? (Date.now() - Date.parse(salud.ultimo_ok_at)) / 60_000 : null
  const estado = salud.fallas_seguidas === 0 && minOk !== null && minOk < 25 ? 'ok'
    : minOk !== null && minOk < CAIDA_MIN ? 'intermitente'
      : salud.ultimo_ok_at === null ? 'sin_datos' : 'caido'

  return {
    conexion: { estado, ...salud },
    ventas: { ultima_at: ventasEv?.created_at ?? null, ok: ventasEv?.status === 'success', error: ventasEv?.error_message ?? null, tickets_hoy: new Set((ventasHoy ?? []).map((v: { fudo_ticket_id: string | number | null }) => String(v.fudo_ticket_id))).size },
    stock: { ultima_at: stockEv?.completed_at ?? stockEv?.created_at ?? null, ok: stockEv?.status === 'success' },
    reintentos: { pendientes: pend ?? [], hechos_7d: hechos7 ?? 0, descartados_7d: desc7 ?? [] },
    vinculos_rotos: vinculosRotos,
    sin_control: sinControl,
    fudo_sin_app: fudoSinApp,
    otros,
    en_app_no_fudo: enAppNoFudo,
  }
}

const normPlato = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\b(peya|pedidos ya)\b/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Lo que está activo en la app y no existe en Fudo, separado por tipo:
 *   carta_vieja        → platos cargados a mano antes de conectar Fudo
 *   insumos_sin_vinculo → insumos sin ingrediente/producto de Fudo
 *   solo_app           → insumos marcados a propósito como "solo en la app"
 * (Los insumos cuyo ingrediente Fudo borró van en "vínculos rotos", y los
 * platos que Fudo borró se desactivan solos en la sincronización diaria.)
 */
async function armarEnAppNoFudo(admin: SupabaseClient) {
  const desde60 = new Date(Date.now() - 60 * 86_400_000).toISOString()
  const [{ data: menu }, { data: insumos }] = await Promise.all([
    admin.from('menu_items').select('id, name, is_active, fudo_product_id, recipe_id, created_at').eq('is_active', true),
    admin.from('stock_items').select('id, name, unit, current_qty, fudo_ingredient_id, fudo_product_id, fudo_skip').eq('is_active', true)
      .is('fudo_ingredient_id', null).is('fudo_product_id', null),
  ])
  type M = { id: string; name: string; fudo_product_id: string | null; recipe_id: string | null; created_at: string }
  const platos = (menu ?? []) as M[]
  const conFudo = platos.filter((m) => m.fudo_product_id)
  const cartaVieja = platos.filter((m) => !m.fudo_product_id).map((m) => {
    const gemelo = conFudo.find((f) => normPlato(f.name) === normPlato(m.name))
    return {
      id: m.id,
      nombre: m.name,
      creado: m.created_at.slice(0, 10),
      gemelo: gemelo?.name ?? null,
      // Su receta no la usa ningún plato de Fudo: puede que en Fudo se llame distinto
      receta_huerfana: !!m.recipe_id && !conFudo.some((f) => f.recipe_id === m.recipe_id),
    }
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  type I = { id: string; name: string; unit: string; current_qty: number; fudo_skip: boolean | null }
  const lista = (insumos ?? []) as I[]
  const ids = lista.map((i) => i.id)
  const [{ data: usos }, { data: movs }] = ids.length
    ? await Promise.all([
      admin.from('recipe_ingredients').select('stock_item_id').in('stock_item_id', ids),
      admin.from('stock_movements').select('stock_item_id').in('stock_item_id', ids).gte('created_at', desde60),
    ])
    : [{ data: [] }, { data: [] }]
  const cuenta = (arr: { stock_item_id: string }[] | null) => (arr ?? []).reduce((m, r) => m.set(r.stock_item_id, (m.get(r.stock_item_id) ?? 0) + 1), new Map<string, number>())
  const recetas = cuenta(usos as { stock_item_id: string }[] | null)
  const movimientos = cuenta(movs as { stock_item_id: string }[] | null)
  const fila = (i: I) => ({ id: i.id, nombre: i.name, unidad: i.unit, stock: Number(i.current_qty), recetas: recetas.get(i.id) ?? 0, movimientos_60d: movimientos.get(i.id) ?? 0 })

  return {
    carta_vieja: cartaVieja,
    insumos_sin_vinculo: lista.filter((i) => !i.fudo_skip).map(fila).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    solo_app: lista.filter((i) => i.fudo_skip).map(fila).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
  }
}
