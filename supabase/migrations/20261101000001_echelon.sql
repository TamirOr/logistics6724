-- Echelons (מפלג קדמי / מפלג אחורי). A company's users split in two: the
-- front echelon opens events and fills the lists, as every company user did
-- until now; the rear echelon is the soldiers who drive to the supplier
-- units and pick the items up. The rear works like a supplier on the
-- company's own requests: it marks their status and comments, by item, by
-- supplier unit or on the whole list, and adds, edits and deletes nothing.
--
-- A company user switches echelon whenever they like; an admin, or the
-- company's super user, sets it for them. Everyone starts in the front.
--
-- Comments now say who wrote them on the company side, and may sit on one
-- request. Each request remembers who set its status last, for the cases
-- where it is unclear who marked what. A new company list notifies the
-- company's rear. The previous web build reads none of the new columns.

create type echelon as enum ('front', 'rear');

-- Read only for customers. An admin working in a company uses their own.
alter table users add column echelon echelon not null default 'front';

alter table requests
  add column status_set_at timestamptz,
  -- The company or supplier unit whose user set the status; null when a server job did.
  add column status_set_by_unit uuid references units (id) on delete set null,
  -- The company echelon that set it; null for a supplier or a server job.
  add column status_set_by_echelon echelon;

-- Views list their columns when created; add the new ones at the end.
create or replace view open_requests with (security_invoker = true) as
select r.* from requests r
join events e on e.id = r.event_id
where e.status = 'open';

alter table list_comments
  -- The company echelon that wrote it; null on the supplier side.
  add column echelon echelon,
  -- A comment on one request; null for one on the list or a supplier's section.
  add column request_id uuid references requests (id) on delete cascade;
create index list_comments_request_idx on list_comments (request_id);

-- The caller's echelon while they work as a company user, else null.
create function my_echelon() returns echelon
language sql stable security definer set search_path = public as $$
  select echelon from users where id = auth.uid() and my_role() = 'customer'
$$;
grant execute on function my_echelon to authenticated;

create function set_echelon(p_user uuid, p_echelon echelon) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (coalesce(p_user = auth.uid() and my_role() = 'customer', false)
          or is_admin()
          or shares_managed_unit(p_user)) then
    raise exception 'not allowed to set this user''s echelon';
  end if;
  -- The caller's own row may be an admin's working in a company.
  update users set echelon = p_echelon where id = p_user and (role = 'customer' or id = auth.uid());
  if not found then raise exception 'only company users have an echelon'; end if;
end $$;
grant execute on function set_echelon to authenticated;

-- Requests ---------------------------------------------------------------------

-- Only the front adds and deletes requests (delete_request deletes, or
-- cancels through an update the rear rules refuse).
drop policy requests_customer_insert on requests;
create policy requests_customer_insert on requests for insert to authenticated with check (
  (select my_role()) = 'customer' and (select my_echelon()) = 'front' and company_id = (select my_unit())
);
drop policy requests_delete on requests;
create policy requests_delete on requests for delete to authenticated using (
  ((select my_role()) = 'customer' and (select my_echelon()) = 'front' and company_id = (select my_unit())
   and status in ('pending', 'missing'))
  or ((select my_role()) = 'supplier' and supplier_id in (select my_suppliers()) and status = 'cancelled')
);

-- The rear marks statuses the way the front does (customer_request_rules),
-- but edits nothing the front wrote and neither cancels nor restores a request.
create function rear_request_rules(old requests, new requests) returns void
language plpgsql immutable set search_path = public as $$
begin
  if new.quantity <> old.quantity or new.urgent <> old.urgent
     or new.customer_note is distinct from old.customer_note then
    raise exception 'the rear echelon only marks statuses';
  end if;
  if new.status <> old.status and 'cancelled' in (new.status, old.status) then
    raise exception 'the rear echelon cannot delete or restore requests';
  end if;
end $$;
-- requests_before_update runs with the caller's rights, as for customer_request_rules.
grant execute on function rear_request_rules to authenticated;

