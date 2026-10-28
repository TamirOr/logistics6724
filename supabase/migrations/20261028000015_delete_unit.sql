-- Deleting a unit. Deactivating keeps a unit for its history; deleting
-- removes it with its catalog, default quantities and queued notifications.
-- Lists, requests and events are that history, so a unit any of them still
-- uses cannot be deleted: the admin deactivates it instead, or deletes it
-- once archiving has removed those events. Users need a unit, so the admin
-- moves its users elsewhere first.
create function delete_unit(p_unit uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if exists (select 1 from users where unit_id = p_unit)
     or exists (select 1 from user_suppliers where supplier_id = p_unit) then
    raise exception 'unit has users';
  end if;
  if exists (select 1 from lists where company_id = p_unit)
     or exists (select 1 from requests where supplier_id = p_unit)
     or exists (select 1 from events where created_by_unit = p_unit) then
    raise exception 'unit is used by events';
  end if;
  delete from items where supplier_id = p_unit;
  delete from units where id = p_unit;
end $$;
grant execute on function delete_unit to authenticated;

-- 20261028000014's list of functions the app may call, plus delete_unit.
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
    'create_event', 'customer_request_rules', 'delete_item', 'delete_request', 'delete_unit', 'derive_list_status',
    'duplicate_event', 'escape_like_pattern', 'exact_item', 'find_exact_item', 'health', 'is_admin', 'is_approved', 'is_client',
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
