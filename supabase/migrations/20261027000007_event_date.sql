-- Events get a date as well as a time (product owner's request after the
-- spec, which had a time only). needed_on is optional so older events keep
-- working: without a date, a time that already passed today means tomorrow.

alter table events add column needed_on date;

-- The event functions gain a p_needed_on parameter. Postgres would keep the
-- old signatures as overloads, so they are dropped first.
drop function create_event(text, event_scope, time);
drop function duplicate_event(uuid, text, time);
drop function insert_event(text, event_scope, time, uuid, uuid);
drop function resolve_needed_at(time, timestamptz);

create function resolve_needed_at(p_needed_on date, p_needed_by time, p_from timestamptz default now())
returns timestamptz language plpgsql stable as $$
declare
  tz text := config('timezone', 'Asia/Jerusalem');
  local_from timestamp := p_from at time zone tz;
  cand timestamp;
begin
  if p_needed_on is not null then
    return (p_needed_on + coalesce(p_needed_by, time '00:00')) at time zone tz;
  end if;
  if p_needed_by is null then return null; end if;
  cand := local_from::date + p_needed_by;
  if cand <= local_from then cand := cand + interval '1 day'; end if;
  return cand at time zone tz;
end $$;

-- Internal: insert an event and its lists. Callers check permissions.
create function insert_event(p_name text, p_scope event_scope, p_needed_on date, p_needed_by time,
  p_company uuid, p_duplicated_from uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into events (name, scope, needed_on, needed_by, needed_at, created_by, created_by_unit, duplicated_from)
  values (btrim(p_name), p_scope, p_needed_on, p_needed_by, resolve_needed_at(p_needed_on, p_needed_by),
          auth.uid(), my_unit(), p_duplicated_from)
  returning id into v_id;

  if p_scope = 'company' then
    insert into lists (event_id, company_id) values (v_id, p_company);
  else
    insert into lists (event_id, company_id)
    select v_id, id from units where kind = 'company' and active;
    perform notify('battalion_event', 'נפתח אירוע חדש: ' || btrim(p_name),
                   '/events/' || v_id, p_all_customers => true);
  end if;
  return v_id;
end $$;

create function create_event(p_name text, p_scope event_scope, p_needed_by time default null,
  p_needed_on date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_role user_role := my_role();
begin
  if v_role = 'customer' then
    return insert_event(p_name, p_scope, p_needed_on, p_needed_by, my_unit());
  elsif v_role = 'admin' and p_scope = 'battalion' then
    return insert_event(p_name, p_scope, p_needed_on, p_needed_by, null);
  end if;
  raise exception 'not allowed to open this event';
end $$;
grant execute on function create_event to authenticated;

-- Copies items and quantities into a new event with every status pending.
-- Each company's new list gets that company's requests from the source.
create function duplicate_event(p_source uuid, p_name text, p_needed_by time default null,
  p_needed_on date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_src events;
  v_role user_role := my_role();
  v_id uuid;
begin
  select * into v_src from events where id = p_source;
  if v_src.id is null then raise exception 'event not found'; end if;
  if v_role = 'customer' then
    if not exists (select 1 from lists where event_id = p_source and company_id = my_unit()) then
      raise exception 'not your event';
    end if;
  elsif not (v_role = 'admin' and v_src.scope = 'battalion') then
    raise exception 'not allowed to duplicate this event';
  end if;

  v_id := insert_event(p_name, v_src.scope, p_needed_on, p_needed_by, my_unit(), p_source);

  insert into requests (list_id, event_id, company_id, supplier_id, item_id, quantity, created_by)
  select nl.id, v_id, nl.company_id, r.supplier_id, i.id, r.quantity, auth.uid()
  from requests r
  join lists ol on ol.id = r.list_id
  join lists nl on nl.event_id = v_id and nl.company_id = ol.company_id
  join items i on i.id = r.item_id and i.active
  where r.event_id = p_source and r.status <> 'cancelled'
  order by r.created_at;
  return v_id;
end $$;
grant execute on function duplicate_event to authenticated;

-- Excel export and the archive show the date too. A replaced view may only
-- add columns at the end.
create or replace view export_rows with (security_invoker = true) as
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
  r.company_id,
  e.needed_on
from requests r
join events e on e.id = r.event_id
join units c on c.id = r.company_id
join units s on s.id = r.supplier_id
join items i on i.id = r.item_id;
