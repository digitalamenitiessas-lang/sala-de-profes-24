// ---------------------------------------------------------------------------
// Preguntar en castellano — un solo motor de consultas para toda la app
// ---------------------------------------------------------------------------
// Regla de oro: la IA NUNCA inventa un número. Solo traduce la pregunta a un
// PLAN (qué entidad, qué filtros, qué orden). El plan se ejecuta contra la base
// y la respuesta se arma con los números que volvieron. Si la IA no está
// disponible, hay un traductor por palabras clave que cubre lo más frecuente.
//
// Esto es lo que permite que la información se cruce: la misma pregunta puede
// tocar stock, ventas, recetas, producción, pedidos o gastos de Fudo, y siempre
// devuelve filas reales + una línea de respuesta + un link a la pantalla donde
// seguir trabajando.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js'
import { costRecipes } from '@/lib/recipes/recipe-cost'
import { isStockArea, areaFromLveCategory, AREA_LABEL, type StockArea } from '@/lib/stock/areas'
import { aggregateVentas, type VentasCanal } from '@/lib/ventas/aggregate'

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export type AskScope = 'stock' | 'numeros' | 'control' | 'hoy'

export type AskEntity =
  | 'stock'        // insumos: cuánto hay, qué falta, cuánto vale
  | 'ventas'       // qué se vendió y cuánto facturó
  | 'margen'       // qué plato deja plata (precio − costo de receta)
  | 'produccion'   // qué se produjo, a qué costo, con qué rendimiento
  | 'pedidos'      // qué hay que comprar
  | 'compras'      // qué se gastó, a qué proveedor (gastos de Fudo)

export type StockEstado =
  | 'critico' | 'negativo' | 'sin_contar' | 'sin_proveedor' | 'producidos' | 'sin_area' | 'sin_receta'

export type QueryPlan = {
  entity: AskEntity
  area?: StockArea
  /** Stock: categoría LVE. Ventas: rubro de la carta (menu_categories.name). */
  categoria?: string
  /** el nombre contiene este texto */
  texto?: string
  estado?: StockEstado
  /** ventana temporal en días (ventas, producción, compras) */
  dias?: number
  /** Sólo ventas: canal de venta (pedidosya se deriva del rubro PEDIDOS YA). */
  canal?: VentasCanal
  /** Sólo ventas: día de semana AR (0=domingo … 6=sábado). */
  dia_semana?: number
  /** Sólo ventas: correr la misma ventana inmediatamente anterior y comparar. */
  comparar_con_anterior?: boolean
  /** qué ordenar primero */
  orden?: 'valor' | 'cantidad' | 'margen' | 'peor_margen' | 'reciente' | 'nombre'
  /** Sólo para compras: si el gasto se agrupa por insumo o por proveedor. */
  agrupar?: 'insumo' | 'proveedor'
  limite?: number
}

export type AskColumn = { key: string; label: string; align?: 'left' | 'right' }

export type AskResult = {
  plan: QueryPlan
  /** Frase corta armada con los números REALES que volvieron. */
  answer: string
  columns: AskColumn[]
  rows: Record<string, string | number | null>[]
  /** Total de filas que matchearon (puede ser mayor que rows.length). */
  matched: number
  /** A dónde ir para seguir trabajando con esto. */
  href?: string
  /** Advertencia honesta sobre la calidad del dato. */
  note?: string
  /** Cómo se interpretó la pregunta: 'ia' o 'reglas'. */
  via: 'ia' | 'reglas'
}

const MONEY_ENTITIES: AskEntity[] = ['ventas', 'margen', 'compras']
export function planNeedsManager(plan: QueryPlan): boolean {
  return MONEY_ENTITIES.includes(plan.entity)
}

// ---------------------------------------------------------------------------
// 1) Pregunta → plan
// ---------------------------------------------------------------------------

const PLAN_SCHEMA = `{
  "entity": "stock" | "ventas" | "margen" | "produccion" | "pedidos" | "compras",
  "area": "cocina" | "pasteleria" | "barra" | "descartables" | "limpieza" (opcional),
  "categoria": string (opcional; para stock es la categoría LVE: carnes, verduras, lacteos, panaderia, bebidas, elaborados, condimentos, frutas, desechables, limpieza, otros; para ventas es el rubro de la carta, ej: cafeteria, pizzas),
  "texto": string (opcional, si pregunta por un insumo o plato puntual),
  "estado": "critico" | "negativo" | "sin_contar" | "sin_proveedor" | "producidos" | "sin_area" | "sin_receta" (opcional),
  "dias": number (opcional, ventana temporal; por defecto 30),
  "canal": "local" | "takeaway" | "pedidosya" (opcional, sólo ventas: por dónde salió la venta),
  "dia_semana": number 0-6 (opcional, sólo ventas: 0=domingo … 6=sábado),
  "comparar_con_anterior": boolean (opcional, sólo ventas: comparar contra la misma ventana inmediatamente anterior),
  "orden": "valor" | "cantidad" | "margen" | "peor_margen" | "reciente" | "nombre" (opcional),
  "agrupar": "insumo" | "proveedor" (opcional, sólo para compras: "a quién le compro" es proveedor, "cuánto gasté en carne" es insumo),
  "limite": number (opcional, por defecto 15)
}`

