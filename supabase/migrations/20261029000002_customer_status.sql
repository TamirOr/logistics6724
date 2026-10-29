-- Customers mark a request's status too. A company sergeant major often
-- sees for themselves what is ready or missing, or takes an item without
-- waiting for the supplier, so the customer sets the same statuses the
-- supplier does (pending, ready, partial with its supplied quantity,
-- missing) and marks a single request collected from any open status.
-- Unmarking returns it to that status.

-- The body is 20261028000008's, with the customer's status changes widened.
create or replace function customer_request_rules(old requests, new requests, event_state event_status)
returns requests language plpgsql stable set search_path = public as $$
declare
  handled constant request_status[] := '{ready,partial,missing}';
  open_statuses constant request_status[] := '{pending,ready,partial,missing}';
begin
  if new.supplier_note is distinct from old.supplier_note then
    raise exception 'customers cannot edit supplier fields';
  end if;
  -- The supplied quantity comes only with partial; any other open status clears it.
  if new.supplied_quantity is distinct from old.supplied_quantity
     and not (new.status = 'partial' or (new.status = any (open_statuses) and new.supplied_quantity is null)) then
    raise exception 'customers cannot edit supplier fields';
  end if;
  new.changed_after_handling := old.changed_after_handling;

  if new.status <> old.status then
    if new.status = 'collected' and old.status = any (open_statuses) then
      new.previous_status := old.status;
    elsif new.status = 'cancelled' and old.status in ('ready', 'partial') then
      new.previous_status := old.status;
    elsif old.status in ('collected', 'cancelled') and new.status = old.previous_status then
      new.previous_status := null;   -- unmark pickup, or undo a delete
    elsif new.status = any (open_statuses) and old.status = any (open_statuses) then
      if new.status <> 'partial' then new.supplied_quantity := null; end if;
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

-- The body is 20261027000016's, minus the notifications for a change the
-- company made itself: it already knows what it marked. Leaving missing
-- still takes the request out of the queue, whoever changes it.
create or replace function requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  win interval := (config('missing_window_minutes', '5') || ' minutes')::interval;
  cap interval := (config('missing_window_cap_minutes', '15') || ' minutes')::interval;
  -- my_role(), not is_client(): this trigger runs with definer rights.
  by_company constant boolean := coalesce(my_role() = 'customer', false);
  v_supplier text;
  v_missing uuid[];
begin
  -- Missing marks: add to the list's queue. Each mark pushes send_after out
  -- by the window, capped at first mark + cap.
  if new.status = 'missing' and old.status <> 'missing' then
    if not by_company then
      insert into missing_queue (list_id, supplier_id, first_marked_at, send_after)
      values (new.list_id, new.supplier_id, now(), now() + win)
      on conflict (list_id, supplier_id) do update
        set send_after = least(now() + win, missing_queue.first_marked_at + cap);
      insert into missing_queue_items (request_id, list_id, supplier_id)
      values (new.id, new.list_id, new.supplier_id)
      on conflict (request_id) do nothing;
    end if;
  elsif old.status = 'missing' and new.status <> 'missing' then
    delete from missing_queue_items where request_id = new.id;
    perform drop_empty_missing_queues();
  end if;

  -- Ready for pickup: the supplier's section of this list has nothing
  -- pending left. Only a supplier's move out of pending triggers it, so
  -- toggling between ready, partial and missing sends nothing new.
  if not by_company and old.status = 'pending' and new.status in ('ready', 'partial', 'missing')
     and not exists (select 1 from requests r where r.list_id = new.list_id
                     and r.supplier_id = new.supplier_id and r.status = 'pending')
     and exists (select 1 from requests r where r.list_id = new.list_id
                 and r.supplier_id = new.supplier_id and r.status in ('ready', 'partial'))
  then
    select name into v_supplier from units where id = new.supplier_id;
    select array_agg(r.id) into v_missing from requests r
    where r.list_id = new.list_id and r.supplier_id = new.supplier_id and r.status = 'missing';

    -- The ready notification lists what is missing, so the queued missing
    -- notification for this section is not sent separately.
    if v_missing is not null then
      delete from missing_queue_items where request_id = any (v_missing);
      perform drop_empty_missing_queues();
    end if;
    perform notify('ready', notification_body('ready', v_supplier, p_items => item_names(v_missing)),
                   '/events/' || new.event_id, p_company => new.company_id);
  end if;
  return null;
end $$;
