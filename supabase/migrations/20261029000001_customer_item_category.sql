-- Customers give a category to an item that has none. The supplier owns its
-- catalog's categories, so a customer only fills in a missing one, which
-- sorts the item for everyone; an item that already has a category keeps
-- it.

-- A customer fills in the category of an item that has none. Suppliers
-- change their own items' categories directly (items_supplier_update).
-- Returns the category as stored, spelled like the supplier's (items_category).
create function add_item_category(p_item uuid, p_category text) returns text
language plpgsql security definer set search_path = public as $$
declare v_category text;
begin
  if my_role() is distinct from 'customer' then raise exception 'customers only'; end if;
  if nullif(btrim(coalesce(p_category, '')), '') is null then raise exception 'empty category'; end if;
  update items set category = p_category where id = p_item and active and category is null
  returning category into v_category;
  if not found then raise exception 'item already has a category'; end if;
  return v_category;
end $$;
grant execute on function add_item_category to authenticated;

-- 20261028000018's list of functions the app may call, plus add_item_category.
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
    'mark_collected', 'match_catalog', 'match_item', 'merge_item', 'merge_suggestions', 'move_user', 'my_role', 'my_suppliers', 'my_unit',
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
