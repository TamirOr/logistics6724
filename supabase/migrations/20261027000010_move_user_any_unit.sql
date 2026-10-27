-- Admins can move a user to any active unit, company or supplier. The
-- user's role follows the unit: a company makes them a customer, a supplier
-- makes them a supplier. Admins have no unit and cannot be moved.
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
end $$;
