-- Push notification triggers, the grouped missing-items queue, realtime
-- publication and scheduled jobs.

-- One row per company and supplier while missing marks are being grouped.
create table missing_queue (
  company_id uuid not null references units (id) on delete cascade,
  supplier_id uuid not null references units (id) on delete cascade,
  first_marked_at timestamptz not null default now(),
  send_after timestamptz not null,
  primary key (company_id, supplier_id)
);

create table missing_queue_items (
  request_id uuid primary key references requests (id) on delete cascade,
  company_id uuid not null,
  supplier_id uuid not null,
  foreign key (company_id, supplier_id) references missing_queue on delete cascade
);

alter table missing_queue enable row level security;
alter table missing_queue_items enable row level security;
revoke all on missing_queue, missing_queue_items from anon, authenticated;

create function drop_empty_missing_queues() returns void
language sql security definer set search_path = public as $$
  delete from missing_queue q
  where not exists (select 1 from missing_queue_items i
                    where i.company_id = q.company_id and i.supplier_id = q.supplier_id)
$$;

create function item_names(p_requests uuid[]) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(i.name, ', ' order by i.name)
  from requests r join items i on i.id = r.item_id
  where r.id = any (p_requests)
$$;

create function requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  win interval := (config('missing_window_minutes', '5') || ' minutes')::interval;
  cap interval := (config('missing_window_cap_minutes', '15') || ' minutes')::interval;
  v_supplier text;
  v_missing uuid[];
  v_body text;
begin
  -- Missing marks: add to the queue. Each mark pushes send_after out by
  -- the window, capped at first mark + cap.
  if new.status = 'missing' and old.status <> 'missing' then
    insert into missing_queue (company_id, supplier_id, first_marked_at, send_after)
    values (new.company_id, new.supplier_id, now(), now() + win)
    on conflict (company_id, supplier_id) do update
      set send_after = least(now() + win, missing_queue.first_marked_at + cap);
    insert into missing_queue_items (request_id, company_id, supplier_id)
    values (new.id, new.company_id, new.supplier_id)
    on conflict (request_id) do nothing;
  elsif old.status = 'missing' and new.status <> 'missing' then
    delete from missing_queue_items where request_id = new.id;
    perform drop_empty_missing_queues();
  end if;

  -- Ready for pickup: the supplier's section of this list has nothing
  -- pending left. Only a supplier's move out of pending triggers it, so
  -- toggling between ready, partial and missing sends nothing new.
  if old.status = 'pending' and new.status in ('ready', 'partial', 'missing')
     and not exists (select 1 from requests r where r.list_id = new.list_id
                     and r.supplier_id = new.supplier_id and r.status = 'pending')
     and exists (select 1 from requests r where r.list_id = new.list_id
                 and r.supplier_id = new.supplier_id and r.status in ('ready', 'partial'))
  then
    select name into v_supplier from units where id = new.supplier_id;
    select array_agg(r.id) into v_missing from requests r
    where r.list_id = new.list_id and r.supplier_id = new.supplier_id and r.status = 'missing';

    v_body := v_supplier || ': הרשימה מוכנה לאיסוף';
    if v_missing is not null then
      v_body := v_body || ' · חסרים: ' || item_names(v_missing);
      delete from missing_queue_items where request_id = any (v_missing);
      perform drop_empty_missing_queues();
    end if;
    perform notify('ready', v_body, '/events/' || new.event_id, p_company => new.company_id);
  end if;
  return null;
end $$;

create trigger requests_notify after update of status on requests
for each row when (new.status <> old.status) execute function requests_notify();

-- Called by push-dispatch every minute: turns due queue rows into
-- notifications. Returns how many were queued.
create function flush_missing_queue() returns int
language plpgsql security definer set search_path = public as $$
declare q record; v_ids uuid[]; v_supplier text; n int := 0;
begin
  for q in select * from missing_queue where send_after <= now() for update skip locked loop
    select array_agg(i.request_id) into v_ids
    from missing_queue_items i join requests r on r.id = i.request_id and r.status = 'missing'
    where i.company_id = q.company_id and i.supplier_id = q.supplier_id;

    if v_ids is not null then
      select name into v_supplier from units where id = q.supplier_id;
      perform notify('missing',
        v_supplier || ': חסרים ' || array_length(v_ids, 1) || ' פריטים: ' || item_names(v_ids),
        '/', p_company => q.company_id);
      n := n + 1;
    end if;
    delete from missing_queue where company_id = q.company_id and supplier_id = q.supplier_id;
  end loop;
  return n;
end $$;

-- Push subscriptions an outbox row should reach.
create function outbox_subscriptions(p_outbox bigint)
returns table (subscription_id uuid, endpoint text, p256dh text, auth text)
language sql stable security definer set search_path = public as $$
  select s.id, s.endpoint, s.p256dh, s.auth
  from notification_outbox o
  join users u on (
       u.id = o.target_user
    or (u.unit_id = o.target_company and u.role = 'customer' and u.approval = 'approved')
    or (o.target_all_customers and u.role = 'customer' and u.approval = 'approved'))
   and u.active
  join push_subscriptions s on s.user_id = u.id
  where o.id = p_outbox
$$;

-- Immediate delivery: wake push-dispatch through pg_net when it is
-- installed and app_config holds functions_url and cron_secret. The
-- every-minute job delivers anything this misses.
create function wake_dispatcher() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_url text := server_config('functions_url'); v_secret text := server_config('cron_secret');
begin
  if v_url is not null and v_secret is not null
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    execute 'select net.http_post(url := $1, headers := $2, body := ''{}''::jsonb)'
      using v_url || '/push-dispatch',
            jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret);
  end if;
  return null;
end $$;

create trigger notification_outbox_wake after insert on notification_outbox
for each statement execute function wake_dispatcher();

-- Events that left their retention window, for the archive function.
create function archive_candidates() returns setof events
language sql stable security definer set search_path = public as $$
  select * from events
  where coalesce(cancelled_at, closed_at, created_at)
        < now() - (config('retention_days', '90') || ' days')::interval
  order by coalesce(cancelled_at, closed_at, created_at)
$$;

-- Realtime ---------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table requests, lists, events, items;
  end if;
end $$;
alter table requests replica identity full;

-- Scheduled jobs ------------------------------------------------------------
-- On Supabase, pg_cron and pg_net are available. Locally they may not be,
-- so the jobs are created only when both extensions install.
do $$
begin
  begin
    -- Schemas as in Supabase's docs for these extensions.
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise warning 'pg_cron or pg_net unavailable, scheduled jobs NOT created: %', sqlerrm;
    return;
  end;

  perform cron.schedule('push-dispatch', '* * * * *', $job$
    select net.http_post(
      url := (select value from public.app_config where key = 'functions_url') || '/push-dispatch',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'cron_secret')),
      body := '{}'::jsonb)
    where exists (select 1 from public.app_config where key = 'functions_url')
  $job$);

  perform cron.schedule('archive', '17 2 * * *', $job$
    select net.http_post(
      url := (select value from public.app_config where key = 'functions_url') || '/archive',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-secret', (select value from public.app_config where key = 'cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000)
    where exists (select 1 from public.app_config where key = 'functions_url')
  $job$);
end $$;
