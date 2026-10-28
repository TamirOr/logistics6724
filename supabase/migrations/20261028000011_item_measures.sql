-- Measures: what a request's quantity counts ("5 קרטונים", "20 ליטר").
-- "unit" already means a company or a supplier, so the glossary name is
-- measure (יחידת מידה).
--
-- A request may carry a measure; it is optional. Each item collects the
-- measures companies used with it, so the add row can offer them in a
-- dropdown. Typing a new one adds it to the item on the first request that
-- uses it: there is no separate "add measure" call. A measure is fixed once
-- the request exists, like its item: to ask in another measure, delete the
-- request and add it again.

create table item_measures (
  item_id uuid not null references items (id) on delete cascade,
  name text not null check (btrim(name) <> '' and length(name) <= 30),
  name_norm text generated always as (normalize_he(name)) stored,
  created_at timestamptz not null default now(),
  -- "קרטון" and "קרטונים" are one measure.
  primary key (item_id, name_norm)
);

alter table item_measures enable row level security;
create policy item_measures_read on item_measures for select to authenticated using ((select is_approved()));
revoke insert, update, delete on item_measures from authenticated;
revoke all on item_measures from anon;

alter table requests add column measure text check (length(measure) <= 30);
-- The company's last measure for the item, next to its last quantity.
alter table default_quantities add column measure text;

-- Cleans the typed measure and spells it like the item's existing one, so
-- "קרטונים" on a request of an item that has "קרטון" stores "קרטון".
create function requests_measure() returns trigger
language plpgsql set search_path = public as $$
begin
  new.measure := nullif(regexp_replace(btrim(coalesce(new.measure, '')), '\s+', ' ', 'g'), '');
  if new.measure is not null then
    new.measure := coalesce(
      (select m.name from item_measures m where m.item_id = new.item_id and m.name_norm = normalize_he(new.measure)),
      new.measure);
  end if;
  return new;
end $$;

create trigger requests_measure before insert on requests
for each row execute function requests_measure();

create function requests_measure_is_fixed() returns trigger
language plpgsql set search_path = public as $$
begin
  if is_client() and new.measure is distinct from old.measure then
    raise exception 'measure cannot change';
  end if;
  return new;
end $$;

create trigger requests_measure_is_fixed before update of measure on requests
for each row execute function requests_measure_is_fixed();

create function remember_item_measure() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.measure is not null then
    insert into item_measures (item_id, name) values (new.item_id, new.measure) on conflict do nothing;
  end if;
  return null;
end $$;

create trigger requests_item_measure after insert on requests
for each row execute function remember_item_measure();

create or replace function remember_default_quantity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into default_quantities (company_id, item_id, quantity, measure, updated_at)
  values (new.company_id, new.item_id, new.quantity, new.measure, now())
  on conflict (company_id, item_id) do update
    set quantity = excluded.quantity, measure = excluded.measure, updated_at = excluded.updated_at;
  return null;
end $$;

