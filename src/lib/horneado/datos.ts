import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { dow, sumar } from './fechas'
import { BUDIN_DE_PAN, PARTE_MANANA, PIEZAS, type BalanceDia, type ControlHorneado, type Pieza, type Recomendado, type Registro, type TipoRegistro } from './config'

// ---------------------------------------------------------------------------
// Control de horneado (solo servidor): registros, ventas de Fudo y balance
// ---------------------------------------------------------------------------
// Traído de Santa Fe (Marco, a39e324). Ventas: la copia de Fudo de la app
// (fudo_sales = ítems, fudo_sale_subitems = opciones como las 2 del Clásico),
// por día operativo (de 06:00 a 06:00). En la 24 se importan durante el día
// en el pulso; el control igual mira hasta ayer, que está completo.
// Diferencia con Santa Fe: el control empieza el día siguiente al primero con
// algo cargado (allá es una fecha fija), así el día que se arranca a mitad no
// aparece con faltantes.
// ---------------------------------------------------------------------------

export const MIGRACION_HORNEADO = '20261125_horneado.sql'
export const faltaTablaHorneado = (m: string | undefined) => !!m && /horneado_registros/.test(m) && /(does not exist|schema cache|not find)/i.test(m)

/** Comienzo de un día operativo: 06:00 de Argentina */
const inicioDia = (f: string) => `${f}T06:00:00-03:00`

