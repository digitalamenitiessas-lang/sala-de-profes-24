# Pendientes — Sala de Profes 24 y Maipú

Actualizado: 2026-09-29.

## Dónde estamos

| | Estado |
|---|---|
| Repo `digitalamenitiessas-lang/sala-de-profes-24` | ✅ Sin historial ni conexiones a LVE |
| Vercel `sala-de-profes-24.vercel.app` | ✅ Deployado, con las variables de la 24 |
| Base Supabase `hmoqksbyfemzprpsxovu` | ✅ Estructura de LVE sin datos (ver `supabase/estructura/README.md`) |
| Perfil de socio | ✅ Creado ("Admin24 Socio": cambiar el nombre en Configuración) |
| Relojes pg_cron | ✅ `fudo-pulso`, `fudo-sync-reintento`, `protocolos-avisos` y `auto-clockout` (cada hora), todos respondiendo 200 |
| Fudo | ⏳ Faltan las credenciales de la cuenta de la 24 |
| Resend (mails) | ⏳ La clave está, pero la cuenta no tiene dominio verificado (ver §3) |
| IA (OpenRouter) | ⏳ Falta la clave (opcional) |

## 1. Lo que bloquea el uso diario (en orden)

1. **Usuario de Fudo exclusivo de la 24 (dueño).** Rol administrador, que pertenezca **solo** a la
   cuenta de la 24, sin segundo factor y con una contraseña que no se cambie. El código no le dice
   a Fudo de qué local es: escribe en la cuenta del usuario. Con un usuario de LVE, o con acceso a
   los dos locales, los conteos y mermas de la 24 terminarían en el Fudo de Santa Fe.
2. **Vercel:** cargar `FUDO_LOGIN` + `FUDO_PASSWORD` **solo en Production** (en Preview no, así las
   ramas de prueba no escriben en el Fudo real) y hacer redeploy.
3. **Verificar la cuenta:** `/admin/fudo/salud` → *Probar*, y en `/admin/fudo` revisar que los
   salones, los medios de pago y los productos sean los de la 24. Si aparece algo de Santa Fe:
   borrar las variables, redeployar y no contar ni cargar mermas.
4. **Carga inicial desde Fudo, en este orden:** `/admin/fudo` (sincroniza el menú al entrar) →
   `/proveedores` → *Sync Fudo* → `/control` → *Datos por completar* → *Crear todos en LVE* →
   `/stock` → *Sincronizar* → abrir `/proveedores/vincular`. No hay forma de crear insumos a mano:
   salen de Fudo.
5. **Conteo de prueba:** contar un insumo poniendo exactamente el número que muestra Fudo y
   confirmar que se sincronizó bien. Después, la **Puesta a cero** (ya no manda un aviso por insumo).
6. **Alta del equipo** desde *Equipo*. El nombre tiene que coincidir con el de la planilla de turnos.
7. **Turnos de la semana** (grilla o Excel). **Sin turno cargado un empleado no puede fichar**
   (los encargados y socios sí).
8. **Probar el fichaje en el local** con un encargado.

Los 3 incidentes críticos que dejaron los crons sin credenciales los cierra solo el pulso cuando
Fudo conecte. Mientras haya uno abierto, `/stock` no deja contar los insumos de Fudo.

## 2. En el panel de Supabase (vos)

1. **Authentication → Sign In / Providers → apagar "Allow new users to sign up".**
2. **Authentication → URL Configuration:**
   - Site URL: `https://sala-de-profes-24.vercel.app`
   - Redirect URLs: `https://sala-de-profes-24.vercel.app/**` (con `/**`: el link lleva parámetros)
3. **Authentication → Emails → SMTP** con Resend (`smtp.resend.com`, puerto 465, usuario `resend`,
   contraseña = clave de Resend, remitente del dominio verificado). **Es la única forma de recuperar
   una contraseña**: la app no tiene cómo resetearle la clave a un empleado. Depende de §3.

## 3. Mails (Resend)

La clave funciona, pero **la cuenta no tiene ningún dominio** y `laviejaescuelabar24.com.ar` no
existe. Mientras tanto no sale ningún mail (la app no se rompe: el error queda en el log).
Opciones:

| Opción | Remitente | Qué hace falta |
|---|---|---|
| **Subdominio** (recomendada) | `info@24.laviejaescuelabar.com.ar` | Agregarlo en Resend y cargar los registros DNS en el Vercel donde está `laviejaescuelabar.com.ar` |
| Cuenta de Resend de LVE | `info@laviejaescuelabar.com.ar` | Una API key nueva de esa cuenta |
| Registrar `laviejaescuelabar24.com.ar` | `info@laviejaescuelabar24.com.ar` | Comprarlo en NIC.ar y verificarlo |

Después: `EMAIL_FROM` en `.env.local` y `RESEND_API_KEY` + `EMAIL_FROM` en Vercel, con redeploy.

## 4. Preguntas para el dueño

