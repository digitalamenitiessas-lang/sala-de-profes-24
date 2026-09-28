import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Platos vendidos ↔ insumos: que cada venta descuente lo que consume
// ---------------------------------------------------------------------------
// Cada producto de Fudo (menu_items) tiene un consumo_modo:
//   'receta'      → descuenta por su receta
//   'insumo'      → descuenta directo un insumo con cantidad
//                   (opción "Leche Entera 190 ML" → 0,19 l de leche entera)
//   'combo'       → descuenta por lo que se eligió adentro (sub-ítems de Fudo)
//   'sin_consumo' → no descuenta (servicio, "Frita", "Horno"…)
//   null          → sin resolver: aparece en la lista para vincular
//
// La mayoría se resuelve SOLO (autoVincularPlatos), así la lista se vacía y
// deja de existir:
//   · Versiones de otro canal ("Wrap de vacío peya") → la receta del plato
//     con el mismo nombre, sin la marca del canal.
//   · Opciones con tamaño en el nombre ("Leche Entera 190 ML") → el insumo
//     con el mismo nombre, en la cantidad que dice.
//   · La reventa directa (gaseosas, budines comprados) ya se cuenta por el
//     insumo con el mismo producto de Fudo.
// Solo se vincula solo con coincidencia EXACTA de nombre (con variantes de
// escritura conocidas). Lo parecido va a la lista como sugerencia, nunca se
// aplica sin que alguien lo confirme. Combos tampoco se resuelven solos: un
// "menú del día" también trae opciones y su plato sí consume.
// ---------------------------------------------------------------------------

const CANAL = /\b(peya|pedidos ?ya|take ?away|delivery|rappi)\b/g
const STOP = new Set(['de', 'la', 'el', 'los', 'las', 'con', 'y', 'en', 'al', 'a', 'x', 'entrada', 'entradas', 'porcion'])
// Variantes de escritura que aparecen en la carta de Fudo
const SINONIMO: Record<string, string> = {
  mozzarella: 'muzza', muzzarella: 'muzza', mozarella: 'muzza', mozza: 'muzza', muza: 'muzza', muzarella: 'muzza',
  calabreza: 'calabresa', caesar: 'cesar', sanguche: 'sandwich', sanguchito: 'sandwich', ciabata: 'ciabatta',
  jyq: 'jq', fugaza: 'fugazza',
}
const TAMANIO = /(\d+(?:[.,]\d+)?)\s*(ml|cc|cm3|g|gr|grs|kg|l|lt|lts|litro|litros)\b/

function norm(x: string): string {
  return x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/j\s*&\s*q/g, 'jq').replace(/[^a-z0-9+., ]/g, ' ')
}

function tokens(name: string): string[] {
  const n = norm(name).replace(CANAL, ' ').split('+')[0] // "Tostado + Infusión" → el plato principal
  return [...new Set(n.replace(/[.,]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t)).map((t) => SINONIMO[t] ?? t))]
}

/** Clave de comparación: mismas palabras (sin canal, sin orden, con variantes unificadas) */
export function claveNombre(name: string): string {
  return tokens(name).sort().join(' ')
}

/** "Leche Entera 190 ML" → { base: "Leche Entera", cantidad: 0.19, unidad: 'l' } */
function tamanio(name: string): { base: string; cantidad: number; unidad: 'l' | 'kg' } | null {
  const m = norm(name).match(TAMANIO)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  if (!(n > 0)) return null
  const u = m[2]
  const base = norm(name).replace(TAMANIO, ' ')
  if (['ml', 'cc', 'cm3'].includes(u)) return { base, cantidad: n / 1000, unidad: 'l' }
  if (['l', 'lt', 'lts', 'litro', 'litros'].includes(u)) return { base, cantidad: n, unidad: 'l' }
  if (['g', 'gr', 'grs'].includes(u)) return { base, cantidad: n / 1000, unidad: 'kg' }
  return { base, cantidad: n, unidad: 'kg' }
}