type Respuesta<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/** Trae todas las filas, de a 1000 (el máximo que devuelve Supabase por vez) */
async function todas<T>(q: (desde: number, hasta: number) => Respuesta<T>): Promise<T[]> {
  const out: T[] = []
  for (let a = 0; ; a += 1000) {
    const { data, error } = await q(a, a + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return out
}

type PorDia = Map<string, Map<string, number>>

const sumarEn = (m: PorDia, fecha: string, id: string, q: number) => {
  const d = m.get(fecha) ?? new Map<string, number>()
  d.set(id, (d.get(id) ?? 0) + q)
  m.set(fecha, d)
}

/** Unidades vendidas por día operativo y producto de Fudo: ítems y opciones por separado */
async function ventasPorDia(admin: SupabaseClient, desde: string, hasta: string): Promise<{ items: PorDia; opciones: PorDia }> {
  const ids = [...new Set([...PIEZAS.flatMap((p) => [...p.venta, ...p.opcion, ...p.personal]), BUDIN_DE_PAN])]
  type Fila = { fudo_product_id: string; quantity: number; sold_at: string }
  const consulta = (tabla: 'fudo_sales' | 'fudo_sale_subitems') => todas<Fila>((a, b) =>
    admin.from(tabla).select('fudo_product_id, quantity, sold_at')
      .in('fudo_product_id', ids)
      .gte('sold_at', inicioDia(desde))
      .lt('sold_at', inicioDia(sumar(hasta, 1)))
      .order('sold_at')
      .range(a, b))
  const [filasItems, filasOpciones] = await Promise.all([consulta('fudo_sales'), consulta('fudo_sale_subitems')])
  const items: PorDia = new Map(), opciones: PorDia = new Map()
  for (const f of filasItems) sumarEn(items, fechaOperativa(new Date(f.sold_at)), String(f.fudo_product_id), Number(f.quantity) || 0)
  for (const f of filasOpciones) sumarEn(opciones, fechaOperativa(new Date(f.sold_at)), String(f.fudo_product_id), Number(f.quantity) || 0)
  return { items, opciones }
}

const suma = (m: Map<string, number> | undefined, ids: string[]) => ids.reduce((a, id) => a + (m?.get(id) ?? 0), 0)

/** Vendidas (sueltas + en combos) y consumo del personal de una pieza en un día */
function salidas(v: { items: PorDia; opciones: PorDia }, pieza: Pieza, fecha: string) {
  const p = PIEZAS.find((x) => x.pieza === pieza)!
  return {
    vendidas: suma(v.items.get(fecha), p.venta) + suma(v.opciones.get(fecha), p.opcion),
    personal: suma(v.items.get(fecha), p.personal),
  }
}

/** Cuántas hornear cada día de la semana (0 = domingo): promedio de las últimas 4 semanas */
function recomendadoPorDia(v: { items: PorDia; opciones: PorDia }, pieza: Pieza, hasta: string): Record<number, Recomendado> {
  const porDow = new Map<number, number[]>()
  for (let i = 0; i < 28; i++) {
    const f = sumar(hasta, -i)
    const s = salidas(v, pieza, f)
    porDow.set(dow(f), [...(porDow.get(dow(f)) ?? []), s.vendidas + s.personal])
  }
  const out: Record<number, Recomendado> = {}
  for (const [d, lista] of porDow) {
    const total = Math.ceil(lista.reduce((a, b) => a + b, 0) / lista.length)
    const manana = Math.ceil(total * PARTE_MANANA)
    out[d] = { total, manana, tarde: total - manana, semanas: lista.length }
  }
  return out
}

export async function registrosEntre(admin: SupabaseClient, desde: string, hasta: string): Promise<{ registros: Registro[]; falta_migracion: boolean }> {
  const { data, error } = await admin.from('horneado_registros').select('*').gte('fecha', desde).lte('fecha', hasta).order('created_at')
  if (error) {
    if (faltaTablaHorneado(error.message)) return { registros: [], falta_migracion: true }
    throw new Error(error.message)
  }
  return { registros: (data ?? []) as Registro[], falta_migracion: false }
}

/** Primer día con algo cargado (null = todavía nada) */
async function primerDiaCargado(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.from('horneado_registros').select('fecha').order('fecha').limit(1)
  if (error) return null
  return ((data ?? []) as { fecha: string }[])[0]?.fecha ?? null
}

/** Lo registrado de una pieza en un día, por tipo */
function delDia(registros: Registro[], pieza: Pieza, fecha: string) {
  const r = registros.filter((x) => x.pieza === pieza && x.fecha === fecha)
  const total = (t: TipoRegistro) => r.filter((x) => x.tipo === t).reduce((a, x) => a + x.cantidad, 0)
  const sob = r.find((x) => x.tipo === 'sobrante')
  return { horneadas: total('tanda'), budin: total('budin'), tirado: total('tirado'), sobrante: sob ? sob.cantidad : null }
}

// ---------------------------------------------------------------------------

/** Para la pantalla de Horneado: lo de hoy y cuántas conviene hornear hoy */
export async function horneadoDeHoy(admin: SupabaseClient) {
  const hoy = fechaOperativa()
  const ayer = sumar(hoy, -1)
  const [{ registros, falta_migracion }, ventas] = await Promise.all([
    registrosEntre(admin, ayer, hoy),
    ventasPorDia(admin, sumar(ayer, -27), ayer),
  ])
  return {
    hoy,
    falta_migracion,
    registros: registros.filter((r) => r.fecha === hoy),
    piezas: PIEZAS.map((p) => ({
      pieza: p.pieza,
      nombre: p.nombre,
      singular: p.singular,
      recomendado: recomendadoPorDia(ventas, p.pieza, ayer)[dow(hoy)] ?? null,
      sobroAyer: delDia(registros, p.pieza, ayer).sobrante,
    })),
  }
}

/** Para el control (encargados y socios): balance de los últimos días, hasta ayer */
export async function controlHorneado(admin: SupabaseClient, dias = 14): Promise<ControlHorneado> {
  const ayer = fechaOperativa(new Date(Date.now() - 86_400_000))
  const desde = sumar(ayer, -(dias - 1))
  const desdeVentas = sumar(ayer, -27) < desde ? sumar(ayer, -27) : desde
  const [{ registros, falta_migracion }, ventas, primero] = await Promise.all([
    registrosEntre(admin, sumar(desde, -1), ayer),
    ventasPorDia(admin, desdeVentas, ayer),
    primerDiaCargado(admin),
  ])
  const inicio = primero ? sumar(primero, 1) : null

  const fechas: string[] = []
  for (let f = desde; f <= ayer; f = sumar(f, 1)) fechas.push(f)

  const budinVendido: Record<string, number> = {}
  for (const f of fechas) budinVendido[f] = suma(ventas.items.get(f), [BUDIN_DE_PAN]) + suma(ventas.opciones.get(f), [BUDIN_DE_PAN])

  return {
    desde,
    hasta: ayer,
    inicio,
    falta_migracion,
    budinVendido,
    piezas: PIEZAS.map((p) => ({
      pieza: p.pieza,
      nombre: p.nombre,
      singular: p.singular,
      umbral: p.umbral,
      recomendadoSemana: recomendadoPorDia(ventas, p.pieza, ayer),
      dias: fechas.map((f): BalanceDia => {
        const r = delDia(registros, p.pieza, f)
        const antes = delDia(registros, p.pieza, sumar(f, -1))
        const s = salidas(ventas, p.pieza, f)
        const antesDelControl = !inicio || f < inicio
        const entra = r.horneadas + (antes.sobrante ?? 0)
        const sale = s.vendidas + s.personal + r.budin + r.tirado + (r.sobrante ?? 0)
        return {
          fecha: f,
          horneadas: r.horneadas,
          sobranteAyer: antes.sobrante,
          vendidas: s.vendidas,
          personal: s.personal,
          budin: r.budin,
          tirado: r.tirado,
          sobrante: r.sobrante,
          diferencia: entra - sale,
          sinTandas: !antesDelControl && r.horneadas === 0 && s.vendidas + s.personal > 0,
          sinConteo: !antesDelControl && r.sobrante == null,
          antesDelControl,
        }
      }),
    })),
  }
}

// ---------------------------------------------------------------------------
// Cargar y borrar
// ---------------------------------------------------------------------------

export type ResultadoHorneado = { ok: true } | { ok: false; status: number; error: string }

export async function agregarRegistro(admin: SupabaseClient, userId: string, r: { pieza: Pieza; tipo: TipoRegistro; cantidad: number; nota: string | null }): Promise<ResultadoHorneado> {
  const fecha = fechaOperativa()
  const fila = { fecha, pieza: r.pieza, tipo: r.tipo, cantidad: r.cantidad, nota: r.nota?.trim().slice(0, 200) || null, created_by: userId }
  // Lo que sobró se cuenta una vez por día: si ya estaba, se reemplaza
  if (r.tipo === 'sobrante') {
    const { error: e1 } = await admin.from('horneado_registros').delete().eq('fecha', fecha).eq('pieza', r.pieza).eq('tipo', 'sobrante')
    if (e1) return { ok: false, status: faltaTablaHorneado(e1.message) ? 503 : 500, error: faltaTablaHorneado(e1.message) ? `Falta correr la migración ${MIGRACION_HORNEADO}` : e1.message }
  }
  const { error } = await admin.from('horneado_registros').insert(fila)
  if (error) return { ok: false, status: faltaTablaHorneado(error.message) ? 503 : 500, error: faltaTablaHorneado(error.message) ? `Falta correr la migración ${MIGRACION_HORNEADO}` : error.message }
  return { ok: true }
}

/** Borra un registro: quien lo cargó (el mismo día) o un encargado/socio */
export async function borrarRegistro(admin: SupabaseClient, user: { id: string; role: string }, id: string): Promise<ResultadoHorneado> {
  const { data } = await admin.from('horneado_registros').select('id, fecha, created_by').eq('id', id).maybeSingle()
  const r = data as { id: string; fecha: string; created_by: string | null } | null
  if (!r) return { ok: false, status: 404, error: 'Ya no existe' }
  const gestion = user.role === 'socio' || user.role === 'encargado'
  if (!gestion && (r.created_by !== user.id || r.fecha !== fechaOperativa())) {
    return { ok: false, status: 403, error: 'Solo lo borra quien lo cargó (el mismo día) o un encargado' }
  }
  const { error } = await admin.from('horneado_registros').delete().eq('id', id)
  return error ? { ok: false, status: 500, error: error.message } : { ok: true }
}
