-- A customer duplicating a battalion event copied every company's requests
-- into the new event, writing into other companies' lists.
-- Copies items and quantities into a new event with every status pending.
-- A customer copies only their own company's requests: each company fills
-- its own list. An admin, acting for the battalion, copies every company's.
create or replace function duplicate_event(p_source uuid, p_name text, p_needed_by time default null,
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
    and (v_role = 'admin' or ol.company_id = my_unit())
  order by r.created_at;
  return v_id;
end $$;
