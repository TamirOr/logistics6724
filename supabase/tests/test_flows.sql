-- End-to-end checks of the rules in the spec. Each statement raises on failure.
set client_min_messages = warning;
create schema tst;
create table tst.t (k text primary key, v uuid);

create function tst.act(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user)::text, false)
$$;
create function tst.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; end if; end $$;
create function tst.fails(stmt text, what text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then return; end;
  raise exception 'FAILED (should have raised): %', what;
end $$;
grant usage on schema tst to authenticated, anon;
grant all on tst.t to authenticated;
grant execute on all functions in schema tst to authenticated, anon;

-- Normalization -------------------------------------------------------------
select tst.ok(normalize_he('גריקנים') = 'גריקנ', 'plural and final letter');
select tst.ok(normalize_he('ג׳ריקן מים') = 'גריקנ מ', 'geresh and plural');
select tst.ok(normalize_he('  סוללות   AA ') = 'סולל aa', 'spaces and latin');
select tst.ok(normalize_he('רס"פ') = 'רספ', 'gershayim');

-- Fixtures: two companies, two suppliers, one user each, an admin ---------
insert into units (id, name, kind, sort_order) values
  ('00000000-0000-0000-0000-0000000000c1', 'פלוגה א', 'company', 1),
  ('00000000-0000-0000-0000-0000000000c2', 'פלוגה ב', 'company', 2),
  ('00000000-0000-0000-0000-0000000000a1', 'אפסנאות', 'supplier', 1),
  ('00000000-0000-0000-0000-0000000000a2', 'מטבח', 'supplier', 2);

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'admin@x.il'),
  ('10000000-0000-0000-0000-000000000002', 'cust1@x.il'),
  ('10000000-0000-0000-0000-000000000003', 'cust2@x.il'),
  ('10000000-0000-0000-0000-000000000004', 'store@x.il'),
  ('10000000-0000-0000-0000-000000000005', 'cook@x.il'),
  ('10000000-0000-0000-0000-000000000006', 'new@x.il');

select promote_admin('admin@x.il');

set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select register_profile('רון', 'כהן', '1234567', 'customer', '00000000-0000-0000-0000-0000000000c1');
select tst.act('10000000-0000-0000-0000-000000000003');
select register_profile('דנה', 'לוי', '1234568', 'customer', '00000000-0000-0000-0000-0000000000c2');
select tst.act('10000000-0000-0000-0000-000000000004');
select register_profile('אבי', 'מזרחי', '1234569', 'supplier', '00000000-0000-0000-0000-0000000000a1');
select tst.act('10000000-0000-0000-0000-000000000005');
select register_profile('משה', 'פרץ', '1234570', 'supplier', '00000000-0000-0000-0000-0000000000a2');
select tst.act('10000000-0000-0000-0000-000000000006');
select tst.fails($$select register_profile('א', 'ב', '1234571', 'customer', '00000000-0000-0000-0000-0000000000a1')$$,
  'customer cannot pick a supplier unit');
select tst.fails($$select register_profile('א', 'ב', '1234571', 'admin', null)$$, 'cannot self-register as admin');
select register_profile('נועה', 'בר', '1234571', 'customer', '00000000-0000-0000-0000-0000000000c1');

-- Pending users see only their own profile and nothing else.
select tst.ok((select count(*) from users) = 1, 'pending user sees only self');
select tst.ok((select count(*) from items) = 0, 'pending user sees no items');
select tst.fails($$select create_event('x', 'company')$$, 'pending user cannot open events');
select tst.fails($$select approve_user('10000000-0000-0000-0000-000000000006')$$, 'self-approve');

select tst.act('10000000-0000-0000-0000-000000000001');
select tst.ok((select count(*) from users where approval = 'pending') = 5, 'admin sees pending sign-ups');
select approve_user(id) from users where approval = 'pending' and email <> 'new@x.il';
select reject_user('10000000-0000-0000-0000-000000000006', 'לא מוכר');
reset role;
select tst.ok((select count(*) from notification_outbox where kind = 'approved') = 4, 'approval notifications');
select tst.ok((select rejection_reason from users where email = 'new@x.il') = 'לא מוכר', 'rejection reason');
set role authenticated;

