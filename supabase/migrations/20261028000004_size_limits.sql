-- Security review F7: size limits on user text.
-- The free database holds 500 MB, and a pending user alone could fill it.
-- not valid: existing rows are not re-checked, every new write is.
alter table units add constraint units_name_length check (length(name) <= 50) not valid;
alter table users add constraint users_first_name_length check (length(first_name) <= 50) not valid,
  add constraint users_last_name_length check (length(last_name) <= 50) not valid,
  add constraint users_rejection_reason_length check (length(rejection_reason) <= 500) not valid;
alter table events add constraint events_name_length check (length(name) <= 80) not valid;
alter table items add constraint items_name_length check (length(name) <= 100) not valid;
alter table item_aliases add constraint item_aliases_alias_length check (length(alias) <= 100) not valid;
alter table requests add constraint requests_supplier_note_length check (length(supplier_note) <= 500) not valid;
alter table push_subscriptions add constraint push_subscriptions_endpoint_length check (length(endpoint) <= 1000) not valid,
  add constraint push_subscriptions_keys_length check (length(p256dh) <= 200 and length(auth) <= 200) not valid,
  add constraint push_subscriptions_user_agent_length check (length(user_agent) <= 300) not valid;

-- Customers may add unverified items to any supplier's catalog. A cap per
-- company per day stops one account from flooding the catalogs.
insert into app_config (key, value, client_readable) values ('max_new_items_per_company_day', '30', true)
on conflict (key) do nothing;

-- The body is 20261028000001's (a supplier adds to any of its units), plus the cap.
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

  if v_role = 'customer' and (
    select count(*) from items i join users u on u.id = i.created_by
    where u.unit_id = my_unit() and not i.verified and i.created_at > now() - interval '1 day'
  ) >= config('max_new_items_per_company_day', '30')::int then
    raise exception 'daily limit of new items reached';
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
