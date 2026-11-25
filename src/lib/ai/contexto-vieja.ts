import type { SupabaseClient } from '@supabase/supabase-js'
import { fechaOperativa, instanteDe } from '@/lib/attendance/jornada'
import { convertQty } from '@/lib/produccion/units'
import { estadoConteoHoy } from '@/lib/stock/conteo-diario'
import { horneadoDeHoy } from '@/lib/horneado/datos'

// ---------------------------------------------------------------------------
// Datos en vivo para La Vieja de Historia (el asistente) — la 24
// ---------------------------------------------------------------------------
// Traído de Santa Fe (be162c4) y adaptado: la 24 NO produce, recibe lo que
// elabora la cocina de Santa Fe. Por eso acá no hay producciones para
// confirmar, partes de cierre ni lista de mínimos (son de Santa Fe), y sí:
//   · equipo activo (sale de la base, siempre al día)
//   · envíos de Santa Fe (envios_entrantes: en camino y los últimos recibidos)
//   · conteo de cierre de lo que manda Santa Fe (Stock → Conteo de cierre)
//   · horneado de medialunas, bollitos y tortillas
//   · protocolos del día
// Se lee con el cliente admin (los permisos por rol los decide la ruta del
// chat antes de llamar). Solo lectura. Todo en hora argentina y con el día
// operativo (corte 06:00), igual que el resto de la app.
// ---------------------------------------------------------------------------

const TZ = 'America/Argentina/Tucuman'

