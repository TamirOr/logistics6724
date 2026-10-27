-- Row-level security. Every permission in the spec is enforced here or in
-- the triggers of the next migration.

-- Helpers read the caller's profile with definer rights, so policies on
-- users do not recurse. They return null for users who are not approved
-- and active, which makes every policy below deny them.
create function my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from users
  where id = auth.uid() and approval = 'approved' and active
$$;

create function my_unit() returns uuid
language sql stable security definer set search_path = public as $$
  select unit_id from users
  where id = auth.uid() and approval = 'approved' and active
$$;

create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() = 'admin', false)
$$;

create function is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select my_role() is not null
$$;

alter table units enable row level security;
alter table users enable row level security;
alter table events enable row level security;
alter table lists enable row level security;
alter table items enable row level security;
alter table item_aliases enable row level security;
alter table requests enable row level security;
alter table default_quantities enable row level security;
alter table push_subscriptions enable row level security;
alter table app_config enable row level security;

revoke all on all tables in schema public from anon;
revoke all on app_config from authenticated;

-- units: anyone signed in reads active units (the sign-up form needs them).
create policy units_read on units for select to authenticated
  using (active or is_admin());
create policy units_admin_insert on units for insert to authenticated
  with check (is_admin());
create policy units_admin_update on units for update to authenticated
  using (is_admin()) with check (is_admin());

-- users: everyone reads their own profile, admins read all. Writes go
-- through the definer functions in the next migration.
create policy users_read_own on users for select to authenticated
  using (id = auth.uid() or is_admin());
revoke insert, update, delete on users from authenticated;

-- events
create policy events_read on events for select to authenticated using (
  is_admin()
  or (my_role() = 'customer' and exists (
        select 1 from lists l where l.event_id = events.id and l.company_id = my_unit()))
  or (my_role() = 'supplier' and exists (
        select 1 from requests r where r.event_id = events.id and r.supplier_id = my_unit()))
);
revoke insert, update, delete on events from authenticated;

-- lists
create policy lists_read on lists for select to authenticated using (
  is_admin()
  or (my_role() = 'customer' and company_id = my_unit())
  or (my_role() = 'supplier' and exists (
        select 1 from requests r where r.list_id = lists.id and r.supplier_id = my_unit()))
);
revoke insert, update, delete on lists from authenticated;

-- requests. Column-level rules live in the requests_guard trigger.
create policy requests_read on requests for select to authenticated using (
  is_admin()
  or (my_role() = 'customer' and company_id = my_unit())
  or (my_role() = 'supplier' and supplier_id = my_unit())
);
create policy requests_customer_insert on requests for insert to authenticated with check (
  my_role() = 'customer'
  and exists (select 1 from lists l where l.id = list_id and l.company_id = my_unit())
);
create policy requests_update on requests for update to authenticated using (
  (my_role() = 'customer' and company_id = my_unit())
  or (my_role() = 'supplier' and supplier_id = my_unit())
) with check (
  (my_role() = 'customer' and company_id = my_unit())
  or (my_role() = 'supplier' and supplier_id = my_unit())
);
-- Customers delete only what the supplier has not prepared. Ready or
-- partial requests become cancelled instead (see delete_request).
-- Suppliers delete a cancelled request to acknowledge it.
create policy requests_delete on requests for delete to authenticated using (
  (my_role() = 'customer' and company_id = my_unit() and status in ('pending', 'missing'))
  or (my_role() = 'supplier' and supplier_id = my_unit() and status = 'cancelled')
);

-- items: every approved user reads the catalogs. Suppliers edit their own.
-- New items are created through add_item.
create policy items_read on items for select to authenticated using (is_approved());
create policy items_supplier_update on items for update to authenticated
  using (my_role() = 'supplier' and supplier_id = my_unit())
  with check (my_role() = 'supplier' and supplier_id = my_unit());
revoke insert, delete on items from authenticated;

create policy item_aliases_read on item_aliases for select to authenticated using (is_approved());
create policy item_aliases_supplier_write on item_aliases for all to authenticated
  using (my_role() = 'supplier' and exists (
    select 1 from items i where i.id = item_id and i.supplier_id = my_unit()))
  with check (my_role() = 'supplier' and exists (
    select 1 from items i where i.id = item_id and i.supplier_id = my_unit()));

create policy default_quantities_read on default_quantities for select to authenticated
  using (my_role() = 'customer' and company_id = my_unit());
revoke insert, update, delete on default_quantities from authenticated;

-- push subscriptions belong to the device's user. Pending users may
-- subscribe so the approval notification reaches them.
create policy push_subscriptions_own on push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