| Tema | En LVE hoy | Qué decidir | Recomendación |
|---|---|---|---|
| **Fudo** | — | Usuario exclusivo de la 24 (ver §1) | Imprescindible |
| **Equipo** | 35 perfiles | Nombre, rol, email y teléfono de cada uno | Alta desde Equipo |
| **Nombre de la app** | "La Vieja Escuela" | Nombre e ícono propios de la 24 (ej. "Profes 24") | **Antes** de que la instalen: si no, quien trabaje en las dos sucursales tiene dos apps iguales |
| **Dominio propio** | — | ¿`.vercel.app` o dominio propio? | Decidir antes de repartir la app: si cambia después, todos reinstalan y reactivan avisos |
| **Horario de cierre por día** | 7 filas | Hora de cierre de cada día | Lo cargo por SQL (no hay pantalla) |
| **Tarifa por hora de cada rol** | 6 filas | Monto por rol | Lo cargo por SQL. Sin esto la liquidación da $0 |
| **Recetas** | 296 | ¿Son las mismas? | Exportar `productos.xls` del Fudo de la 24 y subirlo en `/admin/fudo/importar` |
| **Insumos / proveedores** | 500 / 98 | ¿Los mismos? | Que salgan del Fudo de la 24. Copiarlos de LVE duplica todo en la primera sincronización |
| **Protocolos** | "Limpieza del baño" (11:00, 14:30, 18:00, 21:30) | ¿Mismo protocolo y horarios? | Lo cargo por SQL (no hay pantalla) |
| **Vajilla** | 33 ítems | ¿Misma lista? | Se carga desde `/vajilla` |
| **Código de expedientes** | `LVE-2026-0001` | ¿Mismo prefijo? | Si cambia, toco la función y el front |
| **¿Algún socio ficha?** | Sí, uno en LVE | ¿Quién? | Lo agrego en `SOCIOS_QUE_FICHAN` |
| **Plan de Supabase** | — | Free o Pro | En Free no hay respaldos, y van a estar los fichajes con los que se liquidan sueldos |
| **Plan de Vercel** | — | Hobby o Pro | Hobby es para uso no comercial |
| **IA** | — | ¿Clave de OpenRouter propia? | Con límite de crédito. Sin clave la app funciona con respuestas armadas por reglas |

## 5. Código

**Arreglado en la 24** (también está roto en LVE):

- Salida del fichaje (`clock_out_type` 'normal' → 'manual'). En LVE no hay salidas manuales desde el 05/04.
- Pantalla de Stock, compras sugeridas, briefing, prioridades y chatbot (cruce `stock_items → suppliers` ambiguo).
- Listado y detalle de producción (cruce `production_orders → profiles` ambiguo).
- Alta de un Bachero (daba "Rol inválido"). Un encargado ya no puede crear socios.
- Rol socio: en la base, solo un socio puede darlo, quitarlo o desactivar a un socio.
- Avisos: la Puesta a cero ya no manda uno por insumo, y "falta el conteo" no avisa si no hay elaborados.
- Mails y avisos push que Vercel podía cortar: ahora van con `after()` (17 llamadas).
- Errores de Resend: ahora quedan registrados en el log.
- `/control`: la tarjeta de fichajes ya no da error.
- `/stock/rendimiento`: calcula la duración sin la función que faltaba; para lo que se vende por
  Fudo usa la caída de stock entre fotos diarias.
- `/admin/asistencia` (usaba 5 tablas inexistentes) redirige a `/equipo/asistencia`.
- Chatbot: urgencias de pedidos de barra, columnas inexistentes y "hoy" en hora de Argentina.
- Resumen ejecutivo, analítica del salón y conciliación de stock: "hoy" en hora de Argentina (antes
  cambiaba de día a las 21:00).
- Cierre automático de fichajes cada hora (antes una vez por día, a las 16:00).
- IA: modelo centralizado en `src/lib/ai/model.ts` (variable `OPENROUTER_MODEL`). Sigue en
  `anthropic/claude-sonnet-4`, igual que LVE. **Para pasar a Sonnet 5 o posterior hay que sacar
  `temperature`** (esos modelos lo rechazan con error 400) y revisar `max_tokens` (razonan por
  defecto). Probarlo con una clave real antes.

**Sin arreglar:**

- Chatbot: todavía consulta `clock_events` y `attendance_anomalies` (no existen), así que siempre
  dice "sin anomalías" y "0 personas ficharon". Habría que pasarlo a `attendance_logs`.
- El conteo diario de elaborados manda un aviso "Stock modificado" por cada elaborado, además del resumen.
- En Equipo, el diálogo de alta le sigue mostrando la opción "Socio" a un encargado (el servidor lo rechaza igual).
- ~113 errores de tipos viejos (el build los ignora con `ignoreBuildErrors`).

## 6. Para avisarle a tu compañero (LVE, Santa Fe)

En LVE no se tocó nada. Como referencia sirve `supabase/estructura/03_ajustes_sucursal_24.sql`.

**Seguridad:**
- **Cualquiera puede darse el rol de socio** si el registro público está activado en LVE:
  `handle_new_user()` toma el rol de lo que manda el cliente al registrarse.
- **Cualquier empleado puede cambiarse a socio** con un update de su propio perfil.
- **Tablas `_backup_*_20260728`** (535 + 529 + 137 filas reales) sin RLS y abiertas a `anon`.
- **Vistas `v_today_attendance` y `v_active_alerts`** legibles sin sesión (nombres y fichajes del día).
- **`bar_stock_items`** abierta a `anon`.
- **Rotar la clave `service_role`**: estuvo escrita en `scripts/create-users.mjs` y
  `scripts/update-profiles.mjs` del repo de LVE.

**Bugs:** los de la sección 5 (mismos archivos). El más urgente es la salida del fichaje.