/** Cantidad expresada en la unidad del insumo (null si no se puede convertir) */
function enUnidadDe(cantidad: number, unidad: 'l' | 'kg', unidadInsumo: string): number | null {
  const u = unidadInsumo.toLowerCase()
  if (unidad === 'l') return u === 'l' || u === 'lt' ? cantidad : u === 'ml' || u === 'cc' ? cantidad * 1000 : null
  return u === 'kg' ? cantidad : u === 'g' || u === 'gr' ? cantidad * 1000 : null
}

function parecido(a: string, b: string): number {
  const A = new Set(tokens(a)), B = new Set(tokens(b))
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  const jaccard = inter / (A.size + B.size - inter)
  const cubre = inter / A.size // cuánto del nombre vendido está en el candidato
  return Math.max(jaccard, cubre * 0.9)
}

type MenuRow = {
  id: string
  name: string
  recipe_id: string | null
  fudo_product_id: string | null
  is_active: boolean
  consumo_modo: string | null
}
type RecipeRow = { id: string; name: string }
type StockRow = { id: string; name: string; unit: string; area: string | null; fudo_product_id: string | null }

async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

type Base = {
  menu: MenuRow[]
  recipes: RecipeRow[]
  stock: StockRow[]
  /** productos de Fudo que son reventa directa de un insumo (cuenta por el insumo) */
  reventa: Set<string>
}

async function cargarBase(admin: SupabaseClient): Promise<Base> {
  const [menu, recipes, stock] = await Promise.all([
    all<MenuRow>((f, t) => admin.from('menu_items').select('id, name, recipe_id, fudo_product_id, is_active, consumo_modo').order('id').range(f, t)),
    all<RecipeRow>((f, t) => admin.from('recipes').select('id, name').eq('is_active', true).order('id').range(f, t)),
    all<StockRow>((f, t) => admin.from('stock_items').select('id, name, unit, area, fudo_product_id, is_produced').eq('is_active', true).order('id').range(f, t)),
  ])
  const reventa = new Set(stock.filter((s) => s.fudo_product_id).map((s) => String(s.fudo_product_id)))
  return { menu, recipes, stock, reventa }
}

function indices(base: Base) {
  const recetaPorClaveMenu = new Map<string, Set<string>>()
  for (const m of base.menu) {
    // Solo platos que existen en Fudo: hay duplicados viejos cargados a mano
    if (!m.recipe_id || !m.is_active || !m.fudo_product_id) continue
    const k = claveNombre(m.name)
    if (!recetaPorClaveMenu.has(k)) recetaPorClaveMenu.set(k, new Set())
    recetaPorClaveMenu.get(k)!.add(m.recipe_id)
  }
  const recetaPorClave = new Map<string, Set<string>>()
  for (const r of base.recipes) {
    const k = claveNombre(r.name)
    if (!recetaPorClave.has(k)) recetaPorClave.set(k, new Set())
    recetaPorClave.get(k)!.add(r.id)
  }
  const insumoPorClave = new Map<string, StockRow[]>()
  for (const s of base.stock) {
    const k = claveNombre(s.name.replace(TAMANIO, ' '))
    if (!insumoPorClave.has(k)) insumoPorClave.set(k, [])
    insumoPorClave.get(k)!.push(s)
  }
  return { recetaPorClaveMenu, recetaPorClave, insumoPorClave }
}

type Indices = ReturnType<typeof indices>

/** Receta por nombre exacto (o null si no hay o es ambigua) */
function recetaExacta(name: string, ix: Indices): string | null {
  const k = claveNombre(name)
  if (!k) return null
  const desdeMenu = ix.recetaPorClaveMenu.get(k)
  if (desdeMenu?.size === 1) return [...desdeMenu][0]
  if (desdeMenu && desdeMenu.size > 1) return null
  const desdeRecetas = ix.recetaPorClave.get(k)
  return desdeRecetas?.size === 1 ? [...desdeRecetas][0] : null
}

