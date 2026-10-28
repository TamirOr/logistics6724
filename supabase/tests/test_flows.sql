-- End-to-end checks of the rules in the spec. Each statement raises on failure.
set client_min_messages = warning;
create schema tst;
create table tst.t (k text primary key, v uuid);

-- Signs in as p_user. aal2 unless told otherwise: admins need a second factor.
create function tst.act(p_user uuid, p_aal text default 'aal2') returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'aal', p_aal)::text, false)
$$;
create function tst.ok(cond boolean, what text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAILED: %', what; end if; end $$;
create function tst.fails(stmt text, what text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then return; end;
  raise exception 'FAILED (should have raised): %', what;
end $$;
grant usage on schema tst to authenticated, anon, service_role;
grant all on tst.t to authenticated;
grant execute on all functions in schema tst to authenticated, anon, service_role;

-- Normalization -------------------------------------------------------------
select tst.ok(normalize_he('גריקנים') = 'גריקנ', 'plural and final letter');
select tst.ok(normalize_he('ג׳ריקן מים') = 'גריקנ מ', 'geresh and plural');
select tst.ok(normalize_he('  סוללות   AA ') = 'סולל aa', 'spaces and latin');
select tst.ok(normalize_he('רס"פ') = 'רספ', 'gershayim');

-- Fixtures: two companies, two suppliers, one user each, an admin ---------
insert into units (id, name, kind, headcount) values
  ('00000000-0000-0000-0000-0000000000c1', 'פלוגה א', 'company', 120),
  ('00000000-0000-0000-0000-0000000000c2', 'פלוגה ב', 'company', null),
  ('00000000-0000-0000-0000-0000000000a1', 'אפסנאות', 'supplier', null),
  ('00000000-0000-0000-0000-0000000000a2', 'מטבח', 'supplier', null);

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
select tst.ok((select count(*) from match_item('00000000-0000-0000-0000-0000000000a1', 'ג׳ריקנים') where not exact) >= 1,
  'did you mean suggests a match');
select add_item('00000000-0000-0000-0000-0000000000a1', 'ג׳ריקנים גדולים');
select tst.ok(not verified, 'customer item is unverified') from items where name = 'ג׳ריקנים גדולים';

-- Company event: add, mark, collect, auto-close -----------------------------
select tst.fails($$select create_event('x', 'company') from (select tst.act('10000000-0000-0000-0000-000000000004')) s$$,
  'supplier cannot open events');
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'ev1', create_event('תרגיל לילה', 'company', '22:00');
insert into tst.t select 'list1', id from lists where event_id = (select v from tst.t where k = 'ev1');
select tst.ok((select needed_at from events where id = (select v from tst.t where k = 'ev1'))
  = ((now() at time zone 'Asia/Jerusalem')::date + time '22:00') at time zone 'Asia/Jerusalem', 'a time without a date means today');

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

-- Customer note: the company writes it, the supplier only reads it.
select tst.act('10000000-0000-0000-0000-000000000002');
update requests set customer_note = '  מידה L  ' where id = '20000000-0000-0000-0000-000000000001';
select tst.ok(customer_note = 'מידה L' and status = 'ready' and not changed_after_handling,
  'customer note is trimmed and leaves a handled request as it was')
from requests where id = '20000000-0000-0000-0000-000000000001';
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.ok((select customer_note from requests where id = '20000000-0000-0000-0000-000000000001') = 'מידה L',
  'supplier reads the customer note');
select tst.fails($$update requests set customer_note = 'x' where id = '20000000-0000-0000-0000-000000000001'$$,
  'supplier cannot write customer note');
select tst.act('10000000-0000-0000-0000-000000000002');
update requests set customer_note = ' ' where id = '20000000-0000-0000-0000-000000000001';
select tst.ok(customer_note is null, 'a blank customer note clears it')
from requests where id = '20000000-0000-0000-0000-000000000001';

-- Kitchen marks its request ready.
select tst.act('10000000-0000-0000-0000-000000000005');
update requests set status = 'ready' where id = '20000000-0000-0000-0000-000000000003';

-- Pickup of supplier 1 section, unmark one, collect it again.
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok(mark_collected((select v from tst.t where k = 'list1'), '00000000-0000-0000-0000-0000000000a1') = 2, 'pickup two');
select restore_request('20000000-0000-0000-0000-000000000002');
select tst.ok(status = 'partial', 'unmark returns to partial') from requests where id = '20000000-0000-0000-0000-000000000002';
select tst.fails($$update requests set customer_note = 'x' where id = '20000000-0000-0000-0000-000000000001'$$,
  'customer cannot note a collected request');
select mark_collected((select v from tst.t where k = 'list1'), '00000000-0000-0000-0000-0000000000a1');
select tst.ok((select status from events where id = (select v from tst.t where k = 'ev1')) = 'open', 'still open with kitchen ready');
select mark_collected((select v from tst.t where k = 'list1'), '00000000-0000-0000-0000-0000000000a2');
select tst.ok((select status from events where id = (select v from tst.t where k = 'ev1')) = 'open', 'done event stays open during the quiet period');
reset role;
select tst.ok(close_finished_events() = 0, 'the default 30-minute quiet period has not passed');
select tst.ok(close_finished_events(interval '0') = 1, 'the job closes the finished event');
set role authenticated;
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

-- The health probe works for anon, which can read no table ------------------------
set role anon;
select tst.ok(health() = '{"ok": true}', 'anon health probe');
select tst.fails($$select * from units$$, 'anon cannot read units');
reset role;

-- A battalion event stays open while another company has not filled its list --
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000001');
select set_user_active('10000000-0000-0000-0000-000000000003', true);
insert into tst.t select 'bev2', create_event('יום ספורט', 'battalion');
select tst.act('10000000-0000-0000-0000-000000000002');
insert into requests (list_id, item_id, quantity)
values ((select id from lists where event_id = (select v from tst.t where k = 'bev2')
         and company_id = '00000000-0000-0000-0000-0000000000c1'), (select id from items where name = 'סוללה AA'), 2);
select tst.act('10000000-0000-0000-0000-000000000004');
update requests set status = 'ready' where event_id = (select v from tst.t where k = 'bev2');
select tst.act('10000000-0000-0000-0000-000000000002');
select mark_collected((select id from lists where event_id = (select v from tst.t where k = 'bev2')
  and company_id = '00000000-0000-0000-0000-0000000000c1'), '00000000-0000-0000-0000-0000000000a1');
reset role;
select close_finished_events(interval '0');
set role authenticated;
select tst.ok((select status from events where id = (select v from tst.t where k = 'bev2')) = 'open',
  'battalion event stays open while company 2 list is empty');
select tst.act('10000000-0000-0000-0000-000000000003');
insert into requests (list_id, item_id, quantity)
values ((select id from lists where event_id = (select v from tst.t where k = 'bev2')
         and company_id = '00000000-0000-0000-0000-0000000000c2'), (select id from items where name = 'סוללה AA'), 1);
select tst.act('10000000-0000-0000-0000-000000000004');
update requests set status = 'ready' where event_id = (select v from tst.t where k = 'bev2') and status = 'pending';
select tst.act('10000000-0000-0000-0000-000000000003');
select mark_collected((select id from lists where event_id = (select v from tst.t where k = 'bev2')
  and company_id = '00000000-0000-0000-0000-0000000000c2'), '00000000-0000-0000-0000-0000000000a1');
reset role;
select close_finished_events(interval '0');
set role authenticated;
select tst.ok((select status from events where id = (select v from tst.t where k = 'bev2')) = 'closed',
  'battalion event closes once every list is filled and done');

-- Customers cannot reopen a closed event; only unmarking a pickup does -------
select tst.act('10000000-0000-0000-0000-000000000001');
insert into tst.t select 'bev3', create_event('מסדר', 'battalion');
select close_event((select v from tst.t where k = 'bev3'));
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$update events set status = 'open' where id = (select v from tst.t where k = 'bev3')$$,
  'customer reopens an event directly');
select tst.ok(not exists (select 1 from pg_proc where proname = 'reopen_event'), 'no reopen RPC exposed');
reset role;
select tst.ok((select status from events where id = (select v from tst.t where k = 'bev3')) = 'closed',
  'admin-closed event stays closed');

-- An admin cannot deactivate themselves --------------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000001');
select tst.fails($$select set_user_active('10000000-0000-0000-0000-000000000001', false)$$, 'admin deactivates self');
reset role;
select tst.ok((select active from users where id = '10000000-0000-0000-0000-000000000001'), 'admin still active');

-- Events with a date ------------------------------------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'dated', create_event('אימון שטח', 'company', '06:30', '2026-11-03');
select tst.ok(needed_on = '2026-11-03' and needed_by = '06:30'
  and needed_at = timestamptz '2026-11-03 06:30 Asia/Jerusalem', 'date and time resolve to needed_at')
from events where id = (select v from tst.t where k = 'dated');
insert into tst.t select 'dated2', duplicate_event((select v from tst.t where k = 'dated'), 'אימון שטח 2', null, '2026-11-10');
select tst.ok(needed_on = '2026-11-10' and needed_by is null
  and needed_at = timestamptz '2026-11-10 00:00 Asia/Jerusalem', 'duplicate takes a new date')
from events where id = (select v from tst.t where k = 'dated2');
select tst.ok(exists (select 1 from information_schema.columns
  where table_name = 'export_rows' and column_name = 'needed_on'), 'export_rows has needed_on');
select tst.ok(not exists (select 1 from pg_proc where proname = 'create_event' and pronargs = 3), 'old create_event overload is gone');
reset role;

-- List overviews filter by event status -------------------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok((select count(*) from list_overview where event_status = 'open')
  = (select count(*) from lists l join events e on e.id = l.event_id where e.status = 'open'),
  'list_overview event_status matches the events');
reset role;

-- Headcount (סד״כ) belongs to companies only ------------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000001');
update units set headcount = 95 where id = '00000000-0000-0000-0000-0000000000c2';
select tst.fails($$update units set headcount = 10 where id = '00000000-0000-0000-0000-0000000000a1'$$, 'supplier headcount');
select tst.fails($$update units set headcount = -1 where id = '00000000-0000-0000-0000-0000000000c2'$$, 'negative headcount');
select tst.act('10000000-0000-0000-0000-000000000002');
update units set headcount = 1 where id = '00000000-0000-0000-0000-0000000000c1';
reset role;
select tst.ok((select headcount from units where id = '00000000-0000-0000-0000-0000000000c1') = 120,
  'a customer cannot change headcount');
select tst.ok((select headcount from units where id = '00000000-0000-0000-0000-0000000000c2') = 95, 'admin sets headcount');

-- Moving users between companies and suppliers ------------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000001');
select move_user('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2');
reset role;
select tst.ok(role = 'supplier' and unit_id = '00000000-0000-0000-0000-0000000000a2', 'company user moved to a supplier becomes a supplier')
from users where id = '10000000-0000-0000-0000-000000000003';
set role authenticated;
select move_user('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000c2');
reset role;
select tst.ok(role = 'customer' and unit_id = '00000000-0000-0000-0000-0000000000c2', 'and back to a company as a customer')
from users where id = '10000000-0000-0000-0000-000000000003';
set role authenticated;
select tst.fails($$select move_user('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1')$$, 'moving an admin');
update units set active = false where id = '00000000-0000-0000-0000-0000000000a2';
select tst.fails($$select move_user('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a2')$$, 'moving to an inactive unit');
update units set active = true where id = '00000000-0000-0000-0000-0000000000a2';
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.fails($$select move_user('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1')$$, 'non-admin moves a user');
reset role;

-- Marking the last request missing keeps the event open for undo -----------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'quiet', create_event('בדיקת שקט', 'company', null, '2026-11-05');
insert into requests (list_id, item_id, quantity)
values ((select id from lists where event_id = (select v from tst.t where k = 'quiet')), (select id from items where name = 'סוללה AA'), 4);
select tst.act('10000000-0000-0000-0000-000000000004');
update requests set status = 'missing' where event_id = (select v from tst.t where k = 'quiet');
select tst.ok((select status from events where id = (select v from tst.t where k = 'quiet')) = 'open', 'still open right after the last missing');
update requests set status = 'ready' where event_id = (select v from tst.t where k = 'quiet');
select tst.ok((select status from requests where event_id = (select v from tst.t where k = 'quiet')) = 'ready', 'supplier undoes missing to ready');
reset role;
select tst.ok(close_finished_events(interval '0') = 0, 'a ready request keeps the event open');

-- The creator of a battalion event can close it; another customer cannot ---------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'bev-own', create_event('מטווח', 'battalion', null, '2026-11-06');
select tst.act('10000000-0000-0000-0000-000000000003');
select tst.fails($$select close_event((select v from tst.t where k = 'bev-own'))$$, 'another company closes a battalion event');
select tst.act('10000000-0000-0000-0000-000000000002');
select close_event((select v from tst.t where k = 'bev-own'));
reset role;
select tst.ok((select status from events where id = (select v from tst.t where k = 'bev-own')) = 'closed', 'creator closes battalion event');

-- An item used in a cancelled event can still be merged ---------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'cancelled-ev', create_event('אירוע שבוטל', 'company', null, '2026-11-07');
select add_item('00000000-0000-0000-0000-0000000000a1', 'מנורת ראש');
insert into requests (list_id, item_id, quantity)
values ((select id from lists where event_id = (select v from tst.t where k = 'cancelled-ev')), (select id from items where name = 'מנורת ראש'), 2);
select cancel_event((select v from tst.t where k = 'cancelled-ev'));
select tst.fails($$update requests set quantity = 3 where event_id = (select v from tst.t where k = 'cancelled-ev')$$,
  'customer edits a request in a cancelled event');
select tst.act('10000000-0000-0000-0000-000000000004');
select add_item('00000000-0000-0000-0000-0000000000a1', 'פנס ראש');
select merge_item((select id from items where name = 'מנורת ראש'), (select id from items where name = 'פנס ראש'));
reset role;
select tst.ok((select i.name from requests r join items i on i.id = r.item_id
               where r.event_id = (select v from tst.t where k = 'cancelled-ev')) = 'פנס ראש', 'merge moves requests of a cancelled event');

-- A customer duplicating a battalion event copies only their own company --------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000003');
insert into tst.t select 'bev2-dup', duplicate_event((select v from tst.t where k = 'bev2'), 'יום ספורט 2', null, '2026-11-12');
reset role;
select tst.ok((select count(*) from requests where event_id = (select v from tst.t where k = 'bev2-dup')
               and company_id = '00000000-0000-0000-0000-0000000000c1') = 0, 'no rows written into another company');
select tst.ok((select count(*) from requests where event_id = (select v from tst.t where k = 'bev2-dup')
               and company_id = '00000000-0000-0000-0000-0000000000c2') = 1, 'own company requests copied');

-- Catalog matching ---------------------------------------------------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok((select name from match_item('00000000-0000-0000-0000-0000000000a1', 'גריקן מים') where exact) = 'ג׳ריקן מים',
  'match_item finds the exact match despite the missing geresh');
select tst.ok((select count(*) from match_item('00000000-0000-0000-0000-0000000000a1', 'גריקן מים')) = 1,
  'an exact match comes alone, without suggestions');
select tst.ok(not exists (select 1 from match_item('00000000-0000-0000-0000-0000000000a1', 'גריקן') where exact), 'exact is not fuzzy');
select tst.ok((select bool_and(similarity <= score) from search_items('00000000-0000-0000-0000-0000000000a1', 'סול')),
  'similarity excludes the ranking boost');
-- The previous app build still calls exact_item and suggest_items.
select tst.ok((select name from exact_item('00000000-0000-0000-0000-0000000000a1', 'גריקן מים')) = 'ג׳ריקן מים',
  'exact_item still answers the previous build');
select tst.ok((select count(*) from suggest_items('00000000-0000-0000-0000-0000000000a1', 'ג׳ריקנים')) >= 1,
  'suggest_items still answers the previous build');
reset role;
set role anon;
select tst.fails($$select * from suggest_items('00000000-0000-0000-0000-0000000000a1', 'x')$$, 'anon calls suggest_items');
reset role;
select tst.fails($$insert into items (supplier_id, name, verified) values ('00000000-0000-0000-0000-0000000000a1', 'ג''ריקן  מים', true)$$,
  'a second active item with the same normalized name');
update items set active = false where name = 'סוללה AA';
set role authenticated;
select tst.fails($$select add_item('00000000-0000-0000-0000-0000000000a1', 'סוללה AA')$$, 'customer revives a hidden item');
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.ok(add_item('00000000-0000-0000-0000-0000000000a1', 'סוללה  AA') = (select id from items where name = 'סוללה AA'),
  'supplier adding a hidden name unhides it');
reset role;
select tst.ok((select active from items where name = 'סוללה AA'), 'item active again');

-- Missing items are grouped per event and link to it; cancelled events stay quiet --
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'miss-a', create_event('חסרים א', 'company', null, '2026-11-08');
insert into tst.t select 'miss-b', create_event('חסרים ב', 'company', null, '2026-11-09');
insert into requests (list_id, item_id, quantity)
select l.id, i.id, 1 from lists l, items i
where l.event_id in ((select v from tst.t where k = 'miss-a'), (select v from tst.t where k = 'miss-b'))
  and i.supplier_id = '00000000-0000-0000-0000-0000000000a1' and i.active and i.verified
  and i.name in ('סוללה AA', 'ג׳ריקן מים');
select tst.act('10000000-0000-0000-0000-000000000004');
update requests set status = 'missing'
where event_id in ((select v from tst.t where k = 'miss-a'), (select v from tst.t where k = 'miss-b'))
  and item_id = (select id from items where name = 'סוללה AA');
select tst.act('10000000-0000-0000-0000-000000000002');
select cancel_event((select v from tst.t where k = 'miss-b'));
reset role;
truncate notification_outbox;
select tst.ok((select count(*) from missing_queue) = 2, 'one queue row per event');
update missing_queue set send_after = now() - interval '1 second';
select tst.ok(flush_missing_queue() = 1, 'only the live event sends');
select tst.ok((select url from notification_outbox where kind = 'missing') = '/events/' || (select v from tst.t where k = 'miss-a'),
  'missing notification opens its event');
select tst.ok((select body from notification_outbox where kind = 'missing') = 'אפסנאות: חסרים 1 פריטים: סוללה AA', 'missing text');
select tst.ok((select count(*) from missing_queue) = 0, 'queue emptied, cancelled event included');

-- Model invariants --------------------------------------------------------------
reset role;
select tst.fails($$update users set role = 'supplier' where id = '10000000-0000-0000-0000-000000000002'$$,
  'a customer in a company cannot become a supplier without moving');
select tst.fails($$update units set kind = 'supplier' where id = '00000000-0000-0000-0000-0000000000c1'$$, 'a unit changes kind');
select tst.fails($$insert into notification_outbox (kind, body) values ('x', 'no target')$$, 'a notification without a target');
select tst.fails($$insert into notification_outbox (kind, body, target_user, target_all_customers)
  values ('x', 'two targets', '10000000-0000-0000-0000-000000000002', true)$$, 'a notification with two targets');
select tst.ok(not exists (select 1 from events where needed_on is null), 'every event has a date');
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
insert into tst.t select 'no-date', create_event('בלי תאריך', 'company');
reset role;
select tst.ok(needed_on = (now() at time zone 'Asia/Jerusalem')::date, 'an event without a date defaults to today')
from events where id = (select v from tst.t where k = 'no-date');

-- open_requests shows only open events, within row-level security --------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000004');
select tst.ok(not exists (select 1 from open_requests o join events e on e.id = o.event_id where e.status <> 'open'),
  'open_requests has no closed or cancelled events');
select tst.ok(not exists (select 1 from open_requests where supplier_id <> '00000000-0000-0000-0000-0000000000a1'),
  'open_requests keeps row-level security');
select tst.ok((select count(*) from open_requests) > 0, 'open_requests has the supplier''s open work');
reset role;

-- A shared phone's push subscription follows the signed-in user -------------------
set role authenticated;
select tst.act('10000000-0000-0000-0000-000000000002');
select register_push_subscription('https://fcm.googleapis.com/fcm/send/abc', 'k', 'a');
select tst.act('10000000-0000-0000-0000-000000000004');
select register_push_subscription('https://fcm.googleapis.com/fcm/send/abc', 'k2', 'a2');
select tst.ok((select count(*) from push_subscriptions) = 1, 'the new user owns the phone''s subscription');
select tst.act('10000000-0000-0000-0000-000000000002');
select tst.ok((select count(*) from push_subscriptions) = 0, 'the previous user no longer has it');
reset role;
select tst.ok((select user_id from push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/abc')
  = '10000000-0000-0000-0000-000000000004', 'subscription moved');
delete from push_subscriptions;
