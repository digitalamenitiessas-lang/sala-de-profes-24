# Pendientes — Sala de Profes 24 y Maipú

Actualizado: 2026-09-28 (noche).

## Dónde estamos

| | Estado |
|---|---|
| Repo `digitalamenitiessas-lang/sala-de-profes-24` | ✅ Sin historial ni conexiones a LVE |
| Vercel `sala-de-profes-24.vercel.app` | ✅ Deployado, con las variables de la 24 |
| Base Supabase `hmoqksbyfemzprpsxovu` | ✅ Estructura completa de LVE, sin datos (ver `supabase/estructura/README.md`) |
| Perfil de socio | ✅ Creado para el usuario que ya existía (figura como "Admin24 Socio": cambiar el nombre en Configuración) |
| Fudo | ⏳ Faltan las credenciales de la cuenta de la 24 |
| Relojes pg_cron | ⏳ Se crean cuando esté Fudo (ver abajo) |
| Resend (mails) e IA | ⏳ Faltan las claves |

## 1. Lo que tenés que hacer en el panel de Supabase (proyecto de la 24)

1. **Authentication → Sign In / Providers → apagar "Allow new users to sign up".** La app crea
   usuarios desde Equipo, no necesita registro público. Con el registro abierto cualquiera puede
   crearse una cuenta con la clave pública.
2. **Authentication → URL Configuration:**
   - Site URL: `https://sala-de-profes-24.vercel.app`
   - Redirect URLs: agregar `https://sala-de-profes-24.vercel.app/auth/callback`
   Sin esto, "Olvidé mi contraseña" manda a localhost.
3. (Opcional) **Authentication → Emails → SMTP**: si LVE usa SMTP propio para los mails de acceso,
   copiar la misma configuración.

## 2. Relojes (pg_cron) — cuando estén las credenciales de Fudo

No se crearon a propósito: el pulso de Fudo corre cada 10 minutos y, sin credenciales, generaría
alertas de "Fudo caído". Cuando Fudo esté cargado en Vercel (y redeployado):

1. Guardar el `CRON_SECRET` de la 24 en Vault (el mismo valor que está en Vercel y `.env.local`):
   `select vault.create_secret('<CRON_SECRET>', 'cron_secret_protocolos');`
2. Correr `supabase/manual/fudo_reloj.sql` (crea `fudo-pulso`, `fudo-sync-reintento` y
   `protocolos-avisos`, ya apuntando a `sala-de-profes-24.vercel.app`).
3. Verificar: `select jobname, schedule from cron.job;` → 3 filas, y ninguna con `-lve.`.

## 3. Preguntas para el dueño

| Tema | En LVE hoy | Qué hay que decidir | Recomendación |
|---|---|---|---|
| **Fudo** | — | Credenciales de la cuenta de Fudo de la 24 | Imprescindible para ventas, stock y menú |
| **Equipo** | 35 perfiles | Lista de empleados: nombre, rol, email, teléfono | Se dan de alta desde **Equipo** |
| **Horario de cierre por día** | 7 filas (vie/sáb a la 01:00) | ¿A qué hora cierra la 24 cada día? | Sin esto la salida automática asume medianoche |
| **Tarifa por hora de cada rol** | 6 filas | ¿Cuánto se paga por hora a cada rol en la 24? | Sin esto la liquidación da $0 |
| **Recetas** | 296 recetas, 887 ingredientes | ¿Son las mismas? | Si ya están en el Fudo de la 24, importarlas desde ahí. Copiarlas de LVE se puede, pero hay que volver a vincular los insumos |
| **Insumos** | 500 | ¿Es el mismo catálogo? | Dejar que se creen solos desde el Fudo de la 24 (cron nocturno). Copiarlos de LVE genera duplicados salvo que se les cargue el ID de Fudo de la 24 |
| **Proveedores** | 98 | ¿Son los mismos? | Si son los mismos, se copian, pero antes de sincronizar con Fudo hay que vincularlos con los IDs de la 24, o se duplican |
| **Menú y categorías** | 588 / 36 | — | No se copian: vienen del Fudo de la 24 |
| **Protocolos** | 1: "Limpieza del baño" (11:00, 14:30, 18:00, 21:30; 2 fotos) | ¿El mismo protocolo y horarios? | La app no tiene pantalla para crear protocolos: se cargan por SQL |
| **Vajilla** | 33 ítems | ¿La misma lista? | Copiar solo los nombres, con cantidad 0 |
| **Checklists de cocina y mise en place** | 73 plantillas / 71 ítems | ¿Los usan? | Hoy el módulo casi no se usa: cargar solo si lo piden |
| **Plantillas de producción** | 2 | — | Dependen de recetas e insumos: después de decidir eso |
| **Código de expedientes** | `LVE-2026-0001` | ¿Mismo prefijo o uno propio (ej. `24M-`)? | Si cambia, hay que tocar la función y una regex del front |
| **Mails (Resend) e IA** | — | ¿Misma cuenta y dominio que LVE o propias? | Las de IA se pueden compartir |