const EXAMPLES = `Ejemplos:
"que me falta en cocina" -> {"entity":"stock","area":"cocina","estado":"critico"}
"que hay en negativo" -> {"entity":"stock","estado":"negativo"}
"insumos que no cuento hace mucho" -> {"entity":"stock","estado":"sin_contar","orden":"reciente"}
"cuanta plata tengo en stock de barra" -> {"entity":"stock","area":"barra","orden":"valor"}
"lo mas caro que tengo guardado" -> {"entity":"stock","orden":"valor"}
"que vendi mas esta semana" -> {"entity":"ventas","dias":7,"orden":"cantidad"}
"cuanto facture el ultimo mes" -> {"entity":"ventas","dias":30,"orden":"valor"}
"que plato deja mas plata" -> {"entity":"margen","orden":"margen"}
"que platos me dejan poco" -> {"entity":"margen","orden":"peor_margen"}
"cuanto me cuesta la milanesa" -> {"entity":"margen","texto":"milanesa"}
"que produje esta semana" -> {"entity":"produccion","dias":7}
"que tengo que comprar" -> {"entity":"pedidos"}
"a quien le compro mas" -> {"entity":"compras","dias":30,"agrupar":"proveedor"}
"cuanto gaste en carne" -> {"entity":"compras","texto":"carne","dias":30}
"platos sin receta cargada" -> {"entity":"margen","estado":"sin_receta"}
"cuanto vendi por pedidosya este mes" -> {"entity":"ventas","canal":"pedidosya","dias":30}
"que se vende mas los sabados" -> {"entity":"ventas","dia_semana":6,"orden":"cantidad"}
"como vino esta semana vs la anterior" -> {"entity":"ventas","dias":7,"comparar_con_anterior":true}
"cuanto facturo la cafeteria este mes" -> {"entity":"ventas","categoria":"cafeteria","dias":30}`

const SCOPE_HINT: Record<AskScope, string> = {
  stock: 'La persona está en la pantalla de Stock. Ante la duda, entity="stock".',
  numeros: 'La persona está en Números (ventas, márgenes, compras). Ante la duda, entity="ventas".',
  control: 'La persona está en el Centro de control (problemas de datos y de stock). Ante la duda, entity="stock".',
  hoy: 'La persona está en Hoy (pedir, recibir, producir, contar). Ante la duda, entity="pedidos".',
}

