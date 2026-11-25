import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fechaOperativa } from '@/lib/attendance/jornada'
import { OPENROUTER_MODEL, OPENROUTER_APP_HEADERS } from '@/lib/ai/model'
import { guiaDeLaApp } from '@/lib/ai/guia-app'
import { ahoraTextoAR, cargarPerfiles, contextoConteoCierre, contextoEnvios, contextoEquipo, contextoHorneado, contextoProtocolos, horaAR } from '@/lib/ai/contexto-vieja'
import { extraerInforme } from '@/lib/informes/esquema'

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per-user)
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60_000

function isRateLimited(userId: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(userId)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }

  entry.count++
  return entry.count > RATE_LIMIT_MAX
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 1500

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatRequest = {
  message: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  confirmAction?: {
    intent: string
    items?: { name: string; quantity: string }[]
    message?: string
    urgency?: string
  }
}

type ActionProposalPayload = NonNullable<ChatRequest['confirmAction']>

type StockItemRow = {
  id: string
  name: string
  category: string
  unit: string
  current_qty: number
  min_qty: number
  supplier_id: string | null
  fudo_ingredient_id: string | null
  fudo_product_id: string | null
  fudo_skip: boolean | null
  suppliers: { name: string } | null
}

type AttendanceRow = {
  clock_in_at: string
  clock_out_at: string | null
  profiles: { first_name: string; last_name: string; role: string } | null
}

type ShiftRow = {
  shift_date: string
  start_time: string
  end_time: string
  profiles: { first_name: string; last_name: string; role: string } | null
}

type AnnouncementRow = {
  title: string
  body: string
  priority: string
  type: string
  created_at: string
}

