import { getNavItems } from '@/lib/navegacion'
import type { AppRole } from '@/types/database'

// ---------------------------------------------------------------------------
// Guía de la app para La Vieja de Historia — la 24
// ---------------------------------------------------------------------------
// Traído de Santa Fe (be162c4) y reescrito para la 24. Dos partes:
//   1. El MENÚ real del rol (sale de lib/navegacion, el mismo que dibuja la
//      barra de abajo): así guía con el camino exacto y nunca inventa pantallas.
//   2. CÓMO SE HACE cada tarea frecuente, filtrado por rol. Si cambia un
//      circuito (envíos de Santa Fe, stock, compras, protocolos), se actualiza
//      acá. Toda dirección que se nombra existe en src/app/(app)/…
// La 24 no produce: la cocina de Santa Fe elabora y manda. Lo de producción
// de Santa Fe (parte de cierre, lista y mínimos, qué producir, lo de hoy) no
// existe acá y no se nombra.
// ---------------------------------------------------------------------------

type Rol = AppRole | string

const GESTION = ['socio', 'encargado']
const COCINA = ['socio', 'encargado', 'chef', 'cocina']
const HORNEAN = ['socio', 'encargado', 'chef', 'cocina', 'barista']
const CUENTAN = ['socio', 'encargado', 'chef', 'cocina', 'barista']
const TODOS = ['socio', 'encargado', 'chef', 'cocina', 'barista', 'runner', 'bacha', 'cajero']

/** El menú tal cual lo ve ese rol: barra de abajo y "Más" agrupado. */
export function menuDelRol(role: Rol): string {
  const nav = getNavItems(role as AppRole)
  const barra = nav.items.map((i) => `${i.label} (${i.href})`).join(' · ')
  const grupos = (nav.more?.groups ?? []).map((g) =>
    `  ${g.label}:\n${g.items.map((i) => `    - ${i.label} (${i.href})${i.description ? `: ${i.description}` : ''}`).join('\n')}`,
  ).join('\n')
  return `Barra de abajo: ${barra}${grupos ? `\nBotón "Más" (abajo a la derecha):\n${grupos}` : ''}`
}

type Tema = { roles: string[]; titulo: string; texto: string }

