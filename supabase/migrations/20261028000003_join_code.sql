-- Security review F4: strangers do not see the unit roster.
-- Anyone with an email can sign in, so "signed in" is not "one of us".
-- Approved users see active units; the sign-up form gets them only with the
-- battalion's join code, which admins hand out and rotate.
drop policy units_read on units;
create policy units_read on units for select to authenticated
  using (((select is_approved()) and active) or (select is_admin()));

-- Ten digits: easy to type on a phone, too many to guess through the API.
create function new_join_code() returns text
language sql volatile as $$
  select lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 15))::bit(60)::bigint % 10000000000)::text, 10, '0')
$$;

insert into app_config (key, value) values ('join_code', new_join_code())
on conflict (key) do nothing;

-- The units a new user may pick, for a correct join code.
create function signup_units(p_join_code text)
returns table (id uuid, name text, kind unit_kind)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if btrim(coalesce(p_join_code, '')) is distinct from (select value from app_config where key = 'join_code') then
    raise exception 'wrong join code';
  end if;
  return query select u.id, u.name, u.kind from units u where u.active order by u.name;
end $$;
grant execute on function signup_units to authenticated;

create function join_code() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  return (select value from app_config where key = 'join_code');
end $$;
grant execute on function join_code to authenticated;

-- After a leak, or monthly with the access review. Users already signed
-- up are not affected.
create function rotate_join_code() returns text
language plpgsql security definer set search_path = public as $$
declare v_code text := new_join_code();
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update app_config set value = v_code where key = 'join_code';
  return v_code;
end $$;
grant execute on function rotate_join_code to authenticated;
