-- Productization: operational metrics, the health report the scheduled
-- workflow checks, an anonymous liveness probe, and the support RPCs behind
-- the diagnostics and admin screens. Everything here returns counts and
-- ids, never names, emails or secrets: the health workflow's logs are public.

-- Thresholds, server-only so they change without a deploy (see runbook).
insert into app_config (key, value) values
  ('health_outbox_max_minutes', '10'),
  ('health_dispatch_max_quiet_minutes', '10'),
  ('health_push_max_failure_ratio', '0.2'),
  ('health_archive_max_hours', '48'),
  ('health_db_max_mb', '400'),
  ('health_backup_max_hours', '26')
on conflict (key) do nothing;

-- Builds older than this commit time (Unix seconds) must reload before
-- they may write: the escape hatch for a breaking schema change.
insert into app_config (key, value, client_readable) values ('min_client_version', '0', true)
on conflict (key) do nothing;

-- Counts from tables that exist only where pg_cron and pg_net are installed.
-- Null where they are not, so the metrics work on plain Postgres too.
create function optional_count(p_table text, p_where text) returns int
language plpgsql stable security definer set search_path = public as $$
declare n int;
begin
  if to_regclass(p_table) is null then return null; end if;
  execute format('select count(*) from %s where %s', p_table, p_where) into n;
  return n;
end $$;

create function minutes_since(p_at timestamptz) returns numeric
language sql stable as $$ select round(extract(epoch from now() - p_at)::numeric / 60, 1) $$;

-- The numbers the health check and the admin screen need. A function, not
-- a view: some sources exist only on Supabase. Service role and admins.
create function ops_metrics() returns jsonb
language sql stable security definer set search_path = public as $$
  with outbox as (
    select
      count(*) filter (where sent_at is null and attempts < 5) as unsent,
      minutes_since(min(created_at) filter (where sent_at is null and attempts < 5)) as oldest_unsent_minutes,
      percentile_cont(0.5) within group (order by extract(epoch from sent_at - created_at))
        filter (where sent_at > now() - interval '24 hours') as p50,
      percentile_cont(0.95) within group (order by extract(epoch from sent_at - created_at))
        filter (where sent_at > now() - interval '24 hours') as p95,
      count(*) filter (where sent_at is null and attempts >= 5 and created_at > now() - interval '24 hours') as abandoned
    from notification_outbox
  ), dispatch as (
    select
      coalesce(sum((summary ->> 'sent')::int), 0) as sent,
      coalesce(sum((summary ->> 'failed')::int), 0) as failed,
      coalesce(sum((summary ->> 'removed')::int), 0) as removed
    from job_runs where job = 'push-dispatch' and finished_at > now() - interval '24 hours'
  ), last_ok as (
    select job, max(finished_at) as at from job_runs where ok group by job
  ), last_archive as (
    select summary from job_runs where job = 'archive' order by finished_at desc limit 1
  )
  select jsonb_build_object(
    'outbox_unsent', o.unsent,
    'outbox_oldest_unsent_minutes', o.oldest_unsent_minutes,
    'push_p50_seconds', round(o.p50::numeric, 1),
    'push_p95_seconds', round(o.p95::numeric, 1),
    'push_abandoned_24h', o.abandoned,
    'push_sent_24h', d.sent,
    'push_failed_24h', d.failed,
    'push_devices_removed_24h', d.removed,
    'push_failure_ratio_24h', case when d.sent + d.failed > 0 then round(d.failed::numeric / (d.sent + d.failed), 3) end,
    'dispatch_configured', exists (select 1 from app_config where key = 'functions_url'),
    'dispatch_last_ok_minutes', minutes_since((select at from last_ok where job = 'push-dispatch')),
    'cron_failed_1h', optional_count('cron.job_run_details', $w$status = 'failed' and start_time > now() - interval '1 hour'$w$),
    'net_errors_1h', optional_count('net._http_response',
      $w$created > now() - interval '1 hour' and (status_code >= 400 or error_msg is not null or timed_out)$w$),
    -- Until the archive runs with Drive configured, there is nothing to check.
    'archive_configured', coalesce((select (summary ->> 'configured')::boolean from last_archive), false),
    'archive_last_ok_hours', round(minutes_since((select at from last_ok where job = 'archive')) / 60, 1),
    'events_past_retention', (select count(*) from archive_candidates()),
    'backup_last_ok_hours', round(minutes_since((select at from last_ok where job = 'backup')) / 60, 1),
    'db_size_mb', round(pg_database_size(current_database()) / 1048576.0, 1),
    'active_users_24h', (select count(distinct actor) from audit_log where at > now() - interval '24 hours'),
    'requests_created_24h', (select count(*) from requests where created_at > now() - interval '24 hours')
  )
  from outbox o, dispatch d
$$;

create function threshold(p_key text) returns numeric
language sql stable security definer set search_path = public as $$
  select value::numeric from app_config where key = p_key
$$;