Si deciden copiar algo de LVE, hace falta `LVE_DB_URL` en `.env.local` (solo lectura). Cuando no
se copie nada más, **borrar esa línea**.

## 4. Errores de código encontrados (están también en LVE)

**Arreglados en la 24** (commit local, falta el push):

1. **La salida del fichaje fallaba siempre.** La app mandaba `clock_out_type: 'normal'` y la base
   solo acepta `manual`, `auto` o `edited`. En LVE no hay **ninguna salida manual desde el
   05/04**: los 26 fichajes posteriores los cerró el reloj automático.
   → `src/app/api/attendance/clock/route.ts`
2. **Pantalla de Stock, compras sugeridas, briefing, prioridades y chatbot sin datos o con
   error** desde que existe `stock_item_suppliers` (27/09): el cruce `stock_items → suppliers`
   quedó ambiguo (`PGRST201`). → pista `suppliers!stock_items_supplier_id_fkey` en 6 archivos.
3. **Producción: listado y detalle de órdenes fallan** (dos relaciones posibles con `profiles`).
   → pista `profiles!production_orders_chef_id_fkey` en 2 archivos.

Los tres se comprobaron contra la API real de la 24: fallaban antes y responden 200 después.

**Sin arreglar todavía:**

- `/control` (tarjeta de fichajes) y `/stock/rendimiento` llaman a las funciones
  `get_suspicious_attendance` y `stock_duration`, que no existen en ninguna de las dos bases.
- `/admin/asistencia` usa 5 tablas que no existen (anomalías, correcciones, dispositivos, WiFi).
- "Guardar configuración" de asistencia falla porque `attendance_config` no tiene filas (en LVE
  pasa lo mismo con 3 de las 4 claves).
- Chatbot: crea pedidos de barra con urgencia `alta`/`urgente` (la base espera `high`/`critical`) y
  consulta dos columnas que no existen (`bar_orders.created_by`, `kitchen_shifts.shift_date`).
- `deduct_stock_on_sale` y `produce_recipe` llaman a `register_stock_movement`, que no existe
  (código muerto).

## 5. Para avisarle a tu compañero (LVE, Santa Fe)

Nada de esto se tocó en LVE. En la 24 ya está corregido; como referencia sirve
`supabase/estructura/03_ajustes_sucursal_24.sql`.

**Seguridad:**
- **Cualquiera puede darse el rol de socio** si el registro público está activado en LVE:
  `handle_new_user()` toma el rol de lo que manda el cliente al registrarse.
- **Cualquier empleado puede cambiarse a socio** con un update de su propio perfil: la política
  `profiles_update_own` no limita la columna `role`.
- **Tablas `_backup_*_20260728`** (535 + 529 + 137 filas reales) sin RLS y con permiso total para
  `anon`: se pueden leer y modificar solo con la clave pública.
- **Vistas `v_today_attendance` y `v_active_alerts`** legibles sin sesión: nombres y fichajes del día.
- **`bar_stock_items`** abierta a `anon` (leer, crear y modificar).
- **Rotar la clave `service_role`**: estuvo escrita en `scripts/create-users.mjs` y
  `scripts/update-profiles.mjs` del repo de LVE.

**Bugs:** los tres de la sección 4 (mismos archivos, mismo arreglo).