/** Opción con tamaño en el nombre → insumo con el mismo nombre, en esa cantidad */
function insumoExacto(name: string, ix: Indices): { item: StockRow; qty: number } | null {
  const t = tamanio(name)
  if (!t) return null
  const candidatos = (ix.insumoPorClave.get(claveNombre(t.base)) ?? [])
    .map((item) => ({ item, qty: enUnidadDe(t.cantidad, t.unidad, item.unit) }))
    .filter((c): c is { item: StockRow; qty: number } => c.qty !== null)
  return candidatos.length === 1 ? candidatos[0] : null
}

type ComboInfo = { vendidos: number; conOpcion: number }

/** Por producto vendido: cuántas unidades traían alguna opción elegida adentro */
async function infoCombos(admin: SupabaseClient, dias: number): Promise<{ porProducto: Map<string, ComboInfo>; opciones: Map<string, number> }> {
  const since = new Date(Date.now() - dias * 86_400_000).toISOString()
  const [ventas, subs] = await Promise.all([
    all<{ fudo_sale_item_id: string | null; fudo_product_id: string }>((f, t) => admin.from('fudo_sales').select('fudo_sale_item_id, fudo_product_id').gte('sold_at', since).order('id').range(f, t)),
    all<{ fudo_sale_item_id: string; fudo_product_id: string; quantity: number }>((f, t) => admin.from('fudo_sale_subitems').select('fudo_sale_item_id, fudo_product_id, quantity').gte('sold_at', since).order('fudo_subitem_id').range(f, t)),
  ])
  const itemConOpcion = new Set<string>()
  const opciones = new Map<string, number>()
  for (const s of subs) {
    itemConOpcion.add(String(s.fudo_sale_item_id))
    const p = String(s.fudo_product_id)
    opciones.set(p, (opciones.get(p) ?? 0) + (Number(s.quantity) || 1))
  }
  const porProducto = new Map<string, ComboInfo>()
  for (const v of ventas) {
    const p = String(v.fudo_product_id)
    const info = porProducto.get(p) ?? { vendidos: 0, conOpcion: 0 }
    info.vendidos++
    if (v.fudo_sale_item_id && itemConOpcion.has(String(v.fudo_sale_item_id))) info.conOpcion++
    porProducto.set(p, info)
  }
  return { porProducto, opciones }
}

export type AutoVincularResult = {
  porNombre: number
  porInsumo: number
  revisados: number
  /** en modo prueba: lo que haría, sin escribir */
  propuestas?: { plato: string; accion: 'receta' | 'insumo'; destino: string }[]
}

let ultimaCorrida: { at: number; result: AutoVincularResult } | null = null
export const ultimaAutoVinculacion = () => ultimaCorrida

/**
 * Resuelve solo lo que es seguro. Nunca pisa un vínculo existente ni una
 * decisión de una persona (solo toca productos con consumo_modo null).
 */