-- Catalog: supplier adds verified items, customer adds an unverified one --
select tst.act('10000000-0000-0000-0000-000000000004');
select add_item('00000000-0000-0000-0000-0000000000a1', 'ג׳ריקן מים');
select add_item('00000000-0000-0000-0000-0000000000a1', 'סוללה AA');
select tst.fails($$select add_item('00000000-0000-0000-0000-0000000000a2', 'מלח')$$,
  'supplier cannot add to another catalog');
select tst.act('10000000-0000-0000-0000-000000000005');
select add_item('00000000-0000-0000-0000-0000000000a2', 'ארגז מנות');

select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok((select name from search_items('00000000-0000-0000-0000-0000000000a1', 'גריקנים') limit 1) = 'ג׳ריקן מים',
  'search finds ג׳ריקן מים from גריקנים');
select tst.ok((select name from search_items('00000000-0000-0000-0000-0000000000a1', 'סול') limit 1) = 'סוללה AA',
  'short prefix matches');
select tst.ok(add_item('00000000-0000-0000-0000-0000000000a1', 'ג''ריקן  מים')
  = (select id from items where name = 'ג׳ריקן מים'), 'exact normalized match reuses the item');
select tst.ok((select count(*) from suggest_items('00000000-0000-0000-0000-0000000000a1', 'ג׳ריקנים')) >= 1,
  'did you mean suggests a match');
select add_item('00000000-0000-0000-0000-0000000000a1', 'ג׳ריקנים גדולים');
select tst.ok(not verified, 'customer item is unverified') from items where name = 'ג׳ריקנים גדולים';

-- Company event: add, mark, collect, auto-close -----------------------------
select tst.fails($$select create_event('x', 'company') from (select tst.act('10000000-0000-0000-0000-000000000004')) s$$,
  'supplier cannot open events');
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'ev1', create_event('תרגיל לילה', 'company', '22:00');
insert into tst.t select 'list1', id from lists where event_id = (select v from tst.t where k = 'ev1');
select tst.ok((select needed_at from events where id = (select v from tst.t where k = 'ev1')) > now(), 'needed_at is in the future');

insert into requests (id, list_id, item_id, quantity, status, supplier_note)
values ('20000000-0000-0000-0000-000000000001', (select v from tst.t where k = 'list1'),
        (select id from items where name = 'ג׳ריקן מים'), 20, 'ready', 'sneaky');
select tst.ok(status = 'pending' and supplier_note is null
                  and supplier_id = '00000000-0000-0000-0000-0000000000a1', 'insert forces pending and fills supplier')
from requests where id = '20000000-0000-0000-0000-000000000001';
insert into requests (id, list_id, item_id, quantity) values
  ('20000000-0000-0000-0000-000000000002', (select v from tst.t where k = 'list1'), (select id from items where name = 'סוללה AA'), 40),
  ('20000000-0000-0000-0000-000000000003', (select v from tst.t where k = 'list1'), (select id from items where name = 'ארגז מנות'), 5);
update requests set urgent = true where id = '20000000-0000-0000-0000-000000000003';
select tst.fails($$update requests set supplier_note = 'x' where id = '20000000-0000-0000-0000-000000000001'$$,
  'customer cannot write supplier note');
select tst.fails($$update requests set status = 'ready' where id = '20000000-0000-0000-0000-000000000001'$$,
  'customer cannot mark ready');
select tst.ok((select quantity from default_quantities where item_id = (select id from items where name = 'סוללה AA')) = 40,
  'default quantity remembered');

-- Other company sees nothing of company 1.
select tst.act('10000000-0000-0000-0000-000000000003');
select tst.ok((select count(*) from requests) = 0, 'company 2 cannot see company 1 requests');
select tst.ok((select count(*) from events) = 0, 'company 2 cannot see company 1 events');
select tst.fails($$insert into requests (list_id, item_id, quantity) values ((select v from tst.t where k = 'list1'), (select id from items limit 1), 1)$$,
  'company 2 cannot insert into company 1 list');

-- Supplier 1 sees only its two requests.
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.ok((select count(*) from requests) = 2, 'supplier sees own requests only');
select tst.ok((select count(*) from events) = 1, 'supplier sees the event');
select tst.fails($$update requests set quantity = 1 where id = '20000000-0000-0000-0000-000000000001'$$,
  'supplier cannot change quantity');
