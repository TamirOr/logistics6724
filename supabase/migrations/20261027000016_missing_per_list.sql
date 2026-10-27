-- Missing-item notifications are grouped per list (one company in one
-- event) instead of per company and supplier, so two open events no
-- longer merge into one message, the notification opens its event, and a
-- cancelled event sends nothing. All notification wording moves to one
-- function, notification_body.

-- The user-facing text of every push notification. Texts in quotes come
-- verbatim from the spec.
create function notification_body(p_kind text, p_supplier text default null, p_event text default null,
  p_count int default null, p_items text default null)
returns text language sql immutable as $$
  select case p_kind
    when 'approved' then 'החשבון שלך אושר'
    when 'battalion_event' then 'נפתח אירוע חדש: ' || p_event
    when 'ready' then p_supplier || ': הרשימה מוכנה לאיסוף'
      || coalesce(' · חסרים: ' || p_items, '')
    when 'missing' then p_supplier || ': חסרים ' || p_count || ' פריטים: ' || p_items
  end
$$;

create or replace function approve_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only'; end if;
  update users set approval = 'approved', rejection_reason = null,
    approved_at = now(), approved_by = auth.uid()
  where id = p_user and approval <> 'approved';
  if found then
    perform notify('approved', notification_body('approved'), '/', p_user => p_user);
  end if;
end $$;

-- Internal: insert an event and its lists. Callers check permissions.
create or replace function insert_event(p_name text, p_scope event_scope, p_needed_on date, p_needed_by time,
  p_company uuid, p_duplicated_from uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into events (name, scope, needed_on, needed_by, needed_at, created_by, created_by_unit, duplicated_from)
  values (btrim(p_name), p_scope, p_needed_on, p_needed_by, resolve_needed_at(p_needed_on, p_needed_by),
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


-- The queue, now per list and supplier. Rows waiting at deploy move over.
create table missing_queue_v2 (
  list_id uuid not null references lists (id) on delete cascade,
  supplier_id uuid not null references units (id) on delete cascade,
  first_marked_at timestamptz not null default now(),
  send_after timestamptz not null,
  primary key (list_id, supplier_id)
);
create table missing_queue_items_v2 (
  request_id uuid primary key references requests (id) on delete cascade,
  list_id uuid not null,
  supplier_id uuid not null,
  foreign key (list_id, supplier_id) references missing_queue_v2 on delete cascade
);

insert into missing_queue_v2 (list_id, supplier_id, first_marked_at, send_after)
select r.list_id, q.supplier_id, min(q.first_marked_at), min(q.send_after)
from missing_queue_items i
join missing_queue q on q.company_id = i.company_id and q.supplier_id = i.supplier_id
join requests r on r.id = i.request_id
group by r.list_id, q.supplier_id;
insert into missing_queue_items_v2 (request_id, list_id, supplier_id)
select i.request_id, r.list_id, i.supplier_id
from missing_queue_items i join requests r on r.id = i.request_id;

drop table missing_queue_items;
drop table missing_queue;
alter table missing_queue_v2 rename to missing_queue;
alter table missing_queue_items_v2 rename to missing_queue_items;
alter table missing_queue enable row level security;
alter table missing_queue_items enable row level security;
revoke all on missing_queue, missing_queue_items from anon, authenticated;

create or replace function drop_empty_missing_queues() returns void
language sql security definer set search_path = public as $$
  delete from missing_queue q
  where not exists (select 1 from missing_queue_items i
                    where i.list_id = q.list_id and i.supplier_id = q.supplier_id)
$$;

create or replace function requests_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  win interval := (config('missing_window_minutes', '5') || ' minutes')::interval;
  cap interval := (config('missing_window_cap_minutes', '15') || ' minutes')::interval;
  v_supplier text;
  v_missing uuid[];
begin
  -- Missing marks: add to the list's queue. Each mark pushes send_after out
  -- by the window, capped at first mark + cap.
  if new.status = 'missing' and old.status <> 'missing' then
    insert into missing_queue (list_id, supplier_id, first_marked_at, send_after)
    values (new.list_id, new.supplier_id, now(), now() + win)
    on conflict (list_id, supplier_id) do update
      set send_after = least(now() + win, missing_queue.first_marked_at + cap);
    insert into missing_queue_items (request_id, list_id, supplier_id)
    values (new.id, new.list_id, new.supplier_id)
    on conflict (request_id) do nothing;
  elsif old.status = 'missing' and new.status <> 'missing' then
    delete from missing_queue_items where request_id = new.id;
    perform drop_empty_missing_queues();
  end if;

  -- Ready for pickup: the supplier's section of this list has nothing
  -- pending left. Only a supplier's move out of pending triggers it, so
  -- toggling between ready, partial and missing sends nothing new.
  if old.status = 'pending' and new.status in ('ready', 'partial', 'missing')
     and not exists (select 1 from requests r where r.list_id = new.list_id
                     and r.supplier_id = new.supplier_id and r.status = 'pending')
     and exists (select 1 from requests r where r.list_id = new.list_id
                 and r.supplier_id = new.supplier_id and r.status in ('ready', 'partial'))
  then
    select name into v_supplier from units where id = new.supplier_id;
    select array_agg(r.id) into v_missing from requests r
    where r.list_id = new.list_id and r.supplier_id = new.supplier_id and r.status = 'missing';

    -- The ready notification lists what is missing, so the queued missing
    -- notification for this section is not sent separately.
    if v_missing is not null then
      delete from missing_queue_items where request_id = any (v_missing);
      perform drop_empty_missing_queues();
    end if;
    perform notify('ready', notification_body('ready', v_supplier, p_items => item_names(v_missing)),
                   '/events/' || new.event_id, p_company => new.company_id);
  end if;
  return null;
end $$;

-- Sends due queue rows: one notification per list and supplier, linking to
-- the event. Rows of a cancelled event are dropped unsent.
create or replace function flush_missing_queue() returns int
language plpgsql security definer set search_path = public as $$
declare q record; v_ids uuid[]; v_supplier text; v_list lists; v_event events; n int := 0;
begin
  for q in select * from missing_queue where send_after <= now() for update skip locked loop
    select * into v_list from lists where id = q.list_id;
    select * into v_event from events where id = v_list.event_id;
    select array_agg(i.request_id) into v_ids
    from missing_queue_items i join requests r on r.id = i.request_id and r.status = 'missing'
    where i.list_id = q.list_id and i.supplier_id = q.supplier_id;

    if v_ids is not null and v_event.status <> 'cancelled' then
      select name into v_supplier from units where id = q.supplier_id;
      perform notify('missing',
        notification_body('missing', v_supplier, p_count => array_length(v_ids, 1), p_items => item_names(v_ids)),
        '/events/' || v_event.id, p_company => v_list.company_id);
      n := n + 1;
    end if;
    delete from missing_queue where list_id = q.list_id and supplier_id = q.supplier_id;
  end loop;
  return n;
end $$;