/** Traductor por palabras clave: cubre lo frecuente sin depender de la IA. */
export function rulePlan(question: string, scope: AskScope): QueryPlan {
  const q = question.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const has = (...words: string[]) => words.some((w) => q.includes(w))

  const plan: QueryPlan = { entity: 'stock' }

  // Ventana temporal
  const nDias = q.match(/(\d+)\s*d(i|í)as?/)
  if (nDias) plan.dias = Math.min(365, Number(nDias[1]))
  else if (has('hoy')) plan.dias = 1
  else if (has('semana')) plan.dias = 7
  else if (has('quincena')) plan.dias = 15
  else if (has('mes')) plan.dias = 30
  else if (has('año', 'ano')) plan.dias = 365

  // Canal de venta. PRIMERO que la entidad: 'pedidosya' contiene 'pedido' y
  // sin este orden "¿cuánto vendí por pedidosya?" se iba a la entidad pedidos.
  const esPedidosYa = has('pedidosya', 'pedidos ya', 'pedidos-ya')
  if (esPedidosYa) {
    plan.canal = 'pedidosya'
    plan.entity = 'ventas'
  } else if (has('para llevar', 'takeaway', 'take away')) {
    plan.canal = 'takeaway'
  } else if (has('en el local', 'en el salon', 'en salon')) {
    plan.canal = 'local'
  }

  // Día de semana (palabras completas, nada de substrings cortos: la lección
  // del listado errado sigue vigente). 'sabado' también matchea 'sabados'.
  const DIAS_SEMANA: [string, number][] = [
    ['domingo', 0], ['lunes', 1], ['martes', 2], ['miercoles', 3],
    ['jueves', 4], ['viernes', 5], ['sabado', 6],
  ]
  for (const [nombre, dow] of DIAS_SEMANA) {
    if (q.includes(nombre)) { plan.dia_semana = dow; break }
  }

  // Comparación contra la ventana anterior. Solo palabras de comparación
  // explícitas: "¿cuánto vendí el mes anterior?" es una VENTANA, no una
  // comparación — 'anterior' a secas no alcanza, tiene que venir con
  // comparar/vs/contra o un "más/menos que la semana/el mes anterior".
  if (has('compara', 'comparad', ' vs ', ' vs.', 'versus', 'contra la', 'contra el',
          'que la semana anterior', 'que el mes anterior', 'que la semana pasada', 'que el mes pasado')) {
    plan.comparar_con_anterior = true
  }

  // Entidad. OJO con el orden y con las palabras cortas: 'coci' matcheaba
  // "cocina" y mandaba "¿qué me falta en cocina?" a producción.
  const preguntaPorFaltante = has('falta', 'critic', 'quiebre', 'sin stock', 'agotad', 'negativo', 'sin contar')
  if (!esPedidosYa && has('comprar', 'pedir', 'pedido', 'repone', 'reponer')) plan.entity = 'pedidos'
  else if (preguntaPorFaltante) plan.entity = 'stock'
  else if (has('margen', 'rinde', 'deja ', 'rentab', 'cuesta', 'costo', 'food cost', 'plato')) plan.entity = 'margen'
  else if (has('gast', 'compre', 'compro', 'compra', 'proveedor', 'pague')) plan.entity = 'compras'
  else if (has('vend', 'factur', 'venta')) plan.entity = 'ventas'
  else if (has('produj', 'produc', 'elabor', 'tanda')) plan.entity = 'produccion'
  else if (scope === 'numeros') plan.entity = 'ventas'
  else if (scope === 'hoy') plan.entity = 'pedidos'

  // Área
  if (has('cocina')) plan.area = 'cocina'
  else if (has('pasteler', 'dulce', 'panader', 'postre')) plan.area = 'pasteleria'
  else if (has('barra', 'bebida', 'cafe', 'trago')) plan.area = 'barra'
  else if (has('descartable', 'vaso', 'bolsa')) plan.area = 'descartables'
  else if (has('limpieza')) plan.area = 'limpieza'

  // Estado
  if (has('negativo')) plan.estado = 'negativo'
  else if (has('falta', 'critic', 'quiebre', 'sin stock', 'agotad')) plan.estado = 'critico'
  else if (has('sin contar', 'no cuento', 'no conte', 'sin conteo')) plan.estado = 'sin_contar'
  else if (has('sin proveedor')) plan.estado = 'sin_proveedor'
  else if (has('sin receta')) plan.estado = 'sin_receta'
  else if (has('produci', 'intermedio', 'elaborado')) plan.estado = 'producidos'
  else if (has('sin area', 'sin sector')) plan.estado = 'sin_area'

  // Nombre puntual: "cuánto me cuesta la milanesa", "cuánto gasté en carne".
  // Solo con disparadores claros, para no filtrar de más ("falta en cocina"
  // no debe convertirse en texto="cocina" y devolver cero resultados).
  const foco = q.match(/(?:cuesta|cuestan|sale|precio de|gaste en|gastamos en|compre de|de)\s+(?:la |el |los |las |un |una )?([a-z0-9ñ ]{3,30}?)(?:\?|$|,| en | este | esta | ultimo| ultima)/)
  if (foco && has('cuesta', 'cuestan', 'sale', 'precio', 'gaste', 'gastamos', 'compre de')) {
    const candidato = foco[1].trim()
    const generic = ['stock', 'cocina', 'barra', 'pasteleria', 'plata', 'total', 'mes', 'semana', 'dia']
    if (candidato.length >= 3 && !generic.includes(candidato)) plan.texto = candidato
  }

  // Compras: ¿por proveedor o por insumo?
  if (plan.entity === 'compras') {
    plan.agrupar = has('quien', 'quién', 'proveedor') && !plan.texto ? 'proveedor' : 'insumo'
  }

  // Orden
  if (has('caro', 'mas plata', 'valor', 'factur')) plan.orden = 'valor'
  else if (has('mas vendi', 'mas se vende', 'mas sale')) plan.orden = 'cantidad'
  else if (has('menos margen', 'peor margen', 'poco margen', 'menos plata', 'pierdo')) plan.orden = 'peor_margen'
  else if (has('mas margen', 'mejor margen', 'deja mas')) plan.orden = 'margen'

  return plan
}

