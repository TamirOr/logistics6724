-- Admins create users. An admin enters a person's email and the details
-- they would give at sign-up; the person signs in with a code and lands in
-- the app approved, with no join code and no wait for approval.
--
-- A profile (users) needs a sign-in (auth.users) first, and only the auth
-- server creates one. So an email that has signed in before gets its
-- profile at once. Any other email waits as an invite until its first code
-- request creates the sign-in, and a trigger turns the invite into the
-- profile. The previous web build reads neither the table nor the function.

create table user_invites (
  email text primary key
    check (email = lower(btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length(email) <= 254),
  first_name text not null check (btrim(first_name) <> '' and length(first_name) <= 50),
  last_name text not null check (btrim(last_name) <> '' and length(last_name) <= 50),
  service_number text not null check (service_number ~ '^[0-9]{5,9}$'),
  role user_role not null check (role in ('customer', 'supplier')),
  -- The company, or the supplier's main unit. An invite goes with its unit:
  -- nobody has signed in on it yet, so there is nothing to keep.
  unit_id uuid not null references units (id) on delete cascade,
  -- Every supplier unit of a supplier, unit_id among them. Empty for a customer.
  supplier_ids uuid[] not null default '{}',
  invited_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table user_invites enable row level security;
revoke all on user_invites from anon;
revoke insert, update on user_invites from authenticated;
-- Admins list invites and cancel them; create_user writes them.
create policy user_invites_read on user_invites for select to authenticated using ((select is_admin()));
create policy user_invites_cancel on user_invites for delete to authenticated using ((select is_admin()));

-- The units of a new customer or supplier, or an error when they do not
-- match the side. One rule for sign-up and for create_user.
create function profile_units(p_role user_role, p_unit_id uuid, p_supplier_ids uuid[]) returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_kind unit_kind;
  v_units uuid[] := array(select distinct s from unnest(array[p_unit_id] || coalesce(p_supplier_ids, '{}')) s);
begin
  if p_role is null or p_role not in ('customer', 'supplier') then raise exception 'invalid role'; end if;
  select kind into v_kind from units where id = p_unit_id and active;
  if v_kind is distinct from unit_kind_for(p_role) then
    raise exception 'unit does not match side';
  end if;
  if p_role = 'customer' and cardinality(v_units) > 1 then
    raise exception 'customers belong to one company';
  end if;
  if (select count(*) from units where id = any (v_units) and kind = v_kind and active) <> cardinality(v_units) then
    raise exception 'unit does not match side';
  end if;
  return v_units;
end $$;

-- 20261028000013's sign-up, with its unit rules moved to profile_units.
create or replace function register_profile(p_first_name text, p_last_name text,
  p_service_number text, p_role user_role, p_unit_id uuid, p_supplier_ids uuid[])
returns users language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_row users;
  v_suppliers uuid[];
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  v_suppliers := profile_units(p_role, p_unit_id, p_supplier_ids);
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

-- Server-only: the sign-in's approved profile, in every unit of the invite
-- that still exists. The admin who created it approved it.
create function add_invited_profile(p_user uuid, p_invite user_invites) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into users (id, email, first_name, last_name, service_number, role, unit_id,
                     approval, approved_at, approved_by)
  values (p_user, p_invite.email, p_invite.first_name, p_invite.last_name, p_invite.service_number,
          p_invite.role, p_invite.unit_id, 'approved', now(), p_invite.invited_by);
  insert into user_suppliers (user_id, supplier_id)
  select p_user, s from unnest(p_invite.supplier_ids) s
  where exists (select 1 from units where id = s)
  on conflict do nothing;
  delete from user_invites where email = p_invite.email;
end $$;

-- 'created' when the email has signed in before and now has its profile,
-- 'invited' when the profile waits for the first sign-in. Inviting an
-- email again replaces its details, so a typo is fixed by sending it again.
create function create_user(p_email text, p_first_name text, p_last_name text, p_service_number text,
  p_role user_role, p_unit_id uuid, p_supplier_ids uuid[] default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_units uuid[];
  v_invite user_invites;
  v_sign_in uuid;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  v_units := profile_units(p_role, p_unit_id, p_supplier_ids);

  v_invite.email := lower(btrim(p_email));
  v_invite.first_name := btrim(p_first_name);
  v_invite.last_name := btrim(p_last_name);
  v_invite.service_number := btrim(p_service_number);
  v_invite.role := p_role;
  v_invite.unit_id := p_unit_id;
  v_invite.supplier_ids := case when p_role = 'supplier' then v_units else '{}' end;
  v_invite.invited_by := auth.uid();
  v_invite.created_at := now();

  select id into v_sign_in from auth.users where lower(email) = v_invite.email;
  if exists (select 1 from users where id = v_sign_in or lower(email) = v_invite.email) then
    raise exception 'email already has a user';
  end if;

  if v_sign_in is not null then
    perform add_invited_profile(v_sign_in, v_invite);
    return 'created';
  end if;
  insert into user_invites values (v_invite.*)
  on conflict (email) do update set
    first_name = excluded.first_name, last_name = excluded.last_name, service_number = excluded.service_number,
    role = excluded.role, unit_id = excluded.unit_id, supplier_ids = excluded.supplier_ids,
    invited_by = excluded.invited_by, created_at = excluded.created_at;
  return 'invited';
end $$;
grant execute on function create_user to authenticated;

-- The first code request for an invited email creates its sign-in, and
-- with it the profile. A failure must not block the sign-in: the invite
-- stays, and the person can still sign up with the join code.
create function claim_user_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_invite user_invites;
begin
  select * into v_invite from user_invites where email = lower(new.email);
  if not found then return null; end if;
  begin
    perform add_invited_profile(new.id, v_invite);
  exception when others then
    raise warning 'invite not claimed for sign-in %: %', new.id, sqlstate;
  end;
  return null;
end $$;

create trigger users_claim_invite after insert on auth.users
for each row execute function claim_user_invite();

-- 20261028000018's list of functions the app may call, plus create_user.
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
    'create_event', 'create_user', 'customer_request_rules', 'delete_item', 'delete_request', 'delete_unit', 'delete_user',
    'derive_list_status',
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
