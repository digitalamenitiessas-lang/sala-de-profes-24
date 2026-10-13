-- ---------------------------------------------------------------------------
-- Reloj del resumen semanal: lunes 8:00 Argentina (11:00 UTC). Manda a los
-- socios el resumen de la semana anterior con la liquidación en PDF.
-- Reusa el secreto cron_secret_protocolos de Vault.
-- Vista previa sin mandar: GET /api/cron/resumen-semanal?vista=1 (con el secreto).
-- La URL apunta a la app de la sucursal 24 (sala-de-profes-24.vercel.app).
-- ---------------------------------------------------------------------------
select cron.unschedule('resumen-semanal') where exists (select 1 from cron.job where jobname = 'resumen-semanal');
select cron.schedule(
  'resumen-semanal',
  '0 11 * * 1',
  $$
  select net.http_get(
    url := 'https://sala-de-profes-24.vercel.app/api/cron/resumen-semanal',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')
    ),
    timeout_milliseconds := 120000
  );
  $$
);
