-- Execute somente depois de criar DJEN_CRON_SECRET no Supabase Vault.
-- Ajuste o URL do projeto se o ambiente mudar.

select cron.schedule(
  'faro-prazos-importar-djen',
  '30 10 * * 1-5',
  $$
  select net.http_post(
    url := 'https://dhpjlblafvlvcrgcvwxf.supabase.co/functions/v1/importar-djen',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'DJEN_CRON_SECRET'
        limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
