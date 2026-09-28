-- ---------------------------------------------------------------------------
-- Reloj de los protocolos: llama a /api/cron/protocolos cada 5 minutos.
-- Correr UNA vez en Supabase → SQL Editor (proyecto de Sala de Profes).
-- Reemplazar PEGAR_ACA_EL_CRON_SECRET por el valor de CRON_SECRET que está
-- en Vercel → Settings → Environment Variables (queda guardado cifrado en Vault).
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('PEGAR_ACA_EL_CRON_SECRET', 'cron_secret_protocolos');

select cron.schedule(
  'protocolos-avisos',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://sala-de-profes-lve.vercel.app/api/cron/protocolos',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')
    )
  );
  $$
);

-- Para comprobar que anda (a los 5-10 minutos):
--   select status_code, created from net._http_response order by created desc limit 5;
-- Tiene que decir 200. Si dice 401, el secreto está mal.