update requests set status = 'ready' where id = '20000000-0000-0000-0000-000000000001';
update requests set status = 'partial', supplied_quantity = 30, supplier_note = 'אין עוד'
  where id = '20000000-0000-0000-0000-000000000002';
reset role;
select tst.ok((select count(*) from notification_outbox where kind = 'ready'
                   and target_company = '00000000-0000-0000-0000-0000000000c1') = 1, 'ready notification once');
set role authenticated;

-- Customer changes quantity of a ready request: back to pending + flag.
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok((select status from list_overview where id = (select v from tst.t where k = 'list1')) = 'in_progress', 'list in progress');
update requests set quantity = 25 where id = '20000000-0000-0000-0000-000000000001';
select tst.ok(status = 'pending' and changed_after_handling, 'quantity change resets status')
from requests where id = '20000000-0000-0000-0000-000000000001';
select tst.act('10000000-0000-0000-0000-000000000004');
update requests set status = 'ready' where id = '20000000-0000-0000-0000-000000000001';
select tst.ok(not changed_after_handling, 'supplier status change clears flag')
from requests where id = '20000000-0000-0000-0000-000000000001';

-- Kitchen marks its request ready.
select tst.act('10000000-0000-0000-0000-000000000005');
update requests set status = 'ready' where id = '20000000-0000-0000-0000-000000000003';

-- Pickup of supplier 1 section, unmark one, collect it again.
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok(mark_collected((select v from tst.t where k = 'list1'), '00000000-0000-0000-0000-0000000000a1') = 2, 'pickup two');
select restore_request('20000000-0000-0000-0000-000000000002');
select tst.ok(status = 'partial', 'unmark returns to partial') from requests where id = '20000000-0000-0000-0000-000000000002';
select mark_collected((select v from tst.t where k = 'list1'), '00000000-0000-0000-0000-0000000000a1');
select tst.ok((select status from events where id = (select v from tst.t where k = 'ev1')) = 'open', 'still open with kitchen ready');
select mark_collected((select v from tst.t where k = 'list1'), '00000000-0000-0000-0000-0000000000a2');
select tst.ok((select status from events where id = (select v from tst.t where k = 'ev1')) = 'closed', 'event auto-closes');
select tst.fails($$insert into requests (list_id, item_id, quantity) values ((select v from tst.t where k = 'list1'), (select id from items where name = 'סוללה AA'), 1)$$,
  'closed event is read-only');
-- Unmarking after auto-close reopens the event.
select restore_request('20000000-0000-0000-0000-000000000003');
select tst.ok((select status from events where id = (select v from tst.t where k = 'ev1')) = 'open', 'unmark reopens event');
select mark_collected((select v from tst.t where k = 'list1'), '00000000-0000-0000-0000-0000000000a2');

-- Duplicate: same items and quantities, all pending, urgent reset.
insert into tst.t select 'ev2', duplicate_event((select v from tst.t where k = 'ev1'), 'תרגיל לילה 2', '21:00');
select tst.ok((select count(*) from requests where event_id = (select v from tst.t where k = 'ev2') and status = 'pending' and not urgent) = 3,
  'duplicate copies three pending requests');
select tst.ok((select quantity from requests r join items i on i.id = r.item_id
                   where r.event_id = (select v from tst.t where k = 'ev2') and i.name = 'ג׳ריקן מים') = 25, 'duplicate keeps quantity');

-- Deleting: pending is removed, ready becomes cancelled, supplier acknowledges.
select tst.ok(delete_request(id) = 'deleted', 'delete pending')
from requests r where event_id = (select v from tst.t where k = 'ev2') and supplier_id = '00000000-0000-0000-0000-0000000000a2';
select tst.act('10000000-0000-0000-0000-000000000004');
update requests set status = 'ready' where event_id = (select v from tst.t where k = 'ev2')
  and item_id = (select id from items where name = 'סוללה AA');
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok(delete_request(id) = 'cancelled', 'delete ready cancels')
from requests where event_id = (select v from tst.t where k = 'ev2') and item_id = (select id from items where name = 'סוללה AA');
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.fails($$update requests set status = 'ready' where status = 'cancelled'$$, 'supplier cannot revive cancelled');
delete from requests where status = 'cancelled';
select tst.ok((select count(*) from requests where event_id = (select v from tst.t where k = 'ev2')) = 1, 'acknowledged cancel removed');

