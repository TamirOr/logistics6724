-- The company's own note on a request ("מידה L", "לא דחוף אם חסר"), next to
-- the supplier's note. Customers write it while the request is open;
-- suppliers only read it. Writing it leaves the status alone: it adds
-- detail, it does not change what was asked for.

alter table requests add column customer_note text;

create or replace function customer_request_rules(old requests, new requests, event_state event_status)
returns requests language plpgsql stable set search_path = public as $$
declare handled constant request_status[] := '{ready,partial,missing}';
begin
  if new.supplied_quantity is distinct from old.supplied_quantity
     or new.supplier_note is distinct from old.supplier_note then
    raise exception 'customers cannot edit supplier fields';
  end if;
  new.changed_after_handling := old.changed_after_handling;

  if new.status <> old.status then
    if new.status = 'collected' and old.status in ('ready', 'partial') then
      new.previous_status := old.status;
    elsif new.status = 'cancelled' and old.status in ('ready', 'partial') then
      new.previous_status := old.status;
    elsif old.status in ('collected', 'cancelled') and new.status = old.previous_status then
      new.previous_status := null;   -- unmark pickup, or undo a delete
    else
      raise exception 'customers cannot set status % from %', new.status, old.status;
    end if;
  elsif new.previous_status is distinct from old.previous_status then
    raise exception 'previous_status is managed by the server';
  end if;

  if new.quantity <> old.quantity or new.urgent <> old.urgent
     or new.customer_note is distinct from old.customer_note then
    if old.status in ('collected', 'cancelled') or new.status in ('collected', 'cancelled') then
      raise exception 'request is closed';
    end if;
    -- A new quantity sends a handled request back to the supplier.
    if new.quantity <> old.quantity and old.status = any (handled) then
      new.status := 'pending';
      new.supplied_quantity := null;
      new.changed_after_handling := true;
    end if;
  end if;
  new.customer_note := nullif(btrim(new.customer_note), '');

  -- A closed event takes only an unmarked pickup, which reopens it
  -- (see requests_after_change).
  if event_state = 'closed' and not (old.status = 'collected' and new.status <> 'collected') then
    raise exception 'event is closed';
  end if;
  return new;
end $$;

create or replace function supplier_request_rules(old requests, new requests, event_state event_status)
returns requests language plpgsql stable set search_path = public as $$
begin
  if event_state <> 'open' then raise exception 'event is not open'; end if;
  if new.quantity <> old.quantity or new.urgent <> old.urgent
     or new.customer_note is distinct from old.customer_note
     or new.previous_status is distinct from old.previous_status
     or new.changed_after_handling is distinct from old.changed_after_handling then
    raise exception 'suppliers can change only status, supplied quantity and note';
  end if;
  if old.status in ('collected', 'cancelled') then raise exception 'request is closed'; end if;
  if new.status not in ('pending', 'ready', 'partial', 'missing') then
    raise exception 'suppliers cannot set status %', new.status;
  end if;
  if new.status <> old.status then
    new.changed_after_handling := false;
  end if;
  if new.status <> 'partial' then new.supplied_quantity := null; end if;
  new.supplier_note := nullif(btrim(new.supplier_note), '');
  return new;
end $$;

-- Excel export and the archive keep the company's note too. A replaced view
-- may only add columns at the end.
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
  e.needed_on,
  r.customer_note
from requests r
join events e on e.id = r.event_id
join units c on c.id = r.company_id
join units s on s.id = r.supplier_id
join items i on i.id = r.item_id;