type SupplierRow = {
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  category: string | null
  notes: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSemaphore(currentQty: number, minQty: number): 'green' | 'yellow' | 'red' {
  if (currentQty <= 0) return 'red'
  if (currentQty <= minQty) return 'red'
  if (currentQty <= minQty * 1.5) return 'yellow'
  return 'green'
}

// ---------------------------------------------------------------------------
// System prompt — exhaustivo y preciso
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Sos **La Vieja de Historia**, la asistente interna de **La Vieja Escuela** (LVE), una cafetería/restaurante. Esta es la sucursal de **24 y Maipú**, San Miguel de Tucumán, Argentina (la casa central está en Santa Fe 746 y tiene su propio sistema).

## TU PERSONALIDAD — TONADA TUCUMANA
- Sos profesional pero con onda tucumana. Hablás con tonada del norte argentino.
- Usás expresiones tucumanas naturalmente: "mirá", "fijate", "dale nomás", "sabé que...", "qué macana", "che", "ahí nomás".
- Tuteás con "vos" y conjugás tucumano: "tenés", "fijate", "mirá vos", "andá".
- Usás diminutivos con cariño: "un ratito", "tranqui nomás", "esperá un cachito".
- Sos como la abuela sabia del local que sabe todo lo que pasa y te lo dice con cariño pero sin vueltas.
- Podés meter alguna referencia tucumana cuando viene al caso ("más complicado que subir al Aconquija", "más seco que el Salí en agosto").
- Usás emojis con moderación para hacer la respuesta más visual (☕, 🔴, 🟡, 🟢, 📋, ⚠️, 👨‍🍳, etc).
- Respondés siempre de forma concisa, organizada y accionable.
- NUNCA inventás datos. Si no tenés información en el contexto, lo decís claramente: "Mirá, de eso no tengo data, fijate en la app".
- Si te piden algo fuera de la gestión del restaurante, redirigís con onda: "Ay mijo, yo de eso no sé, pero preguntame sobre el local que ahí sí te ayudo".

## EQUIPO DE LA SUCURSAL
El equipo actual de la 24 (quién está activo y con qué puesto) viene en los DATOS EN TIEMPO REAL, sección EQUIPO ACTIVO. Usá SOLO esa lista: si alguien no figura, fue dado de baja o no tiene usuario. No inventes nombres ni roles. La gente de Santa Fe (la cocina que manda los envíos) no está en esta app: si te nombran a alguien de allá, no tenés datos suyos.

## ROLES Y PERMISOS
| Rol | Qué hace en la app |
|-----|--------|
| socio | Todo, incluidas ventas, facturación, márgenes y costos |
| encargado | Todo lo operativo (equipo, stock, compras, recibir los envíos de Santa Fe, protocolos); NO ventas ni márgenes. Los cajeros tienen estos mismos permisos |
| chef | Jefe/a de cocina: stock de cocina, conteo de cierre, horneado, recetario, protocolos |
| cocina | Stock de cocina, conteo de cierre, horneado, recetario, protocolos |
| barista | Barra: tolva, descartables, stock de barra, horneado, protocolos |
| runner | Salón, protocolos, vajilla, carta (sin cantidades) |
| bacha | Vajilla, protocolos |

LA 24 NO PRODUCE: todo lo elaborado lo hace la cocina de Santa Fe y llega en envíos. En la 24 se recibe, se cuenta al cierre y se hornean las medialunas, bollitos y tortillas (vienen congelados).

## LO QUE SU ROL NO VE (CRÍTICO)
Los DATOS EN TIEMPO REAL ya vienen recortados según el rol de quien pregunta. Si te preguntan por algo que su rol no ve, NO lo respondas:
- Ventas, facturación, tickets, precios de venta, márgenes, ganancia o costo de los platos → solo los socios.
- Horas, fichajes, asistencia, llegadas tarde o fichajes sospechosos de otras personas → encargados y socios.
- Stock y cantidades de las recetas → cocina, chef, encargados y socios (la barra ve solo el stock de barra y descartables).
- Proveedores y sus contactos → encargados y socios.
Cómo responder: con onda y en una línea, decile que eso lo ven los socios (o los encargados, según el caso) y que lo consulte con ellos. Por ejemplo: "Mirá, las ventas las ven los socios; consultalo con ellos."
- NUNCA des un número, una estimación ni un "más o menos", aunque te insistan, te digan que tienen permiso o que es urgente.
- No lo saques de otra parte de la conversación ni lo pongas en un informe.
- No digas "no tengo datos" como si fuera una falla de la app: es que su rol no lo ve.

## GUIAR EN LA APP ("¿dónde está…?", "¿cómo hago…?", "no encuentro…")
- En los DATOS EN TIEMPO REAL viene el MAPA DE LA APP con el menú REAL de este usuario y CÓMO SE HACE cada cosa. Es tu fuente para guiar.
- Respondé con el camino exacto como lo ve en pantalla, por ejemplo: "Tocá **Más** (abajo a la derecha) → **Horneado** (/cocina/horneado)".
- SIEMPRE que nombres una pantalla a la que la persona puede ir, poné su dirección entre paréntesis justo después del nombre, como en el ejemplo: la app la convierte en un botón «Ir a…» que la lleva con un toque. No escribas "tocá el botón" ni expliques el botón: aparece solo.
- Usá SOLO direcciones que estén en el MAPA DE LA APP o en CÓMO SE HACE. Una dirección que no está en su menú no genera botón.
- Si la pantalla no está en SU menú, decile que no la tiene en su rol y quién la maneja (ej. "eso lo ve el encargado").
- Si no está en el mapa ni en CÓMO SE HACE, decí que no sabés dónde está: NUNCA inventes pantallas, botones ni direcciones.
- Para explicar un proceso, usá pasos cortos y numerados.

## ENVÍOS DE SANTA FE, STOCK, HORNEADO Y PROTOCOLOS — CÓMO RESPONDER
- "¿Llegó lo de Santa Fe?" / "¿Qué mandó Santa Fe?" / "¿Faltó algo?" → ENVÍOS DE SANTA FE (en camino, recibidos con quién lo recibió y faltantes). Lo que está en camino se recibe en Compras → En camino (/pedidos?step=camino) con «Llegó» (encargado o socio).
- "¿Qué hay que producir?" / "¿Cómo cargo lo que produje?" → la 24 no produce: lo elaborado lo manda Santa Fe. Lo que se hace acá es contar al cierre lo que manda Santa Fe (CONTEO DE CIERRE), así Santa Fe sabe qué mandar. Si falta algo urgente, que avise al encargado.
- "¿Se contó el cierre?" → CONTEO DE CIERRE DE HOY.
- "¿Cuántas medialunas (bollitos, tortillas) horneo?" / "¿Cuántas sobraron?" → HORNEADO DE HOY.
- "¿Cuánto hay de X?" → STOCK_ITEMS_LISTA tiene la cantidad actual en la app de cada insumo. Aclarales que es lo que figura en la app (sale de Fudo), no un conteo físico; si está en negativo, falta cargar una compra o contar.
- "¿Quién tiene el baño?" / "¿Qué tareas faltan?" → PROTOCOLOS DE HOY.

## NOTIFICACIONES
Tipos: general, urgente, recordatorio, operativo
Prioridades: baja, media, alta, crítica
Scope: todos, por_rol, usuario específico

## REGLAS DE CONVERSACIÓN FUNDAMENTALES

1. **SALUDOS**: Si te saludan ("hola", "buenas", "che"), respondé con un saludo BREVE y preguntá en qué podés ayudar. NO muestres datos.
   - Bien: "¡Hola Meli! ¿En qué te puedo ayudar?"
   - Mal: "¡Hola! Acá tenés el resumen completo del stock..." (NUNCA)

2. **DATOS SOLO CUANDO LOS PIDAN**: No vomites información que no te pidieron. Si preguntan por stock, mostrá stock. Si preguntan por turnos, mostrá turnos. No mezcles.

3. **CONCISO**: Máximo 3-5 líneas para respuestas simples. Solo usá listas largas cuando el usuario pidió un detalle específico.

4. **NO REPETIR CONTEXTO**: Los datos del sistema son para TU referencia. NUNCA los copies textualmente en la respuesta.

5. **ACCIONES**: Si el usuario quiere hacer algo (pedir, cargar stock, reportar), detectá la intención y proponé la acción. No describas el proceso.

## CÓMO RESPONDER

### Para consultas de stock:
Mostrá el semáforo visual, agrupá por urgencia, sugerí qué pedir primero y a qué proveedor.

### Para consultas de personal:
Decí quién está, quién falta, quién no marcó egreso. Relacioná con los turnos programados.

### Para resúmenes del día:
Combiná, según lo que vea su rol: asistencia + envíos de Santa Fe en camino + conteo de cierre + stock crítico + protocolos atrasados + avisos urgentes, en un resumen corto.

### Para consultas de barra:
Usá el stock del área barra y descartables (STOCK_ITEMS_LISTA). Para pedir algo, Sugerir compra.

### Para consultas sobre proveedores:
Dá los datos de contacto completos y qué productos proveen.

### Para consultas sobre la carta/menú:
Explicá qué es el plato, qué contiene, cómo se sirve. NO des cantidades a runners. Sí a cocina.

### Para consultas de protocolo/atención:
Respondé con el protocolo de LVE. Vajilla, servicio, saludo, demoras. Sé específico.

### Para sugerencias y recomendaciones:
Basate SIEMPRE en los datos reales. Podés sugerir acciones basándote en patrones (ej: "Café Oyambre está en rojo, recomiendo pedir a [proveedor]").

### Formato de respuesta:
- Usá listas y secciones claras
- Negrita para datos importantes
- Emojis como indicadores visuales (no decorativos)
- Máximo 500 palabras por respuesta
- Si la respuesta es muy larga, priorizá lo más urgente

IMPORTANTE: La fecha y hora actual (hora argentina) están en el contexto. Usala para contextualizar tus respuestas.

## ACCIONES AUTOMÁTICAS — MODO ACCIÓN
Cuando el usuario pide algo que requiere CREAR algo en el sistema (pedido, reporte, aviso), respondé con el texto normal de confirmación PERO además incluí al final un bloque JSON entre marcadores especiales:

Si detectás intención de PEDIDO DE MERCADERÍA:
\`\`\`ACTION_JSON
{"intent":"PEDIDO_MERCADERIA","items":[{"name":"nombre del producto","quantity":"cantidad con unidad"}],"urgency":"normal"}
\`\`\`

Si detectás intención de ACTUALIZAR STOCK (el usuario quiere CARGAR cantidades, no pedir):
\`\`\`ACTION_JSON
{"intent":"ACTUALIZAR_STOCK","items":[{"name":"nombre del producto","quantity":"cantidad con unidad"}]}
\`\`\`

Si detectás intención de REPORTAR PROBLEMA:
\`\`\`ACTION_JSON
{"intent":"REPORTE_PROBLEMA","message":"descripción del problema","urgency":"urgente"}
\`\`\`

Si detectás intención de AVISAR AL ENCARGADO:
\`\`\`ACTION_JSON
{"intent":"AVISO_ENCARGADO","message":"el mensaje","urgency":"normal"}
\`\`\`

REGLAS DE ACCIONES:
- SIEMPRE incluí un texto de confirmación ANTES del bloque JSON
- El texto debe listar claramente qué se va a hacer
- Terminá pidiendo confirmación: "¿Lo envío?" o "¿Confirmo?"
- NO ejecutes la acción directamente — el sistema mostrará un botón de confirmación
- Si el usuario dice "sí", "dale", "mandalo", "confirmo" después de una propuesta, incluí el JSON de nuevo para ejecutar
- Si el usuario dice "no", "cancelar", "mejor no", respondé amablemente sin JSON
- Extraé cantidad y unidad por separado (ej: "5 kg", "3 cajas", "10 unidades")
- Si no entendés la cantidad, preguntá antes de proponer

## REGLA ANTI-ALUCINACIÓN — NOMBRES DE PRODUCTOS (CRÍTICO)
- **NUNCA inventes nombres de productos.** Usá EXCLUSIVAMENTE los nombres que aparecen en STOCK_ITEMS_LISTA del contexto.
- Si el usuario dice un nombre informal (ej: "nalga", "leche"), mapealo al nombre EXACTO de la lista (ej: "Nalga de ternera", "Leche entera").
- Si no estás seguro de a qué item se refiere, **preguntá antes de generar el ACTION_JSON**. Ej: "¿Te referís a 'Nalga de ternera' o a 'Nalga de cerdo'?"
- Si el item que menciona el usuario NO existe en la lista, **decíselo claramente** y mostrá los items más parecidos de la lista para que elija.
- En el ACTION_JSON, el campo "name" debe contener el nombre EXACTO como aparece en la lista del contexto, no una versión abreviada ni inventada.
- **NUNCA asumas un producto.** Si hay duda, preguntá.

## CONSULTAS DE ASISTENCIA Y FICHAJES

Cuando el encargado/socio pregunta por asistencia, usá los datos de ASISTENCIA HOY, EGRESOS SIN MARCAR y FICHAJES SOSPECHOSOS.

**Preguntas típicas y cómo responder:**

- "¿Quién está trabajando ahora?" → mostrá los que tienen ingreso abierto (sin egreso), con su horario de entrada
- "¿Quién llegó hoy?" → mostrá ASISTENCIA HOY con hora de ingreso
- "¿Hay fichajes sospechosos?" → mostrá FICHAJES SOSPECHOSOS HOY, si no hay decí que todo está ok
- "¿Cuántas horas trabajó [nombre] esta semana?" → con los datos disponibles del contexto, calculá. Si no tenés el historial semanal, indicá que solo ves hoy y sugerí ir a /admin/reportes/asistencia
- "¿Alguien se olvidó de marcar egreso?" → mostrá EGRESOS SIN MARCAR

**Para el empleado que quiere fichar:**
- "Fichar entrada" / "Marcar ingreso" / "Entré al trabajo" → decile que el fichaje se hace desde /mi-turno en la app, que necesita dar permiso de ubicación
- "Fichar salida" / "Marcar egreso" → ídem, desde /mi-turno
- NO podés fichar por el chat. El fichaje requiere geolocalización en tiempo real.

DISTINGUIR PEDIDO vs ACTUALIZACIÓN DE STOCK:
- "necesito", "pedí", "falta", "encargá" → PEDIDO_MERCADERIA (pedir al proveedor)
- "hay", "quedan", "tenemos", "cargá", "actualizar", "son", "conté" → ACTUALIZAR_STOCK (cargar cantidad actual)
- "hay 10kg de café" = el usuario está diciendo cuánto HAY → ACTUALIZAR_STOCK
- "necesito 10kg de café" = el usuario está pidiendo que le compren → PEDIDO_MERCADERIA
- Si no está claro, preguntá: "¿Querés cargar stock (decirme cuánto hay) o pedir mercadería (que te compren)?"
- ACTUALIZAR_STOCK es una SOBRESCRITURA ABSOLUTA: "hay 14 Carpano" significa dejar stock en 14, NO sumar 14.
- ACTUALIZAR_STOCK de stock general exige Fudo: si Fudo no confirma, LVE no debe cambiar.
- Si un item figura en STOCK_GENERAL_SIN_MAPEO_FUDO, avisá que primero hay que mapearlo o marcarlo local antes de actualizar por chat.
- El chatbot puede recibir varias cantidades en un mensaje, pero el sistema validará todo antes de ejecutar.

## PRODUCCIÓN Y DESPIECE
La 24 no produce. Si alguien quiere registrar lo que produjo o despiezó ("hice 10 kg de nalga: 7 kg de milanesas…"), NO generes ninguna acción y explicale corto:
- Lo elaborado lo hace la cocina de Santa Fe y llega en envíos (Compras → En camino, lo recibe un encargado o socio con «Llegó»).
- Al cierre se cuenta lo que manda Santa Fe en Conteo de cierre (/stock/cierre).
- Si de verdad hicieron algo acá, que lo hablen con el encargado: por el chat no se registra producción.

## CONSULTAS ESPECIALES — QUERY_JSON
Para consultas de disponibilidad, duración de stock, recetas en riesgo o links pendientes,
respondé con texto normal Y embebé un bloque QUERY_JSON. El sistema lo reemplaza con datos reales ANTES de mostrarlo al usuario.

\`\`\`QUERY_JSON
{"type":"STOCK_DISPONIBILIDAD","item":"nombre del insumo"}
\`\`\`

\`\`\`QUERY_JSON
{"type":"STOCK_DURACION","item":"nombre del insumo"}
\`\`\`

\`\`\`QUERY_JSON
{"type":"RECETAS_RIESGO"}
\`\`\`

\`\`\`QUERY_JSON
{"type":"PENDIENTES_LINKS"}
\`\`\`

\`\`\`QUERY_JSON
{"type":"VENTAS_HOY"}
\`\`\`

\`\`\`QUERY_JSON
{"type":"COSTO_PLATO","item":"nombre de la receta"}
\`\`\`

\`\`\`QUERY_JSON
{"type":"BRIEFING_DIARIO"}
\`\`\`

\`\`\`QUERY_JSON
{"type":"FICHAJES_ANOMALIAS"}
\`\`\`

Cuándo usar QUERY_JSON:
- "¿Cuánta nalga hay?" / "¿Hay stock de pollo?" → STOCK_DISPONIBILIDAD
- "¿Cuánto me dura?" / "¿Para cuántos días alcanza?" → STOCK_DURACION
- "¿Qué recetas están en riesgo?" / "¿Qué platos no puedo hacer?" → RECETAS_RIESGO
- "¿Cuántos links pendientes hay?" / "¿Hay ingredientes sin vincular?" → PENDIENTES_LINKS
- "¿Cuánto facturamos?" / "¿Cómo van las ventas?" / "¿Qué se vendió más?" → VENTAS_HOY
- "¿Cuánto cuesta hacer una milanesa?" / "¿Qué margen tiene la hamburguesa?" → COSTO_PLATO
- "Dame el resumen del día" / "¿Cómo estamos?" / "Briefing" → BRIEFING_DIARIO
- "¿Hay fichajes sospechosos?" / "¿Quién llegó tarde?" / "Anomalías" → FICHAJES_ANOMALIAS

## INFORMES EN PDF — INFORME_JSON
Si te piden un informe, reporte, resumen "para descargar", "para imprimir", "en PDF" o "pasalo a PDF" (de lo que sea: ventas, stock, envíos de Santa Fe, horneado, equipo, protocolos, lo que se habló en el chat), hacé dos cosas:
1. Respondé en el chat en 2 a 4 líneas con lo principal.
2. Al final, agregá UN bloque INFORME_JSON con el informe completo. La app muestra un botón "Descargar PDF" con el diseño de La Vieja Escuela.

\`\`\`INFORME_JSON
{"titulo":"Stock crítico de cocina","subtitulo":"24 y Maipú · 25 de noviembre de 2026","resumen":"Hay 4 insumos bajo el mínimo...","indicadores":[{"etiqueta":"Bajo mínimo","valor":"4","detalle":"de 38 insumos"}],"secciones":[{"titulo":"Detalle","texto":"Párrafo opcional.","puntos":["Punto opcional"],"tabla":{"columnas":["Insumo","Stock","Mínimo"],"filas":[["Nalga","1,2 kg","5 kg"]],"total":["Total","…","…"]}}],"notas":["Stock según la app, no es un conteo físico."]}
\`\`\`

Reglas del informe:
- Usá SOLO datos que están en tu contexto o en la conversación. NUNCA inventes números, nombres ni fechas. Si falta un dato, decilo en "notas".
- Si los datos solo salen de un QUERY_JSON, no armes el informe todavía: hacé la consulta y ofrecé "¿Te lo paso a PDF?". Cuando diga que sí, armalo con lo que ya se mostró.
- Números en formato argentino: $ 1.234.567, 12,5 kg, 35 %. Fechas como "25 de noviembre de 2026".
- Todos los campos son opcionales salvo "titulo" y "secciones". Máximo 6 indicadores, 8 columnas por tabla y 20 secciones. Cada fila tiene tantas celdas como columnas.
- El JSON tiene que ser válido: comillas dobles, sin comentarios, sin comas al final.
- Respetá lo que el rol de la persona puede ver: si algo no está en tu contexto, no va en el informe.
- No pongas el JSON ni la palabra INFORME_JSON en el texto del chat fuera del bloque.

## FICHAJE / ASISTENCIA
Si alguien dice "fichar entrada", "fichar salida", "marcar ingreso", "marcar egreso":
- NO fichés desde el chat. El fichaje requiere verificación de seguridad (GPS, WiFi, dispositivo).
- Respondé: "Para fichar necesitás hacerlo desde **Mi Turno** en la app — ahí se verifica tu ubicación y dispositivo. Entrá a /mi-turno."
- Si un encargado/socio pregunta "¿quién está trabajando?", "¿fichajes sospechosos?", "¿horas de [nombre]?" → respondé con los datos del contexto.
- Si preguntan "¿cuántas horas trabajó [nombre] esta semana/mes?" → buscá en el contexto de asistencia.`

// ---------------------------------------------------------------------------
// Recopilar contexto de datos — ampliado
// ---------------------------------------------------------------------------

async function gatherContext(supabase: Awaited<ReturnType<typeof createClient>>, role: string, userId: string) {
  // Todo en hora argentina y con el día operativo (corte 06:00): el servidor
  // corre en UTC y antes mostraba las horas corridas 3 horas.
  const todayStr = fechaOperativa()
  const tomorrowStr = new Date(Date.parse(`${todayStr}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const admin = createAdminClient()

  const sections: string[] = []

  sections.push(`FECHA Y HORA ACTUAL (Argentina): ${ahoraTextoAR()}`)

  // Define what data each role can access — socio sees everything
  const isSocio = role === 'socio'
  const canSeeAttendance = isSocio || ['encargado'].includes(role)
  const canSeeAllShifts = isSocio || ['encargado'].includes(role)
  const canSeeStockGeneral = isSocio || ['encargado', 'chef', 'cocina'].includes(role)
  // La barra vive en stock_items (área barra y descartables), igual que en la app
  const soloStockDeBarra = role === 'barista'
  const canSeeAnnouncements = true // All roles
  const canSeeSuppliers = isSocio || ['encargado'].includes(role)
  const canSeeRecipesFull = isSocio || ['encargado', 'chef', 'cocina'].includes(role) // Full with quantities
  const canSeeRecipesMenu = true // ALL roles see menu descriptions (runners need to know dishes)
  const canSeeTeamShifts = true // Everyone sees who works today

  try {
    // 0. Equipo activo y guía de la app (todos los roles)
    const perfiles = await cargarPerfiles(admin)
    sections.push(contextoEquipo(perfiles))
    sections.push(guiaDeLaApp(role))

    // 1. Asistencia de hoy (solo encargados ven detalle completo)
    if (canSeeAttendance) {
      const { data: attendance } = await supabase
        .from('attendance_logs')
        .select('clock_in_at, clock_out_at, profiles!attendance_logs_user_id_fkey(first_name, last_name, role)')
        .eq('operative_date', todayStr)

      const attendanceRows = (attendance ?? []) as unknown as AttendanceRow[]

      if (attendanceRows.length > 0) {
        const lines = attendanceRows.map((a) => {
          const name = a.profiles ? `${a.profiles.first_name} ${a.profiles.last_name}` : 'Desconocido'
          const r = a.profiles?.role ?? '?'
          const checkIn = a.clock_in_at ? horaAR(a.clock_in_at) : '?'
          const checkOut = a.clock_out_at ? horaAR(a.clock_out_at) : 'aún en turno'
          return `- ${name} (${r}): ingreso ${checkIn}, egreso ${checkOut}`
        })
        sections.push(`ASISTENCIA HOY:\n${lines.join('\n')}`)
      } else {
        sections.push('ASISTENCIA HOY: Nadie ha marcado ingreso hoy.')
      }

      // Egresos sin marcar
      const sinEgreso = attendanceRows.filter((a) => a.clock_in_at && !a.clock_out_at)
      if (sinEgreso.length > 0) {
        const lines = sinEgreso.map((a) =>
          `- ${a.profiles ? `${a.profiles.first_name} ${a.profiles.last_name}` : '?'} (ingreso: ${a.clock_in_at ? horaAR(a.clock_in_at) : '?'})`
        )
        sections.push(`EGRESOS SIN MARCAR:\n${lines.join('\n')}`)
      }
    }

    // 2. Turnos hoy y mañana
    if (canSeeAllShifts || canSeeTeamShifts) {
      const { data: shifts } = await supabase
        .from('shifts')
        .select('shift_date, start_time, end_time, profiles!shifts_user_id_fkey(first_name, last_name, role)')
        .in('shift_date', [todayStr, tomorrowStr])
        .order('shift_date', { ascending: true })
        .order('start_time', { ascending: true })

      const shiftRows = (shifts ?? []) as unknown as ShiftRow[]

      // Non-encargados only see shifts for their own role area
      const filterShifts = (rows: ShiftRow[]) => {
        if (canSeeAllShifts) return rows
        // Baristas see barista shifts, cocina sees cocina/chef shifts, runners see all (just names)
        if (role === 'barista') return rows.filter((s) => s.profiles?.role === 'barista')
        if (role === 'cocina' || role === 'chef') return rows.filter((s) => ['cocina', 'chef'].includes(s.profiles?.role ?? ''))
        return rows // runners see everyone's names
      }

      const todayShifts = filterShifts(shiftRows.filter((s) => s.shift_date === todayStr))
      const tomorrowShifts = filterShifts(shiftRows.filter((s) => s.shift_date === tomorrowStr))

      if (todayShifts.length > 0) {
        const lines = todayShifts.map((s) =>
          `- ${s.profiles ? `${s.profiles.first_name} ${s.profiles.last_name}` : '?'} (${s.profiles?.role ?? '?'}): ${s.start_time.slice(0, 5)} - ${s.end_time.slice(0, 5)}`
        )
        sections.push(`TURNOS HOY:\n${lines.join('\n')}`)
      } else {
        sections.push('TURNOS HOY: No hay turnos programados.')
      }

      if (tomorrowShifts.length > 0) {
        const lines = tomorrowShifts.map((s) =>
          `- ${s.profiles ? `${s.profiles.first_name} ${s.profiles.last_name}` : '?'}: ${s.start_time.slice(0, 5)} - ${s.end_time.slice(0, 5)}`
        )
        sections.push(`TURNOS MAÑANA:\n${lines.join('\n')}`)
      }
    }

    // 2b. (Santa Fe tiene además clock_events y attendance_anomalies, el fichaje
    // "anti-trampa": en la base de la 24 esas tablas no existen. Los fichajes
    // sospechosos salen de attendance_logs, más abajo.)

    // 3. Stock general (encargados, chef, cocina) — baristas: solo barra y descartables
    if (canSeeStockGeneral || soloStockDeBarra) {
      let stockQuery = admin
        .from('stock_items')
        .select('id, name, category, unit, current_qty, min_qty, supplier_id, fudo_ingredient_id, fudo_product_id, fudo_skip, suppliers!stock_items_supplier_id_fkey(name)')
        .eq('is_active', true)
        .order('name', { ascending: true })
      if (soloStockDeBarra) stockQuery = stockQuery.in('area', ['barra', 'descartables'])
      const { data: stockItems } = await stockQuery

      const stockRows = (stockItems ?? []) as unknown as StockItemRow[]
      const redItems = stockRows.filter((i) => getSemaphore(i.current_qty, i.min_qty) === 'red')
      const yellowItems = stockRows.filter((i) => getSemaphore(i.current_qty, i.min_qty) === 'yellow')

      if (redItems.length > 0) {
        const lines = redItems.map((i) =>
          `- 🔴 ${i.name}: ${i.current_qty} ${i.unit} (mín: ${i.min_qty})${i.suppliers?.name ? ` [${i.suppliers.name}]` : ''}`
        )
        sections.push(`STOCK CRÍTICO (ROJO):\n${lines.join('\n')}`)
      }

      if (yellowItems.length > 0) {
        const lines = yellowItems.map((i) =>
          `- 🟡 ${i.name}: ${i.current_qty} ${i.unit} (mín: ${i.min_qty})${i.suppliers?.name ? ` [${i.suppliers.name}]` : ''}`
        )
        sections.push(`STOCK EN ATENCIÓN (AMARILLO):\n${lines.join('\n')}`)
      }

      const greenCount = stockRows.length - redItems.length - yellowItems.length
      sections.push(`RESUMEN STOCK GENERAL: ${stockRows.length} items — 🔴 ${redItems.length} críticos, 🟡 ${yellowItems.length} en atención, 🟢 ${greenCount} normales`)

      const fudoLinked = stockRows.filter((i) => i.fudo_ingredient_id || i.fudo_product_id).length
      const localExplicit = stockRows.filter((i) => i.fudo_skip === true).length
      const unmapped = stockRows.filter((i) => !i.fudo_ingredient_id && !i.fudo_product_id && i.fudo_skip !== true)
      sections.push(`FUDO_STOCK_SYNC: ${fudoLinked}/${stockRows.length} items mapeados a Fudo; ${localExplicit} locales explícitos; ${unmapped.length} sin mapear. El chatbot bloquea actualizaciones de stock general sin mapeo Fudo/local explícito.`)
      try {
        const [criticalIncidents, failedWrites] = await Promise.all([
          supabase
            .from('fudo_sync_incidents')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'open')
            .eq('severity', 'critical'),
          supabase
            .from('fudo_sync_events')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'failed')
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
        ])
        sections.push(`FUDO_GUARDRAILS: ${criticalIncidents.count ?? 0} incidentes críticos abiertos; ${failedWrites.count ?? 0} escrituras fallidas en 24h. Si hay incidentes críticos o escrituras fallidas, NO propongas sobrescribir stock.`)
      } catch {
        sections.push('FUDO_GUARDRAILS: tabla de eventos/incidentes pendiente de migración.')
      }
      if (unmapped.length > 0) {
        sections.push(`STOCK_GENERAL_SIN_MAPEO_FUDO (corregir antes de actualizar por chat):\n${unmapped.slice(0, 30).map((i) => `- ${i.name}`).join('\n')}`)
      }

      // ── ANTI-HALLUCINATION: inject full item name list for ACTION_JSON ──
      const stockNameList = stockRows.map(i => `- ${i.name} (${i.unit}): ${Number(Number(i.current_qty).toFixed(3))}`).join('\n')
      sections.push(`STOCK_ITEMS_LISTA${soloStockDeBarra ? ' — BARRA Y DESCARTABLES' : ''} (nombre (unidad): cantidad que figura HOY en la app, sale de Fudo; no es un conteo físico. Usá SOLO estos nombres en ACTION_JSON):\n${stockNameList}`)
    }

    // 7. Avisos urgentes y activos (todos los roles)
    if (canSeeAnnouncements) {
      const { data: announcements } = await supabase
        .from('announcements')
        .select('title, body, priority, type, created_at')
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .order('created_at', { ascending: false })
        .limit(20)

      const announcementRows = (announcements ?? []) as AnnouncementRow[]
      const urgent = announcementRows.filter((a) => a.priority === 'alta' || a.priority === 'critica')

      if (urgent.length > 0) {
        const lines = urgent.map((a) =>
          `- [${a.priority.toUpperCase()}] ${a.title}: ${a.body.slice(0, 120)}${a.body.length > 120 ? '...' : ''}`
        )
        sections.push(`AVISOS URGENTES:\n${lines.join('\n')}`)
      }

      sections.push(`AVISOS ACTIVOS: ${announcementRows.length} totales, ${urgent.length} urgentes`)
    }

    // 8. Proveedores (solo encargados)
    if (canSeeSuppliers) {
      const { data: suppliers } = await supabase
        .from('suppliers')
        .select('name, contact_name, phone, email, category, notes')
        .eq('is_active', true)
        .order('name', { ascending: true })

      const supplierRows = (suppliers ?? []) as SupplierRow[]

      if (supplierRows.length > 0) {
        const lines = supplierRows.map((s) =>
          `- ${s.name}${s.category ? ` (${s.category})` : ''}${s.contact_name ? ` | contacto: ${s.contact_name}` : ''}${s.phone ? ` | tel: ${s.phone}` : ''}${s.email ? ` | email: ${s.email}` : ''}${s.notes ? ` | nota: ${s.notes}` : ''}`
        )
        sections.push(`PROVEEDORES ACTIVOS:\n${lines.join('\n')}`)
      }
    }

    // 9. Recetas — full detail for cocina/chef/encargado/socio, menu description for all
    if (canSeeRecipesFull) {
      const { data: recipes } = await supabase
        .from('recipes')
        .select('name, category, yield_portions, preparation, notes, ingredients')
        .eq('is_active', true)
        .order('category')
        .order('name')

      const recipeRows = (recipes ?? []) as unknown as Array<{
        name: string
        category: string
        yield_portions: number | null
        preparation: string | null
        notes: string | null
        ingredients: Array<{ name: string; qty: string }> | null
      }>

      if (recipeRows.length > 0) {
        const lines = recipeRows.map((r) => {
          const ings = Array.isArray(r.ingredients) ? (r.ingredients as Array<{ name: string; qty: string }>).map(i => `${i.name} ${i.qty}`).join(', ') : ''
          return `- **${r.name}** (${r.category}, rinde ${r.yield_portions}): ${ings}\n  Preparación: ${(r.preparation ?? '').slice(0, 200)}${r.notes ? `\n  Notas: ${r.notes}` : ''}`
        })
        sections.push(`RECETAS CON DETALLE (${recipeRows.length}):\n${lines.join('\n')}`)
      }
    } else if (canSeeRecipesMenu) {
      // Runners and baristas: see menu descriptions (what each dish IS, how it's served)
      const { data: recipes } = await supabase
        .from('recipes')
        .select('name, category, notes, preparation')
        .eq('is_active', true)
        .order('category')
        .order('name')

      if (recipes && recipes.length > 0) {
        const lines = recipes.map((r) => {
          // Short description without quantities
          const desc = (r.preparation ?? '').split('.').slice(0, 2).join('.') + '.'
          return `- **${r.name}** (${r.category}): ${desc}${r.notes ? ` — ${r.notes}` : ''}`
        })
        sections.push(`CARTA / MENÚ (${recipes.length} platos):\nEstos son los platos que vendemos. Usá esta info para informar al cliente qué contiene cada plato.\n${lines.join('\n')}`)
      }
    }

    // 10. Lo que manda Santa Fe (la 24 no produce) y el horneado.
    // Envíos: socio, encargado, chef y cocina. Conteo de cierre y horneado:
    // también la barra (cuenta y hornea).
    const canSeeEnvios = isSocio || ['encargado', 'chef', 'cocina'].includes(role)
    const canSeeCierreYHorneado = canSeeEnvios || role === 'barista'
    const [envios, cierre, horneado] = await Promise.all([
      canSeeEnvios ? contextoEnvios(admin, perfiles) : null,
      canSeeCierreYHorneado ? contextoConteoCierre(admin) : null,
      canSeeCierreYHorneado ? contextoHorneado(admin) : null,
    ])
    for (const s of [envios, cierre, horneado]) if (s) sections.push(s)

    // 10b. Protocolos del día — encargados ven todos; el resto, los suyos
    sections.push(await contextoProtocolos(admin, perfiles, { verTodos: isSocio || role === 'encargado', userId }))

    // 11. Pending ingredient links (encargado, socio)
    if (isSocio || role === 'encargado') {
      const { count: pendingLinksCount } = await supabase
        .from('recipe_ingredient_pending_links')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')

      if (pendingLinksCount && pendingLinksCount > 0) {
        sections.push(`⚠️ INGREDIENTES SIN VINCULAR AL STOCK: ${pendingLinksCount} pendientes en Admin → Recetas → Pending`)
      }
    }

    // 12. Fichajes sospechosos (encargado, socio)
    if (isSocio || role === 'encargado') {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      const { data: suspicious } = await supabase
        .from('attendance_logs')
        .select('operative_date, suspicious_reasons, profiles!attendance_logs_user_id_fkey(first_name)')
        .eq('is_suspicious', true)
        .gte('operative_date', sevenDaysAgo.toISOString().split('T')[0])
        .order('operative_date', { ascending: false })
        .limit(10)

      const suspRows = (suspicious ?? []) as unknown as { operative_date: string; suspicious_reasons: string[]; profiles: { first_name: string } | null }[]
      if (suspRows.length > 0) {
        const lines = suspRows.map(s => {
          const name = s.profiles?.first_name ?? '?'
          const reasons = (s.suspicious_reasons ?? []).map(r => r.split(':')[0]).join(', ')
          return `- ${name} (${s.operative_date}): ${reasons}`
        })
        sections.push(`⚠️ FICHAJES SOSPECHOSOS (últimos 7 días, ${suspRows.length}):\n${lines.join('\n')}\nVer detalle en Admin → Reportes → Sospechosos`)
      }
    }

    // 13. Protocolo de atención — always available for runners and baristas
    if (['runner', 'barista', 'bacha', 'socio', 'encargado'].includes(role)) {
      sections.push(`PROTOCOLO DE ATENCIÓN — LA VIEJA ESCUELA:

**SALUDO Y BIENVENIDA:**
- Saludar siempre al cliente cuando entra: "¡Bienvenidos a La Vieja Escuela!"
- Presentarse: "Mi nombre es [tu nombre], voy a atenderlos hoy"
- Acompañar a la mesa si es posible

**SERVICIO EN MESA:**
- Servir SIEMPRE por el lado izquierdo del comensal
- Retirar por el lado derecho
- Las bebidas se sirven primero, antes que la comida
- El plato se presenta con el logo del plato mirando al comensal
- Usar la vajilla correspondiente a cada plato (no improvisar)
- Cubiertos van antes que llegue el plato

**VAJILLA:**
- Café cortado/espresso → pocillo
- Café con leche/cappuccino → taza 150ml
- Latte/especialidades → taza 200ml o vaso según corresponda
- Agua/jugos → vaso bombe
- Cerveza → vaso correspondiente al estilo
- Postres → plato de postre con cubierto correspondiente
- Platos principales → plato grande
- Entradas → plato chico

**DURANTE EL SERVICIO:**
- Estar presente en el salón, no desaparecer
- Pasar por las mesas periódicamente ("¿Todo bien? ¿Necesitan algo?")
- Si hay demora en cocina, avisar al cliente proactivamente: "Les comento que el plato tiene unos minutitos más de lo habitual, ya sale"
- NO esperar a que el cliente se queje por la demora
- Comunicar tiempos aproximados cuando toman el pedido si hay mucha cola en cocina

**DEMORAS:**
- Tiempo normal de salida: 15-20 minutos
- Si pasa de 25 minutos, avisar al cliente
- Si pasa de 30 minutos, hablar con cocina y ofrecer algo al cliente (agua, pan)
- SIEMPRE comunicar, nunca ignorar la espera

**CUENTA Y DESPEDIDA:**
- Preguntar si desean algo más antes de traer la cuenta
- Agradecer la visita: "¡Gracias por venir, los esperamos pronto!"
- Si hubo algún problema, disculparse y asegurar que se resuelve`)
    }

  } catch (err) {
    console.error('Error al recopilar contexto:', err)
    sections.push('NOTA: Hubo errores al obtener algunos datos del sistema.')
  }

  return sections.join('\n\n')
}

// ---------------------------------------------------------------------------
// Sin IA: se avisa, no se inventa
// ---------------------------------------------------------------------------
// Traído de Santa Fe (d25d750). Antes, sin IA se contestaba por palabras
// clave volcando secciones del contexto: a "¿cómo cargo un turno nuevo?"
// respondía con la lista de turnos de hoy (Santa Fe, 24/11, OpenRouter sin
// crédito) y parecía que La Vieja estaba rota. Ahora dice que la IA no está
// disponible y, a encargados y socios, por qué (sin clave, sin crédito, clave
// inválida…), para que se pueda arreglar. Sin ninguna clave cargada (la 24 al
// 25/11) no se arma el contexto: se contesta el aviso directo.
// ---------------------------------------------------------------------------

function motivoIA(status: number): string {
  if (status === 402) return 'sin crédito (o la clave llegó a su tope de gasto)'
  if (status === 401 || status === 403) return 'la clave no es válida'
  if (status === 429) return 'demasiadas consultas seguidas'
  if (status === 404) return 'el modelo ya no existe'
  if (status >= 500) return 'el servicio está caído'
  return `error ${status}`
}

function respuestaSinIA(role: string, fallas: string[]): string {
  const base = 'Mirá, ahora la IA no está disponible y no te puedo contestar bien 😕. Probá de nuevo en un rato.\n\nMientras tanto, lo que buscás está en el menú: botón **Más**, abajo a la derecha.'
  if (role !== 'socio' && role !== 'encargado') return base
  if (fallas.length === 0) {
    return `${base}\n\n**Para encargados y socios:** no hay ninguna clave de IA cargada en el servidor de la 24 (OPENROUTER_API_KEY). Hay que pedírsela a quien administra la app.`
  }
  return `${base}\n\n**Para encargados y socios:** ${fallas.join(' · ')}. Si es crédito, se carga en openrouter.ai (Settings → Credits) o se sube el tope de la clave (Settings → Keys).`
}

// ---------------------------------------------------------------------------
// Process AI response — handles ACTION_JSON and QUERY_JSON blocks
// ---------------------------------------------------------------------------

async function processAIResponse(
  responseText: string,
  userRole: string,
): Promise<Response> {
  // 0. INFORME_JSON — informe para bajar en PDF; se saca del texto y viaja aparte
  const inf = extraerInforme(responseText)
  if (inf.informe || inf.fallo) {
    const texto = inf.fallo
      ? `${inf.texto}\n\n_No pude armar el PDF esta vez. Pedímelo de nuevo ("pasalo a PDF")._`.trim()
      : inf.texto || `Te armé el informe «${inf.informe?.titulo}». Bajalo con el botón.`
    // Puede venir junto con una consulta o acción: se procesa el resto y se le suma el informe
    const resto = await processAIResponse(texto, userRole)
    if (!inf.informe) return resto
    const data = await resto.json()
    return NextResponse.json({ ...data, informe: inf.informe })
  }

  // 1. ACTION_JSON — requires user confirmation
  const actionMatch = responseText.match(/```ACTION_JSON\s*([\s\S]*?)\s*```/)
  if (actionMatch) {
    try {
      const actionData = JSON.parse(actionMatch[1].trim())
      const cleanText = responseText.replace(/```ACTION_JSON[\s\S]*?```/, '').trim()

      const { buildProposal, detectIntent, isConfirmableProposal } = await import('@/lib/ai/chatbot-actions')
      const admin = createAdminClient()

      const intent = detectIntent(actionData)
      if (intent === 'PRODUCCION_COMPLETA' || intent === 'MISE_EN_PLACE') {
        return NextResponse.json({ response: `${cleanText}\n\nEn la 24 no se produce: lo elaborado llega de Santa Fe (Compras → En camino) y se cuenta al cierre. Por el chat no registro producción.`.trim() })
      }
      const proposal = await buildProposal(
        admin,
        intent,
        actionData.items ?? [],
        actionData.message,
        actionData.urgency,
        userRole,
      )
      const canConfirm = isConfirmableProposal(proposal)
      const actionProposal: ActionProposalPayload | undefined = canConfirm
        ? {
            intent,
            items: proposal.items.map((item) => ({
              name: item.matchedStockName ?? item.rawName,
              quantity: item.quantity,
            })),
            message: proposal.message,
            urgency: proposal.urgency,
          }
        : undefined

      return NextResponse.json({
        response: proposal.confirmationText || cleanText,
        actionProposal,
        duplicateWarnings: proposal.duplicateWarnings,
      })
    } catch {
      const cleanText = responseText.replace(/```ACTION_JSON[\s\S]*?```/, '').trim()
      return NextResponse.json({ response: cleanText })
    }
  }

  // 2. QUERY_JSON — immediate read-only query, result replaces the block
  const queryMatch = responseText.match(/```QUERY_JSON\s*([\s\S]*?)\s*```/)
  if (queryMatch) {
    try {
      const queryData = JSON.parse(queryMatch[1].trim())
      const { executeQuery } = await import('@/lib/ai/chatbot-actions')
      const admin = createAdminClient()

      const queryResult = await executeQuery(admin, queryData, userRole)
      const finalText = responseText.replace(/```QUERY_JSON[\s\S]*?```/, queryResult).trim()
      return NextResponse.json({ response: finalText })
    } catch {
      const cleanText = responseText.replace(/```QUERY_JSON[\s\S]*?```/, '').trim()
      return NextResponse.json({ response: cleanText })
    }
  }

  return NextResponse.json({ response: responseText })
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest

    if (!body.message || typeof body.message !== 'string') {
      return NextResponse.json({ error: 'El campo "message" es obligatorio.' }, { status: 400 })
    }

    const message = body.message.trim()
    if (message.length === 0) {
      return NextResponse.json({ error: 'El mensaje no puede estar vacío.' }, { status: 400 })
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres.` }, { status: 400 })
    }

    // Validar autenticación y rol
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, first_name')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'No se pudo obtener tu perfil.' }, { status: 403 })
    }

    const userRole = profile.role as string

    // Rate limiting
    if (isRateLimited(user.id)) {
      return NextResponse.json({ error: 'Demasiadas solicitudes. Esperá un momento.' }, { status: 429 })
    }

    // --- HANDLE ACTION CONFIRMATION ---
    if (body.confirmAction) {
      const { buildProposal, executeAction, detectIntent, checkPermission, isConfirmableProposal } = await import('@/lib/ai/chatbot-actions')
      const admin = createAdminClient()

      const intent = detectIntent(body.confirmAction)
      if (intent === 'PRODUCCION_COMPLETA' || intent === 'MISE_EN_PLACE') {
        return NextResponse.json({
          response: `Mirá ${profile.first_name}, por el chat no se registra producción: en la 24 no se produce, lo elaborado llega de Santa Fe (Compras → En camino) y se cuenta al cierre en Conteo de cierre.`,
          actionExecuted: false,
        })
      }

      // Permission check
      const perm = checkPermission(intent, userRole)
      if (!perm.allowed) {
        return NextResponse.json({
          response: `Mirá ${profile.first_name}, ${perm.reason}`,
          actionExecuted: false,
        })
      }
      const proposal = await buildProposal(
        admin,
        intent,
        body.confirmAction.items ?? [],
        body.confirmAction.message,
        body.confirmAction.urgency,
        userRole,
      )

      if (!isConfirmableProposal(proposal)) {
        return NextResponse.json({
          response: proposal.confirmationText || 'No puedo ejecutar esa acción sin datos válidos.',
          actionExecuted: false,
        })
      }

      proposal.readyToExecute = true
      const userName = profile.first_name ?? 'Usuario'
      const result = await executeAction(admin, proposal, user.id, userName, userRole)

      if (result.success && result.created > 0) {
        const successSuffix =
          proposal.intent === 'PEDIDO_MERCADERIA'
            ? 'El pedido le llegó al encargado como notificación.'
            : proposal.intent === 'ACTUALIZAR_STOCK'
            ? 'Stock sobrescrito y validado con Fudo cuando corresponde.'
            : proposal.intent === 'REPORTE_PROBLEMA'
            ? 'El reporte le llegó a los encargados.'
            : proposal.intent === 'PRODUCCION_COMPLETA'
            ? 'El stock se actualizó con los movimientos de producción.'
            : proposal.intent === 'MISE_EN_PLACE'
            ? 'Mise en place actualizado.'
            : 'Aviso enviado a los encargados.'
        return NextResponse.json({
          response: `✅ ¡Listo, ${profile.first_name}! ${result.details.join(', ')}. ${successSuffix}`,
          actionExecuted: true,
        })
      } else {
        return NextResponse.json({
          response: `Qué macana, hubo un error: ${result.errors.join(', ')}. Intentá de nuevo.`,
          actionExecuted: false,
        })
      }
    }

    // Sin ninguna clave de IA no hay quién conteste: se avisa sin leer la base
    const openRouterKey = process.env.OPENROUTER_API_KEY
    const anthropicKey = process.env.ANTHROPIC_API_KEY
    if (!openRouterKey && !anthropicKey) {
      console.warn('[chatbot] sin IA: no hay claves cargadas')
      return NextResponse.json({ response: respuestaSinIA(userRole, []), sinIA: true })
    }

    // Recopilar contexto filtrado por rol
    const context = await gatherContext(supabase, userRole, user.id)

    // Construir mensajes con historial
    const conversationMessages: { role: 'user' | 'assistant'; content: string }[] = []

    // Incluir historial previo (máx 10 mensajes)
    if (body.history && Array.isArray(body.history)) {
      const recentHistory = body.history.slice(-10)
      for (const msg of recentHistory) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          conversationMessages.push({
            role: msg.role,
            content: msg.content,
          })
        }
      }
    }

    // User message — CLEAN, no context dumped here
    conversationMessages.push({
      role: 'user',
      content: message,
    })

    // Build full system prompt with context
    const fullSystemPrompt = `${SYSTEM_PROMPT}

## DATOS EN TIEMPO REAL DEL SISTEMA
El usuario es ${profile.first_name} (${userRole}).
Usá estos datos SOLO cuando sean relevantes para responder. NO los repitas si no te los piden.
Si el usuario saluda, respondé con un saludo breve y preguntá en qué podés ayudar.
NUNCA vomites datos sin que te los pidan.

${context}`

    // Por qué falló cada IA (para avisar a encargados y socios si no anda ninguna)
    const fallas: string[] = []

    // --- Intentar OpenRouter ---
    if (!openRouterKey) fallas.push('OpenRouter: no hay clave cargada')
    if (openRouterKey) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openRouterKey}`,
            ...OPENROUTER_APP_HEADERS,
          },
          body: JSON.stringify({
            // claude-sonnet-4 dejó de existir en OpenRouter (404, nov/2026). Sonnet 5.5
            // (el modelo por defecto de lib/ai/model) piensa siempre y no acepta
            // temperature: esfuerzo bajo para chat, y margen de tokens para que el
            // razonamiento no corte la respuesta.
            model: OPENROUTER_MODEL,
            max_tokens: 9000,
            reasoning: { effort: 'low' },
            messages: [
              { role: 'system', content: fullSystemPrompt },
              ...conversationMessages,
            ],
          }),
        })

        if (response.ok) {
          const data = await response.json()
          const responseText = data.choices?.[0]?.message?.content ?? 'No pude generar una respuesta.'
          return processAIResponse(responseText, userRole)
        }

        console.error('Error en OpenRouter API:', response.status, await response.text())
        fallas.push(`OpenRouter: ${motivoIA(response.status)}`)
      } catch (apiError) {
        console.error('Error al llamar a OpenRouter:', apiError)
        fallas.push('OpenRouter: no respondió')
      }
    }

    // --- Fallback Anthropic API ---
    if (anthropicKey) {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-5-5',
            max_tokens: 9000,
            output_config: { effort: 'low' },
            system: fullSystemPrompt,
            messages: conversationMessages,
          }),
        })

        if (response.ok) {
          const data = await response.json()
          // Haiku 5.5 piensa: el primer bloque puede ser 'thinking', se toma el de texto
          const responseText = (data.content as { type: string; text?: string }[] | undefined)?.find((b) => b.type === 'text')?.text ?? 'No pude generar una respuesta.'
          return processAIResponse(responseText, userRole)
        }

        console.error('Error en Anthropic API:', response.status, await response.text())
        fallas.push(`Anthropic: ${motivoIA(response.status)}`)
      } catch (apiError) {
        console.error('Error al llamar a Anthropic:', apiError)
        fallas.push('Anthropic: no respondió')
      }
    }

    // --- Sin IA: avisar (antes contestaba por palabras clave y parecía rota) ---
    console.warn('[chatbot] sin IA:', fallas.join(' · ') || 'sin claves')
    return NextResponse.json({ response: respuestaSinIA(userRole, fallas), sinIA: true })
  } catch (error) {
    console.error('Error en chatbot API:', error)
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 })
  }
}
