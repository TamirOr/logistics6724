-- Modeling invariants that lived only in functions:
-- * A user's role matches their unit's kind (customer in a company,
--   supplier in a supplier, admin in none), enforced by a trigger, with
--   the mapping in one helper. A unit's kind is fixed once created.
-- * A notification has exactly one target.
-- * Every event has a date. Events from before needed_on get the date
--   they resolved to, and the "passed today means tomorrow" path is gone.

create function unit_kind_for(p_role user_role) returns unit_kind
language sql immutable as $$
  select case p_role when 'customer' then 'company'::unit_kind when 'supplier' then 'supplier'::unit_kind end
$$;

create function users_role_matches_unit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role <> 'admin'
     and (select kind from units where id = new.unit_id) is distinct from unit_kind_for(new.role) then
    raise exception 'role % does not match the unit', new.role;
  end if;
  return new;
end $$;

create trigger users_role_matches_unit before insert or update of role, unit_id on users
for each row execute function users_role_matches_unit();

create function units_kind_is_fixed() returns trigger
language plpgsql as $$
begin
  if new.kind <> old.kind then raise exception 'a unit cannot change kind'; end if;
  return new;
end $$;

create trigger units_kind_is_fixed before update of kind on units
for each row execute function units_kind_is_fixed();

create or replace function register_profile(p_first_name text, p_last_name text,
  p_service_number text, p_role user_role, p_unit_id uuid)
returns users language plpgsql security definer set search_path = public as $$
declare
  v_kind unit_kind;
  v_email text;
  v_row users;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_role not in ('customer', 'supplier') then raise exception 'invalid role'; end if;
  select kind into v_kind from units where id = p_unit_id and active;
  if v_kind is distinct from unit_kind_for(p_role) then
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
  return v_row;
end $$;

alter table notification_outbox add constraint notification_outbox_one_target
  check (num_nonnulls(target_user, target_company, nullif(target_all_customers, false)) = 1);

-- Every event has a date.
update events
set needed_on = (coalesce(needed_at, created_at) at time zone config('timezone', 'Asia/Jerusalem'))::date
where needed_on is null;
alter table events alter column needed_on set not null;

drop function resolve_needed_at(date, time, timestamptz);
create function resolve_needed_at(p_needed_on date, p_needed_by time) returns timestamptz
language sql stable as $$
  select (p_needed_on + coalesce(p_needed_by, time '00:00')) at time zone config('timezone', 'Asia/Jerusalem')
$$;

-- Internal: insert an event and its lists. Callers check permissions.
create or replace function insert_event(p_name text, p_scope event_scope, p_needed_on date, p_needed_by time,
  p_company uuid, p_duplicated_from uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_on date := coalesce(p_needed_on, (now() at time zone config('timezone', 'Asia/Jerusalem'))::date);
begin
  insert into events (name, scope, needed_on, needed_by, needed_at, created_by, created_by_unit, duplicated_from)
  values (btrim(p_name), p_scope, v_on, p_needed_by, resolve_needed_at(v_on, p_needed_by),
          auth.uid(), my_unit(), p_duplicated_from)
  returning id into v_id;

  if p_scope = 'company' then
    insert into lists (event_id, company_id) values (v_id, p_company);
  else
    insert into lists (event_id, company_id)
    select v_id, id from units where kind = 'company' and active;
    perform notify('battalion_event', notification_body('battalion_event', p_event => btrim(p_name)),
                   '/events/' || v_id, p_all_customers => true);
  end if;
  return v_id;
end $$;
