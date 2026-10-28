-- Categories: groups inside a supplier's catalog ("ירקות ופירות", "מוצרי חלב"),
-- so a list reads by shelf instead of in the order requests came in.
--
-- The category belongs to the item, so every request of a known item is
-- grouped without anyone typing it again. It is optional: items without one
-- form the general group. The supplier owns it and sets or changes it on
-- the catalog (items_supplier_update already lets them). A customer who
-- adds a new item may give one; an item that already exists keeps its own.

alter table items add column category text check (length(category) <= 30);

-- Cleans the typed category and spells it like one the supplier already
-- uses, so "ירק ופירות" on an item of a supplier that has "ירקות ופירות" joins
-- that group instead of starting a second one.
create function items_category() returns trigger
language plpgsql set search_path = public as $$
begin
  new.category := nullif(regexp_replace(btrim(coalesce(new.category, '')), '\s+', ' ', 'g'), '');
  if new.category is not null then
    new.category := coalesce(
      (select i.category from items i
       where i.supplier_id = new.supplier_id and i.id <> new.id and normalize_he(i.category) = normalize_he(new.category)
       order by i.created_at limit 1),
      new.category);
  end if;
  return new;
end $$;

create trigger items_category before insert or update of category on items
for each row execute function items_category();

-- The supplier's categories, for the category field's suggestions.
create function supplier_categories(p_supplier uuid) returns setof text
language sql stable set search_path = public as $$
  select distinct i.category from items i
  where i.supplier_id = p_supplier and i.active and i.category is not null
  order by 1
$$;
grant execute on function supplier_categories to authenticated;

-- add_catalog_item is add_item with the category of a new item. Adding a
-- parameter to add_item would need a drop, and the previous web build still
-- calls it; it stays below as a wrapper until a later release removes it
-- (expand, then contract). The body is add_item's from 20261028000004.
create function add_catalog_item(p_supplier uuid, p_name text, p_category text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role := my_role();
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_id uuid;
begin
  if not exists (select 1 from units where id = p_supplier and kind = 'supplier' and active) then
    raise exception 'not a supplier';
  end if;
  if not (v_role = 'customer' or (v_role = 'supplier' and p_supplier in (select my_suppliers()))) then
    raise exception 'not allowed to add items here';
  end if;
  if v_name = '' then raise exception 'empty name'; end if;

  v_id := find_exact_item(p_supplier, v_name);
  if v_id is not null then return v_id; end if;

  -- A hidden item with this name: the supplier brings it back, a customer
  -- may not, since the supplier hid it on purpose.
  select id into v_id from items
  where supplier_id = p_supplier and not active and name_norm = normalize_he(v_name)
  order by verified desc, created_at limit 1;
  if v_id is not null then
    if v_role <> 'supplier' then raise exception 'item is hidden by the supplier'; end if;
    update items set active = true where id = v_id;
    return v_id;
  end if;

  if v_role = 'customer' and (
    select count(*) from items i join users u on u.id = i.created_by
    where u.unit_id = my_unit() and not i.verified and i.created_at > now() - interval '1 day'
  ) >= config('max_new_items_per_company_day', '100')::int then
    raise exception 'daily limit of new items reached';
  end if;

  begin
    insert into items (supplier_id, name, category, verified, created_by)
    values (p_supplier, v_name, p_category, v_role = 'supplier', auth.uid())
    returning id into v_id;
  exception when unique_violation then
    -- Someone added the same name a moment ago.
    v_id := find_exact_item(p_supplier, v_name);
  end;
  return v_id;
end $$;
grant execute on function add_catalog_item to authenticated;

-- The previous web build's call, answered by the new function.
create or replace function add_item(p_supplier uuid, p_name text) returns uuid
language sql set search_path = public as $$
  select add_catalog_item(p_supplier, p_name)
$$;

-- The body is 20261028000011's, plus: the item merged into keeps its
-- category, or takes the merged item's if it had none.
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

  if v_dst.category is null and v_src.category is not null then
    update items set category = v_src.category where id = p_target;
  end if;

  delete from items where id = p_source;
end $$;

-- The body is 20261028000011's, plus the item's category at the end.
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
  r.measure,
  i.category as item_category
from requests r
join events e on e.id = r.event_id
join units c on c.id = r.company_id
join units s on s.id = r.supplier_id
join items i on i.id = r.item_id;

-- 20261028000011's list of functions the app may call, plus add_catalog_item and supplier_categories.
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
    'access_review', 'add_catalog_item', 'add_item', 'admin_health', 'approve_user', 'cancel_event', 'close_event', 'config',
    'create_event', 'customer_request_rules', 'delete_request', 'derive_list_status', 'duplicate_event',
    'escape_like_pattern', 'exact_item', 'find_exact_item', 'health', 'is_admin', 'is_approved', 'is_client',
    'item_measure_names', 'join_code',
    'mark_collected', 'match_catalog', 'match_item', 'merge_item', 'merge_suggestions', 'move_user', 'my_role', 'my_suppliers', 'my_unit',
    'normalize_he', 'register_profile', 'register_push_subscription', 'reject_user', 'restore_request',
    'rotate_join_code', 'search_catalog', 'search_items', 'send_test_notification', 'set_user_active', 'set_user_suppliers', 'signup_units',
    'suggest_items', 'supplier_categories', 'supplier_request_rules', 'user_support')
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
