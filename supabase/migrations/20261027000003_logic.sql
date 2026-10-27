-- Business rules: sign-up and approval, events, requests, pickup, catalog.
--
-- Triggers enforce the column rules only for direct client writes
-- (current_user = authenticated). Definer functions in this file run as
-- their owner and are trusted to have done their own checks.

create function is_client() returns boolean
language sql stable as $$ select current_user in ('authenticated', 'anon') $$;

-- Notifications -----------------------------------------------------------
-- Rows are written here by triggers and sent by the push-dispatch Edge
-- Function. Exactly one target column is set.
create table notification_outbox (
  id bigint generated always as identity primary key,
  kind text not null,
  target_user uuid references users (id) on delete cascade,
  target_company uuid references units (id) on delete cascade,
  target_all_customers boolean not null default false,
  body text not null,
  url text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text
);
create index notification_outbox_unsent_idx on notification_outbox (id) where sent_at is null;
alter table notification_outbox enable row level security;
revoke all on notification_outbox from anon, authenticated;

create function notify(p_kind text, p_body text, p_url text default null,
  p_user uuid default null, p_company uuid default null, p_all_customers boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into notification_outbox (kind, body, url, target_user, target_company, target_all_customers)
  values (p_kind, p_body, p_url, p_user, p_company, p_all_customers)
$$;
revoke execute on function notify from public, anon, authenticated;

-- Sign-up and approval ------------------------------------------------------

-- Called by the user after their first sign-in, and again to re-apply
-- after a rejection.
create function register_profile(p_first_name text, p_last_name text,
  p_service_number text, p_role user_role, p_unit_id uuid)
returns users language plpgsql security definer set search_path = public as $$
declare
  v_kind unit_kind;
  v_email text;
  v_row users;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_role not in ('customer', 'supplier') then raise exception 'invalid role'; end if;
  select kind into v_kind from units where id = p_unit_id and active;
  if v_kind is null or v_kind::text <> (case p_role when 'customer' then 'company' else 'supplier' end) then
    raise exception 'unit does not match side';
  end if;
  select email into v_email from auth.users where id = auth.uid();

  insert into users (id, email, first_name, last_name, service_number, role, unit_id)
  values (auth.uid(), coalesce(v_email, ''), btrim(p_first_name), btrim(p_last_name),
          btrim(p_service_number), p_role, p_unit_id)
  on conflict (id) do update set
    first_name = excluded.first_name, last_name = excluded.last_name,
    service_number = excluded.service_number, role = excluded.role,
    unit_id = excluded.unit_id, approval = 'pending', rejection_reason = null
  where users.approval <> 'approved'
  returning * into v_row;

  if v_row.id is null then raise exception 'profile already approved'; end if;
  return v_row;
end $$;

create function approve_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update users set approval = 'approved', rejection_reason = null,
    approved_at = now(), approved_by = auth.uid()
  where id = p_user and approval <> 'approved';
  if found then
    perform notify('approved', 'החשבון שלך אושר', '/', p_user => p_user);
  end if;
end $$;

create function reject_user(p_user uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update users set approval = 'rejected', rejection_reason = nullif(btrim(p_reason), '')
  where id = p_user and approval = 'pending';
end $$;

create function set_user_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if p_user = auth.uid() and not p_active then raise exception 'cannot deactivate yourself'; end if;
  update users set active = p_active where id = p_user;
end $$;

create function move_user(p_user uuid, p_unit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_role user_role; v_kind unit_kind;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select role into v_role from users where id = p_user;
  select kind into v_kind from units where id = p_unit;
  if v_role is null or v_role = 'admin' or v_kind is null
     or v_kind::text <> (case v_role when 'customer' then 'company' else 'supplier' end) then
    raise exception 'unit does not match role';
  end if;
  update users set unit_id = p_unit where id = p_user;
end $$;

-- Bootstrap: run from the SQL editor to make the first admin.
create function promote_admin(p_email text, p_first_name text default 'מנהל',
  p_last_name text default 'מערכת', p_service_number text default '0000000')
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(p_email);
  if v_id is null then raise exception 'no auth user with email %; sign in once first', p_email; end if;
  insert into users (id, email, first_name, last_name, service_number, role, unit_id, approval, approved_at)
  values (v_id, p_email, p_first_name, p_last_name, p_service_number, 'admin', null, 'approved', now())
  on conflict (id) do update set role = 'admin', unit_id = null, approval = 'approved',
    active = true, approved_at = now();
end $$;
revoke execute on function promote_admin from public, anon, authenticated;

-- Events ------------------------------------------------------------------

create function resolve_needed_at(p_needed_by time, p_from timestamptz default now())
returns timestamptz language plpgsql stable as $$
declare
  tz text := config('timezone', 'Asia/Jerusalem');
  local_from timestamp := p_from at time zone tz;
  cand timestamp;
begin
  if p_needed_by is null then return null; end if;
  cand := local_from::date + p_needed_by;
  if cand <= local_from then cand := cand + interval '1 day'; end if;
  return cand at time zone tz;
end $$;

-- Internal: insert an event and its lists. Callers check permissions.
create function insert_event(p_name text, p_scope event_scope, p_needed_by time,
  p_company uuid, p_duplicated_from uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into events (name, scope, needed_by, needed_at, created_by, created_by_unit, duplicated_from)
  values (btrim(p_name), p_scope, p_needed_by, resolve_needed_at(p_needed_by),
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
revoke execute on function insert_event from public, anon, authenticated;

create function create_event(p_name text, p_scope event_scope, p_needed_by time default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_role user_role := my_role();
begin
  if v_role = 'customer' then
    return insert_event(p_name, p_scope, p_needed_by, my_unit());
  elsif v_role = 'admin' and p_scope = 'battalion' then
    return insert_event(p_name, p_scope, p_needed_by, null);
  end if;
  raise exception 'not allowed to open this event';
end $$;

-- Copies items and quantities into a new event with every status pending.
-- Each company's new list gets that company's requests from the source.
create function duplicate_event(p_source uuid, p_name text, p_needed_by time default null)
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

  v_id := insert_event(p_name, v_src.scope, p_needed_by, my_unit(), p_source);

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

create function close_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_ev events;
begin
  select * into v_ev from events where id = p_event;
  if not (is_admin() or (my_role() = 'customer' and v_ev.scope = 'company'
          and exists (select 1 from lists where event_id = p_event and company_id = my_unit()))) then
    raise exception 'not allowed to close this event';
  end if;
  update events set status = 'closed', closed_at = now() where id = p_event and status = 'open';
end $$;

create function cancel_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or exists (select 1 from events where id = p_event and created_by = auth.uid())) then
    raise exception 'not allowed to cancel this event';
  end if;
  update events set status = 'cancelled', cancelled_at = now() where id = p_event and status <> 'cancelled';
end $$;

-- Closes an open event when every request that can still move is done:
-- collected, or missing (nothing to collect). Needs at least one request,
-- so a battalion event does not close while companies are still filling.
create function maybe_close_event(p_event uuid) returns void
language sql security definer set search_path = public as $$
  update events e set status = 'closed', closed_at = now()
  where e.id = p_event and e.status = 'open'
    and exists (select 1 from requests r where r.event_id = e.id)
    and not exists (select 1 from requests r where r.event_id = e.id
                    and r.status in ('pending', 'ready', 'partial', 'cancelled'))
$$;
revoke execute on function maybe_close_event from public, anon, authenticated;

-- Derived status of a group of requests (a list, or one supplier's section).
create function derive_list_status(n_total int, n_pending int, n_ready int, n_partial int,
  n_missing int, n_collected int, n_cancelled int) returns text
language sql immutable as $$
  select case
    when n_total = 0 then 'empty'
    when n_pending + n_ready + n_partial + n_cancelled = 0 then 'collected'
    when n_pending = 0 and n_cancelled = 0 and n_ready + n_partial > 0 then 'ready_for_pickup'
    when n_pending = n_total then 'open'
    else 'in_progress'
  end
$$;

create view list_overview with (security_invoker = true) as
select l.id, l.event_id, l.company_id, u.name as company_name,
  c.n_total, c.n_pending, c.n_ready, c.n_partial, c.n_missing, c.n_collected, c.n_cancelled,
  c.n_urgent,
  derive_list_status(c.n_total, c.n_pending, c.n_ready, c.n_partial, c.n_missing, c.n_collected, c.n_cancelled) as status,
  c.last_update
from lists l
join units u on u.id = l.company_id
cross join lateral (
  select count(*)::int as n_total,
    count(*) filter (where r.status = 'pending')::int as n_pending,
    count(*) filter (where r.status = 'ready')::int as n_ready,
    count(*) filter (where r.status = 'partial')::int as n_partial,
    count(*) filter (where r.status = 'missing')::int as n_missing,
    count(*) filter (where r.status = 'collected')::int as n_collected,
    count(*) filter (where r.status = 'cancelled')::int as n_cancelled,
    count(*) filter (where r.urgent and r.status not in ('collected', 'cancelled'))::int as n_urgent,
    max(r.updated_at) as last_update
  from requests r where r.list_id = l.id
) c;

-- Requests ----------------------------------------------------------------

-- Trigger functions that call is_client() run with the caller's rights.
create function requests_before_insert() returns trigger
language plpgsql set search_path = public as $$
declare v_list lists; v_status event_status; v_item items;
begin
  select * into v_list from lists where id = new.list_id;
  select status into v_status from events where id = v_list.event_id;
  if v_status is distinct from 'open' then raise exception 'event is not open'; end if;
  select * into v_item from items where id = new.item_id;
  if v_item.id is null or not v_item.active then raise exception 'item not available'; end if;

  new.event_id := v_list.event_id;
  new.company_id := v_list.company_id;
  new.supplier_id := v_item.supplier_id;
  new.created_at := now();
  new.updated_at := now();
  if is_client() then
    new.status := 'pending';
    new.previous_status := null;
    new.supplied_quantity := null;
    new.supplier_note := null;
    new.changed_after_handling := false;
    new.created_by := auth.uid();
  end if;
  new.updated_by := coalesce(auth.uid(), new.created_by);
  return new;
end $$;

create trigger requests_before_insert before insert on requests
for each row execute function requests_before_insert();

-- Column and transition rules for direct client writes, plus the derived
-- fields every update maintains.
create function reopen_event(p_event uuid) returns void
language sql security definer set search_path = public as $$
  update events set status = 'open', closed_at = null
  where id = p_event and status = 'closed' and my_role() = 'customer'
    and exists (select 1 from lists l where l.event_id = p_event and l.company_id = my_unit())
$$;
revoke execute on function reopen_event from public, anon, authenticated;
grant execute on function reopen_event to authenticated;

create function requests_before_update() returns trigger
language plpgsql set search_path = public as $$
declare
  v_role user_role;
  v_event_status event_status;
  handled constant request_status[] := '{ready,partial,missing}';
begin
  select status into v_event_status from events where id = old.event_id;
  if v_event_status = 'cancelled' then raise exception 'event is cancelled'; end if;

  if is_client() then
    v_role := my_role();
    if new.list_id <> old.list_id or new.event_id <> old.event_id or new.company_id <> old.company_id
       or new.supplier_id <> old.supplier_id or new.item_id <> old.item_id
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'request identity cannot change';
    end if;

    if v_role = 'customer' then
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
        if new.quantity <> old.quantity and old.status = any (handled) then
          new.status := 'pending';
          new.supplied_quantity := null;
          new.changed_after_handling := true;
        end if;
      end if;

      if old.status = 'collected' and new.status <> 'collected' and v_event_status = 'closed' then
        -- Unmarking a pickup reopens an event that closed automatically.
        perform reopen_event(old.event_id);
      elsif v_event_status = 'closed' then
        raise exception 'event is closed';
      end if;

    elsif v_role = 'supplier' then
      if v_event_status <> 'open' then raise exception 'event is not open'; end if;
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
    else
      raise exception 'not allowed';
    end if;
  end if;

  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end $$;

create trigger requests_before_update before update on requests
for each row execute function requests_before_update();

create function remember_default_quantity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into default_quantities (company_id, item_id, quantity, updated_at)
  values (new.company_id, new.item_id, new.quantity, now())
  on conflict (company_id, item_id) do update
    set quantity = excluded.quantity, updated_at = excluded.updated_at;
  return null;
end $$;

create trigger requests_default_quantity_ins after insert on requests
for each row execute function remember_default_quantity();
create trigger requests_default_quantity_upd after update of quantity on requests
for each row when (new.quantity <> old.quantity) execute function remember_default_quantity();

create function requests_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform maybe_close_event(coalesce(new.event_id, old.event_id));
  return null;
end $$;

create trigger requests_after_status after update of status on requests
for each row when (new.status <> old.status) execute function requests_after_change();
create trigger requests_after_delete after delete on requests
for each row execute function requests_after_change();

-- Customer deletes: removes a request the supplier has not prepared, and
-- cancels one that is ready or partial so the supplier takes it back.
-- Runs with the caller's rights so RLS and the guard trigger apply.
create function delete_request(p_request uuid) returns text
language plpgsql as $$
declare v_status request_status;
begin
  select status into v_status from requests where id = p_request;
  if v_status is null then return 'gone'; end if;
  if v_status in ('ready', 'partial') then
    update requests set status = 'cancelled' where id = p_request;
    return 'cancelled';
  end if;
  delete from requests where id = p_request;
  if not found then raise exception 'cannot delete this request'; end if;
  return 'deleted';
end $$;

-- "אספתי" on one supplier's section of a list.
create function mark_collected(p_list uuid, p_supplier uuid) returns int
language plpgsql as $$
declare n int;
begin
  update requests set status = 'collected'
  where list_id = p_list and supplier_id = p_supplier and status in ('ready', 'partial');
  get diagnostics n = row_count;
  return n;
end $$;

-- Returns a collected or cancelled request to its previous status.
create function restore_request(p_request uuid) returns void
language plpgsql as $$
begin
  update requests set status = previous_status
  where id = p_request and status in ('collected', 'cancelled') and previous_status is not null;
end $$;

-- Catalog -----------------------------------------------------------------

create function like_escape(t text) returns text
language sql immutable as $$ select replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') $$;

-- Autocomplete over names and aliases, at most 8 rows. With an empty
-- query, returns the items this company requested most recently.
create function search_items(p_supplier uuid, p_q text, p_limit int default 8)
returns table (id uuid, name text, verified boolean, matched_alias text, score real, default_quantity int)
language plpgsql stable set pg_trgm.word_similarity_threshold = 0.3 as $$
declare q text := normalize_he(coalesce(p_q, ''));
begin
  if q = '' then
    return query
      select i.id, i.name, i.verified, null::text, 1::real, d.quantity
      from items i
      join default_quantities d on d.item_id = i.id and d.company_id = my_unit()
      where i.supplier_id = p_supplier and i.active
      order by d.updated_at desc limit p_limit;
    return;
  end if;

  return query
  with cand as (
    select i.id, i.name, i.verified, null::text as alias,
      word_similarity(q, i.name_norm)
        + case when i.name_norm like like_escape(q) || '%' then 0.5
               when i.name_norm like '% ' || like_escape(q) || '%' then 0.3 else 0 end as s
    from items i
    where i.supplier_id = p_supplier and i.active
      and (q <% i.name_norm or i.name_norm like '%' || like_escape(q) || '%')
    union all
    select i.id, i.name, i.verified, a.alias,
      word_similarity(q, a.alias_norm)
        + case when a.alias_norm like like_escape(q) || '%' then 0.5 else 0 end
    from item_aliases a join items i on i.id = a.item_id
    where i.supplier_id = p_supplier and i.active
      and (q <% a.alias_norm or a.alias_norm like '%' || like_escape(q) || '%')
  ), best as (
    select distinct on (c.id) c.id, c.name, c.verified, c.alias, c.s
    from cand c order by c.id, c.s desc
  )
  select b.id, b.name, b.verified, b.alias, b.s::real, d.quantity
  from best b
  left join default_quantities d on d.item_id = b.id and d.company_id = my_unit()
  order by b.s desc, b.name
  limit p_limit;
end $$;

-- Exact match on the normalized name or an alias.
create function find_exact_item(p_supplier uuid, p_name text) returns uuid
language sql stable as $$
  select i.id from items i
  where i.supplier_id = p_supplier and i.active
    and (i.name_norm = normalize_he(p_name)
         or exists (select 1 from item_aliases a where a.item_id = i.id and a.alias_norm = normalize_he(p_name)))
  order by i.verified desc, i.created_at
  limit 1
$$;

-- "התכוונת ל...?": up to 3 items above the similarity threshold.
create function suggest_items(p_supplier uuid, p_name text)
returns table (id uuid, name text, score real)
language sql stable as $$
  select s.id, s.name, s.score from search_items(p_supplier, p_name, 8) s
  where s.score >= config('did_you_mean_threshold', '0.4')::real
  order by s.score desc limit 3
$$;

-- Creates an item. Customers create unverified items in any supplier's
-- catalog, suppliers create verified items in their own. An exact match
-- is returned instead of creating a duplicate.
create function add_item(p_supplier uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := my_role();
  v_id uuid;
begin
  if not exists (select 1 from units where id = p_supplier and kind = 'supplier' and active) then
    raise exception 'not a supplier';
  end if;
  if not (v_role = 'customer' or (v_role = 'supplier' and p_supplier = my_unit())) then
    raise exception 'not allowed to add items here';
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'empty name'; end if;

  v_id := find_exact_item(p_supplier, p_name);
  if v_id is not null then return v_id; end if;

  insert into items (supplier_id, name, verified, created_by)
  values (p_supplier, regexp_replace(btrim(p_name), '\s+', ' ', 'g'), v_role = 'supplier', auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Moves every request and default quantity from p_source to p_target and
-- keeps p_source's name as an alias of p_target.
create function merge_item(p_source uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_src items; v_dst items;
begin
  select * into v_src from items where id = p_source;
  select * into v_dst from items where id = p_target;
  if v_src.id is null or v_dst.id is null or p_source = p_target then raise exception 'invalid merge'; end if;
  if v_src.supplier_id <> v_dst.supplier_id then raise exception 'items belong to different suppliers'; end if;
  if not (my_role() = 'supplier' and v_src.supplier_id = my_unit()) then
    raise exception 'not your catalog';
  end if;

  update requests set item_id = p_target where item_id = p_source;

  insert into default_quantities (company_id, item_id, quantity, updated_at)
  select company_id, p_target, quantity, updated_at from default_quantities where item_id = p_source
  on conflict (company_id, item_id) do update
    set quantity = excluded.quantity, updated_at = excluded.updated_at
    where default_quantities.updated_at < excluded.updated_at;

  insert into item_aliases (item_id, alias)
  select p_target, a.alias from item_aliases a where a.item_id = p_source
  union select p_target, v_src.name
  on conflict do nothing;

  delete from items where id = p_source;
  update items set verified = true where id = p_target;
end $$;

-- For each unverified item of a supplier, the closest verified item.
create function merge_suggestions(p_supplier uuid)
returns table (item_id uuid, suggested_id uuid, suggested_name text, score real)
language sql stable set pg_trgm.similarity_threshold = 0.2 as $$
  select u.id, m.id, m.name, m.score
  from items u
  cross join lateral (
    select v.id, v.name, greatest(similarity(u.name_norm, v.name_norm),
                                   word_similarity(u.name_norm, v.name_norm))::real as score
    from items v
    where v.supplier_id = u.supplier_id and v.verified and v.active and v.id <> u.id
      and (u.name_norm % v.name_norm or u.name_norm <% v.name_norm or v.name_norm <% u.name_norm)
    order by score desc limit 1
  ) m
  where u.supplier_id = p_supplier and not u.verified and u.active
$$;