function sanitizePlan(raw: unknown, fallback: QueryPlan): QueryPlan {
  if (!raw || typeof raw !== 'object') return fallback
  const r = raw as Record<string, unknown>
  const entities: AskEntity[] = ['stock', 'ventas', 'margen', 'produccion', 'pedidos', 'compras']
  const estados: StockEstado[] = ['critico', 'negativo', 'sin_contar', 'sin_proveedor', 'producidos', 'sin_area', 'sin_receta']
  const ordenes = ['valor', 'cantidad', 'margen', 'peor_margen', 'reciente', 'nombre'] as const

  const entity = entities.includes(r.entity as AskEntity) ? (r.entity as AskEntity) : fallback.entity
  const plan: QueryPlan = { entity }
  if (isStockArea(r.area)) plan.area = r.area
  if (typeof r.categoria === 'string' && r.categoria.length < 40) plan.categoria = r.categoria
  if (typeof r.texto === 'string' && r.texto.trim()) plan.texto = r.texto.trim().slice(0, 60)
  if (estados.includes(r.estado as StockEstado)) plan.estado = r.estado as StockEstado
  if (typeof r.dias === 'number' && r.dias > 0) plan.dias = Math.min(365, Math.round(r.dias))
  if (r.canal === 'local' || r.canal === 'takeaway' || r.canal === 'pedidosya') plan.canal = r.canal
  // dia_semana acepta 0-6 o el nombre del día
  if (typeof r.dia_semana === 'number' && Number.isInteger(r.dia_semana) && r.dia_semana >= 0 && r.dia_semana <= 6) {
    plan.dia_semana = r.dia_semana
  } else if (typeof r.dia_semana === 'string') {
    const nombres = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado']
    const limpio = r.dia_semana.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
    // Acepta singular y plural ("sabado" / "sabados"); ojo: "lunes" ya termina en s
    const idx = nombres.findIndex((n) => limpio === n || limpio === `${n}s`)
    if (idx >= 0) plan.dia_semana = idx
  }
  if (r.comparar_con_anterior === true) plan.comparar_con_anterior = true
  if (typeof r.orden === 'string' && (ordenes as readonly string[]).includes(r.orden)) plan.orden = r.orden as QueryPlan['orden']
  if (r.agrupar === 'insumo' || r.agrupar === 'proveedor') plan.agrupar = r.agrupar
  if (typeof r.limite === 'number' && r.limite > 0) plan.limite = Math.min(50, Math.round(r.limite))
  return plan
}

export async function planFromQuestion(
  question: string,
  scope: AskScope,
): Promise<{ plan: QueryPlan; via: 'ia' | 'reglas' }> {
  const fallback = rulePlan(question, scope)
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return { plan: fallback, via: 'reglas' }

  const systemPrompt = `Sos el traductor de preguntas de una app de gestión de un restaurante (La Vieja Escuela).
Convertís una pregunta en castellano rioplatense a un JSON con este esquema:
${PLAN_SCHEMA}

${EXAMPLES}

${SCOPE_HINT[scope]}

Respondé SOLO el JSON, sin explicación, sin markdown. Si la pregunta no encaja en ninguna entidad, elegí la más cercana.`

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4',
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question.slice(0, 300) },
        ],
      }),
    })
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
    const json = await res.json()
    const text: string = json.choices?.[0]?.message?.content ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('sin JSON')
    return { plan: sanitizePlan(JSON.parse(match[0]), fallback), via: 'ia' }
  } catch {
    return { plan: fallback, via: 'reglas' }
  }
}

// ---------------------------------------------------------------------------
// 2) Plan → datos reales
// ---------------------------------------------------------------------------

