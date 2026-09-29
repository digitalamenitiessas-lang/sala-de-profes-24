-- ---------------------------------------------------------------------------
-- Reloj del cierre automático de fichajes: cada hora (minuto 5).
-- El cron de Vercel solo corre una vez por día (16:00 AR) y hasta esa hora los
-- que no marcaron salida figuraban como presentes. La ruta solo cierra los
-- fichajes cuya hora prevista (fin de turno o cierre del local) ya pasó.
-- Usa el mismo secreto de Vault que los otros relojes (cron_secret_protocolos).
-- ---------------------------------------------------------------------------
select cron.schedule('auto-clockout', '5 * * * *', $$
  select net.http_get(
    url := 'https://sala-de-profes-24.vercel.app/api/cron/auto-clockout',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_protocolos')),
    timeout_milliseconds := 60000
  );
$$);
