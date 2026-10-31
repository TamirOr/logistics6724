-- Comments: general remarks on a company's list, beside the per-request
-- notes ("נגיע לאסוף ב-14:00", "חסר לנו מקרר, מה אפשר במקום?"). A list
-- holds any number of them, oldest first, from both sides:
--   - the company writes to every supplier of the list (supplier_id null)
--     or to one supplier;
--   - a supplier writes to the company, always as one of its supplier units.
-- A supplier sees those between the company and itself, and the company's
-- general ones on lists that have requests for it. Comments are not edited;
-- the side that wrote one deletes it while the event is open.

create table list_comments (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists (id) on delete cascade,
  -- Copied from the list by trigger, for RLS and the open-event check.
  event_id uuid not null references events (id) on delete cascade,
  company_id uuid not null references units (id),
  -- The supplier the comment is between the company and; null for a company comment to every supplier.
  supplier_id uuid references units (id) on delete cascade,
  side user_role not null check (side in ('customer', 'supplier')),
  body text not null check (btrim(body) <> '' and length(body) <= 500),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (side = 'customer' or supplier_id is not null)
);
create index list_comments_list_idx on list_comments (list_id);

-- Fills in what the client does not choose: the list's event and company,
-- the writer's side and the time. Only open events take comments.
create function list_comments_before_insert() returns trigger
language plpgsql set search_path = public as $$
declare v_event_status event_status;
begin
  select l.event_id, l.company_id, e.status into new.event_id, new.company_id, v_event_status
  from lists l join events e on e.id = l.event_id where l.id = new.list_id;
  if is_client() then
    if v_event_status is distinct from 'open' then raise exception 'event is not open'; end if;
    new.side := my_role();
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  if new.supplier_id is not null
     and not exists (select 1 from units where id = new.supplier_id and kind = 'supplier') then
    raise exception 'not a supplier';
  end if;
  new.body := btrim(new.body);
  return new;
end $$;

create trigger list_comments_before_insert before insert on list_comments
for each row execute function list_comments_before_insert();

create function list_comments_before_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if is_client() and (select status from events where id = old.event_id) <> 'open' then
    raise exception 'event is not open';
  end if;
  return old;
end $$;

create trigger list_comments_before_delete before delete on list_comments
for each row execute function list_comments_before_delete();

alter table list_comments enable row level security;
revoke all on list_comments from anon;
revoke update on list_comments from authenticated;

create policy list_comments_read on list_comments for select to authenticated using (
  (select is_admin())
  or ((select my_role()) = 'customer' and company_id = (select my_unit()))
  or ((select my_role()) = 'supplier' and (
        supplier_id in (select my_suppliers())
        or (supplier_id is null and exists (
              select 1 from requests r where r.list_id = list_comments.list_id and r.supplier_id in (select my_suppliers())))))
);
-- company_id and side are set by list_comments_before_insert, which runs before this check.
create policy list_comments_insert on list_comments for insert to authenticated with check (
  ((select my_role()) = 'customer' and side = 'customer' and company_id = (select my_unit()))
  or ((select my_role()) = 'supplier' and side = 'supplier' and supplier_id in (select my_suppliers())
      and exists (select 1 from requests r where r.list_id = list_comments.list_id and r.supplier_id = list_comments.supplier_id))
);
create policy list_comments_delete on list_comments for delete to authenticated using (
  ((select my_role()) = 'customer' and side = 'customer' and company_id = (select my_unit()))
  or ((select my_role()) = 'supplier' and side = 'supplier' and supplier_id in (select my_suppliers()))
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table list_comments;
  end if;
end $$;