const money = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`
const qty = (n: number) => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Filtra por nombre, pero si no matchea nada devuelve la lista completa con un
 * aviso. Preferible a mostrar "0 resultados" cuando el insumo se llama distinto
 * en el sistema (ej. se pregunta por "milanesa" y el item es "Milanesa cruda").
 */
function filtrarPorNombre<T>(lista: T[], texto: string | undefined, nombreDe: (x: T) => string): { lista: T[]; aviso?: string } {
  if (!texto) return { lista }
  const t = norm(texto)
  const filtrada = lista.filter((x) => norm(nombreDe(x)).includes(t))
  if (filtrada.length > 0) return { lista: filtrada }
  return { lista, aviso: `No encontré nada con "${texto}", así que te muestro todo. Puede que en el sistema se llame distinto.` }
}

function sinceISO(dias: number) {
  return new Date(Date.now() - dias * 86_400_000).toISOString()
}

type StockRow = {
  id: string; name: string; unit: string; category: string | null
  current_qty: number; min_qty: number; cost_per_unit: number | null
  is_produced: boolean | null; supplier_id: string | null
  last_counted_at: string | null; area?: string | null
}

async function runStock(admin: SupabaseClient, plan: QueryPlan): Promise<AskResult> {
  const base = 'id, name, unit, category, current_qty, min_qty, cost_per_unit, is_produced, supplier_id, last_counted_at'
  let res: { data: unknown[] | null; error: { message: string } | null } =
    await admin.from('stock_items').select(`${base}, area`).eq('is_active', true)
  if (res.error) res = await admin.from('stock_items').select(base).eq('is_active', true)
  if (res.error) throw new Error(res.error.message)

  let items = (res.data ?? []) as unknown as StockRow[]
  const areaOf = (i: StockRow): StockArea => (isStockArea(i.area) ? i.area : areaFromLveCategory(i.category))

  if (plan.area) items = items.filter((i) => areaOf(i) === plan.area)
  if (plan.categoria) items = items.filter((i) => i.category === plan.categoria)
  const filtroStock = filtrarPorNombre(items, plan.texto, (i) => i.name)
  items = filtroStock.lista

  const days = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null)
  switch (plan.estado) {
    case 'negativo': items = items.filter((i) => Number(i.current_qty) < 0); break
    case 'critico': items = items.filter((i) => Number(i.current_qty) < 0 || (Number(i.min_qty) > 0 && Number(i.current_qty) <= Number(i.min_qty))); break
    case 'sin_contar': items = items.filter((i) => { const d = days(i.last_counted_at); return d === null || d >= 7 }); break
    case 'sin_proveedor': items = items.filter((i) => !i.supplier_id); break
    case 'producidos': items = items.filter((i) => Boolean(i.is_produced)); break
    case 'sin_area': items = items.filter((i) => !isStockArea(i.area)); break
  }

  const valorDe = (i: StockRow) => (i.cost_per_unit ? Math.max(Number(i.current_qty), 0) * Number(i.cost_per_unit) : 0)
  const matched = items.length
  const valorTotal = items.reduce((s, i) => s + valorDe(i), 0)

  if (plan.orden === 'valor') items = [...items].sort((a, b) => valorDe(b) - valorDe(a))
  else if (plan.orden === 'cantidad') items = [...items].sort((a, b) => Number(b.current_qty) - Number(a.current_qty))
  else if (plan.orden === 'reciente') items = [...items].sort((a, b) => (days(b.last_counted_at) ?? 9999) - (days(a.last_counted_at) ?? 9999))
  else items = [...items].sort((a, b) => Number(a.current_qty) - Number(b.current_qty))

  const limite = plan.limite ?? 15
  const rows = items.slice(0, limite).map((i) => ({
    // La ficha del insumo (kardex, precios, recetas, cadena) queda a un toque.
    _href: `/stock/item/${i.id}`,
    insumo: i.name,
    area: AREA_LABEL[areaOf(i)],
    cantidad: `${qty(i.current_qty)} ${i.unit}`,
    minimo: Number(i.min_qty) > 0 ? qty(i.min_qty) : '—',
    contado: days(i.last_counted_at) === null ? 'nunca' : `hace ${days(i.last_counted_at)}d`,
    valor: i.cost_per_unit ? money(valorDe(i)) : '—',
  }))

  const queHay = plan.estado === 'critico' ? 'en falta'
    : plan.estado === 'negativo' ? 'en negativo'
    : plan.estado === 'sin_contar' ? 'sin contar hace una semana o más'
    : plan.estado === 'sin_proveedor' ? 'sin proveedor asignado'
    : plan.estado === 'producidos' ? 'que se producen en cocina'
    : plan.estado === 'sin_area' ? 'sin área asignada'
    : ''
  const donde = plan.area ? ` en ${AREA_LABEL[plan.area].toLowerCase()}` : ''
  const answer = matched === 0
    ? `No hay insumos ${queHay || 'que cumplan eso'}${donde}.`
    : [`${matched} insumo${matched === 1 ? '' : 's'}`, queHay, donde.trim()]
        .filter(Boolean).join(' ') + `${valorTotal > 0 ? `, ${money(valorTotal)} en stock` : ''}.`

  const href = plan.area ? `/stock?area=${plan.area}` : '/stock'
  return {
    plan, answer, matched, rows, href, via: 'reglas', note: filtroStock.aviso,
    columns: [
      { key: 'insumo', label: 'Insumo' },
      { key: 'area', label: 'Área' },
      { key: 'cantidad', label: 'Hay', align: 'right' },
      { key: 'minimo', label: 'Mín.', align: 'right' },
      { key: 'contado', label: 'Contado', align: 'right' },
      { key: 'valor', label: 'Valor', align: 'right' },
    ],
  }
}

const DOW_NOMBRES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const CANAL_LABEL: Record<VentasCanal, string> = {
  local: 'en el local',
  takeaway: 'para llevar',
  pedidosya: 'por PedidosYa',
}

function fechaARHoy(): string {
  return new Date().toLocaleString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 10)
}

function restarDiasFecha(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

async function runVentas(admin: SupabaseClient, plan: QueryPlan): Promise<AskResult> {
  const dias = plan.dias ?? 30
  const hoy = fechaARHoy()
  const from = restarDiasFecha(hoy, dias - 1)

  // Categoría (rubro de la carta): texto → ids de menu_categories
  let categorias: string[] | undefined
  let avisoCategoria: string | undefined
  if (plan.categoria) {
    const { data: cats } = await admin.from('menu_categories').select('id, name')
    const t = norm(plan.categoria)
    const matcheadas = ((cats ?? []) as { id: string | number; name: string }[])
      .filter((c) => norm(String(c.name)).includes(t))
      .map((c) => String(c.id))
    if (matcheadas.length > 0) categorias = matcheadas
    else avisoCategoria = `No encontré el rubro "${plan.categoria}" en la carta, así que te muestro todo.`
  }

  const filtroBase = {
    canal: plan.canal,
    categorias,
    dows: plan.dia_semana != null ? [plan.dia_semana] : undefined,
  }
  const agg = await aggregateVentas(admin, { from, to: hoy, ...filtroBase })

  let list = agg.byProduct.map((p) => ({ producto: p.nombre, unidades: p.unidades, facturado: p.revenue }))
  const filtroVentas = filtrarPorNombre(list, plan.texto, (r) => r.producto)
  list = filtroVentas.lista

  const totalU = list.reduce((s, r) => s + r.unidades, 0)
  const total$ = list.reduce((s, r) => s + r.facturado, 0)
  const matched = list.length
  list.sort((a, b) => (plan.orden === 'valor' ? b.facturado - a.facturado : b.unidades - a.unidades))

  const rows = list.slice(0, plan.limite ?? 15).map((r) => ({
    producto: r.producto, unidades: qty(r.unidades), facturado: r.facturado > 0 ? money(r.facturado) : '—',
  }))

  const foco = plan.texto ? ` de "${plan.texto}"` : ''
  const conCanal = plan.canal ? ` ${CANAL_LABEL[plan.canal]}` : ''
  const conDia = plan.dia_semana != null ? ` los ${DOW_NOMBRES[plan.dia_semana]}${plan.dia_semana === 0 || plan.dia_semana === 6 ? 's' : ''}` : ''
  let answer = matched === 0
    ? `No hay ventas${foco}${conCanal}${conDia} en los últimos ${dias} días.`
    : `En ${dias} días se vendieron ${qty(totalU)} unidades${foco}${conCanal}${conDia} por ${money(total$)}.`

  // Comparación contra la MISMA ventana inmediatamente anterior
  if (plan.comparar_con_anterior) {
    const prevTo = restarDiasFecha(from, 1)
    const prevFrom = restarDiasFecha(from, dias)
    const prev = await aggregateVentas(admin, { from: prevFrom, to: prevTo, ...filtroBase })
    // Si hay foco por texto, comparar el mismo recorte de productos
    let prevList = prev.byProduct.map((p) => ({ producto: p.nombre, unidades: p.unidades, facturado: p.revenue }))
    if (plan.texto && !filtroVentas.aviso) prevList = filtrarPorNombre(prevList, plan.texto, (r) => r.producto).lista
    const prevU = prevList.reduce((s, r) => s + r.unidades, 0)
    const prev$ = prevList.reduce((s, r) => s + r.facturado, 0)
    const delta$ = total$ - prev$
    const deltaPct = prev$ > 0 ? Math.round((delta$ / prev$) * 100) : null
    const deltaU = totalU - prevU
    answer += prev$ > 0 || prevU > 0
      ? ` Contra los ${dias} días anteriores (${money(prev$)}): ${delta$ >= 0 ? '+' : '−'}${money(Math.abs(delta$))}${deltaPct != null ? ` (${delta$ >= 0 ? '+' : '−'}${Math.abs(deltaPct)}%)` : ''} y ${deltaU >= 0 ? '+' : '−'}${qty(Math.abs(deltaU))} unidades.`
      : ` La ventana anterior no tiene ventas registradas para comparar.`
  }

  return {
    plan, answer, matched, rows, via: 'reglas',
    href: `/ventas?m=${dias <= 1 ? 'dia' : 'mes'}`,
    note: [
      filtroVentas.aviso,
      avisoCategoria,
      'Facturado = cantidad × precio unitario de cada línea en Fudo; las líneas sin precio (consumo interno y promos) quedan afuera.',
      'El registro de ventas se sincroniza a la madrugada: lo de hoy puede estar incompleto.',
    ].filter(Boolean).join(' '),
    columns: [
      { key: 'producto', label: 'Producto' },
      { key: 'unidades', label: 'Unidades', align: 'right' },
      { key: 'facturado', label: 'Facturado', align: 'right' },
    ],
  }
}

async function runMargen(admin: SupabaseClient, plan: QueryPlan): Promise<AskResult> {
  const { data: menu, error } = await admin
    .from('menu_items')
    .select('id, name, sale_price, recipe_id')
    .eq('is_active', true)
  if (error) throw new Error(error.message)

  type Menu = { id: string; name: string; sale_price: number | null; recipe_id: string | null }
  let items = (menu ?? []) as unknown as Menu[]
  const filtroMargen = filtrarPorNombre(items, plan.texto, (m) => m.name)
  items = filtroMargen.lista
  const focoEncontrado = plan.texto ? !filtroMargen.aviso : false

  if (plan.estado === 'sin_receta') {
    const sin = items.filter((m) => !m.recipe_id)
    return {
      plan, matched: sin.length, via: 'reglas', href: '/ventas?m=carta',
      answer: sin.length === 0 ? 'Todos los platos activos tienen receta cargada.' : `${sin.length} platos activos no tienen receta, así que no se les puede calcular el costo.`,
      rows: sin.slice(0, plan.limite ?? 15).map((m) => ({ plato: m.name, precio: m.sale_price ? money(Number(m.sale_price)) : '—', costo: '—', margen: '—', pct: 'sin receta' })),
      columns: [
        { key: 'plato', label: 'Plato' },
        { key: 'precio', label: 'Precio', align: 'right' },
        { key: 'costo', label: 'Costo', align: 'right' },
        { key: 'margen', label: 'Margen', align: 'right' },
        { key: 'pct', label: '%', align: 'right' },
      ],
    }
  }

  const withRecipe = items.filter((m) => m.recipe_id && Number(m.sale_price) > 0)
  const costs = await costRecipes(admin, [...new Set(withRecipe.map((m) => m.recipe_id!))])

  // Solo entran al ranking los platos con costo CONFIABLE completo (todas las
  // líneas con fuente compra/manual/producción). El resto queda afuera y se
  // avisa cuántos son — un margen con costos fantasma es peor que ninguno.
  let excluidos = 0
  const list = withRecipe.map((m) => {
    const c = costs.get(m.recipe_id!)
    const costo = c?.cost ?? 0
    const precio = Number(m.sale_price)
    return { plato: m.name, precio, costo, margen: precio - costo, pct: precio > 0 ? ((precio - costo) / precio) * 100 : 0, confiable: c?.confiable === true }
  }).filter((r) => {
    if (r.confiable && r.costo > 0) return true
    excluidos += 1
    return false
  })

  const matched = list.length
  list.sort((a, b) => (plan.orden === 'peor_margen' ? a.margen - b.margen : b.margen - a.margen))

  const rows = list.slice(0, plan.limite ?? 15).map((r) => ({
    plato: r.plato,
    precio: money(r.precio), costo: money(r.costo), margen: money(r.margen), pct: `${Math.round(r.pct)}%`,
  }))

  const promedio = matched > 0 ? list.reduce((s, r) => s + r.pct, 0) / matched : 0
  const answer = matched === 0
    ? (excluidos > 0
        ? `No hay platos con costo real completo todavía (${excluidos} quedaron afuera por insumos sin precio de compra, manual o de producción).`
        : 'No hay platos con receta y precio como para calcular margen.')
    : focoEncontrado
      ? `${list[0].plato}: se vende a ${money(list[0].precio)}, cuesta ${money(list[0].costo)} y deja ${money(list[0].margen)} (${Math.round(list[0].pct)}%).`
      : `${matched} platos con costo real. Margen promedio ${Math.round(promedio)}%. ${plan.orden === 'peor_margen' ? 'Los que menos dejan, primero.' : 'Los que más dejan, primero.'}`

  return {
    plan, answer, matched, rows, via: 'reglas', href: '/ventas?m=carta',
    note: [
      filtroMargen.aviso,
      'El costo sale de la receta con precios reales (compra/manual/producción).',
      excluidos > 0 ? `${excluidos} ${excluidos === 1 ? 'plato quedó afuera' : 'platos quedaron afuera'} del ranking por no tener costo real completo.` : null,
    ].filter(Boolean).join(' '),
    columns: [
      { key: 'plato', label: 'Plato' },
      { key: 'precio', label: 'Precio', align: 'right' },
      { key: 'costo', label: 'Costo', align: 'right' },
      { key: 'margen', label: 'Deja', align: 'right' },
      { key: 'pct', label: '%', align: 'right' },
    ],
  }
}

async function runProduccion(admin: SupabaseClient, plan: QueryPlan): Promise<AskResult> {
  const dias = plan.dias ?? 30
  const { data, error } = await admin
    .from('production_orders')
    .select('id, name, status, created_at, cost_per_output_unit, total_cost, efficiency_pct')
    .gte('created_at', sinceISO(dias))
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  type Orden = { id: number; name: string; status: string; created_at: string; cost_per_output_unit: number | null; total_cost: number | null; efficiency_pct: number | null }
  let list = (data ?? []) as unknown as Orden[]
  if (plan.texto) { const t = norm(plan.texto); list = list.filter((o) => norm(o.name).includes(t)) }

  const matched = list.length
  const completadas = list.filter((o) => o.status === 'completed').length
  const pendientes = list.filter((o) => o.status === 'pending_review').length
  const costoTotal = list.reduce((s, o) => s + Number(o.total_cost ?? 0), 0)

  const rows = list.slice(0, plan.limite ?? 15).map((o) => ({
    produccion: o.name,
    fecha: new Date(o.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
    estado: o.status === 'completed' ? 'validada' : o.status === 'pending_review' ? 'a validar' : o.status,
    costo_unidad: o.cost_per_output_unit ? money(Number(o.cost_per_output_unit)) : '—',
    eficiencia: o.efficiency_pct != null ? `${o.efficiency_pct}%` : '—',
  }))

  const answer = matched === 0
    ? `No hubo producciones en los últimos ${dias} días.`
    : `${matched} producciones en ${dias} días: ${completadas} validadas${pendientes > 0 ? `, ${pendientes} esperando validación` : ''}${costoTotal > 0 ? `, ${money(costoTotal)} en insumos` : ''}.`

  return {
    plan, answer, matched, rows, via: 'reglas', href: '/stock/produccion',
    note: costoTotal === 0 ? 'El costo por producción se empezó a guardar recién ahora, así que las tandas viejas no lo tienen.' : undefined,
    columns: [
      { key: 'produccion', label: 'Producción' },
      { key: 'fecha', label: 'Fecha' },
      { key: 'estado', label: 'Estado' },
      { key: 'costo_unidad', label: 'Costo/u', align: 'right' },
      { key: 'eficiencia', label: 'Rendim.', align: 'right' },
    ],
  }
}

async function runPedidos(admin: SupabaseClient, plan: QueryPlan): Promise<AskResult> {
  const { generarSugerenciasCompra } = await import('@/lib/compras/sugerencias')
  const payload = await generarSugerenciasCompra(admin)

  let items = payload.groups.flatMap((g) => g.items.map((i) => ({ ...i, proveedor: g.supplier_name, hoy: g.is_order_day })))
  if (plan.area) items = items.filter((i) => i.area === plan.area)
  if (plan.texto) { const t = norm(plan.texto); items = items.filter((i) => norm(i.name).includes(t)) }

  const matched = items.length
  const costo = items.reduce((s, i) => s + (i.estimated_cost ?? 0), 0)
  const hoyToca = payload.groups.filter((g) => g.is_order_day && g.supplier_id).map((g) => g.supplier_name)

  const rows = items.slice(0, plan.limite ?? 15).map((i) => ({
    insumo: i.name,
    motivo: i.reason_label,
    pedir: `${i.suggested_qty} ${i.unit}`,
    proveedor: i.proveedor,
    costo: i.estimated_cost ? money(i.estimated_cost) : '—',
  }))

  const answer = matched === 0
    ? 'No hay nada para pedir: ningún insumo por debajo del mínimo ni por acabarse antes de la próxima entrega.'
    : `${matched} insumos para pedir${costo > 0 ? ` (${money(costo)} estimado)` : ''}.${hoyToca.length > 0 ? ` Hoy toca pedirle a ${hoyToca.join(', ')}.` : ''}`

  return {
    plan, answer, matched, rows, via: 'reglas', href: '/pedidos?step=pedir',
    columns: [
      { key: 'insumo', label: 'Insumo' },
      { key: 'motivo', label: 'Por qué' },
      { key: 'pedir', label: 'Pedir', align: 'right' },
      { key: 'proveedor', label: 'Proveedor' },
      { key: 'costo', label: 'Estimado', align: 'right' },
    ],
  }
}

async function runCompras(admin: SupabaseClient, plan: QueryPlan): Promise<AskResult> {
  void admin
  const { fetchFudoExpenses } = await import('@/lib/fudo/expenses')
  const dias = plan.dias ?? 30
  const gastos = await fetchFudoExpenses(sinceISO(dias))

  const porInsumo = plan.agrupar ? plan.agrupar === 'insumo' : Boolean(plan.texto)
  const acc = new Map<string, { $: number; n: number }>()
  for (const g of gastos) {
    const claves = porInsumo ? (g.ingredientNames.length > 0 ? g.ingredientNames : ['(sin detalle)']) : [g.provider ?? '(sin proveedor)']
    // Un gasto con varios insumos no dice cuánto fue de cada uno: se reparte
    // en partes iguales para no inventar precisión que el dato no tiene.
    const parte = g.amount / claves.length
    for (const k of claves) {
      const cur = acc.get(k) ?? { $: 0, n: 0 }
      cur.$ += parte; cur.n += 1
      acc.set(k, cur)
    }
  }

  let list = [...acc.entries()].map(([nombre, v]) => ({ nombre, gastado: v.$, compras: v.n }))
  const filtroCompras = filtrarPorNombre(list, plan.texto, (r) => r.nombre)
  list = filtroCompras.lista
  list.sort((a, b) => b.gastado - a.gastado)

  const matched = list.length
  const total = list.reduce((s, r) => s + r.gastado, 0)
  const rows = list.slice(0, plan.limite ?? 15).map((r) => ({
    nombre: r.nombre, gastado: money(r.gastado), compras: r.compras,
  }))

  const foco = plan.texto ? ` en "${plan.texto}"` : ''
  const answer = matched === 0
    ? `No hay compras registradas en Fudo${foco} en los últimos ${dias} días.`
    : `${money(total)} gastados${foco} en ${dias} días, sobre ${gastos.length} compras cargadas en Fudo.`

  return {
    plan, answer, matched, rows, via: 'reglas', href: '/ventas?m=precios',
    note: [filtroCompras.aviso, porInsumo ? 'Cuando una compra tiene varios insumos, Fudo no dice cuánto fue de cada uno: el monto se reparte en partes iguales.' : ''].filter(Boolean).join(' ') || undefined,
    columns: [
      { key: 'nombre', label: porInsumo ? 'Insumo' : 'Proveedor' },
      { key: 'compras', label: 'Compras', align: 'right' },
      { key: 'gastado', label: 'Gastado', align: 'right' },
    ],
  }
}

export async function runPlan(admin: SupabaseClient, plan: QueryPlan): Promise<AskResult> {
  switch (plan.entity) {
    case 'ventas': return runVentas(admin, plan)
    case 'margen': return runMargen(admin, plan)
    case 'produccion': return runProduccion(admin, plan)
    case 'pedidos': return runPedidos(admin, plan)
    case 'compras': return runCompras(admin, plan)
    default: return runStock(admin, plan)
  }
}
