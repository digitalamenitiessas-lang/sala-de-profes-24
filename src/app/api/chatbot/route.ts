import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { format } from 'date-fns'
import { es } from 'date-fns/locale/es'

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

type BarStockRow = {
  name: string
  category: string
  unit: string
  current_qty: number
  current_detail: string | null
  min_level: number
  is_urgent: boolean
}

type BarOrderRow = {
  product_name: string
  category: string
  quantity: string
  urgency: string
  status: string
  note: string | null
  created_at: string
  profiles: { first_name: string } | null
}

type ChecklistItemRow = {
  title: string
  status: string
  completed_by_profile: { first_name: string } | null
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

const SYSTEM_PROMPT = `Sos **La Vieja de Historia**, la asistente interna de **La Vieja Escuela** (LVE), una cafetería/restaurante ubicada en Santa Fe 746, San Miguel de Tucumán, Argentina.

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

## EQUIPO DE LVE (18 empleados)
**Encargados** (acceso total): Ricardo, Noelia, Ignacio, Marco
**Chef**: Facundo Yapura
**Cocina**: Melina, Gastón, Samuel, Marisol, Facundo Torres
**Baristas**: Agustín, Ivoti, Patricia, Gonzalo
**Runners**: Juan Pablo, Fernanda, Aimé, Sebastián

## ROLES Y PERMISOS
| Rol | Acceso |
|-----|--------|
| encargado | Todo: dashboard, stock, proveedores, cocina, barra, equipo, alertas, chatbot, recetario |
| chef | Cocina, checklists, mise en place, recetario |
| cocina | Cocina, checklists, mise en place, recetario |
| barista | Barra (stock cafetería, pedidos barra) |
| runner | Solo base: fichar, ver turnos, notificaciones |

## ESTRUCTURA DE LA APP ("Sala de Profes")
- **Inicio** (/) — Dashboard del encargado con resúmenes
- **Mi Turno** (/mi-turno) — Fichaje con geolocalización (150m del local)
- **Horarios** (/mis-horarios) — Turnos semanales
- **Avisos** (/notificaciones) — Sistema de notificaciones por rol, tipo y prioridad
- **Cocina** (/cocina) — Turnos de cocina, checklists, mise en place
- **Barra** (/cocina/barra) — Stock cafetería, pedidos de barra
- **Stock** (/stock) — Inventario general con semáforo (🟢🟡🔴)
- **Proveedores** (/proveedores) — Directorio de proveedores
- **Equipo** (/equipo) — Gestión de empleados y roles
- **Recetario** (/recetas) — Recetas con ingredientes y rendimiento
- **Control** (/admin) — Dashboard administrativo
- **Asistente** (/asistente) — Este chatbot (todos los roles, con info filtrada)

## ACCESO POR ROL AL CHATBOT
Cada rol ve datos adaptados a su función:
- **socio**: Ve TODO sin restricciones
- **encargado**: Ve TODO (asistencia, stock, barra, cocina, proveedores, recetas completas, equipo, avisos)
- **barista**: Ve stock de barra, pedidos de barra, carta/menú (descripción de platos), protocolo de atención, turnos, avisos
- **chef / cocina**: Ve cocina (checklists, turnos cocina), stock general (para ingredientes), recetas CON CANTIDADES Y PREPARACIÓN DETALLADA, avisos
- **runner**: Ve carta/menú (qué es cada plato, cómo se sirve), protocolo de atención completo, turnos generales, avisos, barra (Agustín)
- **bacha**: Ve vajilla, protocolo de atención, turnos generales, avisos

IMPORTANTE:
- Runners NO ven cantidades de recetas ni stock, pero SÍ saben qué contiene cada plato para informar al cliente.
- Runners tienen acceso al protocolo de atención (saludo, servicio, vajilla, demoras).
- Si un runner pregunta "¿qué lleva la milanesa napolitana?" respondé con la descripción del plato, NO con cantidades de ingredientes.
- Si un runner pregunta "¿en qué se sirve un cortado?" respondé con la vajilla correcta.
- Cocina/Chef ven las recetas completas con cantidades, preparación paso a paso y rendimiento.
- Si un barista pregunta por proveedores, decile con onda que eso lo maneja el encargado.

## SISTEMA DE STOCK (SEMÁFORO)
- 🟢 Verde: stock > min_qty × 1.5
- 🟡 Amarillo: stock entre min_qty y min_qty × 1.5
- 🔴 Rojo: stock ≤ min_qty o stock = 0
Categorías: bebidas, lácteos, carnes, verduras, frutas, panadería, condimentos, limpieza, desechables, otros

## BARRA / CAFETERÍA
Stock separado del stock general. Categorías: lácteos, café, packaging, suministros, insumos_oyambre, librería, general.
Las baristas pueden crear pedidos con urgencia: normal / alta / urgente.
Los pedidos van: pending → ordered → received.

## COCINA
- **Turnos**: morning (mañana) / night (noche). Status: pending → in_progress → completed.
- **Checklists**: opening (apertura), production (producción), service (servicio), closing (cierre). Items: pending / done / skipped / overdue.
- **Mise en Place**: Preparaciones diarias por familia (proteínas, verduras, panadería, lácteos, etc). Status: pending / in_progress / done / low / missing.

## SERVICIOS GASTRONÓMICOS
- **Desayuno y Meriendas**: desayunos_meriendas, entrepanes, tostones, sin_trigo, panadería_salada, bebidas, postres
- **Almuerzos y Cenas**: entradas, ensaladas, kids, especialidades, pizzas, entre_panes, bebidas, postres

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
Combiná asistencia + stock crítico + avisos urgentes + pedidos pendientes en un resumen ejecutivo.

### Para consultas de barra:
Mostrá items bajos, pedidos pendientes, qué se necesita comprar.

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

IMPORTANTE: La fecha y hora actual están en el contexto. Usala para contextualizar tus respuestas (ej: "Hoy viernes 20 de marzo..." ).

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
- **NUNCA inventes nombres de productos.** Usá EXCLUSIVAMENTE los nombres que aparecen en STOCK_ITEMS_LISTA o BAR_STOCK_ITEMS_LISTA del contexto.
- Si el usuario dice un nombre informal (ej: "nalga", "leche"), mapealo al nombre EXACTO de la lista (ej: "Nalga de ternera", "Leche entera").
- Si no estás seguro de a qué item se refiere, **preguntá antes de generar el ACTION_JSON**. Ej: "¿Te referís a 'Nalga de ternera' o a 'Nalga de cerdo'?"
- Si el item que menciona el usuario NO existe en la lista, **decíselo claramente** y mostrá los items más parecidos de la lista para que elija.
- En el ACTION_JSON, el campo "name" debe contener el nombre EXACTO como aparece en la lista del contexto, no una versión abreviada ni inventada.
- Para PRODUCCION_COMPLETA, tanto el input.name como cada output.name deben usar nombres de la lista cuando sea posible. Si un output es un producto nuevo (no existe en stock), indicalo con "(nuevo)" al final del nombre.
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
Cuando el usuario registra que procesó/despiezó un insumo (solo roles: chef, cocina, encargado, socio):
- "Hice despiece de 10kg de nalga: 7kg milanesas, 2kg hamburguesas"
- "De 8kg de pollo saqué 6.5kg de pechuga y 1kg de carcaza"
- "Registrá producción 5kg queso: 4kg cuñas, 0.8kg rallado"

Respondé resumiendo el despiece Y agregá al final:
\`\`\`ACTION_JSON
{"intent":"PRODUCCION_COMPLETA","message":"{\"input\":{\"name\":\"nalga\",\"qty\":10,\"unit\":\"kg\"},\"outputs\":[{\"name\":\"milanesas\",\"qty\":7,\"unit\":\"kg\"},{\"name\":\"hamburguesas\",\"qty\":2,\"unit\":\"kg\"}]}"}
\`\`\`

IMPORTANTE para PRODUCCION_COMPLETA:
- El campo "message" contiene un JSON-string con input y outputs
- "input" es el insumo principal que se procesa (un único item)
- "outputs" son todos los productos obtenidos
- La merma = input.qty − suma de outputs (se calcula automáticamente)
- Mostrá la eficiencia antes del bloque: (sum outputs / input) × 100%
- Si falta info, preguntá antes de proponer

## CONSULTAS ESPECIALES — QUERY_JSON
Para consultas de disponibilidad, duración de stock, recetas en riesgo, producciones de hoy o links pendientes,
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
{"type":"PRODUCCION_HOY"}
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
- "¿Qué producciones hubo hoy?" / "¿Qué se hizo hoy?" → PRODUCCION_HOY
- "¿Cuántos links pendientes hay?" / "¿Hay ingredientes sin vincular?" → PENDIENTES_LINKS
- "¿Cuánto facturamos?" / "¿Cómo van las ventas?" / "¿Qué se vendió más?" → VENTAS_HOY
- "¿Cuánto cuesta hacer una milanesa?" / "¿Qué margen tiene la hamburguesa?" → COSTO_PLATO
- "Dame el resumen del día" / "¿Cómo estamos?" / "Briefing" → BRIEFING_DIARIO
- "¿Hay fichajes sospechosos?" / "¿Quién llegó tarde?" / "Anomalías" → FICHAJES_ANOMALIAS

## MISE EN PLACE
Si alguien dice "listo salsas", "terminé los vegetales", "mise en place listo", "preparé las masas":
- Detectá los items mencionados y proponé una acción MISE_EN_PLACE.
- Formato del ACTION_JSON:
\`\`\`ACTION_JSON
{"intent":"MISE_EN_PLACE","items":[{"name":"salsas","quantity":"1"},{"name":"vegetales cortados","quantity":"1"}]}
\`\`\`
- El sistema matchea los nombres contra mise_en_place_items del turno activo.
- Si incluyen cantidad ("hice 50 empanadas"), usala en quantity.
- Si no hay turno activo, avisá que abran uno primero.

## FICHAJE / ASISTENCIA
Si alguien dice "fichar entrada", "fichar salida", "marcar ingreso", "marcar egreso":
- NO fichés desde el chat. El fichaje requiere verificación de seguridad (GPS, WiFi, dispositivo).
- Respondé: "Para fichar necesitás hacerlo desde **Mi Turno** en la app — ahí se verifica tu ubicación y dispositivo. Entrá a /mi-turno."
- Si un encargado/socio pregunta "¿quién está trabajando?", "¿fichajes sospechosos?", "¿horas de [nombre]?" → respondé con los datos del contexto.
- Si preguntan "¿cuántas horas trabajó [nombre] esta semana/mes?" → buscá en el contexto de asistencia.`

// ---------------------------------------------------------------------------
// Recopilar contexto de datos — ampliado
// ---------------------------------------------------------------------------

async function gatherContext(supabase: Awaited<ReturnType<typeof createClient>>, role: string) {
  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const tomorrowStr = format(new Date(today.getTime() + 86400000), 'yyyy-MM-dd')

  const sections: string[] = []

  sections.push(`FECHA Y HORA ACTUAL: ${format(today, "EEEE d 'de' MMMM yyyy, HH:mm", { locale: es })}`)

  // Define what data each role can access — socio sees everything
  const isSocio = role === 'socio'
  const canSeeAttendance = isSocio || ['encargado'].includes(role)
  const canSeeAllShifts = isSocio || ['encargado'].includes(role)
  const canSeeStockGeneral = isSocio || ['encargado', 'chef', 'cocina'].includes(role)
  const canSeeBarStock = isSocio || ['encargado', 'barista'].includes(role)
  const canSeeBarOrders = isSocio || ['encargado', 'barista'].includes(role)
  const canSeeKitchen = isSocio || ['encargado', 'chef', 'cocina'].includes(role)
  const canSeeAnnouncements = true // All roles
  const canSeeSuppliers = isSocio || ['encargado'].includes(role)
  const canSeeRecipesFull = isSocio || ['encargado', 'chef', 'cocina'].includes(role) // Full with quantities
  const canSeeRecipesMenu = true // ALL roles see menu descriptions (runners need to know dishes)
  const canSeeTeamShifts = true // Everyone sees who works today

  try {
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
          const checkIn = a.clock_in_at ? format(new Date(a.clock_in_at), 'HH:mm') : '?'
          const checkOut = a.clock_out_at ? format(new Date(a.clock_out_at), 'HH:mm') : 'aún en turno'
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
          `- ${a.profiles ? `${a.profiles.first_name} ${a.profiles.last_name}` : '?'} (ingreso: ${a.clock_in_at ? format(new Date(a.clock_in_at), 'HH:mm') : '?'})`
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

    // 2b. Clock events (nuevo sistema anti-trampa — paralelo a attendance_logs)
    if (canSeeAttendance) {
      const { data: clockEvents } = await supabase
        .from('clock_events')
        .select('event_type, timestamp, verified, anomaly_flags, profiles!clock_events_employee_id_fkey(first_name, last_name, role)')
        .gte('timestamp', `${todayStr}T00:00:00-03:00`)
        .order('timestamp', { ascending: false })

      if (clockEvents && clockEvents.length > 0) {
        // Build current status per employee
        const seenEmployees = new Set<string>()
        const currentlyIn: string[] = []
        const completedToday: string[] = []

        for (const evt of clockEvents) {
          const p = evt.profiles as unknown as { first_name: string; last_name: string; role: string } | null
          if (!p) continue
          const key = `${p.first_name} ${p.last_name}`
          if (seenEmployees.has(key)) continue
          seenEmployees.add(key)
          const time = format(new Date(evt.timestamp as string), 'HH:mm')
          const flags = Array.isArray(evt.anomaly_flags) ? evt.anomaly_flags : []
          const flagStr = flags.length > 0 ? ` ⚠️ (${flags.length} alerta${flags.length > 1 ? 's' : ''})` : ''
          if (evt.event_type === 'clock_in') {
            currentlyIn.push(`- ${key} (${p.role}): ingresó ${time}${flagStr}`)
          } else {
            completedToday.push(`- ${key} (${p.role}): egresó ${time}${flagStr}`)
          }
        }

        if (currentlyIn.length > 0) {
          sections.push(`FICHAJE ANTI-TRAMPA — ACTUALMENTE EN EL LOCAL (${currentlyIn.length}):\n${currentlyIn.join('\n')}`)
        }
      }

      // Open anomalies summary
      const { data: openAnomalies } = await supabase
        .from('attendance_anomalies')
        .select('anomaly_type, severity, employee_id, profiles!attendance_anomalies_employee_id_fkey(first_name, last_name)')
        .eq('resolved', false)
        .order('created_at', { ascending: false })
        .limit(10)

      if (openAnomalies && openAnomalies.length > 0) {
        const lines = openAnomalies.map((a) => {
          const p = a.profiles as unknown as { first_name: string; last_name: string } | null
          const name = p ? `${p.first_name} ${p.last_name}` : 'Empleado'
          const tipo = a.anomaly_type === 'gps_out_of_range' ? 'GPS fuera de rango' :
                       a.anomaly_type === 'wifi_mismatch' ? 'WiFi no reconocida' :
                       a.anomaly_type === 'unknown_device' ? 'Dispositivo no registrado' :
                       a.anomaly_type === 'rapid_succession' ? 'Fichaje muy rápido' :
                       a.anomaly_type === 'unusual_hour' ? 'Horario inusual' : a.anomaly_type
          return `- ${name}: ${tipo} (${a.severity})`
        })
        sections.push(`ANOMALÍAS DE ASISTENCIA SIN RESOLVER (${openAnomalies.length}):\n${lines.join('\n')}`)
      } else {
        sections.push('ANOMALÍAS DE ASISTENCIA: Sin anomalías pendientes.')
      }
    }

    // 3. Stock general (encargados, chef, cocina)
    if (canSeeStockGeneral) {
      const { data: stockItems } = await supabase
        .from('stock_items')
        .select('id, name, category, unit, current_qty, min_qty, supplier_id, fudo_ingredient_id, fudo_product_id, fudo_skip, suppliers(name)')
        .eq('is_active', true)
        .order('name', { ascending: true })

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
      const stockNameList = stockRows.map(i => `- ${i.name} (${i.unit})`).join('\n')
      sections.push(`STOCK_ITEMS_LISTA (usá SOLO estos nombres en ACTION_JSON para stock general, pedidos y producción):\n${stockNameList}`)
    }

    // 4. Stock de Barra / Cafetería (encargados, baristas)
    if (canSeeBarStock) {
      const { data: barStock } = await supabase
        .from('bar_stock_items')
        .select('name, category, unit, current_qty, current_detail, min_level, is_urgent')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      const barRows = (barStock ?? []) as BarStockRow[]
      const barLow = barRows.filter((b) => b.current_qty <= b.min_level || b.is_urgent)

      if (barLow.length > 0) {
        const lines = barLow.map((b) =>
          `- ${b.is_urgent ? '🔴' : '🟡'} ${b.name} (${b.category}): ${b.current_qty} ${b.unit} (mín: ${b.min_level})${b.current_detail ? ` — ${b.current_detail}` : ''}`
        )
        sections.push(`BARRA — ITEMS BAJOS O URGENTES:\n${lines.join('\n')}`)
      }

      sections.push(`RESUMEN BARRA: ${barRows.length} items — ${barLow.length} bajos/urgentes, ${barRows.length - barLow.length} normales`)

      // ── ANTI-HALLUCINATION: inject full bar item name list ──
      const barNameList = barRows.map(b => `- ${b.name} (${b.unit})`).join('\n')
      sections.push(`BAR_STOCK_ITEMS_LISTA (usá SOLO estos nombres en ACTION_JSON para barra):\n${barNameList}`)
    }

    // 5. Pedidos de barra pendientes (encargados, baristas)
    if (canSeeBarOrders) {
      const { data: barOrders } = await supabase
        .from('bar_orders')
        .select('product_name, category, quantity, urgency, status, note, created_at, profiles:created_by(first_name)')
        .in('status', ['pending', 'ordered'])
        .order('created_at', { ascending: false })
        .limit(20)

      const orderRows = (barOrders ?? []) as unknown as BarOrderRow[]

      if (orderRows.length > 0) {
        const lines = orderRows.map((o) => {
          const urgTag = o.urgency === 'urgente' ? '🔴 URGENTE' : o.urgency === 'alta' ? '🟡 ALTA' : ''
          const who = o.profiles?.first_name ?? '?'
          return `- ${o.product_name} × ${o.quantity} (${o.status}) ${urgTag} — pedido por ${who}${o.note ? ` | nota: ${o.note}` : ''}`
        })
        sections.push(`PEDIDOS DE BARRA PENDIENTES:\n${lines.join('\n')}`)
      }
    }

    // 6. Checklist del turno activo (encargados, chef, cocina)
    if (canSeeKitchen) {
      const { data: activeShift } = await supabase
        .from('kitchen_shifts')
        .select('id, shift_type, status')
        .eq('shift_date', todayStr)
        .in('status', ['pending', 'in_progress'])
        .limit(1)
        .maybeSingle()

      if (activeShift) {
        const { data: checklistItems } = await supabase
          .from('checklist_items')
          .select('title, status, completed_by_profile:completed_by(first_name)')
          .eq('kitchen_shift_id', activeShift.id)

        const items = (checklistItems ?? []) as unknown as ChecklistItemRow[]
        const pending = items.filter((i) => i.status === 'pending')
        const done = items.filter((i) => i.status === 'done')

        sections.push(`COCINA — TURNO ${activeShift.shift_type === 'morning' ? 'MAÑANA' : 'NOCHE'} (${activeShift.status}): ${done.length}/${items.length} tareas completadas, ${pending.length} pendientes`)

        if (pending.length > 0) {
          const lines = pending.slice(0, 10).map((i) => `- ⬜ ${i.title}`)
          sections.push(`TAREAS PENDIENTES COCINA:\n${lines.join('\n')}`)
        }

        // 6b. Mise en place status for this shift
        const { data: miseItems } = await supabase
          .from('mise_en_place_items')
          .select('id, name, family, target_quantity, unit')
          .eq('is_active', true)
          .in('shift', [activeShift.shift_type, 'both'])

        if (miseItems && miseItems.length > 0) {
          const { data: miseRecords } = await supabase
            .from('mise_en_place_records')
            .select('mise_en_place_item_id, status, quantity_produced')
            .eq('kitchen_shift_id', activeShift.id)

          const recordMap = new Map(
            (miseRecords ?? []).map(r => [r.mise_en_place_item_id, r])
          )

          const misePending = miseItems.filter(m => {
            const rec = recordMap.get(m.id)
            return !rec || rec.status !== 'done'
          })
          const miseDone = miseItems.filter(m => {
            const rec = recordMap.get(m.id)
            return rec?.status === 'done'
          })

          sections.push(`MISE EN PLACE — ${miseDone.length}/${miseItems.length} completados, ${misePending.length} pendientes`)

          if (misePending.length > 0) {
            const miseLines = misePending.slice(0, 15).map(m => {
              const rec = recordMap.get(m.id)
              const status = rec?.status === 'in_progress' ? '🔄' : rec?.status === 'low' ? '🟡' : rec?.status === 'missing' ? '🔴' : '⬜'
              return `- ${status} ${m.name} (objetivo: ${m.target_quantity} ${m.unit})`
            })
            sections.push(`MISE EN PLACE PENDIENTE:\n${miseLines.join('\n')}`)
          }

          // ── ANTI-HALLUCINATION: inject full mise en place item name list ──
          const miseNameList = miseItems.map(m => `- ${m.name}`).join('\n')
          sections.push(`MISE_EN_PLACE_ITEMS_LISTA (usá SOLO estos nombres para MISE_EN_PLACE):\n${miseNameList}`)
        }
      }
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

    // 10. Producción — chef, cocina, encargado, socio
    const canSeeProduccion = isSocio || ['encargado', 'chef', 'cocina'].includes(role)
    if (canSeeProduccion) {
      const prodSince = new Date()
      prodSince.setDate(prodSince.getDate() - 7)

      const { data: recentOrders } = await supabase
        .from('production_orders')
        .select('id, name, status, created_at, profiles!production_orders_chef_id_fkey(first_name)')
        .gte('created_at', prodSince.toISOString())
        .order('created_at', { ascending: false })
        .limit(15)

      if (recentOrders && recentOrders.length > 0) {
        const pending = recentOrders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled')
        const completed = recentOrders.filter((o) => o.status === 'completed')

        const lines = recentOrders.map((o) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chef = (o.profiles as any)?.first_name ?? '?'
          const icon = o.status === 'completed' ? '✅' : o.status === 'in_progress' ? '🔄' : '📋'
          const date = new Date(o.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })
          return `${icon} ${o.name} — ${chef} (${date})`
        })
        sections.push(`PRODUCCIÓN ÚLTIMOS 7 DÍAS (${recentOrders.length} total, ${completed.length} completadas, ${pending.length} pendientes):\n${lines.join('\n')}`)

        if (pending.length > 0) {
          sections.push(`⚠️ PRODUCCIONES SIN COMPLETAR: ${pending.length} — el stock NO se actualiza hasta confirmarlas`)
        }
      } else {
        sections.push('PRODUCCIÓN ÚLTIMOS 7 DÍAS: Sin registros.')
      }
    }

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
// Respuesta basada en keywords (fallback sin IA)
// ---------------------------------------------------------------------------

function buildKeywordResponse(question: string, context: string): string {
  const q = question.toLowerCase()

  const getSection = (header: string): string => {
    const regex = new RegExp(`${header}[^]*?(?=\\n\\n|$)`, 'i')
    const match = context.match(regex)
    return match ? match[0] : ''
  }

  if (q.includes('trabaj') || q.includes('quien') || q.includes('equipo') || q.includes('hoy') || q.includes('fichaj') || q.includes('local')) {
    const fichaje = getSection('FICHAJE ANTI-TRAMPA')
    const asistencia = getSection('ASISTENCIA HOY')
    const turnos = getSection('TURNOS HOY')
    const sinEgreso = getSection('EGRESOS SIN MARCAR')
    return [fichaje, asistencia, sinEgreso, turnos].filter(Boolean).join('\n\n')
  }

  if (q.includes('anomal') || q.includes('alerta') || q.includes('sospech') || q.includes('trampa') || q.includes('irreg') || q.includes('irregulari')) {
    const anomalias = getSection('ANOMALÍAS DE ASISTENCIA')
    const suspicious = getSection('FICHAJES SOSPECHOSOS')
    return [anomalias, suspicious].filter(Boolean).join('\n\n') || 'No hay anomalías ni fichajes sospechosos. ✅'
  }

  if (q.includes('egreso') || q.includes('salida') || q.includes('sin marcar') || q.includes('olvidó')) {
    return getSection('EGRESOS SIN MARCAR') || 'Todos marcaron egreso. ✅'
  }

  if (q.includes('hora') || q.includes('horas') && (q.includes('trabajo') || q.includes('trabaj') || q.includes('semana') || q.includes('mes'))) {
    return 'Para consultar horas trabajadas de un empleado, revisá el panel de Asistencia en /admin/asistencia donde podés filtrar por empleado y período.'
  }

  if (q.includes('stock') || q.includes('rojo') || q.includes('critico') || q.includes('falt')) {
    return [getSection('STOCK CRÍTICO'), getSection('STOCK EN ATENCIÓN'), getSection('RESUMEN STOCK')].filter(Boolean).join('\n\n')
  }

  if (q.includes('barra') || q.includes('cafe') || q.includes('barista')) {
    return [getSection('BARRA'), getSection('PEDIDOS DE BARRA')].filter(Boolean).join('\n\n')
  }

  if (q.includes('pedir') || q.includes('comprar') || q.includes('pedido') || q.includes('producto')) {
    return [getSection('STOCK CRÍTICO'), getSection('BARRA — ITEMS BAJOS'), getSection('PEDIDOS DE BARRA')].filter(Boolean).join('\n\n') || 'No hay productos pendientes de pedido.'
  }

  if (q.includes('cocina') || q.includes('checklist') || q.includes('tarea')) {
    return [getSection('COCINA'), getSection('TAREAS PENDIENTES')].filter(Boolean).join('\n\n')
  }

  if (q.includes('aviso') || q.includes('urgent') || q.includes('notificacion') || q.includes('alerta')) {
    return [getSection('AVISOS URGENTES'), getSection('AVISOS ACTIVOS')].filter(Boolean).join('\n\n')
  }

  if (q.includes('proveedor') || q.includes('supplier')) {
    return getSection('PROVEEDORES ACTIVOS') || 'No hay proveedores registrados.'
  }

  if (q.includes('turno') || q.includes('horario') || q.includes('manana') || q.includes('mañana')) {
    return [getSection('TURNOS HOY'), getSection('TURNOS MAÑANA')].filter(Boolean).join('\n\n') || 'No hay turnos programados.'
  }

  if (q.includes('receta') || q.includes('plato') || q.includes('menu')) {
    return getSection('RECETAS') || 'No hay recetas cargadas.'
  }

  return `Acá tenés un resumen general:\n\n${context}`
}

// ---------------------------------------------------------------------------
// Process AI response — handles ACTION_JSON and QUERY_JSON blocks
// ---------------------------------------------------------------------------

async function processAIResponse(
  responseText: string,
  userRole: string,
): Promise<Response> {
  // 1. ACTION_JSON — requires user confirmation
  const actionMatch = responseText.match(/```ACTION_JSON\s*([\s\S]*?)\s*```/)
  if (actionMatch) {
    try {
      const actionData = JSON.parse(actionMatch[1].trim())
      const cleanText = responseText.replace(/```ACTION_JSON[\s\S]*?```/, '').trim()

      const { buildProposal, detectIntent, isConfirmableProposal } = await import('@/lib/ai/chatbot-actions')
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const admin = createAdminClient()

      const intent = detectIntent(actionData)
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
      const { createAdminClient } = await import('@/lib/supabase/admin')
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
      const { createAdminClient } = await import('@/lib/supabase/admin')
      const admin = createAdminClient()

      const intent = detectIntent(body.confirmAction)

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

    // Recopilar contexto filtrado por rol
    const context = await gatherContext(supabase, userRole)

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

    // --- Intentar OpenRouter ---
    const openRouterKey = process.env.OPENROUTER_API_KEY

    if (openRouterKey) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openRouterKey}`,
            'HTTP-Referer': 'https://laviejaescuela.com',
            'X-Title': 'La Vieja Escuela - Sala de Profes',
          },
          body: JSON.stringify({
            model: 'anthropic/claude-sonnet-4',
            max_tokens: 1024,
            temperature: 0.3,
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
      } catch (apiError) {
        console.error('Error al llamar a OpenRouter:', apiError)
      }
    }

    // --- Fallback Anthropic API ---
    const anthropicKey = process.env.ANTHROPIC_API_KEY

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
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: fullSystemPrompt,
            messages: conversationMessages,
          }),
        })

        if (response.ok) {
          const data = await response.json()
          const responseText = data.content?.[0]?.text ?? 'No pude generar una respuesta.'
          return processAIResponse(responseText, userRole)
        }

        console.error('Error en Anthropic API:', response.status, await response.text())
      } catch (apiError) {
        console.error('Error al llamar a Anthropic:', apiError)
      }
    }

    // --- Fallback keywords ---
    const fallbackResponse = buildKeywordResponse(message, context)
    return NextResponse.json({ response: fallbackResponse })
  } catch (error) {
    console.error('Error en chatbot API:', error)
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 })
  }
}