-- The body is 20261027000013's, plus the rear rules and the record of who
-- set the status.
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
      when 'customer' then
        if my_echelon() = 'rear' then perform rear_request_rules(old, new); end if;
        new := customer_request_rules(old, new, v_event_status);
      when 'supplier' then new := supplier_request_rules(old, new, v_event_status);
      else raise exception 'not allowed';
    end case;
  end if;

  new.status_set_at := old.status_set_at;
  new.status_set_by_unit := old.status_set_by_unit;
  new.status_set_by_echelon := old.status_set_by_echelon;
  if new.status <> old.status then
    new.status_set_at := now();
    new.status_set_by_unit := case when not is_client() then null
                                   when my_role() = 'customer' then new.company_id else new.supplier_id end;
    new.status_set_by_echelon := case when is_client() then my_echelon() end;
  end if;

  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end $$;

-- A new request has no status set by anyone yet, whatever the client sends.
create function requests_status_unset() returns trigger
language plpgsql set search_path = public as $$
begin
  if is_client() then
    new.status_set_at := null;
    new.status_set_by_unit := null;
    new.status_set_by_echelon := null;
  end if;
  return new;
end $$;

create trigger requests_status_unset before insert on requests
for each row execute function requests_status_unset();

-- Events -----------------------------------------------------------------------

-- Opening an event (create_event, duplicate_event) is the front's.
create function events_opened_by_front() returns trigger
language plpgsql set search_path = public as $$
begin
  if my_echelon() = 'rear' then raise exception 'the rear echelon cannot open events'; end if;
  return new;
end $$;

create trigger events_opened_by_front before insert on events
for each row execute function events_opened_by_front();

-- The bodies are 20261028000005's, minus the rear. A trigger cannot do
-- this: the rear's pickups close an event on their own (maybe_close_event).
create or replace function close_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_ev events;
begin
  select * into v_ev from events where id = p_event;
  if v_ev.id is null then raise exception 'event not found'; end if;
  if my_echelon() = 'rear' then raise exception 'the rear echelon cannot close events'; end if;
  if not (is_admin()
          -- coalesce: with my_unit() null the comparison is null, and
          -- "if not (null)" would let the call through.
          or coalesce(v_ev.created_by = auth.uid() and v_ev.created_by_unit = my_unit(), false)
          or (my_role() = 'customer' and v_ev.scope = 'company'
              and exists (select 1 from lists where event_id = p_event and company_id = my_unit()))) then
    raise exception 'not allowed to close this event';
  end if;
  update events set status = 'closed', closed_at = now() where id = p_event and status = 'open';
end $$;

create or replace function cancel_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_echelon() = 'rear' then raise exception 'the rear echelon cannot cancel events'; end if;
  if not (is_admin() or exists (select 1 from events where id = p_event
                                and created_by = auth.uid() and created_by_unit = my_unit())) then
    raise exception 'not allowed to cancel this event';
  end if;
  update events set status = 'cancelled', cancelled_at = now() where id = p_event and status <> 'cancelled';
end $$;

-- A list the front opens tells the company's rear there is something to
-- pick up. A battalion event's lists already notify every company user
-- (battalion_event).
create or replace function notification_body(p_kind text, p_supplier text default null, p_event text default null,
  p_count int default null, p_items text default null)
returns text language sql immutable as $$
  select case p_kind
    when 'approved' then 'החשבון שלך אושר'
    when 'battalion_event' then 'נפתח אירוע חדש: ' || p_event
    when 'new_list' then 'רשימה חדשה לאיסוף: ' || p_event
    when 'ready' then p_supplier || ': הרשימה מוכנה לאיסוף'
      || coalesce(' · חסרים: ' || p_items, '')
    when 'missing' then p_supplier || ': חסרים ' || p_count || ' פריטים: ' || p_items
    when 'test' then 'התראת בדיקה: ההתראות מגיעות למכשיר הזה'
  end
$$;

create function lists_notify_rear() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_event text;
begin
  if my_role() is distinct from 'customer' then return null; end if;
  select name into v_event from events where id = new.event_id;
  perform notify('new_list', notification_body('new_list', p_event => v_event), '/events/' || new.event_id, p_user => u.id)
  from users u
  where u.unit_id = new.company_id and u.role = 'customer' and u.echelon = 'rear'
    and u.approval = 'approved' and u.active;
  return null;
