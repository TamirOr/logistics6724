-- Helpers for the push-dispatch and archive Edge Functions, and the row
-- shape shared by Excel export and archiving.

-- Outbox lifecycle for push-dispatch: claim (a lease), then mark sent or
-- release for a retry. A row is retried up to 5 times; purge_outbox clears
-- sent and abandoned rows daily.
create function claim_outbox(p_limit int default 100) returns setof notification_outbox
language sql security definer set search_path = public as $$
  update notification_outbox o set claimed_at = now(), attempts = o.attempts + 1
  where o.id in (
    select id from notification_outbox
    where sent_at is null and attempts < 5
      and (claimed_at is null or claimed_at < now() - interval '5 minutes')
    order by id limit p_limit
    for update skip locked)
  returning o.*
$$;

create function mark_outbox_sent(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update notification_outbox set sent_at = now() where id = p_id
$$;

create function release_outbox(p_id bigint, p_error text) returns void
language sql security definer set search_path = public as $$
  update notification_outbox set claimed_at = null, last_error = p_error where id = p_id
$$;

create function purge_outbox() returns int
language sql security definer set search_path = public as $$
  with gone as (
    delete from notification_outbox
    where sent_at < now() - interval '7 days'
       or (sent_at is null and attempts >= 5 and created_at < now() - interval '1 day')
    returning 1)
  select count(*)::int from gone
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('purge-outbox', '41 3 * * *', 'select public.purge_outbox()');
  end if;
end $$;

-- One row per request, with the columns the spec lists for Excel. Runs
-- with the caller's rights, so each user exports only what they can see.
create view export_rows with (security_invoker = true) as
select
  e.id as event_id,
  e.name as event_name,
  e.needed_by,
  e.created_at as event_created_at,
  coalesce(e.cancelled_at, e.closed_at, e.created_at) as event_age_from,
  e.status as event_status,
  c.name as company_name,
  s.name as supplier_name,
  i.name as item_name,
  r.quantity,
  r.supplied_quantity,
  r.status,
  r.urgent,
  r.supplier_note,
  r.updated_at,
  r.supplier_id,
  r.company_id
from requests r
join events e on e.id = r.event_id
join units c on c.id = r.company_id
join units s on s.id = r.supplier_id
join items i on i.id = r.item_id;
