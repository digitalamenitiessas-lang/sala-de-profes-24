-- ---------------------------------------------------------------------------
-- Reloj del resumen de cada turno por Telegram:
--   16:30 Argentina (19:30 UTC) → turno mañana
--   01:30 Argentina (04:30 UTC) → turno tarde/noche
-- Reusa el secreto cron_secret_protocolos de Vault.
-- La URL apunta a la app de la sucursal 24 (lve24.com.ar).
-- Los horarios suponen los turnos de LVE (mañana 06-16, tarde/noche 16-06):
-- si la 24 corta distinto, cambiar las horas acá y en lib/reportes/resumen-turno.ts.
-- ---------------------------------------------------------------------------
select cron.unschedule('resumen-turno-tm') where exists (select 1 from cron.job where jobname = 'resumen-turno-tm');
select cron.unschedule('resumen-turno-tt') where exists (select 1 from cron.job where jobname = 'resumen-turno-tt');
select cron.schedule('resumen-turno-tm', '30 19 * * *', $$
  select net.http_get(
    url := 'https://lve24.com.ar/api/cron/resumen-turno?turno=TM',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')),
    timeout_milliseconds := 60000
  );
$$);
select cron.schedule('resumen-turno-tt', '30 4 * * *', $$
  select net.http_get(
    url := 'https://lve24.com.ar/api/cron/resumen-turno?turno=TT',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')),
    timeout_milliseconds := 60000
  );
$$);