-- The body is 20261027000015's, plus the measures and the default measure.
create or replace function merge_items(p_source uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_src items; v_dst items;
begin
  select * into v_src from items where id = p_source;
  select * into v_dst from items where id = p_target;
  if v_src.id is null or v_dst.id is null or p_source = p_target then raise exception 'invalid merge'; end if;
  if v_src.supplier_id <> v_dst.supplier_id then raise exception 'items belong to different suppliers'; end if;

  update requests set item_id = p_target where item_id = p_source;

  insert into default_quantities (company_id, item_id, quantity, measure, updated_at)
  select company_id, p_target, quantity, measure, updated_at from default_quantities where item_id = p_source
  on conflict (company_id, item_id) do update
    set quantity = excluded.quantity, measure = excluded.measure, updated_at = excluded.updated_at
    where default_quantities.updated_at < excluded.updated_at;

  insert into item_measures (item_id, name, created_at)
  select p_target, m.name, m.created_at from item_measures m where m.item_id = p_source
  on conflict do nothing;

  insert into item_aliases (item_id, alias)
  select p_target, a.alias from item_aliases a where a.item_id = p_source
  union select p_target, v_src.name
  on conflict do nothing;

  delete from items where id = p_source;
end $$;

-- The body is 20261027000014's, copying the measure too.
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

  insert into requests (list_id, event_id, company_id, supplier_id, item_id, quantity, measure, created_by)
  select nl.id, v_id, nl.company_id, r.supplier_id, i.id, r.quantity, r.measure, auth.uid()
  from requests r
  join lists ol on ol.id = r.list_id
  join lists nl on nl.event_id = v_id and nl.company_id = ol.company_id
  join items i on i.id = r.item_id and i.active
  where r.event_id = p_source and r.status <> 'cancelled'
    and (v_role = 'admin' or ol.company_id = my_unit())
  order by r.created_at;
  return v_id;
end $$;

-- The item's measures, oldest first: the first one used is usually the usual one.
create function item_measure_names(p_item uuid) returns text[]
language sql stable set search_path = public as $$
  select coalesce(array_agg(m.name order by m.created_at, m.name), '{}') from item_measures m where m.item_id = p_item
$$;

-- search_catalog and match_catalog are search_items and match_item with the
-- measures added. Adding columns to those two would need a drop, which the
-- previous web build still calls; they stay below as wrappers until a later
-- release removes them (expand, then contract).

-- search_catalog sets pg_trgm.word_similarity_threshold. As in
-- 20261027000015: the Supabase migration role is not a superuser, and
-- Postgres refuses that setting until the pg_trgm library is loaded in the
-- session. Calling any pg_trgm function loads it.
select extensions.word_similarity('', '');

-- The body is search_items' from 20261027000015, plus each item's measures
-- and this company's last measure for it.
create function search_catalog(p_supplier uuid, p_q text, p_limit int default 8)
returns table (id uuid, name text, verified boolean, matched_alias text, score real, similarity real,
  default_quantity int, measures text[], default_measure text)
language plpgsql stable set search_path = public, extensions set pg_trgm.word_similarity_threshold = 0.3 as $$
declare q text := normalize_he(coalesce(p_q, ''));
begin
  if q = '' then
    return query
      select i.id, i.name, i.verified, null::text, 1::real, 1::real, d.quantity, item_measure_names(i.id), d.measure
      from items i
      join default_quantities d on d.item_id = i.id and d.company_id = my_unit()
      where i.supplier_id = p_supplier and i.active
      order by d.updated_at desc limit p_limit;
    return;
  end if;

  return query
  with cand as (
    select i.id, i.name, i.verified, null::text as alias,
      word_similarity(q, i.name_norm) as sim,
      case when i.name_norm like escape_like_pattern(q) || '%' then 0.5
           when i.name_norm like '% ' || escape_like_pattern(q) || '%' then 0.3 else 0 end as boost
    from items i
    where i.supplier_id = p_supplier and i.active
      and (q <% i.name_norm or i.name_norm like '%' || escape_like_pattern(q) || '%')
    union all
    select i.id, i.name, i.verified, a.alias,
      word_similarity(q, a.alias_norm),
      case when a.alias_norm like escape_like_pattern(q) || '%' then 0.5 else 0 end
    from item_aliases a join items i on i.id = a.item_id
    where i.supplier_id = p_supplier and i.active
      and (q <% a.alias_norm or a.alias_norm like '%' || escape_like_pattern(q) || '%')
  ), best as (
    select distinct on (c.id) c.id, c.name, c.verified, c.alias, c.sim, c.sim + c.boost as s
    from cand c order by c.id, c.sim + c.boost desc
  )
  select b.id, b.name, b.verified, b.alias, b.s::real, b.sim::real, d.quantity, item_measure_names(b.id), d.measure
  from best b
  left join default_quantities d on d.item_id = b.id and d.company_id = my_unit()
  order by b.s desc, b.name
  limit p_limit;
end $$;
grant execute on function search_catalog to authenticated;

-- The body is match_item's from 20261027000020, plus the measures as in search_catalog.
create function match_catalog(p_supplier uuid, p_name text)
returns table (id uuid, name text, exact boolean, default_quantity int, measures text[], default_measure text)
language plpgsql stable set search_path = public as $$
declare v_exact uuid := find_exact_item(p_supplier, p_name);
begin
  if v_exact is not null then
    return query
      select i.id, i.name, true, d.quantity, item_measure_names(i.id), d.measure
      from items i
      left join default_quantities d on d.item_id = i.id and d.company_id = my_unit()
      where i.id = v_exact;
    return;
  end if;
  return query
    select s.id, s.name, false, s.default_quantity, s.measures, s.default_measure
    from search_catalog(p_supplier, p_name, 8) s
    where s.similarity >= config('did_you_mean_threshold', '0.4')::real
    order by s.similarity desc limit 3;
end $$;
grant execute on function match_catalog to authenticated;

-- The previous web build's calls, answered by the new functions.
create or replace function search_items(p_supplier uuid, p_q text, p_limit int default 8)
returns table (id uuid, name text, verified boolean, matched_alias text, score real, similarity real, default_quantity int)
language sql stable set search_path = public as $$
  select c.id, c.name, c.verified, c.matched_alias, c.score, c.similarity, c.default_quantity
  from search_catalog(p_supplier, p_q, p_limit) c
$$;

create or replace function match_item(p_supplier uuid, p_name text)
returns table (id uuid, name text, exact boolean, default_quantity int)
language sql stable set search_path = public as $$
  select c.id, c.name, c.exact, c.default_quantity from match_catalog(p_supplier, p_name) c
$$;

-- search_catalog and match_catalog call it with the caller's rights.
grant execute on function item_measure_names to authenticated;

-- Views list their columns when created; add measure at the end.
create or replace view open_requests with (security_invoker = true) as
select r.* from requests r
join events e on e.id = r.event_id
where e.status = 'open';

-- The body is 20261028000008's, plus the measure at the end.
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
  r.customer_note,
  r.measure
from requests r
join events e on e.id = r.event_id
join units c on c.id = r.company_id
join units s on s.id = r.supplier_id
join items i on i.id = r.item_id;

-- 20261028000007's list of functions the app may call, plus the three above.
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
    'access_review', 'add_item', 'admin_health', 'approve_user', 'cancel_event', 'close_event', 'config',
    'create_event', 'customer_request_rules', 'delete_request', 'derive_list_status', 'duplicate_event',
    'escape_like_pattern', 'exact_item', 'find_exact_item', 'health', 'is_admin', 'is_approved', 'is_client',
    'item_measure_names', 'join_code',
    'mark_collected', 'match_catalog', 'match_item', 'merge_item', 'merge_suggestions', 'move_user', 'my_role', 'my_suppliers', 'my_unit',
    'normalize_he', 'register_profile', 'register_push_subscription', 'reject_user', 'restore_request',
    'rotate_join_code', 'search_catalog', 'search_items', 'send_test_notification', 'set_user_active', 'set_user_suppliers', 'signup_units', 'suggest_items',
    'supplier_request_rules', 'user_support')
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
