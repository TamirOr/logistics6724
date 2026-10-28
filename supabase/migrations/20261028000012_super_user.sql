-- Super users: customers or suppliers an admin trusts to run their own
-- unit's people. A super user approves or rejects the sign-ups of their
-- unit and removes users from it. Admins set the flag, on any number of
-- users. The previous web build never reads the new column.

alter table users add column super_user boolean not null default false;

-- A customer's company, or a supplier's units (unit_id is among them).
create function user_units(p_user uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select unit_id from users where id = p_user and role = 'customer'
  union
  select supplier_id from user_suppliers where user_id = p_user
$$;

-- False unless the caller is an approved, active super user.
create function is_super_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = auth.uid() and super_user
                 and approval = 'approved' and active and role <> 'admin')
$$;
grant execute on function is_super_user to authenticated;

-- The units the caller runs as a super user; none otherwise.
create function my_managed_units() returns setof uuid
language sql stable security definer set search_path = public as $$
  select user_units(auth.uid()) where is_super_user()
$$;

-- The user is in at least one unit the caller runs. Enough to see them and
-- to remove them from the caller's units.
create function shares_managed_unit(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select user_units(p_user) intersect select my_managed_units())
$$;
grant execute on function shares_managed_unit to authenticated;

-- Every unit of the user is one the caller runs. Needed to approve: a
-- sign-up that also picked another unit must not get in through this one.
create function manages_all_units_of(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select user_units(p_user))
     and not exists (select user_units(p_user) except select my_managed_units())
$$;

-- Super users read the profiles and units of the users in their units.
drop policy users_read_own on users;
create policy users_read on users for select to authenticated using (
  id = (select auth.uid()) or (select is_admin())
  or ((select is_super_user()) and shares_managed_unit(id))
);

drop policy user_suppliers_read on user_suppliers;
create policy user_suppliers_read on user_suppliers for select to authenticated using (
  user_id = (select auth.uid()) or (select is_admin())
  or ((select is_super_user()) and shares_managed_unit(user_id))
);

create or replace function approve_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or manages_all_units_of(p_user)) then
    raise exception 'admins and the unit''s super users only';
  end if;
  update users set approval = 'approved', rejection_reason = null,
    approved_at = now(), approved_by = auth.uid()
  where id = p_user and approval <> 'approved';
  if found then
    perform notify('approved', notification_body('approved'), '/', p_user => p_user);
  end if;
end $$;

create or replace function reject_user(p_user uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or manages_all_units_of(p_user)) then
    raise exception 'admins and the unit''s super users only';
  end if;
  update users set approval = 'rejected', rejection_reason = nullif(btrim(p_reason), '')
  where id = p_user and approval = 'pending';
end $$;

-- A user only in the caller's units is deactivated. A supplier who also
-- works in other units leaves only the caller's and keeps the rest.
create function remove_from_unit(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super_user() then raise exception 'super users only'; end if;
  if p_user = auth.uid() then raise exception 'cannot remove yourself'; end if;
  if not shares_managed_unit(p_user)
     or (select approval from users where id = p_user) <> 'approved' then
    raise exception 'not an approved user of your unit';
  end if;

  if manages_all_units_of(p_user) then
    update users set active = false where id = p_user;
    return;
  end if;
  delete from user_suppliers where user_id = p_user and supplier_id in (select my_managed_units());
  update users
  set unit_id = (select supplier_id from user_suppliers where user_id = p_user order by supplier_id limit 1)
  where id = p_user and unit_id not in (select supplier_id from user_suppliers where user_id = p_user);
end $$;
grant execute on function remove_from_unit to authenticated;

create function set_super_user(p_user uuid, p_super_user boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  if not coalesce((select role in ('customer', 'supplier') from users where id = p_user and approval = 'approved'), false) then
    raise exception 'only approved customers and suppliers can be super users';
  end if;
  update users set super_user = p_super_user where id = p_user;
end $$;
grant execute on function set_super_user to authenticated;

-- The trust is in running one unit: moving to another unit drops it, and
-- an admin marks the user again if they should run the new one.
create or replace function move_user(p_user uuid, p_unit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_role user_role; v_kind unit_kind;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select role into v_role from users where id = p_user;
  if v_role is null then raise exception 'user not found'; end if;
  if v_role = 'admin' then raise exception 'admins have no unit'; end if;
  select kind into v_kind from units where id = p_unit and active;
  if v_kind is null then raise exception 'unit not found or inactive'; end if;

  update users
  set unit_id = p_unit,
      role = case v_kind when 'company' then 'customer'::user_role else 'supplier'::user_role end,
      super_user = super_user and unit_id = p_unit
  where id = p_user;
  delete from user_suppliers where user_id = p_user and supplier_id <> p_unit;
end $$;

-- Super users hold extra rights, so the access review lists them too.
create or replace function access_review()
returns table (user_id uuid, role user_role, unit_id uuid, active boolean, approved_at timestamptz, last_change_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return query
    select u.id, u.role, u.unit_id, u.active, u.approved_at,
           (select max(a.at) from audit_log a where a.actor = u.id)
    from users u where (u.role in ('admin', 'supplier') or u.super_user) and u.approval = 'approved'
    order by u.role, u.unit_id;
end $$;

-- 20261028000011's list of functions the app may call, plus the four above.
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
    'is_super_user', 'item_measure_names', 'join_code',
    'mark_collected', 'match_catalog', 'match_item', 'merge_item', 'merge_suggestions', 'move_user', 'my_role', 'my_suppliers', 'my_unit',
    'normalize_he', 'register_profile', 'register_push_subscription', 'reject_user', 'remove_from_unit', 'restore_request',
    'rotate_join_code', 'search_catalog', 'search_items', 'send_test_notification', 'set_super_user', 'set_user_active',
    'set_user_suppliers', 'shares_managed_unit', 'signup_units', 'suggest_items',
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
