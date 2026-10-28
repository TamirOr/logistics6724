-- An admin works as a unit's user: as a customer of a company or a supplier
-- of a supplier unit, with that user's rights and nothing more, and returns
-- to admin whenever they like. While working in a unit they are not an
-- admin anywhere. The previous web build does not read the new column.

alter table users add column acting_unit_id uuid references units (id);
alter table users add constraint users_only_admins_act check (acting_unit_id is null or role = 'admin');

-- The helpers below see the admin as a user of the unit they work in. A unit
-- deactivated meanwhile returns them to admin.
create or replace function my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select coalesce(case a.kind when 'company' then 'customer'::user_role when 'supplier' then 'supplier'::user_role end, u.role)
  from users u left join units a on a.id = u.acting_unit_id and a.active
  where u.id = auth.uid() and u.approval = 'approved' and u.active
$$;

create or replace function my_unit() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(a.id, u.unit_id)
  from users u left join units a on a.id = u.acting_unit_id and a.active
  where u.id = auth.uid() and u.approval = 'approved' and u.active
$$;

-- 20261028000013's my_suppliers, plus the supplier unit an admin works in.
create or replace function my_suppliers() returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.supplier_id
  from user_suppliers s join users u on u.id = s.user_id
  where u.id = auth.uid() and u.approval = 'approved' and u.active and u.role = 'supplier' and s.approved
  union
  select a.id
  from users u join units a on a.id = u.acting_unit_id and a.active and a.kind = 'supplier'
  where u.id = auth.uid() and u.approval = 'approved' and u.active
$$;

-- Both check the stored role, not my_role(): an admin working in a unit is
-- a customer or supplier there, and must still be able to switch and return.
create or replace function is_real_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = auth.uid() and role = 'admin' and approval = 'approved' and active)
$$;

create function act_as_unit(p_unit uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_real_admin() then raise exception 'admins only'; end if;
  if not exists (select 1 from units where id = p_unit and active) then raise exception 'unknown unit'; end if;
  update users set acting_unit_id = p_unit where id = auth.uid();
end $$;
grant execute on function act_as_unit to authenticated;

create function return_to_admin() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_real_admin() then raise exception 'admins only'; end if;
  update users set acting_unit_id = null where id = auth.uid();
end $$;
grant execute on function return_to_admin to authenticated;

-- 20261028000014's list of functions the app may call, plus act_as_unit and return_to_admin.
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
    'access_review', 'act_as_unit', 'add_catalog_item', 'add_item', 'admin_health', 'approve_user', 'cancel_event',
    'close_event', 'config',
    'create_event', 'customer_request_rules', 'delete_item', 'delete_request', 'derive_list_status', 'duplicate_event',
    'escape_like_pattern', 'exact_item', 'find_exact_item', 'health', 'is_admin', 'is_approved', 'is_client',
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
