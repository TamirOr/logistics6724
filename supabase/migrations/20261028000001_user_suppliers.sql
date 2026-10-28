-- A supplier user can work in several supplier units, e.g. a cook who also
-- runs the closing store. user_suppliers lists them. users.unit_id stays
-- one of them (the first picked), so the previous web build, which reads
-- only unit_id, keeps working.

create table user_suppliers (
  user_id uuid not null references users (id) on delete cascade,
  supplier_id uuid not null references units (id),
  primary key (user_id, supplier_id)
);
create index user_suppliers_supplier_idx on user_suppliers (supplier_id);

alter table user_suppliers enable row level security;
revoke all on user_suppliers from anon;
revoke insert, update, delete on user_suppliers from authenticated;
-- Writes go through register_profile and move_user.
create policy user_suppliers_read on user_suppliers for select to authenticated
  using (user_id = (select auth.uid()) or (select is_admin()));

-- Only supplier units, and only for supplier users.
create function user_suppliers_match() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select kind from units where id = new.supplier_id) is distinct from 'supplier' then
    raise exception 'not a supplier unit';
  end if;
  if (select role from users where id = new.user_id) is distinct from 'supplier' then
    raise exception 'only suppliers belong to supplier units';
  end if;
  return new;
end $$;

create trigger user_suppliers_match before insert or update on user_suppliers
for each row execute function user_suppliers_match();

-- unit_id is always one of the user's supplier units, and a user who stops
-- being a supplier (moved to a company, promoted to admin) leaves them all.
create function users_sync_suppliers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'supplier' then
    insert into user_suppliers (user_id, supplier_id) values (new.id, new.unit_id)
    on conflict do nothing;
  else
    delete from user_suppliers where user_id = new.id;
  end if;
  return null;
end $$;

create trigger users_sync_suppliers after insert or update of role, unit_id on users
for each row execute function users_sync_suppliers();

insert into user_suppliers (user_id, supplier_id)
select id, unit_id from users where role = 'supplier';

-- The caller's supplier units; none unless an approved, active supplier.
create function my_suppliers() returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.supplier_id
  from user_suppliers s join users u on u.id = s.user_id
  where u.id = auth.uid() and u.approval = 'approved' and u.active and u.role = 'supplier'
$$;
grant execute on function my_suppliers to authenticated;

-- Policies: a supplier sees and works on the requests of any of its units.
drop policy events_read on events;
create policy events_read on events for select to authenticated using (
  (select is_admin())
  or ((select my_role()) = 'customer' and exists (
        select 1 from lists l where l.event_id = events.id and l.company_id = (select my_unit())))
  or ((select my_role()) = 'supplier' and exists (
        select 1 from requests r where r.event_id = events.id and r.supplier_id in (select my_suppliers())))
);

drop policy lists_read on lists;
create policy lists_read on lists for select to authenticated using (
  (select is_admin())
  or ((select my_role()) = 'customer' and company_id = (select my_unit()))
  or ((select my_role()) = 'supplier' and exists (
        select 1 from requests r where r.list_id = lists.id and r.supplier_id in (select my_suppliers())))
);

drop policy requests_read on requests;
create policy requests_read on requests for select to authenticated using (
  (select is_admin())
  or ((select my_role()) = 'customer' and company_id = (select my_unit()))
  or ((select my_role()) = 'supplier' and supplier_id in (select my_suppliers()))
);

drop policy requests_update on requests;
create policy requests_update on requests for update to authenticated using (
  ((select my_role()) = 'customer' and company_id = (select my_unit()))
  or ((select my_role()) = 'supplier' and supplier_id in (select my_suppliers()))
) with check (
  ((select my_role()) = 'customer' and company_id = (select my_unit()))
  or ((select my_role()) = 'supplier' and supplier_id in (select my_suppliers()))
);

drop policy requests_delete on requests;
create policy requests_delete on requests for delete to authenticated using (
  ((select my_role()) = 'customer' and company_id = (select my_unit()) and status in ('pending', 'missing'))
  or ((select my_role()) = 'supplier' and supplier_id in (select my_suppliers()) and status = 'cancelled')
);

drop policy items_supplier_update on items;
create policy items_supplier_update on items for update to authenticated
  using ((select my_role()) = 'supplier' and supplier_id in (select my_suppliers()))
  with check ((select my_role()) = 'supplier' and supplier_id in (select my_suppliers()));

drop policy item_aliases_supplier_write on item_aliases;
create policy item_aliases_supplier_write on item_aliases for all to authenticated
  using ((select my_role()) = 'supplier' and exists (
    select 1 from items i where i.id = item_id and i.supplier_id in (select my_suppliers())))
  with check ((select my_role()) = 'supplier' and exists (
    select 1 from items i where i.id = item_id and i.supplier_id in (select my_suppliers())));

-- Sign-up: a supplier picks one or more supplier units. p_unit_id is the
-- main one; p_supplier_ids may add more.
create function register_profile(p_first_name text, p_last_name text,
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
  end if;
  return v_row;
end $$;
grant execute on function register_profile(text, text, text, user_role, uuid, uuid[]) to authenticated;

-- The previous web build's call, with one unit. Drop it once that build is gone.
create or replace function register_profile(p_first_name text, p_last_name text,
  p_service_number text, p_role user_role, p_unit_id uuid)
returns users language sql security definer set search_path = public as $$
  select register_profile(p_first_name, p_last_name, p_service_number, p_role, p_unit_id, null)
$$;

-- Moving a user puts them in exactly the one unit they are moved to.
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
      role = case v_kind when 'company' then 'customer'::user_role else 'supplier'::user_role end
  where id = p_user;
  delete from user_suppliers where user_id = p_user and supplier_id <> p_unit;
end $$;

-- Catalog work: a supplier edits the catalog of any of its units.
create or replace function merge_item(p_source uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from items where id = p_source and supplier_id in (select my_suppliers()))
     or my_role() is distinct from 'supplier' then
    raise exception 'not your catalog';
  end if;
  perform merge_items(p_source, p_target);
  update items set verified = true where id = p_target;
end $$;

create or replace function add_item(p_supplier uuid, p_name text) returns uuid
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

  begin
    insert into items (supplier_id, name, verified, created_by)
    values (p_supplier, v_name, v_role = 'supplier', auth.uid())
    returning id into v_id;
  exception when unique_violation then
    -- Someone added the same name a moment ago.
    v_id := find_exact_item(p_supplier, v_name);
  end;
  return v_id;
end $$;
