-- A supplier in several units moves catalog items, one by one or a whole
-- category, to another of its units: e.g. drinks that the store kept and
-- the kitchen now hands out.
--
-- A request copies its item's supplier (requests_before_insert), and the
-- app groups a supplier's work by requests.supplier_id. So an item moves
-- with every request made for it, past ones included, and the target
-- unit's suppliers take them over. An item the target already has under
-- the same name is merged into that one instead of becoming a second copy.

-- The supplier of an item changes only through move_items, which moves its
-- requests along. items_supplier_update would otherwise let a supplier
-- re-point the item alone.
create function items_supplier_is_fixed() returns trigger
language plpgsql set search_path = public as $$
begin
  if is_client() and new.supplier_id <> old.supplier_id then
    raise exception 'move items with move_items';
  end if;
  return new;
end $$;

create trigger items_supplier_is_fixed before update of supplier_id on items
for each row execute function items_supplier_is_fixed();

-- Moves one item, already checked, to p_supplier.
create function move_item_to(p_item uuid, p_supplier uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_same uuid := (select t.id from items t join items s on s.id = p_item
                  where t.supplier_id = p_supplier and t.active and s.active and t.name_norm = s.name_norm);
begin
  -- The missing-items notice waits per list and supplier: the target
  -- supplier's queue takes over the moved requests' place in it.
  insert into missing_queue (list_id, supplier_id, first_marked_at, send_after)
  select q.list_id, p_supplier, q.first_marked_at, q.send_after
  from missing_queue q
  where exists (select 1 from missing_queue_items m join requests r on r.id = m.request_id
                where r.item_id = p_item and m.list_id = q.list_id and m.supplier_id = q.supplier_id)
  on conflict do nothing;
  update missing_queue_items m set supplier_id = p_supplier
  from requests r where r.id = m.request_id and r.item_id = p_item;
  perform drop_empty_missing_queues();

  update requests set supplier_id = p_supplier where item_id = p_item;
  -- Setting the category again spells it like the target's (items_category).
  -- An active item of the same name there would break items_active_name_unique,
  -- so the moved one is hidden first and merged into it.
  update items set supplier_id = p_supplier, category = category, active = active and v_same is null
  where id = p_item;
  if v_same is not null then perform merge_items(p_item, v_same); end if;
end $$;

-- Moves the caller's items to another of its supplier units. All or none:
-- every item must be in one of the caller's units, and the target too.
create function move_items(p_items uuid[], p_supplier uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_item uuid;
begin
  if my_role() is distinct from 'supplier' or p_supplier not in (select my_suppliers()) then
    raise exception 'not your unit';
  end if;
  if not exists (select 1 from units where id = p_supplier and active) then
    raise exception 'unit not found or inactive';
  end if;
  if (select count(distinct x) from unnest(p_items) x) is distinct from
     (select count(*) from items where id = any (p_items) and supplier_id in (select my_suppliers())) then
    raise exception 'not your catalog';
  end if;

  for v_item in select id from items where id = any (p_items) and supplier_id <> p_supplier order by created_at loop
    perform move_item_to(v_item, p_supplier);
  end loop;
end $$;
grant execute on function move_items to authenticated;

-- 20261029000001's list of functions the app may call, plus move_items.
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
    'mark_collected', 'match_catalog', 'match_item', 'merge_item', 'merge_suggestions', 'move_items', 'move_user', 'my_role', 'my_suppliers', 'my_unit',
    'normalize_he', 'register_profile', 'register_push_subscription', 'reject_user', 'remove_from_unit', 'restore_request',
    'return_to_admin', 'rotate_join_code', 'search_catalog', 'search_items', 'send_test_notification', 'set_super_user',
    'set_user_active', 'set_user_suppliers', 'shares_managed_unit', 'signup_units', 'suggest_items',
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
