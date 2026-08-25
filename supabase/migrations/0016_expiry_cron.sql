-- Schedules the daily expiry reminders.
--
-- Requires three Vault secrets to exist first. They hold credentials, so they
-- are created once by hand rather than committed here:
--
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<project secret key>',      'edge_secret_key');
--   select vault.create_secret('<32 random bytes, base64>', 'cron_secret');
--
-- The same random value must be set as the CRON_SECRET edge function secret;
-- the function rejects any request whose x-cron-secret header does not match.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Daylight saving is the whole reason this looks odd.
--
-- pg_cron has no per-job timezone and evaluates schedules in UTC on Supabase.
-- 10:00 in Israel is 08:00 UTC in winter (UTC+2) and 07:00 UTC in summer
-- (UTC+3). Rather than editing the schedule twice a year -- and getting it
-- wrong the year nobody remembers -- the job fires at both hours and does
-- nothing unless the local clock actually reads 10. Exactly one of the two
-- runs does the work, every day, in both halves of the year.
select cron.schedule(
  'voucher-expiry-notifications',
  '0 7,8 * * *',
  $cron$
  select case
    when extract(hour from (now() at time zone 'Asia/Jerusalem')) = 10 then
      net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/send-expiry-notifications',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'apikey',        (select decrypted_secret from vault.decrypted_secrets where name = 'edge_secret_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('trigger', 'cron'),
        timeout_milliseconds := 10000
      )
  end;
  $cron$
);

-- Retry sweep, twenty minutes later on the same gate. The function returns 202
-- and sends in the background, so a crash mid-batch leaves claims with
-- notified_at still null; claim_expiry_notifications picks those up again once
-- they are older than its staleness window.
select cron.schedule(
  'voucher-expiry-notifications-retry',
  '20 7,8 * * *',
  $cron$
  select case
    when extract(hour from (now() at time zone 'Asia/Jerusalem')) = 10 then
      net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/send-expiry-notifications',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'apikey',        (select decrypted_secret from vault.decrypted_secrets where name = 'edge_secret_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('trigger', 'cron-retry'),
        timeout_milliseconds := 10000
      )
  end;
  $cron$
);
