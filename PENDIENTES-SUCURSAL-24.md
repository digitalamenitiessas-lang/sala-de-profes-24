# Pendientes — Sala de Profes 24 y Maipú

Actualizado: 2026-10-13 (apertura de la 24, noche). Fudo conectado: ventas, menú y 44 insumos sincronizados; protocolos PAUSADOS hasta que arranque el equipo. Incluye los cambios de LVE hasta el 13/10 (ver §7).

## Dónde estamos

| | Estado |
|---|---|
| Repo `digitalamenitiessas-lang/sala-de-profes-24` | ✅ Sin historial ni conexiones a LVE |
| Vercel `sala-de-profes-24.vercel.app` | ✅ Deployado, con las variables de la 24 |
| Base Supabase `hmoqksbyfemzprpsxovu` | ✅ Estructura de LVE sin datos (ver `supabase/estructura/README.md`) |
| Perfil de socio | ✅ Creado ("Admin24 Socio": cambiar el nombre en Configuración) |
| Relojes pg_cron | ✅ `fudo-pulso`, `fudo-sync-reintento`, `protocolos-avisos`, `fichajes-cierre` (cada 15'), `resumen-semanal`, `resumen-turno-tm/tt` |
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
- Cierre automático de fichajes: ahora cada 15' (`fichajes-cierre`, viene de LVE).
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

## 7. Sincronización con LVE (13/10)

Se trajeron los 90 cambios de LVE del 29/09 al 13/10 (compras y gastos en Fudo, pedidos, turnos con
rol, liquidación por turno con feriados y PDF, rol Cajero, ausencias, WiFi del local, botón "Llegó",
recetario de platos, protocolos de tolva/descartables/elaborados, alerta de stock crítico, resúmenes
por Telegram, etc.), conservando todas las adaptaciones de la 24.

- **Base:** aplicado `supabase/estructura/04_sync_lve_2026-10-13.sql` (estructura idéntica a LVE salvo
  los ajustes de seguridad de la 24). Feriados nacionales 2026 cargados.
- **Para volver a sincronizar más adelante:** `git fetch lve` (el remoto `lve` es solo lectura), aplicar
  `git diff <último sincronizado> lve/main` en una rama y comparar las bases con
  `supabase/estructura/comparar_catalogo.sql`. Último commit de LVE sincronizado: `2cb4da4`.

**Datos copiados de LVE** (`supabase/estructura/06_datos_copiados_de_lve_2026-10-13.sql`, aplicado):
- Tarifas por hora iguales a Santa Fe: encargado $4.400; cajero, chef y barista $4.200; cocina $4.000;
  runner $3.600; bachero $3.300.
- Los 4 protocolos iguales a Santa Fe: Limpieza del baño (11:00, 14:30, 18:00, 23:30), Control de tolva
  (08:00, 16:00, 21:45), Control de descartables (08:30, 16:30) y Conteo de elaborados (15:30, 15:45).
  Los horarios se editan desde la app.

**Falta:**
- **Telegram (pendiente para el 14/10):** crear un **bot propio de la 24** con BotFather (no usar el de
  LVE), cargar la clave en `TELEGRAM_JOB_BOT` en Vercel, redeploy y vincular el grupo desde la app.
- Los resúmenes de turno suponen turnos 06-16 y 16-06 (como LVE): confirmar el horario de la 24.

**Falta (cuando conecte Fudo):**
- Mirar `GET /payment-methods` del Fudo de la 24 y, si hace falta, cargar `FUDO_MEDIOS_PAGO`. Sin eso,
  si un medio no se encuentra por tipo, el pago corta con error (antes se imputaba con ids de LVE).
- Revisar que existan con ese nombre los insumos que usa Nueva producción
  (`src/lib/recipes/production-batches.ts`: 'Rebozador Preferido 5Kg', 'Molida Esp.', 'Filet de pollo',
  'Mozzarella Cilindro', etc.).
- Regenerar `src/types/database.ts` contra la base de la 24 (hay ~11 errores de tipos que vienen de LVE).

**Para avisarle a tu compañero (además de §6):**
- `_deduct_stock_item` y `fn_stock_critico_manana` quedaron ejecutables **sin sesión** en LVE (la
  primera permite cambiar el stock de cualquier insumo por la API pública). En la 24 están cerradas.
- **Alta de Cajero:** queda como encargado sin puesto (el upsert del perfil choca con el trigger).
  Arreglado en la 24 en `src/app/api/admin/create-user/route.ts` (`fijarPuestoCajero`).
- `profiles.puesto` no está protegido: un empleado puede cambiarse el puesto y cobrar otra tarifa.

## 8. Estado al cierre del 13/10

- **Fudo conectado** con la cuenta del dueño (verificado: es el Fudo de la 24). Ventas en vivo cada 10',
  menú (152 productos), 44 insumos creados desde Fudo con área y unidad. **Nada escrito en Fudo todavía.**
- **Protocolos pausados** (los 4 con `activo = false`) hasta que haya equipo con turno. Se reactivan
  desde la app (*Protocolos → configuración → activo*).
- **Recetas y descartables:** propuesta para el dueño en `PROPUESTA-RECETAS-Y-DESCARTABLES.md`.
- **Proveedores:** 41 de 44 insumos sin proveedor (en Fudo hay solo 2 reales: Nuevo Polo Norte y
  Todo Envase). Cargar los proveedores en Fudo → *Sync Fudo* → asignar en `/proveedores/vincular`.
- **Lo que escribe en Fudo** (no usar hasta la Puesta a cero): conteos, mermas, recepciones,
  producciones, confirmar compras / pagar gastos, ajustes por el chatbot y la configuración de
  descartables por producto.

## 9. Empleados (13/10)

- Copiados los **25 empleados activos de Santa Fe** con `scripts/copiar-empleados-lve.mjs`: mismo
  email, misma contraseña (cifrada), mismo rol y mismo id que en LVE. En la 24 hay 26 perfiles
  (los 25 + Admin24). Incluye 3 cuentas que parecen genéricas o de prueba de LVE
  (`encargado@lve.com`, `runner@lve.com` y `lu@laviejaescuela.com`, esta última **socio**): revisar
  si se usan y, si no, desactivarlas.
- Quien no trabaje en la 24 se desactiva desde *Equipo* (un encargado puede de encargado para abajo;
  a un socio solo lo desactiva otro socio). Los nuevos se dan de alta desde *Equipo → Nuevo*.
- Si alguien cambia la contraseña en una app, en la otra no cambia (son cuentas separadas).
- Falta: **cargar los turnos** (sin turno no se puede fichar) y reactivar los protocolos.

## 10. Mudanza de Vercel a la VPS (19/10)

Vercel dio de baja el plan gratis (402 DEPLOYMENT_DISABLED). La app ahora corre en la VPS del equipo,
con el mismo esquema que Casa Fe, Citify y Malala. La base sigue en Supabase.

| | |
|---|---|
| **Dirección provisoria** | https://salaprofes24.2-25-185-242.sslip.io |
| Servidor | `root@2.25.185.242` (Ubuntu 24.04, 1 núcleo, 3,8 GB) |
| Usuario / código | `salaprofes24` (sin shell) · `/home/salaprofes24/sala-de-profes-24` (clon, rama `main`) |
| Variables | `/etc/salaprofes24/app.env` (640 root:salaprofes24). **No** tiene `LVE_DB_URL` ni `SUPABASE_DB_URL` (la app no las usa) |
| Servicio | `salaprofes24.service` → `next start -H 127.0.0.1 -p 3070` · Nice=10 · MemoryMax=1G · Restart=always |
| Caddy | `/etc/caddy/salaprofes24.caddy` (import al final del Caddyfile) |
| Crons | `/etc/cron.d/salaprofes24` (13: los de vercel.json salvo el festejo del 19/10, a 127.0.0.1:3070) · secreto en `/etc/salaprofes24/cron.curlrc` (600) · log `/var/log/salaprofes24-cron.log` |
| Relojes de Supabase | Los 7 de pg_cron apuntan a la dirección provisoria |

**Deploy (reemplaza a Vercel):** con `main` pusheado, `bash scripts/deploy-vps.sh`. La VPS no tiene
acceso al repo privado: el script lleva el código como `git bundle`. Para que la VPS pueda hacer
`git pull` sola, el **dueño del repo** (`digitalamenitiessas-lang`) tiene que agregar una *deploy key*
de solo lectura (no usar la de `sala-de-profes-LVE` que está en `/root/.ssh`).

**Falta (vos):**
- Supabase → *Authentication → URL Configuration*: Site URL `https://salaprofes24.2-25-185-242.sslip.io`
  y Redirect URLs `https://salaprofes24.2-25-185-242.sslip.io/**` (para "Olvidé mi contraseña").
- Avisar al equipo la **dirección nueva**: los que tenían la app instalada desde `sala-de-profes-24.vercel.app`
  la tienen que volver a instalar y **reactivar las notificaciones** (los avisos dependen de la dirección).
- **Dominio propio:** cuando lo haya, se agrega como primer nombre del bloque de Caddy, se actualiza
  `NEXT_PUBLIC_APP_URL` en `app.env` (y se recompila: es `NEXT_PUBLIC_*`), los relojes de pg_cron y la
  Site URL de Supabase.
- La VPS está en EE. UU. y la base en San Pablo: cada consulta tarda un poco más que en Vercel.

## 11. Segunda sincronización con LVE (19/10)

Traídos los cambios de LVE `2cb4da4..be59676` (runner cuenta stock, compras directas de Fudo al
historial, recordatorio de turno 18 h, aviso a socios por fichajes, cruce tolva vs ventas, misma factura
= un gasto, festejo del 19/10). Sin cambios de base. Último commit de LVE sincronizado: **`be59676`**.
Cron nuevo en la VPS: `recordatorio-turno` (21:00 UTC). El del festejo no se agregó (era solo el 19/10).

**Arreglado en la 24 sobre lo que trajo LVE (avisarle a tu compañero, LVE tiene los mismos bugs):**
- Aviso de llegada tarde: nunca saltaba (`start_time` viene como HH:MM:SS → NaN) y el push abría
  `/fichajes`, que no existe. También corre aunque Fudo esté caído.
- Compras cargadas directo en Fudo: se sumaban **dos veces** al stock de la app (el espejo de Fudo ya
  las trae) y tomaban la fecha en UTC. Ahora se guarda solo el historial y se relee el stock de Fudo.
- Cruce tolva/ventas: cortaba en 1000 filas (diferencia inflada), la API dejaba verlo a cualquiera
  (ahora solo socios), no encontraba "Cafe" sin tilde y partía mal el turno después de medianoche.
- Recordatorio de turno: contaba como "enviado" a quien no tiene avisos activos.
- Compras: el número de factura anterior se **precargaba** y la compra se sumaba sola al gasto anterior
  en Fudo. Ahora hay que elegirlo a propósito ("¿Es la misma factura…? Usar ese número").

**Queda como en LVE (decidir más adelante):**
- El servidor igual suma a un gasto de Fudo si alguien escribe a mano un número de factura que coincide
  con una carga de los últimos 7 días del mismo proveedor y medio de pago.
- Con dos turnos el mismo día, el aviso de tardanza del segundo turno compara contra el fichaje de la
  mañana.
- El runner ahora puede contar stock: mientras no se haga la Puesta a cero, sus conteos escriben en Fudo.
