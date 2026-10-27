-- The requests guard trigger, split into the rules for each side, and with
-- the cancelled-event check moved inside the client branch. Before, that
-- check also ran for trusted server functions, so merge_item failed for
-- any item used in a cancelled event.
--
-- Rules for client writes live in customer_request_rules and
-- supplier_request_rules. They take the row before and after the write
-- and return the row to store, or raise. The trigger runs them with the
-- caller's rights, so authenticated needs execute; they have no side
-- effects, so calling them directly changes nothing.

create function customer_request_rules(old requests, new requests, event_state event_status)
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

  if new.quantity <> old.quantity or new.urgent <> old.urgent then
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

  -- A closed event takes only an unmarked pickup, which reopens it
  -- (see requests_after_change).
  if event_state = 'closed' and not (old.status = 'collected' and new.status <> 'collected') then
    raise exception 'event is closed';
  end if;
  return new;
end $$;
grant execute on function customer_request_rules to authenticated;

create function supplier_request_rules(old requests, new requests, event_state event_status)
returns requests language plpgsql stable set search_path = public as $$
begin
  if event_state <> 'open' then raise exception 'event is not open'; end if;
  if new.quantity <> old.quantity or new.urgent <> old.urgent
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
grant execute on function supplier_request_rules to authenticated;

create or replace function requests_before_update() returns trigger
language plpgsql set search_path = public as $$
declare v_event_status event_status;
begin
  -- Trusted server functions (merge_item and the like) skip the client
  -- rules, including the cancelled-event check.
  if is_client() then
    if new.list_id <> old.list_id or new.event_id <> old.event_id or new.company_id <> old.company_id
       or new.supplier_id <> old.supplier_id or new.item_id <> old.item_id
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'request identity cannot change';
    end if;

    select status into v_event_status from events where id = old.event_id;
    if v_event_status = 'cancelled' then raise exception 'event is cancelled'; end if;

    case my_role()
      when 'customer' then new := customer_request_rules(old, new, v_event_status);
      when 'supplier' then new := supplier_request_rules(old, new, v_event_status);
      else raise exception 'not allowed';
    end case;
  end if;

  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end $$;