export async function autoVincularPlatos(admin: SupabaseClient, options: { prueba?: boolean } = {}): Promise<AutoVincularResult> {
  const base = await cargarBase(admin)
  const ix = indices(base)
  const result: AutoVincularResult = { porNombre: 0, porInsumo: 0, revisados: 0, propuestas: options.prueba ? [] : undefined }
  const nombreReceta = new Map(base.recipes.map((r) => [r.id, r.name]))
  const now = new Date().toISOString()

  for (const m of base.menu) {
    if (m.consumo_modo !== null) continue
    if (m.recipe_id) {
      // tenía receta pero sin modo (alta vieja): queda resuelto
      if (!options.prueba) {
        await admin.from('menu_items').update({ consumo_modo: 'receta', recipe_link_source: 'importacion', updated_at: now }).eq('id', m.id).is('consumo_modo', null)
      }
      continue
    }
    if (!m.fudo_product_id || !m.is_active || base.reventa.has(String(m.fudo_product_id))) continue
    result.revisados++

    const receta = recetaExacta(m.name, ix)
    if (receta) {
      result.porNombre++
      if (options.prueba) { result.propuestas!.push({ plato: m.name, accion: 'receta', destino: nombreReceta.get(receta) ?? receta }); continue }
      await admin.from('menu_items')
        .update({ recipe_id: receta, consumo_modo: 'receta', recipe_link_source: 'auto_nombre', updated_at: now })
        .eq('id', m.id).is('consumo_modo', null).is('recipe_id', null)
      continue
    }

    const insumo = insumoExacto(m.name, ix)
    if (insumo) {
      result.porInsumo++
      if (options.prueba) { result.propuestas!.push({ plato: m.name, accion: 'insumo', destino: `${insumo.qty} ${insumo.item.unit} de ${insumo.item.name}` }); continue }
      await admin.from('menu_items')
        .update({ consumo_modo: 'insumo', consumo_stock_item_id: insumo.item.id, consumo_qty: insumo.qty, recipe_link_source: 'auto_nombre', updated_at: now })
        .eq('id', m.id).is('consumo_modo', null)
    }
  }

  if (!options.prueba) ultimaCorrida = { at: Date.now(), result }
  return result
}

// ---------------------------------------------------------------------------
// Lista a vincular (solo lo que la máquina no pudo resolver)
// ---------------------------------------------------------------------------

export type SugerenciaInsumo = { stock_item_id: string; name: string; unit: string; qty: number }

export type PlatoPendiente = {
  menu_item_id: string
  name: string
  /** 'plato': se vende solo · 'opcion': se elige dentro de otro plato */
  tipo: 'plato' | 'opcion'
  units: number
  revenue: number
  /** % de las unidades que se vendieron con alguna opción adentro */
  pct_con_opciones: number
  sugerencias: { recipe_id: string; name: string; score: number }[]
  insumos_sugeridos: SugerenciaInsumo[]
}

export type VentasVinculosPayload = {
  days: number
  pendientes: PlatoPendiente[]
  opciones: PlatoPendiente[]
  resumen: {
    revenue_total: number
    revenue_pendiente: number
    /** % de la facturación que ya descuenta insumos */
    cobertura_pct: number | null
    auto_por_nombre: number
    auto_por_insumo: number
  }
  recetas: RecipeRow[]
  insumos: { id: string; name: string; unit: string }[]
}

function sugerirInsumos(name: string, base: Base): SugerenciaInsumo[] {
  const t = tamanio(name)
  const ref = t ? t.base : name
  return base.stock
    // Sin tamaño en el nombre solo tiene sentido "1 por venta" si el insumo va por unidad
    // (sugerir "1 kg de costeletas por plato" confunde más de lo que ayuda).
    .filter((s) => t ? enUnidadDe(t.cantidad, t.unidad, s.unit) !== null : /^(u|un|unid|unidad|unidades)$/i.test(s.unit.trim()))
    .map((s) => ({ s, score: parecido(ref, s.name.replace(TAMANIO, ' ')) }))
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ s }) => ({
      stock_item_id: s.id,
      name: s.name,
      unit: s.unit,
      qty: (t && enUnidadDe(t.cantidad, t.unidad, s.unit)) || 1,
    }))
}

