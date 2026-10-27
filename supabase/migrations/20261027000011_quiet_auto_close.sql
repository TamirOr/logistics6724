-- An event used to close the instant its last request was done. Marking
-- the last request missing then locked the supplier out of undo or
-- missing -> ready, and the customer out of adding a replacement. Now a
-- scheduled job closes events that have been done for a quiet period
-- (auto_close_quiet_minutes). It runs once per event, not once per
-- updated row as the trigger did.

insert into app_config (key, value, client_readable)
values ('auto_close_quiet_minutes', '30', true)
on conflict (key) do nothing;

-- Closes open events where every list has requests, every request is done
-- (collected or missing) and nothing changed for the quiet period. A
-- battalion event with a list still empty stays open; its creator or an
-- admin closes it by hand. Returns how many closed.
create function close_finished_events(p_quiet interval default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  quiet interval := coalesce(p_quiet, (config('auto_close_quiet_minutes', '30') || ' minutes')::interval);
  n int;
begin
  update events e set status = 'closed', closed_at = now()
  where e.status = 'open'
    and exists (select 1 from requests r where r.event_id = e.id)
    and not exists (select 1 from lists l where l.event_id = e.id
                    and not exists (select 1 from requests r where r.list_id = l.id))
    and not exists (select 1 from requests r where r.event_id = e.id
                    and r.status in ('pending', 'ready', 'partial', 'cancelled'))
    and (select max(r.updated_at) from requests r where r.event_id = e.id) <= now() - quiet;
  get diagnostics n = row_count;
  return n;
end $$;

-- The triggers keep only the reopen on an unmarked pickup.
create or replace function requests_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Unmarking a pickup reopens the event if it had closed. The guard
  -- trigger lets only the company's customer make that change.
  if old.status = 'collected' and new.status <> 'collected' then
    update events set status = 'open', closed_at = null where id = new.event_id and status = 'closed';
  end if;
  return null;
end $$;

drop trigger requests_after_delete on requests;
drop function maybe_close_event(uuid);

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('close-finished-events', '*/5 * * * *', 'select public.close_finished_events()');
  end if;
end $$;
