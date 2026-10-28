-- push-dispatch ran every minute, 1,440 times a day, and logged a job_runs
-- row each time, though wake_dispatcher already calls it the moment a
-- notification is queued. The cron is the safety net for retries, expired
-- leases and grouped "missing" notifications, so it now calls the function
-- only when one of those is waiting, plus once an hour as the heartbeat
-- the health check looks for.

-- Whether push-dispatch has anything to send. Called by pg_cron only.
create function dispatch_due() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from notification_outbox
      where sent_at is null and attempts < 5
        and (claimed_at is null or claimed_at < now() - interval '5 minutes'))
    or exists (select 1 from missing_queue where send_after <= now())
$$;

-- An hourly run is now normal, so quiet means more than an hour.
update app_config set value = '70' where key = 'health_dispatch_max_quiet_minutes' and value = '10';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('push-dispatch', '* * * * *', $job$
      select net.http_post(
        url := (select value from public.app_config where key = 'functions_url') || '/push-dispatch',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select value from public.app_config where key = 'cron_secret')),
        body := '{}'::jsonb)
      where exists (select 1 from public.app_config where key = 'functions_url')
        and (public.dispatch_due() or extract(minute from now()) = 0)
    $job$);
  end if;
end $$;
