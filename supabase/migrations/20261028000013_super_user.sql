-- Super users ("מפקד אחראי" in the app): customers or suppliers an admin
-- trusts to run their own unit's people. A super user approves or rejects
-- sign-ups to their unit and removes users from it. Admins set the flag, on
-- any number of users.
--
-- A supplier who signs up to several units is approved by each unit on its
-- own: they start working once one unit approves them, in the units that
-- did, and wait for the rest. Removing them works the same way, unit by
-- unit. The previous web build reads neither new column.

alter table users add column super_user boolean not null default false;

-- Memberships that exist now, and those admins set, are approved; sign-ups
-- mark theirs as waiting (register_profile below).
alter table user_suppliers add column approved boolean not null default true;

-- A supplier works only in the units that approved them.
create or replace function my_suppliers() returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.supplier_id
  from user_suppliers s join users u on u.id = s.user_id
  where u.id = auth.uid() and u.approval = 'approved' and u.active and u.role = 'supplier' and s.approved
$$;

-- 20261028000001's sign-up; every unit picked waits for its own approval.
create or replace function register_profile(p_first_name text, p_last_name text,
  p_service_number text, p_role user_role, p_unit_id uuid, p_supplier_ids uuid[])
returns users language plpgsql security definer set search_path = public as $$
declare
  v_kind unit_kind;
  v_email text;
  v_row users;
  v_suppliers uuid[] := array(select distinct s from unnest(array[p_unit_id] || coalesce(p_supplier_ids, '{}')) s);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_role not in ('customer', 'supplier') then raise exception 'invalid role'; end if;
  select kind into v_kind from units where id = p_unit_id and active;
  if v_kind is distinct from unit_kind_for(p_role) then
    raise exception 'unit does not match side';
  end if;
  if p_role = 'customer' and cardinality(v_suppliers) > 1 then
    raise exception 'customers belong to one company';
  end if;
  if (select count(*) from units where id = any (v_suppliers) and kind = v_kind and active) <> cardinality(v_suppliers) then
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

  if p_role = 'supplier' then
    delete from user_suppliers where user_id = v_row.id and supplier_id <> all (v_suppliers);
    insert into user_suppliers (user_id, supplier_id)
    select v_row.id, s from unnest(v_suppliers) s
    on conflict do nothing;
    update user_suppliers set approved = false where user_id = v_row.id;
  end if;
  return v_row;
end $$;

-- Every unit of a user: a customer's company, a supplier's units, approved
-- or waiting.
create function user_units(p_user uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select unit_id from users where id = p_user and role = 'customer'
  union
  select supplier_id from user_suppliers where user_id = p_user
$$;

-- The units still to approve the user: a pending customer's company, a
-- supplier's waiting units. None once the user was rejected.
create function pending_units(p_user uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select unit_id from users where id = p_user and role = 'customer' and approval = 'pending'
  union
  select s.supplier_id from user_suppliers s join users u on u.id = s.user_id
  where s.user_id = p_user and not s.approved and u.approval <> 'rejected'
$$;

-- False unless the caller is an approved, active super user.
create function is_super_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = auth.uid() and super_user
                 and approval = 'approved' and active and role <> 'admin')
$$;
grant execute on function is_super_user to authenticated;

-- The units the caller runs as a super user: those they work in. None
-- for anyone else.
create function my_managed_units() returns setof uuid
language sql stable security definer set search_path = public as $$
  select my_unit() where is_super_user() and my_role() = 'customer'
  union
  select my_suppliers() where is_super_user()
$$;

-- The user is in at least one unit the caller runs, approved or waiting.
create function shares_managed_unit(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select user_units(p_user) intersect select my_managed_units())
$$;
grant execute on function shares_managed_unit to authenticated;

-- Keeps a supplier's main unit (users.unit_id) on a unit they work in:
-- the current one while it is approved, else an approved one, else any.
create function refresh_main_unit(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_main uuid;
begin
  select s.supplier_id into v_main
  from user_suppliers s join users u on u.id = s.user_id
  where s.user_id = p_user
  order by s.approved desc, s.supplier_id = u.unit_id desc, s.supplier_id
  limit 1;
  if v_main is not null then
    update users set unit_id = v_main where id = p_user and unit_id is distinct from v_main;
  end if;
end $$;

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

-- An admin approves the user in all their units, a super user in the
-- waiting units they run. The first approval lets the user in.
create or replace function approve_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_units uuid[];
begin
  if is_admin() then
    v_units := array(select user_units(p_user));
  else
    v_units := array(select pending_units(p_user) intersect select my_managed_units());
    if cardinality(v_units) = 0 then raise exception 'admins and the unit''s super users only'; end if;
  end if;

  update user_suppliers set approved = true where user_id = p_user and supplier_id = any (v_units);
  perform refresh_main_unit(p_user);
  update users set approval = 'approved', rejection_reason = null,
    approved_at = now(), approved_by = auth.uid()
  where id = p_user and approval <> 'approved';
  if found then
    perform notify('approved', notification_body('approved'), '/', p_user => p_user);
  end if;
end $$;

-- A super user turns the user down for the waiting units they run. The
-- user is rejected only when no other unit is left to them.
create or replace function reject_user(p_user uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_units uuid[];
begin
  if not is_admin() then
    v_units := array(select pending_units(p_user) intersect select my_managed_units());
    if cardinality(v_units) = 0 then raise exception 'admins and the unit''s super users only'; end if;
    if exists (select user_units(p_user) except select unnest(v_units)) then
      delete from user_suppliers where user_id = p_user and supplier_id = any (v_units);
      perform refresh_main_unit(p_user);
      return;
    end if;
  end if;
  update users set approval = 'rejected', rejection_reason = nullif(btrim(p_reason), '')
  where id = p_user and approval = 'pending';
end $$;

-- A user only in the caller's units is deactivated. A supplier who is also
-- in other units leaves the caller's and keeps the rest; left only with
-- units still to approve them, they wait again.
create function remove_from_unit(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super_user() then raise exception 'super users only'; end if;
  if p_user = auth.uid() then raise exception 'cannot remove yourself'; end if;
  if (select approval from users where id = p_user) is distinct from 'approved'
     or not exists (select 1 from user_units(p_user) u (id)
                    where u.id in (select my_managed_units()) and u.id not in (select pending_units(p_user))) then
    raise exception 'not an approved user of your unit';
  end if;

  if not exists (select user_units(p_user) except select my_managed_units()) then
    update users set active = false where id = p_user;
    return;
  end if;
  delete from user_suppliers where user_id = p_user and supplier_id in (select my_managed_units());
  perform refresh_main_unit(p_user);
  if not exists (select 1 from user_suppliers where user_id = p_user and approved) then
    update users set approval = 'pending' where id = p_user;
  end if;
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
-- an admin marks the user again if they should run the new one. An
-- approved user works in the unit an admin moves them to.
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
  update user_suppliers set approved = true
  where user_id = p_user and (select approval from users where id = p_user) = 'approved';
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

-- 20261028000012's list of functions the app may call, plus the four above.
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
