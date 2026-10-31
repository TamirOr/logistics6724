-- The join code did not keep anyone out: admin approval is the real gate,
-- and a code passed around a battalion's WhatsApp groups is not a secret.
-- Any signed-in user may now list the units to sign up to; the units table
-- itself stays readable only to approved users.
--
-- The parameter stays, with a default, because the previous web build still
-- sends a code. join_code() and rotate_join_code() stay for the previous
-- build's admin screen; drop them, new_join_code() and the app_config row in
-- the next release.
create or replace function signup_units(p_join_code text default null)
returns table (id uuid, name text, kind unit_kind)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  return query select u.id, u.name, u.kind from units u where u.active order by u.name;
end $$;