const TEMAS: Tema[] = [
  // ── Lo que manda Santa Fe ──
  {
    roles: COCINA,
    titulo: 'La 24 no produce: lo elaborado llega de Santa Fe',
    texto: `La cocina de Santa Fe (la casa central) elabora todo y le manda a la 24 lo que hace falta. En la 24 no se registra producción: si alguien pregunta cómo cargar lo que produjo, explicale esto. Aunque Producción (/cocina/produccion) y Contar elaborados aparezcan en el menú, en la 24 no se cargan producciones ni hay elaborados propios: no los sugieras para registrar ni para contar lo que manda Santa Fe.
1) Santa Fe arma el envío y lo manda: en la 24 aparece «En camino desde Santa Fe» en Compras → En camino (/pedidos?step=camino), y llega un aviso a encargados y socios.
2) Cuando llega, un encargado o socio revisa las cantidades, elige la primera vez a qué producto de la 24 corresponde cada uno (después queda guardado), anota lo que llegó de verdad y toca «Llegó». Eso sube el stock en la app y en el Fudo de la 24. No es una compra: no genera gasto ni deuda. Si llegó menos, se anota lo que llegó y queda registrado el faltante (y se avisa).
3) Mientras está en camino, Santa Fe lo puede anular. Los recibidos de los últimos 14 días se ven en Compras → Recibidos.
4) Al cerrar, se cuenta lo que manda Santa Fe en Conteo de cierre (/stock/cierre; también desde Stock, arriba, «Conteo de cierre»): un número por producto. Se guarda como conteo en la app y en el Fudo de la 24, y Santa Fe lo lee para saber qué mandar. Si a las 23 no se contó, la app avisa. La lista de productos y el mínimo de la 24 los manda Santa Fe: si la pantalla dice que Santa Fe todavía no mandó la lista, no hay nada para contar.`,
  },
  // ── Horneado ──
  {
    roles: HORNEAN,
    titulo: 'Horneado (medialunas, bollitos y tortillas)',
    texto: 'Horneado (/cocina/horneado): vienen congelados y se hornean acá. Arriba dice cuántas conviene hornear hoy de cada una (el promedio de lo que salió ese día de la semana en las últimas 4 semanas, según Fudo, partido en mañana y tarde). Se carga cada tanda que sale del horno y, al cierre, cuántas sobraron, cuántas fueron al budín de pan y cuántas se tiraron. Encargados y socios tienen además la pestaña Control: eso cruzado con lo vendido en Fudo, con lo que no cierra.',
  },
  // ── Stock y compras ──
  {
    roles: CUENTAN,
    titulo: 'Stock',
    texto: 'Stock (/stock; la cocina entra por Más → Stock cocina y la barra por Más → Descartables): el inventario con semáforo (🔴 por debajo del mínimo, 🟡 cerca, 🟢 bien), filtrable por área; tocando un insumo se ve su detalle y sus movimientos. Fudo es la fuente: lo que se vende y las compras cargadas en Fudo se reflejan solos. Para contar: botón verde «Conteo guiado» abajo en Stock (/stock/conteo); cada número que se confirma se escribe en Fudo. Lo que manda Santa Fe se cuenta al cerrar en Conteo de cierre (/stock/cierre; en Stock, arriba). Los encargados y socios tienen además, dentro de Stock, Rendimiento, Historial, Consumo y el Centro de control.',
  },
  {
    roles: GESTION,
    titulo: 'Compras y pedidos',
    texto: 'Compras (/pedidos) tiene cuatro pasos: PEDIR (sugiere qué y cuánto por proveedor; se manda por WhatsApp y queda «en camino»), EN CAMINO (lo pedido a proveedores y los envíos de Santa Fe; cuando la compra se carga en Fudo, en Gastos, aparece acá y «Llegó» solo marca que llegó, sin volver a sumar stock), RECIBIDOS (el historial) y PAGOS. Todo comprobante se carga en Fudo y la app lo vincula solo; lo que tiene gasto en Fudo se paga en Fudo y la app lo marca pagado. Cuentas por pagar: /pedidos/cuentas. Historial y descargas (Excel de comprobantes y pagos): /pedidos/gastos.',
  },
  {
    roles: TODOS,
    titulo: 'Avisar que algo se está acabando',
    texto: 'Sugerir compra (/sugerir-compra): cualquiera avisa lo que se acaba, pegando la lista como en WhatsApp o de a uno. Es una sugerencia para el encargado; no hace el pedido. Si lo que falta es algo que manda Santa Fe, se avisa igual al encargado: Santa Fe lo ve en el conteo de cierre.',
  },
  // ── Protocolos y tareas ──
  {
    roles: TODOS,
    titulo: 'Protocolos (tareas con horario)',
    texto: 'Protocolos (/protocolos): tareas con hora fija (limpieza del baño, control de tolva y control de descartables). Cada tarea se asigna a alguien que esté en turno (la automática va a quien tenga turno de ese puesto). Cuando llega la hora aparece un aviso rojo abajo en la pantalla. Se cierra marcando todos los pasos y sacando las fotos que pide. La cierra quien la tiene asignada o un encargado. Si quedó atrasada, el encargado se la puede pasar a quien está trabajando ahora.',
  },
  // ── Personal ──
  {
    roles: TODOS,
    titulo: 'Fichar, horarios y avisos',
    texto: 'Fichar entrada y salida: Mi Turno (/mi-turno). Pide permiso de ubicación porque hay que estar en el local. No se puede fichar por el chat. Mis turnos: Horarios (/mis-horarios). Avisos del equipo: Avisos (/notificaciones). Cambiar la contraseña propia: /cambiar-clave.',
  },
  {
    roles: GESTION,
    titulo: 'Equipo: altas, bajas, roles y turnos',
    texto: 'Equipo y turnos (/equipo): quién está hoy y la lista del personal. Tocando a una persona se abre su ficha: ahí se cambian el rol y los datos, se la pasa a «Inactivo» (baja: deja de entrar a la app y no se borra su historial) y se cambian el email o la contraseña con la que entra. Turnos de la semana: /equipo/turnos (para cargar, /equipo/turnos/cargar). Asistencia de hoy y correcciones de fichajes: /equipo/asistencia. Liquidación de horas: /admin/reportes/liquidacion.',
  },
  {
    roles: ['socio'],
    titulo: 'Ventas y reportes',
    texto: 'Ventas (/ventas): facturación y tickets que vienen del Fudo de la 24 (solo socios). Reportes (/admin/reportes): food cost, márgenes, ventas, stock y turnos por período.',
  },
  // ── Cocina ──
  {
    roles: COCINA,
    titulo: 'Recetario',
    texto: 'Recetario (/recetario): la ficha de cada plato de la carta por porción, qué lleva y cómo se arma («Cómo se arma» lo editan chef, encargados y socios). El costo y el margen de cada plato los ven solo los socios. Lo que descuenta stock al vender es la receta del plato en Fudo.',
  },
  // ── Barra ──
  {
    roles: ['socio', 'encargado', 'barista'],
    titulo: 'Barra',
    texto: 'Tolva (/tolva): el cuaderno de la tolva de café por turno (inicio, agregado y final; el consumo se calcula solo). Descartables (vasos y tapas): se cuentan desde Stock, área descartables, y se descuentan solos al vender para llevar.',
  },
  {
    roles: TODOS,
    titulo: 'Vajilla',
    texto: 'Vajilla (/vajilla): se cargan las roturas y los faltantes y se controla la reposición.',
  },
]

/** Guía completa para el rol: menú + cómo se hace cada cosa. */
export function guiaDeLaApp(role: Rol): string {
  const temas = TEMAS.filter((t) => t.roles.includes(role) || role === 'socio')
  return `MAPA DE LA APP PARA ESTE USUARIO (rol ${role}). Es el menú real: guiá SOLO con estas pantallas y caminos.
${menuDelRol(role)}

CÓMO SE HACE CADA COSA:
${temas.map((t) => `### ${t.titulo}\n${t.texto}`).join('\n\n')}`
}