/** "14:05" en hora argentina */
export function horaAR(iso: string | null | undefined): string {
  if (!iso) return '?'
  return new Date(iso).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** "miércoles, 25 de noviembre de 2026, 14:05" */
export function ahoraTextoAR(d = new Date()): string {
  return d.toLocaleString('es-AR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** "20/11" en hora argentina */
function diaAR(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit' })
}

const num = (n: number) => Number(Number(n).toFixed(3)).toLocaleString('es-AR')

type Perfil = { id: string; first_name: string | null; last_name: string | null; role: string; puesto: string | null; is_active: boolean }

export async function cargarPerfiles(admin: SupabaseClient): Promise<Map<string, Perfil>> {
  const { data } = await admin.from('profiles').select('id, first_name, last_name, role, puesto, is_active')
  return new Map(((data ?? []) as Perfil[]).map((p) => [p.id, p]))
}

const nombreDe = (perfiles: Map<string, Perfil>, id: string | null | undefined) => {
  const p = id ? perfiles.get(id) : null
  return p ? [p.first_name, p.last_name].filter(Boolean).join(' ') || '?' : '?'
}

const ROL_TXT: Record<string, string> = {
  socio: 'Socios', encargado: 'Encargados', chef: 'Jefe/a de cocina (chef)', cocina: 'Cocina',
  barista: 'Barra (baristas)', runner: 'Salón (runners)', bacha: 'Bacha',
  cajero: 'Caja (con permisos de encargado)',
}

/** Equipo activo de la 24 agrupado por puesto (sale de la base: siempre al día). */
export function contextoEquipo(perfiles: Map<string, Perfil>): string {
  const activos = [...perfiles.values()].filter((p) => p.is_active)
  const porRol = new Map<string, string[]>()
  for (const p of activos) {
    const n = [p.first_name, p.last_name].filter(Boolean).join(' ')
    if (!n) continue
    // El cajero tiene role 'encargado' y puesto 'cajero' (lib/roles: puestoDe)
    const puesto = p.puesto ?? p.role
    porRol.set(puesto, [...(porRol.get(puesto) ?? []), n])
  }
  const orden = ['socio', 'encargado', 'cajero', 'chef', 'cocina', 'barista', 'runner', 'bacha']
  const lugar = (r: string) => (orden.indexOf(r) === -1 ? 99 : orden.indexOf(r))
  const lineas = [...porRol.entries()]
    .sort(([a], [b]) => lugar(a) - lugar(b))
    .map(([rol, ns]) => `- ${ROL_TXT[rol] ?? rol}: ${ns.sort().join(', ')}`)
  return `EQUIPO ACTIVO HOY EN LA APP DE LA 24 (${activos.length} personas; quien no está acá fue dado de baja o no tiene usuario):\n${lineas.join('\n')}`
}

// ---- Envíos de Santa Fe ------------------------------------------------------

type Envio = {
  id: string; estado: string; enviado_at: string; enviado_por: string | null; nota: string | null
  recibido_at: string | null; recibido_por: string | null; nota_recepcion: string | null
}
type ItemEnvio = { envio_id: string; nombre: string; cantidad: number; unidad: string; cantidad_recibida: number | null; stock_item_id: string | null; error: string | null }

/** Lo que mandó Santa Fe: lo que está en camino y los últimos recibidos o anulados. */
export async function contextoEnvios(admin: SupabaseClient, perfiles: Map<string, Perfil>): Promise<string> {
  try {
    const hace7 = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const { data, error } = await admin.from('envios_entrantes')
      .select('id, estado, enviado_at, enviado_por, nota, recibido_at, recibido_por, nota_recepcion')
      .or(`estado.eq.en_camino,enviado_at.gte.${hace7}`)
      .order('enviado_at', { ascending: false })
      .limit(8)
    if (error) return 'ENVÍOS DE SANTA FE: no se pudieron leer ahora.'
    const envios = (data ?? []) as Envio[]
    if (!envios.length) return 'ENVÍOS DE SANTA FE: no hay envíos en camino ni de los últimos 7 días.'

    const { data: filas } = await admin.from('envios_entrantes_items')
      .select('envio_id, nombre, cantidad, unidad, cantidad_recibida, stock_item_id, error')
      .in('envio_id', envios.map((e) => e.id))
      .order('created_at')
    const items = (filas ?? []) as ItemEnvio[]
    const ids = [...new Set(items.map((i) => i.stock_item_id).filter((x): x is string => Boolean(x)))]
    const { data: insumos } = ids.length ? await admin.from('stock_items').select('id, name, unit').in('id', ids) : { data: [] }
    const insumo = new Map(((insumos ?? []) as { id: string; name: string; unit: string }[]).map((s) => [s.id, s]))

    const ESTADO: Record<string, string> = { en_camino: '🚚 EN CAMINO (falta tocar «Llegó»)', recibido: '✅ llegó', anulado: '❌ anulado por Santa Fe' }
    const lineas = envios.map((e) => {
      const suyos = items.filter((i) => i.envio_id === e.id)
      const detalle = suyos.map((i) => `${num(i.cantidad)} ${i.unidad} ${i.nombre}`).join(', ').slice(0, 400)
      // Faltantes: lo que llegó (unidad de la 24) contra lo mandado convertido a esa unidad
      const faltas = e.estado !== 'recibido' ? [] : suyos.flatMap((i) => {
        const s = i.stock_item_id ? insumo.get(i.stock_item_id) : null
        if (!s || i.cantidad_recibida == null) return []
        const mandado = convertQty(Number(i.cantidad), i.unidad, s.unit)
        return mandado != null && Number(i.cantidad_recibida) < mandado - 0.0005
          ? [`${s.name}: llegaron ${num(i.cantidad_recibida)} ${s.unit} de ${num(mandado)} ${s.unit}`]
          : []
      })
      const errores = suyos.filter((i) => i.error).map((i) => `${i.nombre}: ${i.error}`)
      return `- Salió ${diaAR(e.enviado_at)} ${horaAR(e.enviado_at)}${e.enviado_por ? ` (mandó ${e.enviado_por})` : ''} · ${ESTADO[e.estado] ?? e.estado}`
        + `${e.recibido_at ? ` el ${diaAR(e.recibido_at)} ${horaAR(e.recibido_at)}, recibió ${nombreDe(perfiles, e.recibido_por)}` : ''}`
        + ` · ${detalle || 'sin productos'}`
        + `${e.nota ? ` · nota de Santa Fe: «${e.nota.slice(0, 160)}»` : ''}`
        + `${faltas.length ? `\n  ⚠️ Llegó con faltantes: ${faltas.join('; ')}` : ''}`
        + `${e.nota_recepcion ? `\n  Nota al recibir: «${e.nota_recepcion.slice(0, 160)}»` : ''}`
        + `${errores.length ? `\n  No se sumó al stock: ${errores.join('; ').slice(0, 300)}` : ''}`
    })
    const enCamino = envios.filter((e) => e.estado === 'en_camino').length
    return `ENVÍOS DE SANTA FE (en camino y últimos 7 días; se reciben en Compras → En camino, /pedidos?step=camino${enCamino ? `; ${enCamino} en camino` : ''}):\n${lineas.join('\n')}`
  } catch (err) {
    console.error('[contexto-vieja] envíos:', err)
    return 'ENVÍOS DE SANTA FE: no se pudieron leer ahora.'
  }
}

// ---- Conteo de cierre de lo que manda Santa Fe --------------------------------

/** ¿Se contó hoy lo que manda Santa Fe? (la misma cuenta que Hoy y el aviso de las 23) */
export async function contextoConteoCierre(admin: SupabaseClient): Promise<string> {
  try {
    const e = await estadoConteoHoy(admin)
    if (e.destino.url !== '/stock/cierre') {
      return 'CONTEO DE CIERRE (/stock/cierre): Santa Fe todavía no mandó la lista de productos que cuenta la 24; hasta que la mande, la pantalla aparece vacía.'
    }
    const estado = e.contados >= e.total && e.total > 0
      ? `✅ hecho: ${e.contados} de ${e.total} productos contados`
      : e.contados > 0 ? `a medias: ${e.contados} de ${e.total} productos contados` : `⏳ todavía no se contó (${e.total} productos)`
    return `CONTEO DE CIERRE DE HOY (lo que manda Santa Fe; Stock → Conteo de cierre, /stock/cierre): ${estado}${e.ultimo ? `, último a las ${horaAR(e.ultimo)}` : ''}. Con ese conteo Santa Fe sabe qué mandar.`
  } catch (err) {
    console.error('[contexto-vieja] conteo de cierre:', err)
    return 'CONTEO DE CIERRE: no se pudo leer ahora.'
  }
}

// ---- Horneado ---------------------------------------------------------------

/** Horneado de hoy: cuántas conviene hornear y lo que ya se cargó, por pieza. */
export async function contextoHorneado(admin: SupabaseClient): Promise<string> {
  try {
    const h = await horneadoDeHoy(admin)
    if (h.falta_migracion) return 'HORNEADO: la pantalla todavía no está habilitada (falta la tabla).'
    const lineas = h.piezas.map((p) => {
      const suyos = h.registros.filter((r) => r.pieza === p.pieza)
      const total = (t: string) => suyos.filter((r) => r.tipo === t).reduce((a, r) => a + r.cantidad, 0)
      const tandas = suyos.filter((r) => r.tipo === 'tanda')
      const sobrante = suyos.find((r) => r.tipo === 'sobrante')
      const rec = p.recomendado
      return `- ${p.nombre}: conviene hornear ${rec ? `${rec.total} (${rec.manana} a la mañana y ${rec.tarde} a la tarde si hace falta)` : 'sin datos'}`
        + ` · horneadas hoy ${total('tanda')}${tandas.length ? ` en ${tandas.length} tanda${tandas.length > 1 ? 's' : ''}` : ''}`
        + `${sobrante ? ` · sobraron al cierre ${sobrante.cantidad}` : ''}`
        + `${total('budin') ? ` · al budín de pan ${total('budin')}` : ''}`
        + `${total('tirado') ? ` · tiradas ${total('tirado')}` : ''}`
        + `${p.sobroAyer != null ? ` · sobraron ayer ${p.sobroAyer}` : ''}`
    })
    return `HORNEADO DE HOY (día operativo ${h.hoy}; medialunas, bollitos y tortillas vienen congelados y se hornean acá; se carga en Horneado, /cocina/horneado; "conviene hornear" es el promedio de lo que salió ese día de la semana en las últimas 4 semanas de Fudo):\n${lineas.join('\n')}`
  } catch (err) {
    console.error('[contexto-vieja] horneado:', err)
    return 'HORNEADO: no se pudo leer ahora.'
  }
}

// ---- Protocolos -------------------------------------------------------------

/** Protocolos del día: los encargados ven todos; el resto, los suyos. */
export async function contextoProtocolos(admin: SupabaseClient, perfiles: Map<string, Perfil>, opts: { verTodos: boolean; userId: string }, ahora = new Date()): Promise<string> {
  const hoy = fechaOperativa(ahora)
  let q = admin.from('protocolo_tareas').select('hora, estado, asignado_a, hecho_por, hecho_at, protocolos(nombre)').eq('fecha', hoy).order('hora')
  if (!opts.verTodos) q = q.eq('asignado_a', opts.userId)
  const { data } = await q
  type Tarea = { hora: string | null; estado: string; asignado_a: string | null; hecho_por: string | null; hecho_at: string | null; protocolos: { nombre: string } | null }
  const tareas = (data ?? []) as unknown as Tarea[]
  if (!tareas.length) return opts.verTodos ? 'PROTOCOLOS DE HOY: no hay tareas generadas.' : 'TUS PROTOCOLOS DE HOY: no tenés tareas asignadas.'
  const ya = ahora.getTime()
  const lineas = tareas.map((t) => {
    const atrasada = t.estado !== 'hecha' && t.hora && instanteDe(hoy, t.hora).getTime() < ya
    const estado = t.estado === 'hecha'
      ? `✅ hecha por ${nombreDe(perfiles, t.hecho_por)} a las ${horaAR(t.hecho_at)}`
      : `${atrasada ? '🔴 atrasada' : '⏳ pendiente'}${t.asignado_a ? `, asignada a ${nombreDe(perfiles, t.asignado_a)}` : ', sin asignar'}`
    return `- ${t.hora?.slice(0, 5) ?? 'sin hora'} ${t.protocolos?.nombre ?? 'Protocolo'}: ${estado}`
  })
  return `${opts.verTodos ? 'PROTOCOLOS DE HOY' : 'TUS PROTOCOLOS DE HOY'}:\n${lineas.join('\n')}`
}
