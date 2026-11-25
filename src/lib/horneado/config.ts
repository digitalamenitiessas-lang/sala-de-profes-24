// ---------------------------------------------------------------------------
// Control de horneado — qué se controla y cómo se cuenta en Fudo
// ---------------------------------------------------------------------------
// Traído de Santa Fe (Marco, a39e324, 24/11/2026) con los productos del Fudo
// de la 24 (verificado 25/11 con las ventas de 28 días):
//   · venta: el producto suelto y el de PedidosYa (la medialuna de jamón y
//     queso lleva una)
//   · opcion: elegido dentro del Clásico (trae 2 a elegir: en 28 días salieron
//     317 medialunas, 255 tortillas y 126 bollitos así)
//   · personal: lo que consume el equipo. La 24 no tiene productos "personal"
//     de panadería: va vacío.
// Se usa igual en el servidor y en el navegador.
// ---------------------------------------------------------------------------

export type Pieza = 'medialuna' | 'bollito' | 'tortilla'
export type TipoRegistro = 'tanda' | 'sobrante' | 'budin' | 'tirado'

export const PIEZAS: { pieza: Pieza; nombre: string; singular: string; venta: string[]; opcion: string[]; personal: string[]; umbral: number }[] = [
  // Medialuna (60), Medialuna J&Q (75), Medialuna PEYA (251), Medialuna J&Q PEYA (265) · en el Clásico
  { pieza: 'medialuna', nombre: 'Medialunas', singular: 'medialuna', venta: ['60', '75', '251', '265'], opcion: ['60'], personal: [], umbral: 4 },
  // Bollito (73), Bollito PEYA (264) · en el Clásico
  { pieza: 'bollito', nombre: 'Bollitos', singular: 'bollito', venta: ['73', '264'], opcion: ['73'], personal: [], umbral: 2 },
  // Tortilla fina (72), Tortilla Fina PEYA (263) · en el Clásico. No la tortilla de papa (77, 274)
  { pieza: 'tortilla', nombre: 'Tortillas', singular: 'tortilla', venta: ['72', '263'], opcion: ['72'], personal: [], umbral: 2 },
]

/** Budín de pan (100): suelto y como postre de los menús, para ver si las sobrantes de verdad salen */
export const BUDIN_DE_PAN = '100'

export const ETIQUETA_TIPO: Record<TipoRegistro, string> = {
  tanda: 'Tanda horneada',
  sobrante: 'Sobraron al cierre',
  budin: 'Al budín de pan',
  tirado: 'Se tiraron',
}

/** Parte de lo del día que conviene hornear a la mañana (el resto, a la tarde si hace falta) */
export const PARTE_MANANA = 0.6

export type Registro = {
  id: string
  fecha: string
  pieza: Pieza
  tipo: TipoRegistro
  cantidad: number
  nota: string | null
  created_by: string | null
  created_at: string
}

/** Cuántas hornear: promedio de lo que salió ese día de la semana, redondeado para arriba */
export type Recomendado = { total: number; manana: number; tarde: number; semanas: number }

/** Balance de un día: lo que entró contra lo que salió */
export type BalanceDia = {
  fecha: string
  horneadas: number
  /** Lo que quedó al cierre del día anterior */
  sobranteAyer: number | null
  vendidas: number
  personal: number
  budin: number
  tirado: number
  /** Lo que quedó al cierre (null = no se contó) */
  sobrante: number | null
  /** horneadas + sobró ayer − (vendidas + personal + budín + tiradas + sobró hoy). Positivo: faltan. Negativo: salieron más de las cargadas. */
  diferencia: number
  sinTandas: boolean
  sinConteo: boolean
  /** Antes de empezar a cargar las tandas (o el primer día, que se empezó a mitad): no se controla */
  antesDelControl: boolean
}

export type ControlHorneado = {
  desde: string
  hasta: string
  /** Primer día que se controla: el siguiente al primero con algo cargado (null = todavía nada) */
  inicio: string | null
  piezas: { pieza: Pieza; nombre: string; singular: string; umbral: number; dias: BalanceDia[]; recomendadoSemana: Record<number, Recomendado> }[]
  /** Porciones de budín de pan vendidas por día (suelto y en menús) */
  budinVendido: Record<string, number>
  falta_migracion: boolean
}

export type Alerta = { nivel: 'rojo' | 'ambar'; texto: string }

/** Alertas del día anterior (como en el control interno de Santa Fe) */
export function alertasHorneado(c: ControlHorneado | null | undefined): Alerta[] {
  if (!c || c.falta_migracion) return []
  const A: Alerta[] = []
  for (const p of c.piezas) {
    const d = p.dias[p.dias.length - 1]
    if (!d || d.antesDelControl) continue
    const nombre = p.nombre.toLowerCase()
    const salieron = d.vendidas + d.personal
    if (d.sinTandas) A.push({ nivel: 'ambar', texto: `Ayer no se cargaron las tandas de ${nombre} (salieron ${salieron})` })
    else if (d.diferencia > p.umbral) A.push({ nivel: 'rojo', texto: `Ayer faltan ${d.diferencia} ${nombre} sin explicar` })
    else if (d.diferencia < -p.umbral) A.push({ nivel: 'ambar', texto: `Ayer salieron ${-d.diferencia} ${nombre} más de las cargadas` })
    if (d.horneadas > 0 && d.sinConteo) A.push({ nivel: 'ambar', texto: `Ayer no se contaron las ${nombre} que sobraron` })
  }
  return A.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'rojo' ? -1 : 1))
}