-- Missing items are grouped; flush sends one notification.
update requests set status = 'missing' where event_id = (select v from tst.t where k = 'ev2');
reset role;
select tst.ok((select count(*) from missing_queue_items) = 1, 'missing queued');
update missing_queue set send_after = now() - interval '1 second';
select tst.ok(flush_missing_queue() = 1, 'flush sends one');
select tst.ok((select body from notification_outbox where kind = 'missing') like 'אפסנאות: חסרים 1 פריטים: %', 'missing text');
select tst.ok((select count(*) from missing_queue) = 0, 'queue emptied');

-- Missing then ready in the same section: only the ready notification,
-- listing the missing items.
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'ev3', create_event('אימון', 'company');
insert into requests (list_id, item_id, quantity)
select (select id from lists where event_id = (select v from tst.t where k = 'ev3')), id, 3
from items where supplier_id = '00000000-0000-0000-0000-0000000000a1' and verified;
select tst.act('10000000-0000-0000-0000-000000000004');
update requests set status = 'missing' where event_id = (select v from tst.t where k = 'ev3')
  and item_id = (select id from items where name = 'סוללה AA');
update requests set status = 'ready' where event_id = (select v from tst.t where k = 'ev3') and status = 'pending';
reset role;
select tst.ok((select count(*) from missing_queue_items) = 0, 'ready notification consumed missing queue');
select tst.ok((select body from notification_outbox where kind = 'ready' order by id desc limit 1)
                  = 'אפסנאות: הרשימה מוכנה לאיסוף · חסרים: סוללה AA', 'ready text lists missing');

-- Merge an unverified item into a verified one --------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
insert into requests (list_id, item_id, quantity)
values ((select id from lists where event_id = (select v from tst.t where k = 'ev3')),
        (select id from items where name = 'ג׳ריקנים גדולים'), 7);
select tst.fails($$select merge_item((select id from items where name = 'ג׳ריקנים גדולים'), (select id from items where name = 'ג׳ריקן מים'))$$,
  'customer cannot merge');
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.ok((select suggested_name from merge_suggestions('00000000-0000-0000-0000-0000000000a1') limit 1) = 'ג׳ריקן מים',
  'merge suggestion');
select merge_item((select id from items where name = 'ג׳ריקנים גדולים'), (select id from items where name = 'ג׳ריקן מים'));
select tst.ok((select count(*) from items where name = 'ג׳ריקנים גדולים') = 0, 'merged item gone');
select tst.ok((select count(*) from item_aliases where alias = 'ג׳ריקנים גדולים') = 1, 'alias kept');
select tst.ok((select name from search_items('00000000-0000-0000-0000-0000000000a1', 'גדולים') limit 1) = 'ג׳ריקן מים',
  'alias searchable');

-- Battalion event opens a list for every active company and notifies ----
select tst.act('10000000-0000-0000-0000-000000000001');
insert into tst.t select 'bev', create_event('ביקורת מפקד', 'battalion', '08:00');
select tst.ok((select count(*) from lists where event_id = (select v from tst.t where k = 'bev')) = 2, 'battalion lists');
select tst.fails($$select create_event('x', 'company')$$, 'admin cannot open company event');
select tst.act('10000000-0000-0000-0000-000000000003');
select tst.ok((select count(*) from events) = 1, 'company 2 sees battalion event');
select tst.fails($$select cancel_event((select v from tst.t where k = 'bev'))$$, 'only creator or admin cancels');
select tst.act('10000000-0000-0000-0000-000000000001');
select cancel_event((select v from tst.t where k = 'bev'));
reset role;
select tst.ok((select count(*) from notification_outbox where target_all_customers) = 1, 'battalion notification');
select tst.ok((select count(*) from outbox_subscriptions((select id from notification_outbox where target_all_customers))) = 0,
  'no subscriptions yet');

-- Deactivated users lose access ---------------------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000001');
select set_user_active('10000000-0000-0000-0000-000000000003', false);
select tst.act('10000000-0000-0000-0000-000000000003');
select tst.ok((select count(*) from events) = 0, 'deactivated user sees nothing');
reset role;

-- Keepalive works for anon, which can read no table ----------------------------
set role anon;
select tst.ok(keepalive() is not null, 'anon keepalive');
select tst.fails($$select * from units$$, 'anon cannot read units');
reset role;
