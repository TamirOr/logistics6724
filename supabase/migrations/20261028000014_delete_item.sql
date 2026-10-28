-- Deleting a catalog item. Hiding keeps an item for its history; deleting
-- removes it with its aliases, measures and default quantities. Requests
-- are that history, so an item any request still uses cannot be deleted:
-- the supplier hides it or merges it instead. Archiving removes old events
-- with their requests, after which the item can go.
create function delete_item(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from items where id = p_item and supplier_id in (select my_suppliers()))
     or my_role() is distinct from 'supplier' then
    raise exception 'not your catalog';
  end if;
  if exists (select 1 from requests where item_id = p_item) then
    raise exception 'item is used by requests';
  end if;
  delete from items where id = p_item;
end $$;
grant execute on function delete_item to authenticated;

-- 20261028000013's list of functions the app may call, plus delete_item.
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
    'create_event', 'customer_request_rules', 'delete_item', 'delete_request', 'derive_list_status', 'duplicate_event',
    'escape_like_pattern', 'exact_item', 'find_exact_item', 'health', 'is_admin', 'is_approved', 'is_client',
    'is_super_user', 'item_measure_names', 'join_code',
    'mark_collected', 'match_catalog', 'match_item', 'merge_item', 'merge_suggestions', 'move_user', 'my_role', 'my_suppliers', 'my_unit',
    'normalize_he', 'register_profile', 'register_push_subscription', 'reject_user', 'remove_from_unit', 'restore_request',
    'rotate_join_code', 'search_catalog', 'search_items', 'send_test_notification', 'set_super_user', 'set_user_active',
    'set_user_suppliers', 'shares_managed_unit', 'signup_units', 'suggest_items',
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
