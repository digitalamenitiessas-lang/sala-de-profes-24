-- ---------------------------------------------------------------------------
-- Reloj de Fudo (pg_cron + pg_net). Usa el secreto ya guardado en Vault
-- ('cron_secret_protocolos' = CRON_SECRET de Vercel).
--   fudo-pulso          cada 10 min: conexión, reintentos, ventas, stock, menú
--   fudo-sync-reintento 07:45 UTC (04:45 AR): repite el nocturno si falló
-- También alarga la espera del reloj de protocolos (antes 5 s por defecto).
-- ---------------------------------------------------------------------------
select cron.schedule('fudo-pulso', '*/10 * * * *', $$
  select net.http_get(
    url := 'https://sala-de-profes-lve.vercel.app/api/cron/fudo-pulso',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')),
    timeout_milliseconds := 120000
  );
$$);

select cron.schedule('fudo-sync-reintento', '45 7 * * *', $$
  select net.http_get(
    url := 'https://sala-de-profes-lve.vercel.app/api/cron/fudo-sync?si_fallo=1',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')),
    timeout_milliseconds := 300000
  );
$$);

select cron.schedule('protocolos-avisos', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://sala-de-profes-lve.vercel.app/api/cron/protocolos',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')),
    timeout_milliseconds := 60000
  );
$$);
