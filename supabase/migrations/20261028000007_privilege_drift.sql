-- Security review F3: no grant the app does not need.
-- Views are security_invoker, so anon could read nothing through them, but
-- it held grants on them all the same.
revoke all on all tables in schema public from anon;

-- Everything that should not be: functions anon or authenticated can run
-- beyond the lists below, public tables without row-level security, any
-- anon grant on a table or view, views that run as their owner. Empty when
-- all is well. The SQL tests assert it on every CI run; the health workflow
-- runs it against the live projects, where a dashboard edit or a platform
-- default could grant what the migrations never did. A new function the app
-- calls goes on the list here, in a new migration.
create function privilege_drift() returns setof text
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
    'escape_like_pattern', 'exact_item', 'find_exact_item', 'health', 'is_admin', 'is_approved', 'is_client', 'join_code',
    'mark_collected', 'match_item', 'merge_item', 'merge_suggestions', 'move_user', 'my_role', 'my_suppliers', 'my_unit',
    'normalize_he', 'register_profile', 'register_push_subscription', 'reject_user', 'restore_request',
    'rotate_join_code', 'search_items', 'send_test_notification', 'set_user_active', 'set_user_suppliers', 'signup_units', 'suggest_items',
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
grant execute on function privilege_drift to service_role;