-- Pass or fail per check, against the thresholds in app_config. A check
-- whose source is not set up yet (no archive, no backup so far) passes;
-- the workflow that should feed it fails on its own and emails.
create function health_report() returns jsonb
language sql stable security definer set search_path = public as $$
  with m as (select ops_metrics() as v),
  checks (name, value, max_allowed) as (
    select 'outbox_oldest_unsent_minutes', (v ->> 'outbox_oldest_unsent_minutes')::numeric,
           threshold('health_outbox_max_minutes') from m
    union all
    select 'cron_failed_1h', (v ->> 'cron_failed_1h')::numeric, 0 from m
    union all
    -- Never succeeded counts as failing once the functions are deployed.
    select 'dispatch_last_ok_minutes',
           case when (v ->> 'dispatch_configured')::boolean
                then coalesce((v ->> 'dispatch_last_ok_minutes')::numeric, 999999) end,
           threshold('health_dispatch_max_quiet_minutes') from m
    union all
    select 'push_failure_ratio_24h', (v ->> 'push_failure_ratio_24h')::numeric,
           threshold('health_push_max_failure_ratio') from m
    union all
    select 'archive_last_ok_hours',
           case when (v ->> 'archive_configured')::boolean and (v ->> 'events_past_retention')::int > 0
                then coalesce((v ->> 'archive_last_ok_hours')::numeric, 999999) end,
           threshold('health_archive_max_hours') from m
    union all
    select 'db_size_mb', (v ->> 'db_size_mb')::numeric, threshold('health_db_max_mb') from m
    union all
    select 'backup_last_ok_hours', (v ->> 'backup_last_ok_hours')::numeric, threshold('health_backup_max_hours') from m
  )
  select jsonb_build_object(
    'ok', bool_and(value is null or value <= max_allowed),
    'checks', jsonb_agg(jsonb_build_object('name', name, 'value', value, 'max', max_allowed,
                                           'ok', value is null or value <= max_allowed) order by name),
    'metrics', (select v from m))
  from checks
$$;
grant execute on function ops_metrics, health_report to service_role;

-- The admin home's status strip.
create function admin_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return health_report();
end $$;
grant execute on function admin_health to authenticated;

-- Liveness for the external uptime monitor, with the anon key. The answer
-- comes from Postgres through the API, so a paused or down project fails it.
create function health() returns jsonb
language sql stable as $$ select jsonb_build_object('ok', true) $$;
grant execute on function health to anon, authenticated;

-- The health workflow replaces the keepalive workflow and its function.
drop function keepalive();

-- Support -------------------------------------------------------------------

create or replace function notification_body(p_kind text, p_supplier text default null, p_event text default null,
  p_count int default null, p_items text default null)
returns text language sql immutable as $$
  select case p_kind
    when 'approved' then 'החשבון שלך אושר'
    when 'battalion_event' then 'נפתח אירוע חדש: ' || p_event
    when 'ready' then p_supplier || ': הרשימה מוכנה לאיסוף'
      || coalesce(' · חסרים: ' || p_items, '')
    when 'missing' then p_supplier || ': חסרים ' || p_count || ' פריטים: ' || p_items
    when 'test' then 'התראת בדיקה: ההתראות מגיעות למכשיר הזה'
  end
$$;

-- "Send test notification" on the diagnostics screen: a push to the caller
-- only, at most once a minute. Pending users may test too.
create function send_test_notification() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from users where id = auth.uid()) then
    raise exception 'sign up first';
  end if;
  if exists (select 1 from notification_outbox where kind = 'test' and target_user = auth.uid()
             and created_at > now() - interval '1 minute') then
    raise exception 'test notification already sent, try again in a minute';
  end if;
  perform notify('test', notification_body('test'), '/diagnostics', p_user => auth.uid());
end $$;
grant execute on function send_test_notification to authenticated;

-- One user's devices, the notifications that should have reached them, and
-- their recent changes, for the admin support view.
create function user_support(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_user users;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select * into v_user from users where id = p_user;
  if not found then return null; end if;
  return jsonb_build_object(
    'devices', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'user_agent', s.user_agent, 'created_at', s.created_at, 'last_success_at', s.last_success_at)
        order by s.created_at desc), '[]')
      from push_subscriptions s where s.user_id = p_user),
    'notifications', (select coalesce(jsonb_agg(n order by n.created_at desc), '[]') from (
        select o.id, o.kind, o.body, o.created_at, o.sent_at, o.attempts, o.last_error
        from notification_outbox o
        where o.target_user = p_user
           or (v_user.role = 'customer' and (o.target_company = v_user.unit_id or o.target_all_customers))
        order by o.created_at desc limit 20) n),
    'audit', (select coalesce(jsonb_agg(a order by a.at desc), '[]') from (
        select a.at, a.table_name, a.row_id, a.op, a.changed
        from audit_log a where a.actor = p_user order by a.at desc limit 30) a));
end $$;
grant execute on function user_support to authenticated;

-- Admins and suppliers with their last change, to catch stale access.
create function access_review()
returns table (user_id uuid, role user_role, unit_id uuid, active boolean, approved_at timestamptz, last_change_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return query
    select u.id, u.role, u.unit_id, u.active, u.approved_at,
           (select max(a.at) from audit_log a where a.actor = u.id)
    from users u where u.role in ('admin', 'supplier') and u.approval = 'approved'
    order by u.role, u.unit_id;
end $$;
grant execute on function access_review to authenticated;
