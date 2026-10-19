-- ---------------------------------------------------------------------------
-- Reloj de los fichajes: cierra cada 15 minutos las salidas olvidadas.
-- Antes el cierre corría una vez por día (16:00): un fichaje olvidado quedaba
-- "abierto" hasta 16 horas mostrando horas de más.
-- Reusa el secreto cron_secret_protocolos de Vault (protocolos_reloj.sql).
-- La URL apunta a la app de la sucursal 24 (lve24.com.ar).
-- Reemplaza al reloj 'auto-clockout' de la 24 (cada hora, auto_clockout_reloj.sql):
-- se borra para que la misma ruta no corra con dos relojes.
-- ---------------------------------------------------------------------------

select cron.unschedule('auto-clockout') where exists (select 1 from cron.job where jobname = 'auto-clockout');
select cron.unschedule('fichajes-cierre') where exists (select 1 from cron.job where jobname = 'fichajes-cierre');
select cron.schedule(
  'fichajes-cierre',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://lve24.com.ar/api/cron/auto-clockout',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Comprobar (a los 15-30 minutos):
--   select status_code, created from net._http_response order by created desc limit 5;
