# Estructura de la base — sucursal 24 y Maipú

La base de la 24 (`hmoqksbyfemzprpsxovu`) se armó el 2026-09-28 copiando **solo la
estructura** de la base de LVE (Santa Fe 746), sin datos. Las migraciones de
`supabase/migrations/` **no** alcanzan para armar una base: unas 20 tablas se crearon
a mano en el panel y varias migraciones nunca se aplicaron o cargan datos de LVE.
**No correr `supabase/migrations/` ni `supabase/seed/` sobre esta base.**

## Cómo se hizo

1. `pg_dump --schema-only --schema=public --no-owner --quote-all-identifiers` contra LVE
   (sesión de solo lectura).
2. Se quitaron 14 líneas que fallan en un Supabase nuevo: `CREATE SCHEMA "public"`,
   `COMMENT ON SCHEMA "public"` y los `ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"`.
3. Se aplicó en una sola transacción:
   ```
   psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
     -f 01_permisos_previos.sql -f 02_estructura_desde_lve.sql
   psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f 03_ajustes_sucursal_24.sql
   ```

## Archivos

| Archivo | Qué hace |
|---|---|
| `01_permisos_previos.sql` | Apaga los permisos automáticos de Supabase en `public` para que los GRANT del dump dejen **los mismos permisos que LVE** (27 funciones que LVE tiene cerradas al público quedan cerradas). El final del dump los vuelve a prender. |
| `02_estructura_desde_lve.sql` | Tablas, vistas, funciones, triggers, índices, políticas RLS y permisos de LVE. |
| `03_ajustes_sucursal_24.sql` | Lo que el dump no trae (trigger de perfiles en `auth.users`, bucket `protocolos`, realtime, extensiones `cube`/`earthdistance`), el perfil del socio y arreglos de seguridad heredados de LVE. |

## Diferencias con LVE (a propósito)

Verificado comparando el catálogo completo de las dos bases (columnas, funciones,
políticas, triggers, índices, restricciones y permisos por rol): todo es idéntico salvo:

- Sin las tablas `_backup_*_20260728` (respaldos de LVE, sin RLS y abiertos a `anon`).
- `audit_trail_select` sin el UUID de un usuario de LVE (solo socio).
- `bar_stock_items`: políticas `TO authenticated` (antes también `anon`).
- Vistas `v_today_attendance` y `v_active_alerts` con `security_invoker` y sin `anon`.
- `handle_new_user()` ya no toma el rol de los metadatos del registro (siempre `barista`).
- `profiles_insert` solo deja crearse el perfil propio como `barista`.
- Trigger `trg_profiles_proteger_rol`: rol y estado solo los cambia un encargado o socio.
- Sin el bucket `attendance-selfies` (la app no lo usa).
- `cube` / `earthdistance` en el schema `extensions` (en LVE están en `public`).

Los relojes de pg_cron **todavía no están creados**: ver `supabase/manual/` y
`PENDIENTES-SUCURSAL-24.md`.
