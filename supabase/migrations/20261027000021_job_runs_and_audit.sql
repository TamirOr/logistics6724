-- Productization: a record of every scheduled run, a change history for
-- support, and longer notification retention so "why no push" can be traced.

-- Job runs ------------------------------------------------------------------
-- Supabase keeps function logs only briefly on the free plan. Each run of
-- push-dispatch, archive and the backup workflow writes one row here, which
-- the health check reads. Written by the service role only.
create table job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  ok boolean not null,
  -- Counts only (claimed, sent, failed, removed, archived...), never names.
  summary jsonb not null default '{}',
  error text
);
create index job_runs_job_idx on job_runs (job, finished_at desc);
alter table job_runs enable row level security;
revoke all on job_runs from anon, authenticated;

-- push-dispatch records each device's last delivery, for the support view.
alter table push_subscriptions add column last_success_at timestamptz;

-- Audit log -----------------------------------------------------------------
-- Who changed what, to answer "who changed this quantity" and "was my
-- write ever received". Rows of an event go when the event is archived;
-- rows about users and units are purged after the same retention window.
create table audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references users (id) on delete set null,
  table_name text not null,
  row_id text not null,
  op text not null check (op in ('insert', 'update', 'delete')),
  event_id uuid references events (id) on delete cascade,
  -- insert and delete: the row; update: {column: [old, new]} for changed columns only.
  changed jsonb not null
);
create index audit_log_row_idx on audit_log (table_name, row_id, at desc);
create index audit_log_actor_idx on audit_log (actor, at desc);
create index audit_log_event_idx on audit_log (event_id);
create index audit_log_at_idx on audit_log (at);
alter table audit_log enable row level security;
revoke all on audit_log from anon;
revoke insert, update, delete on audit_log from authenticated;
create policy audit_log_admin_read on audit_log for select to authenticated using ((select is_admin()));

-- The columns of a row, minus the ones named in the trigger's arguments:
-- bookkeeping noise, or personal data that must not outlive the user row.
create function audit_row_json(p_row jsonb, p_omit text[]) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(p_row) where key <> all (p_omit)
$$;

create function audit_changes(p_old jsonb, p_new jsonb, p_omit text[]) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(n.key, jsonb_build_array(p_old -> n.key, n.value)), '{}')
  from jsonb_each(p_new) n
  where n.key <> all (p_omit) and n.value is distinct from p_old -> n.key
$$;

create function audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_omit text[] := coalesce(tg_argv::text[], '{}');
  v_event uuid := case tg_table_name when 'events' then (v_row ->> 'id')::uuid
                                     when 'requests' then (v_row ->> 'event_id')::uuid
                                     when 'lists' then (v_row ->> 'event_id')::uuid end;
  v_changed jsonb;
begin
  -- Archiving deletes events, and their lists and requests with them. That
  -- is not a change anyone makes, and its history goes with the event.
  if tg_op = 'DELETE' and v_event is not null and not exists (select 1 from events where id = v_event) then
    return null;
  end if;

  v_changed := case tg_op
    when 'UPDATE' then audit_changes(to_jsonb(old), to_jsonb(new), v_omit)
    else audit_row_json(v_row, v_omit) end;
  if tg_op = 'UPDATE' and v_changed = '{}' then return null; end if;

  insert into audit_log (actor, table_name, row_id, op, event_id, changed)
  values ((select id from users where id = auth.uid()), tg_table_name, v_row ->> 'id', lower(tg_op), v_event, v_changed);
  return null;
end $$;

create trigger requests_audit after insert or update or delete on requests
for each row execute function audit_row('updated_at', 'updated_by');
create trigger lists_audit after insert or update or delete on lists
for each row execute function audit_row();
-- Events are deleted only by archiving, which drops their history anyway.
create trigger events_audit after insert or update on events
for each row execute function audit_row();
-- Users: role, unit, approval and active changes. Names, email and service
-- number stay out, so deleting a user's row deletes their personal data.
create trigger users_audit after insert or update or delete on users
for each row execute function audit_row('email', 'first_name', 'last_name', 'service_number', 'rejection_reason');
create trigger units_audit after insert or update or delete on units
for each row execute function audit_row();

-- Retention -----------------------------------------------------------------
-- One daily purge for everything with a fixed lifetime: notifications 14
-- days (sent or abandoned), job runs 30 days, audit rows not tied to an
-- event after the retention window.
create function purge_expired() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_outbox int; v_runs int; v_audit int;
begin
  delete from notification_outbox
  where (sent_at is not null or attempts >= 5) and created_at < now() - interval '14 days';
  get diagnostics v_outbox = row_count;
  delete from job_runs where finished_at < now() - interval '30 days';
  get diagnostics v_runs = row_count;
  delete from audit_log
  where event_id is null and at < now() - (config('retention_days', '90') || ' days')::interval;
  get diagnostics v_audit = row_count;
  return jsonb_build_object('outbox', v_outbox, 'job_runs', v_runs, 'audit_log', v_audit);
end $$;

drop function purge_outbox();

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-outbox';
    perform cron.schedule('purge-expired', '41 3 * * *', 'select public.purge_expired()');
  end if;
end $$;