end $$;

create trigger lists_notify_rear after insert on lists
for each row execute function lists_notify_rear();

-- Comments ---------------------------------------------------------------------

-- The body is 20261029000003's, plus the writer's echelon and the request a
-- comment may sit on. A comment on a request is between the company and
-- that request's supplier.
create or replace function list_comments_before_insert() returns trigger
language plpgsql set search_path = public as $$
declare v_event_status event_status; v_request requests;
begin
  select l.event_id, l.company_id, e.status into new.event_id, new.company_id, v_event_status
  from lists l join events e on e.id = l.event_id where l.id = new.list_id;
  if is_client() then
    if v_event_status is distinct from 'open' then raise exception 'event is not open'; end if;
    new.side := my_role();
    new.echelon := my_echelon();
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  if new.request_id is not null then
    select * into v_request from requests where id = new.request_id;
    if v_request.list_id is distinct from new.list_id then raise exception 'request is not on this list'; end if;
    new.supplier_id := v_request.supplier_id;
  end if;
  if new.supplier_id is not null
     and not exists (select 1 from units where id = new.supplier_id and kind = 'supplier') then
    raise exception 'not a supplier';
  end if;
  new.body := btrim(new.body);
  return new;
end $$;

-- A request moved to another supplier unit (move_items) takes its comments along.
create function requests_move_comments() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update list_comments set supplier_id = new.supplier_id where request_id = new.id;
  return null;
end $$;

create trigger requests_move_comments after update of supplier_id on requests
for each row when (new.supplier_id <> old.supplier_id) execute function requests_move_comments();

-- 20261101000000's list of functions the app may call, plus my_echelon, set_echelon and rear_request_rules.
create or replace function privilege_drift() returns setof text
language sql stable security definer set search_path = public as $$
  with fns as (
    select p.oid, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature, p.proname
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  )
  select 'anon can execute ' || signature from fns
  where has_function_privilege('anon', oid, 'execute') and proname not in ('health')
  union all
  select 'authenticated can execute ' || signature from fns
  where has_function_privilege('authenticated', oid, 'execute') and proname not in (
    'access_review', 'act_as_unit', 'add_catalog_item', 'add_item_category', 'add_item', 'admin_health', 'approve_user', 'cancel_event',
    'close_event', 'config',
    'create_event', 'customer_request_rules', 'delete_item', 'delete_request', 'delete_unit', 'delete_user', 'derive_list_status',
    'duplicate_event', 'escape_like_pattern', 'exact_item', 'find_exact_item', 'health', 'is_admin', 'is_approved', 'is_client',
    'is_super_user', 'item_measure_names', 'join_code',
    'mark_collected', 'match_catalog', 'match_item', 'merge_item', 'merge_suggestions', 'move_items', 'move_user',
    'my_echelon', 'my_role', 'my_suppliers', 'my_unit',
    'normalize_he', 'rear_request_rules', 'register_profile', 'register_push_subscription', 'reject_user', 'remove_from_unit', 'restore_request',
    'return_to_admin', 'rotate_join_code', 'search_catalog', 'search_items', 'send_test_notification', 'set_echelon',
    'set_super_user', 'set_user_active', 'set_user_suppliers', 'shares_managed_unit', 'signup_units', 'suggest_items',
    'supplier_categories', 'supplier_request_rules', 'user_support')
  union all
  select 'no row-level security on ' || relname from pg_class
  where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity
  union all
  -- Any privilege at all, granted to anon or to public (grantee 0).
  select 'anon has a grant on ' || relname from pg_class
  where relnamespace = 'public'::regnamespace and relkind in ('r', 'p', 'v', 'm')
    and exists (select 1 from aclexplode(relacl) a where a.grantee in ('anon'::regrole, 0))
  union all
  select 'view runs as its owner: ' || relname from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'v'
    and not coalesce('security_invoker=true' = any (reloptions), false)
  order by 1
$$;