export async function buildVentasVinculos(admin: SupabaseClient, days = 30): Promise<VentasVinculosPayload> {
  const base = await cargarBase(admin)
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const [ventas, combos, autos] = await Promise.all([
    all<{ fudo_product_id: string; quantity: number; raw_payload: { price?: number } | null }>((f, t) =>
      admin.from('fudo_sales').select('fudo_product_id, quantity, raw_payload').gte('sold_at', since).order('id').range(f, t)),
    infoCombos(admin, days),
    admin.from('menu_items').select('consumo_modo').eq('recipe_link_source', 'auto_nombre'),
  ])

  const porProducto = new Map<string, { units: number; revenue: number }>()
  let revenueTotal = 0
  for (const v of ventas) {
    const p = String(v.fudo_product_id)
    const units = Number(v.quantity) || 0
    const revenue = units * (Number(v.raw_payload?.price) || 0)
    revenueTotal += revenue
    const acc = porProducto.get(p) ?? { units: 0, revenue: 0 }
    acc.units += units
    acc.revenue += revenue
    porProducto.set(p, acc)
  }

  const menuPorProducto = new Map<string, MenuRow>()
  for (const m of base.menu) {
    if (!m.fudo_product_id) continue
    const prev = menuPorProducto.get(String(m.fudo_product_id))
    if (!prev || (m.is_active && !prev.is_active)) menuPorProducto.set(String(m.fudo_product_id), m)
  }
  const sinResolver = (producto: string): MenuRow | null => {
    if (base.reventa.has(producto)) return null
    const m = menuPorProducto.get(producto)
    if (!m || m.consumo_modo !== null || m.recipe_id) return null
    return m
  }
  const sugerirRecetas = (name: string) => base.recipes
    .map((r) => ({ recipe_id: r.id, name: r.name, score: parecido(name, r.name) }))
    .filter((s) => s.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  const pendientes: PlatoPendiente[] = []
  let revenuePendiente = 0
  for (const [producto, v] of porProducto) {
    const m = sinResolver(producto)
    if (!m) continue
    revenuePendiente += v.revenue
    const c = combos.porProducto.get(producto)
    pendientes.push({
      menu_item_id: m.id,
      name: m.name,
      tipo: 'plato',
      units: Math.round(v.units * 100) / 100,
      revenue: Math.round(v.revenue),
      pct_con_opciones: c && c.vendidos > 0 ? Math.round((100 * c.conOpcion) / c.vendidos) : 0,
      sugerencias: sugerirRecetas(m.name),
      insumos_sugeridos: sugerirInsumos(m.name, base),
    })
  }
  pendientes.sort((a, b) => b.revenue - a.revenue || b.units - a.units)

  // Opciones elegidas dentro de otros platos (leche, packaging…): van por
  // cantidad de veces, no tienen facturación propia.
  const opciones: PlatoPendiente[] = []
  const yaListado = new Set(pendientes.map((p) => p.menu_item_id))
  for (const [producto, veces] of combos.opciones) {
    const m = sinResolver(producto)
    if (!m || yaListado.has(m.id)) continue
    opciones.push({
      menu_item_id: m.id,
      name: m.name,
      tipo: 'opcion',
      units: Math.round(veces),
      revenue: 0,
      pct_con_opciones: 0,
      sugerencias: [],
      insumos_sugeridos: sugerirInsumos(m.name, base),
    })
  }
  opciones.sort((a, b) => b.units - a.units)

  const autoRows = (autos.data ?? []) as { consumo_modo: string | null }[]
  return {
    days,
    pendientes,
    opciones,
    resumen: {
      revenue_total: Math.round(revenueTotal),
      revenue_pendiente: Math.round(revenuePendiente),
      cobertura_pct: revenueTotal > 0 ? Math.round(1000 * (1 - revenuePendiente / revenueTotal)) / 10 : null,
      auto_por_nombre: autoRows.filter((r) => r.consumo_modo === 'receta').length,
      auto_por_insumo: autoRows.filter((r) => r.consumo_modo === 'insumo').length,
    },
    recetas: base.recipes.slice().sort((a, b) => a.name.localeCompare(b.name, 'es')),
    insumos: base.stock.map((s) => ({ id: s.id, name: s.name, unit: s.unit })).sort((a, b) => a.name.localeCompare(b.name, 'es')),
  }
}
